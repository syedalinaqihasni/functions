/**
 * One-time migration script for Square Trivia Firestore
 * Run: node scripts/migrate.js
 */

const admin = require("firebase-admin");

// Use your Firebase project credentials (service account JSON)
const serviceAccount = require("../../serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// User Collection Schema
const UserSchema = {
  // Required fields
  email: '', // string - validated email
  createdAt: null, // Timestamp - account creation
  
  // Profile fields
  telegramUsername: null, // string - @username format (OPTIONAL)
  phone: null, // string - +1XXXXXXXXXX format
  hasTelegram: false, // boolean - tracks if user has added Telegram
  telegramPromptDismissed: false, // boolean - if user dismissed Telegram prompts
  preferredNotificationMethod: 'email', // string - 'email', 'telegram', 'both'
  referralCode: null, // string - unique 6-char code
  referredBy: null, // string - referral code used
  
  // Financial fields
  totalDonations: 0, // number - lifetime donation total
  lifetimeValue: 0, // number - total value including prizes
  currentTiers: [], // array - active tier IDs ['tier_25', 'tier_50']
  lastDonation: null, // Timestamp - most recent donation
  
  // Payout preferences
  payoutMethod: {
    type: null, // string - 'paypal', 'venmo', 'zelle', 'check', 'crypto'
    details: {}, // object - method-specific details
    verified: false // boolean - payout method verified
  },
  instantPayoutPreference: false, // boolean - user's default choice for instant payouts
  totalInstantPayoutFees: 0, // number - lifetime instant fees paid
  
  // Tax information
  taxInfo: {
    ssn_last4: null, // string - last 4 digits only
    fullName: null, // string - legal name
    address: null, // object - mailing address
    w9_submitted: false, // boolean
    total_annual_winnings: 0 // number - for 1099 tracking
  },
  
  // Activity tracking
  lastActive: null, // Timestamp
  loginCount: 0, // number
  gamesPlayed: 0, // number
  squaresWon: 0, // number
  totalWinnings: 0, // number - lifetime prize total
  
  // SKILL-BASED: New stats
  triviaCorrect: 0, // number - correct trivia answers
  triviaIncorrect: 0, // number - incorrect trivia answers
  squaresPlaced: 0, // number - total squares placed
  
  // Preferences
  notifications: {
    email: true,
    telegram: true,
    sms: false,
    marketing: true
  },
  
  // System fields
  isAdmin: false, // boolean
  isBanned: false, // boolean
  banReason: null, // string
  metadata: {} // object - for future use
};

// Donation Collection Schema - COMPLETE VERSION
const DonationSchema = {
  // Core fields
  userId: '', // string - Firebase Auth UID
  amount: 0, // number - donation amount
  tierId: '', // string - 'tier_25', 'tier_50', etc.
  
  // Payment details
  stripePaymentIntentId: '', // string
  paymentMethod: '', // string - 'card', 'apple_pay', 'google_pay', etc.
  paymentMethodDetails: {}, // object - card last4, brand, etc.
  currency: 'usd', // string
  payoutPercentage: 0, // number - 0.77 or 0.80 based on tier
  
  // Status tracking
  status: 'pending_payout', // string - 'pending_payout', 'completed', 'failed', 'refunded'
  completedAt: null, // Timestamp - when payment completed
  failedAt: null, // Timestamp - if payment failed
  failureReason: null, // string - reason for failure
  
  // Access management
  telegramUsername: null, // string - for group access (OPTIONAL)
  telegramAccessGranted: false, // boolean
  hasTelegram: false, // boolean - whether user provided Telegram
  webOnlyAccess: false, // boolean - user chose web-only access
  accessExpiresAt: null, // Timestamp - 30 days from completion
  
  // Refund tracking
  refundedAt: null, // Timestamp
  refundAmount: 0, // number - partial refunds allowed
  refundReason: null, // string
  refundRequestedBy: null, // string - 'user' or 'admin'
  
  // Free entries earned
  freeEntriesGranted: 0, // number - based on donation amount
  
  // Metadata
  createdAt: null, // Timestamp
  updatedAt: null, // Timestamp
  ipAddress: null, // string - for fraud detection
  userAgent: null, // string - browser info
  metadata: {} // object - additional Stripe data, promo codes, etc.
};

// Game Collection Schema
const GameSchema = {
  // Game identification
  sport: '', // string - 'NFL', 'NBA', 'NCAA_FB', 'NCAA_BB'
  apiSportsId: '', // string - CRITICAL for live updates
  gameType: 'regular', // string - 'regular', 'playoff', 'championship'
  
  // Teams
  teams: {
    home: '', // string - team name
    away: '', // string - team name
  },
  
  // Scheduling
  startTime: null, // Timestamp
  actualStartTime: null, // Timestamp - when game actually started
  
  // Status tracking
  status: 'scheduled', // string - 'scheduled', 'active', 'completed', 'cancelled'
  
  // Score tracking
  scores: {
    q1: { home: null, away: null },
    q2: { home: null, away: null },
    q3: { home: null, away: null },
    q4: { home: null, away: null },
    ot: { home: null, away: null }, // if applicable
    final: { home: null, away: null }
  },
  
  // Processing status
  processedQuarters: {
    q1: false,
    q2: false,
    q3: false,
    q4: false,
    ot: false
  },
  
  // API monitoring
  lastApiCheck: null, // Timestamp
  lastApiStatus: null, // string - last API response status
  apiCheckCount: 0, // number - total API calls made
  
  // Manual overrides
  manualScoreEntry: false, // boolean
  manualScores: {}, // object - admin-entered scores
  
  // Metadata
  createdAt: null, // Timestamp
  createdBy: '', // string - admin user ID
  completedAt: null, // Timestamp
  cancelledAt: null, // Timestamp
  cancelReason: null // string
};

// Board Collection Schema - UPDATED FOR SKILL-BASED SYSTEM
const BoardSchema = {
  // Board identification
  gameId: '', // string - reference to game
  tierId: '', // string - 'tier_25', 'tier_50', etc.
  gameType: '', // string - copied from game for querying
  
  // SKILL-BASED: Updated square management
  // Each position can have up to 2 claims
  // Structure: { position: { claims: [{userId, claimId, answerTimeSeconds}...], isFull: boolean }}
  squares: {}, // object - position -> square data
  maxSquares: 50, // number - always 50
  
  // SKILL-BASED: New fields
  maxPlayersPerSquare: 2, // number - always 2 for skill-based system
  consolationSquaresAwarded: 0, // number - track total (max 4 per board)
  
  // Cached game info (for display without joins)
  gameInfo: {
    teams: { home: '', away: '' },
    sport: '',
    startTime: null
  },
  
  // Status
  isActive: true, // boolean
  isFull: false, // boolean - auto-updated when all squares have 2 players
  
  // Metadata
  createdAt: null, // Timestamp
  lastUpdated: null // Timestamp
};

// Square Claims Collection Schema - UPDATED FOR SKILL-BASED SYSTEM
const SquareClaimSchema = {
  // Claim details
  userId: '', // string - who claimed it
  boardId: '', // string - which board
  position: 0, // number - 0-49
  
  // SKILL-BASED: Timing fields
  triviaAnswerTimeMs: 0, // number - milliseconds to answer trivia
  triviaAnswerTimeSeconds: 0, // number - seconds (for display)
  
  // SKILL-BASED: Consolation tracking
  isConsolationSquare: false, // boolean - earned via consolation prize
  sourceWinnerId: null, // string - winner record that granted this consolation
  canEarnConsolation: true, // boolean - false for consolation squares (can't win another)
  
  // Earning details
  earnedVia: 'trivia', // string - 'trivia', 'free_entry', 'admin', 'consolation'
  triviaQuestionId: null, // string - if earned via trivia
  accessTokenId: null, // string - token used
  
  // Timestamps
  earnedAt: null, // Timestamp - when trivia was answered
  placedAt: null, // Timestamp - when square was placed
  
  // Result tracking
  isWinner: false, // boolean
  winningQuarter: null, // string - 'q1', 'q2', etc.
  prizeAmount: 0, // number
  
  // Metadata
  ipAddress: null, // string - for fraud detection
  userAgent: null // string - browser info
};

// SKILL-BASED: NEW Trivia Session Schema
const TriviaSessionSchema = {
  sessionId: '', // string - unique session ID
  userId: '', // string - player's user ID
  boardId: '', // string - board they're playing for
  questionId: '', // string - trivia question ID
  
  // Timing fields (critical for skill-based system)
  questionDisplayedAt: null, // Timestamp - when question shown to user
  answerSubmittedAt: null, // Timestamp - when user submitted answer
  answerTimeMs: null, // number - calculated milliseconds to answer
  answerTimeSeconds: null, // number - seconds for display (ms / 1000)
  
  // Answer tracking
  answered: false, // boolean - whether user answered
  isCorrect: false, // boolean - whether answer was correct
  answerIndex: null, // number - which answer they selected (0-3)
  
  // Session info
  sport: '', // string - sport category
  tier: '', // string - tier they're playing for
  startedAt: null, // Timestamp - session start
  expiresAt: null, // Timestamp - session expiration
  
  // Metadata
  createdAt: null, // Timestamp
};

// Winners Collection Schema - UPDATED FOR SKILL-BASED SYSTEM
const WinnerSchema = {
  // Winner identification
  userId: '', // string
  gameId: '', // string
  boardId: '', // string
  claimId: '', // string - reference to square claim
  
  // Winning details
  position: 0, // number - winning square position
  quarter: '', // string - 'q1', 'q2', 'q3', 'q4', 'ot'
  score: '', // string - '21-17' format
  tierId: '', // string - for prize calculation
  prizeAmount: 0, // number
  
  // SKILL-BASED: Speed competition fields
  winnerAnswerTimeMs: 0, // number - winner's trivia answer time in ms
  winnerAnswerTimeSeconds: 0, // number - winner's time in seconds
  loserAnswerTimeMs: 0, // number - loser's trivia answer time (if applicable)
  loserUserId: null, // string - who lost the speed competition
  consolationSquareGranted: false, // boolean - whether consolation was given
  consolationSquareId: null, // string - reference to granted consolation square
  
  // Cached info for display
  gameInfo: {
    teams: { home: '', away: '' },
    sport: ''
  },
  userInfo: {
    email: '',
    telegramUsername: ''
  },
  
  // Notification status
  notificationStatus: 'pending', // string - 'pending', 'sent', 'failed'
  notifiedAt: null, // Timestamp
  notificationErrors: [], // array - any errors
  
  // Payout status
  status: 'pending_payout', // string - 'pending_payout', 'processing', 'completed', 'failed'
  payoutMethod: null, // string
  payoutDetails: {}, // object - transaction details
  payoutCompletedAt: null, // Timestamp
  payoutType: '', // string - 'instant' or 'batch'
  instantPayoutFee: 0, // number - fee amount if instant payout
  relayBatchId: null, // string - reference to relay batch if applicable
  
  // Tax tracking
  reportedOn1099: false, // boolean
  taxYear: 0, // number - year for tax purposes
  
  // Metadata
  createdAt: null, // Timestamp
  processedBy: null // string - admin who processed payout
};

// Trivia Collection Schema
const TriviaSchema = {
  // Question details
  question: '', // string - the question text
  answers: [], // array - 4 answer options
  correctAnswerIndex: 0, // number - 0-3
  
  // Categorization
  sport: '', // string - 'NFL', 'NBA', etc.
  category: '', // string - 'history', 'stats', 'current', etc.
  difficulty: 'medium', // string - 'easy', 'medium', 'hard'
  
  // Usage tracking
  timesUsed: 0, // number
  timesCorrect: 0, // number
  successRate: 0, // number - calculated percentage
  
  // Validation
  isActive: true, // boolean
  requiresUpdate: false, // boolean - for time-sensitive questions
  
  // Metadata
  createdAt: null, // Timestamp
  createdBy: '', // string - admin who created
  lastUsed: null, // Timestamp
  tags: [] // array - for searching
};

// Access Tokens Collection Schema - RENAMED from squareTokens
const AccessTokenSchema = {
  // Token details
  userId: '', // string - who earned it
  tierId: '', // string - which tier it's for
  
  // Earning details
  earnedVia: 'trivia', // string - 'trivia', 'free_entry', 'consolation'
  triviaQuestionId: null, // string - if from trivia
  
  // SKILL-BASED: Consolation token tracking
  isConsolationToken: false, // boolean - if this is a consolation prize
  sourceWinnerId: null, // string - winner record that granted this
  canEarnConsolation: true, // boolean - whether this can earn consolation if it loses
  
  // SKILL-BASED: Timing data from trivia
  answerTimeMs: 0, // number - milliseconds (for skill-based wins)
  answerTimeSeconds: 0, // number - seconds (for display)
  
  // Usage tracking
  usedForSquare: false, // boolean
  usedAt: null, // Timestamp
  usedOnBoardId: null, // string
  assignedPosition: null, // number
  
  // Expiration
  expiresAt: null, // Timestamp - 24 hours for regular, 30 days for consolation
  
  // Metadata
  createdAt: null, // Timestamp
  ipAddress: null // string
};

// Free Entries Collection Schema
const FreeEntrySchema = {
  // Entry details
  email: '', // string
  fullName: '', // string
  mailingAddress: {
    street1: '',
    street2: null,
    city: '',
    state: '',
    zip: '',
    country: 'US'
  },
  phone: null, // string
  
  // Tier selection
  requestedTier: '', // string - 'tier_25', etc.
  
  // Processing
  status: 'pending', // string - 'pending', 'approved', 'rejected'
  processedAt: null, // Timestamp
  processedBy: null, // string - admin ID
  
  // If approved
  userId: null, // string - created account
  accessTokenId: null, // string - token granted
  
  // Metadata
  receivedAt: null, // Timestamp
  createdAt: null, // Timestamp
  notes: null // string - admin notes
};

// Relay Batch Collection Schema
const RelayBatchSchema = {
  // Batch identification
  batchId: '', // string - unique batch identifier
  batchType: 'scheduled', // string - 'scheduled', 'manual'
  
  // Batch schedule
  scheduledFor: '', // string - 'tuesday' or 'friday'
  dateRange: {
    start: null, // Timestamp - start of period
    end: null // Timestamp - end of period
  },
  
  // Winners included
  winnerIds: [], // array - winner document IDs
  totalWinners: 0, // number - count of winners
  
  // Financial totals
  totalAmount: 0, // number - sum of all payouts
  tierBreakdown: {
    tier_25: { count: 0, total: 0 },
    tier_50: { count: 0, total: 0 },
    tier_100: { count: 0, total: 0 },
    tier_250: { count: 0, total: 0 },
    tier_500: { count: 0, total: 0 },
    tier_1000: { count: 0, total: 0 }
  },
  
  // Mercury account info
  mercuryBalance: 0, // number - balance at time of batch
  sufficientFunds: false, // boolean - whether balance covers batch
  
  // Processing status
  status: 'pending', // string - 'pending', 'csv_generated', 'uploaded', 'processing', 'completed', 'failed'
  csvGeneratedAt: null, // Timestamp
  csvFilePath: null, // string - storage path
  uploadedToRelayAt: null, // Timestamp
  
  // Relay processing
  relayConfirmationId: null, // string - from Relay
  relayStatus: null, // string - status from Relay
  relayErrors: [], // array - any errors from Relay
  
  // Completion tracking
  completedAt: null, // Timestamp
  completedPayouts: 0, // number - successful payouts
  failedPayouts: 0, // number - failed payouts
  failedPayoutDetails: [], // array - details of failures
  
  // Metadata
  createdAt: null, // Timestamp
  createdBy: '', // string - admin user ID
  lastUpdated: null, // Timestamp
  notes: null // string - admin notes
};
/**
 * Seed trivia if empty
 */
const seedTriviaQuestions = [
  // NFL Questions
  {
    question: "Which NFL team has won the most Super Bowl championships?",
    answers: ["New England Patriots (6)", "Pittsburgh Steelers (6)", "Dallas Cowboys (5)", "San Francisco 49ers (5)"],
    correctAnswerIndex: 1,
    sport: "NFL",
    category: "history",
    difficulty: "medium"
  },
  {
    question: "Who holds the NFL record for most career passing touchdowns?",
    answers: ["Peyton Manning", "Drew Brees", "Tom Brady", "Brett Favre"],
    correctAnswerIndex: 2,
    sport: "NFL",
    category: "records",
    difficulty: "medium"
  },
  {
    question: "Which NFL team plays in the newest stadium?",
    answers: ["Las Vegas Raiders", "Los Angeles Rams", "Minnesota Vikings", "Atlanta Falcons"],
    correctAnswerIndex: 0,
    sport: "NFL",
    category: "current",
    difficulty: "hard"
  },
  
  // NBA Questions
  {
    question: "Who holds the NBA record for most points in a single game?",
    answers: ["Kobe Bryant (81)", "Michael Jordan (69)", "Wilt Chamberlain (100)", "David Thompson (73)"],
    correctAnswerIndex: 2,
    sport: "NBA",
    category: "records",
    difficulty: "easy"
  },
  {
    question: "Which NBA team has won the most championships?",
    answers: ["Los Angeles Lakers", "Boston Celtics", "Chicago Bulls", "Golden State Warriors"],
    correctAnswerIndex: 1,
    sport: "NBA",
    category: "history",
    difficulty: "medium"
  },
  
  // Add more questions as needed...
];

// ===== MIGRATION FUNCTION =====
async function migrateCollection(collectionName, schema) {
  const snapshot = await db.collection(collectionName).get();
  let updateCount = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const updateData = {};

    for (const [field, defaultValue] of Object.entries(schema)) {
      if (data[field] === undefined) {
        updateData[field] = defaultValue;
      }
    }

    if (Object.keys(updateData).length > 0) {
      await doc.ref.update(updateData);
      updateCount++;
    }
  }

  console.log(`${collectionName}: updated ${updateCount} docs`);
  return updateCount;
}

// ===== RUN ALL =====
(async () => {
  try {
    await migrateCollection("users", UserSchema);
    await migrateCollection("donations", DonationSchema);
    await migrateCollection("games", GameSchema);
    await migrateCollection("accessTokens", AccessTokenSchema);
    await migrateCollection("boards", BoardSchema);
    await migrateCollection("squareClaims", SquareClaimSchema);
    await migrateCollection("winners", WinnerSchema);
    await migrateCollection("trivia", TriviaSchema);

    console.log("✅ Migration completed for all collections!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Migration failed", err);
    process.exit(1);
  }
})();
