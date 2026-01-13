// Square Trivia - Database Schema & Security Rules (SKILL-BASED VERSION)
// This artifact defines all Firestore collections, security rules, and indexes
// COMPLETE VERSION: Fixed truncated schemas, uses CommonJS, includes all skill-based fields

// =====================================
// COMMONJS IMPORTS
// =====================================

const admin = require("firebase-admin");

// Note: Constants will be imported from another file in the actual implementation
// For this schema file, we'll define what we need locally
const TIERS = {
  tier_25: { amount: 25, payoutPercentage: 0.77 },
  tier_50: { amount: 50, payoutPercentage: 0.77 },
  tier_100: { amount: 100, payoutPercentage: 0.77 },
  tier_250: { amount: 250, payoutPercentage: 0.8 },
  tier_500: { amount: 500, payoutPercentage: 0.8 },
  tier_1000: { amount: 1000, payoutPercentage: 0.8 },
};

// =====================================
// COLLECTION SCHEMAS
// =====================================

// User Collection Schema
const UserSchema = {
  // Required fields
  email: "", // string - validated email
  createdAt: null, // Timestamp - account creation

  // Profile fields
  telegramUsername: null, // string - @username format (OPTIONAL)
  phone: null, // string - +1XXXXXXXXXX format
  hasTelegram: false, // boolean - tracks if user has added Telegram
  telegramPromptDismissed: false, // boolean - if user dismissed Telegram prompts
  preferredNotificationMethod: "email", // string - 'email', 'telegram', 'both'
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
    verified: false, // boolean - payout method verified
  },
  instantPayoutPreference: false, // boolean - user's default choice for instant payouts
  totalInstantPayoutFees: 0, // number - lifetime instant fees paid

  // Tax information
  taxInfo: {
    ssn_last4: null, // string - last 4 digits only
    fullName: null, // string - legal name
    address: null, // object - mailing address
    w9_submitted: false, // boolean
    total_annual_winnings: 0, // number - for 1099 tracking
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
    marketing: true,
  },

  // System fields
  isAdmin: false, // boolean
  isBanned: false, // boolean
  banReason: null, // string
  metadata: {}, // object - for future use
};

// Donation Collection Schema - COMPLETE VERSION
const DonationSchema = {
  // Core fields
  userId: "", // string - Firebase Auth UID
  amount: 0, // number - donation amount
  tierId: "", // string - 'tier_25', 'tier_50', etc.

  // Payment details
  stripePaymentIntentId: "", // string
  paymentMethod: "", // string - 'card', 'apple_pay', 'google_pay', etc.
  paymentMethodDetails: {}, // object - card last4, brand, etc.
  currency: "usd", // string
  payoutPercentage: 0, // number - 0.77 or 0.80 based on tier

  // Status tracking
  status: "pending", // string - 'pending', 'completed', 'failed', 'refunded'
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
  metadata: {}, // object - additional Stripe data, promo codes, etc.
};

// Game Collection Schema
const GameSchema = {
  // Game identification
  sport: "", // string - 'NFL', 'NBA', 'NCAA_FB', 'NCAA_BB'
  apiSportsId: "", // string - CRITICAL for live updates
  gameType: "regular", // string - 'regular', 'playoff', 'championship'

  // Teams
  teams: {
    home: "", // string - team name
    away: "", // string - team name
  },

  // Scheduling
  startTime: null, // Timestamp
  actualStartTime: null, // Timestamp - when game actually started

  // Status tracking
  status: "scheduled", // string - 'scheduled', 'active', 'completed', 'cancelled'

  // Score tracking
  scores: {
    q1: { home: null, away: null },
    q2: { home: null, away: null },
    q3: { home: null, away: null },
    q4: { home: null, away: null },
    ot: { home: null, away: null }, // if applicable
    final: { home: null, away: null },
  },

  // Processing status
  processedQuarters: {
    q1: false,
    q2: false,
    q3: false,
    q4: false,
    ot: false,
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
  createdBy: "", // string - admin user ID
  completedAt: null, // Timestamp
  cancelledAt: null, // Timestamp
  cancelReason: null, // string
};

// Board Collection Schema - UPDATED FOR SKILL-BASED SYSTEM
const BoardSchema = {
  // Board identification
  gameId: "", // string - reference to game
  tierId: "", // string - 'tier_25', 'tier_50', etc.
  gameType: "", // string - copied from game for querying

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
    teams: { home: "", away: "" },
    sport: "",
    startTime: null,
  },

  // Status
  isActive: true, // boolean
  isFull: false, // boolean - auto-updated when all squares have 2 players

  // Metadata
  createdAt: null, // Timestamp
  lastUpdated: null, // Timestamp
};

// Square Claims Collection Schema - UPDATED FOR SKILL-BASED SYSTEM
const SquareClaimSchema = {
  // Claim details
  userId: "", // string - who claimed it
  boardId: "", // string - which board
  position: 0, // number - 0-49

  // SKILL-BASED: Timing fields
  triviaAnswerTimeMs: 0, // number - milliseconds to answer trivia
  triviaAnswerTimeSeconds: 0, // number - seconds (for display)

  // SKILL-BASED: Consolation tracking
  isConsolationSquare: false, // boolean - earned via consolation prize
  sourceWinnerId: null, // string - winner record that granted this consolation
  canEarnConsolation: true, // boolean - false for consolation squares (can't win another)

  // Earning details
  earnedVia: "trivia", // string - 'trivia', 'free_entry', 'admin', 'consolation'
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
  userAgent: null, // string - browser info
};

// SKILL-BASED: NEW Trivia Session Schema
const TriviaSessionSchema = {
  sessionId: "", // string - unique session ID
  userId: "", // string - player's user ID
  boardId: "", // string - board they're playing for
  questionId: "", // string - trivia question ID

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
  sport: "", // string - sport category
  tier: "", // string - tier they're playing for
  startedAt: null, // Timestamp - session start
  expiresAt: null, // Timestamp - session expiration

  // Metadata
  createdAt: null, // Timestamp
};

// Winners Collection Schema - UPDATED FOR SKILL-BASED SYSTEM
const WinnerSchema = {
  // Winner identification
  userId: "", // string
  gameId: "", // string
  boardId: "", // string
  claimId: "", // string - reference to square claim

  // Winning details
  position: 0, // number - winning square position
  quarter: "", // string - 'q1', 'q2', 'q3', 'q4', 'ot'
  score: "", // string - '21-17' format
  tierId: "", // string - for prize calculation
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
    teams: { home: "", away: "" },
    sport: "",
  },
  userInfo: {
    email: "",
    telegramUsername: "",
  },

  // Notification status
  notificationStatus: "pending", // string - 'pending', 'sent', 'failed'
  notifiedAt: null, // Timestamp
  notificationErrors: [], // array - any errors

  // Payout status
  status: "pending_payout", // string - 'pending_payout', 'processing', 'completed', 'failed'
  payoutMethod: null, // string
  payoutDetails: {}, // object - transaction details
  payoutCompletedAt: null, // Timestamp
  payoutType: "standard", // string - 'instant' or 'batch' or 'standard'
  instantPayoutFee: 0, // number - fee amount if instant payout
  relayBatchId: null, // string - reference to relay batch if applicable

  // Tax tracking
  reportedOn1099: false, // boolean
  taxYear: 0, // number - year for tax purposes

  // Metadata
  createdAt: null, // Timestamp
  processedBy: null, // string - admin who processed payout
};

// Trivia Collection Schema
const TriviaSchema = {
  // Question details
  question: "", // string - the question text
  answers: [], // array - 4 answer options
  correctAnswerIndex: 0, // number - 0-3

  // Categorization
  sport: "", // string - 'NFL', 'NBA', etc.
  category: "", // string - 'history', 'stats', 'current', etc.
  difficulty: "medium", // string - 'easy', 'medium', 'hard'

  // Usage tracking
  timesUsed: 0, // number
  timesCorrect: 0, // number
  successRate: 0, // number - calculated percentage

  // Validation
  isActive: true, // boolean
  requiresUpdate: false, // boolean - for time-sensitive questions

  // Metadata
  createdAt: null, // Timestamp
  createdBy: "", // string - admin who created
  lastUsed: null, // Timestamp
  tags: [], // array - for searching
};

// Access Tokens Collection Schema - RENAMED from squareTokens
const AccessTokenSchema = {
  // Token details
  userId: "", // string - who earned it
  tierId: "", // string - which tier it's for

  // Earning details
  earnedVia: "trivia", // string - 'trivia', 'free_entry', 'consolation'
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
  ipAddress: null, // string
};

// Free Entries Collection Schema
const FreeEntrySchema = {
  // Entry details
  email: "", // string
  fullName: "", // string
  mailingAddress: {
    street1: "",
    street2: null,
    city: "",
    state: "",
    zip: "",
    country: "US",
  },
  phone: null, // string

  // Tier selection
  requestedTier: "", // string - 'tier_25', etc.

  // Processing
  status: "pending", // string - 'pending', 'approved', 'rejected'
  processedAt: null, // Timestamp
  processedBy: null, // string - admin ID

  // If approved
  userId: null, // string - created account
  accessTokenId: null, // string - token granted

  // Metadata
  receivedAt: null, // Timestamp
  createdAt: null, // Timestamp
  notes: null, // string - admin notes
};

// Relay Batch Collection Schema
const RelayBatchSchema = {
  // Batch identification
  batchId: "", // string - unique batch identifier
  batchType: "scheduled", // string - 'scheduled', 'manual'

  // Batch schedule
  scheduledFor: "", // string - 'tuesday' or 'friday'
  dateRange: {
    start: null, // Timestamp - start of period
    end: null, // Timestamp - end of period
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
    tier_1000: { count: 0, total: 0 },
  },

  // Mercury account info
  mercuryBalance: 0, // number - balance at time of batch
  sufficientFunds: false, // boolean - whether balance covers batch

  // Processing status
  status: "pending", // string - 'pending', 'csv_generated', 'uploaded', 'processing', 'completed', 'failed'
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
  createdBy: "", // string - admin user ID
  lastUpdated: null, // Timestamp
  notes: null, // string - admin notes
};

// =====================================
// FIRESTORE SECURITY RULES
// =====================================

const firestoreRules = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Helper functions
    function isAuthenticated() {
      return request.auth != null;
    }
    
    function isOwner(userId) {
      return isAuthenticated() && request.auth.uid == userId;
    }
    
    function isAdmin() {
      return isAuthenticated() && 
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.isAdmin == true;
    }
    
    function hasActiveTier(tierId) {
      return isAuthenticated() &&
        tierId in get(/databases/$(database)/documents/users/$(request.auth.uid)).data.currentTiers;
    }
    
    // Users collection
    match /users/{userId} {
      allow read: if isOwner(userId) || isAdmin();
      allow create: if false; // Only through auth functions
      allow update: if isOwner(userId) && 
        !request.resource.data.diff(resource.data).affectedKeys().hasAny(['isAdmin', 'totalDonations', 'currentTiers']);
      allow delete: if false;
    }
    
    // Donations collection
    match /donations/{donationId} {
      allow read: if isAuthenticated() && 
        (resource.data.userId == request.auth.uid || isAdmin());
      allow write: if false; // Only through Cloud Functions
    }
    
    // Games collection - public read
    match /games/{gameId} {
      allow read: if true;
      allow write: if isAdmin();
    }
    
    // Boards collection - public read
    match /boards/{boardId} {
      allow read: if true;
      allow write: if false; // Only through Cloud Functions
    }
    
    // Square claims - authenticated read own claims
    match /squareClaims/{claimId} {
      allow read: if isAuthenticated() && 
        (resource.data.userId == request.auth.uid || isAdmin());
      allow write: if false; // Only through Cloud Functions
    }
    
    // Trivia sessions - read own only
    match /triviaSessions/{sessionId} {
      allow read: if isOwner(resource.data.userId) || isAdmin();
      allow write: if false; // Only through Cloud Functions
    }
    
    // Winners - public read
    match /winners/{winnerId} {
      allow read: if true;
      allow write: if false; // Only through Cloud Functions
    }
    
    // Trivia - authenticated read
    match /trivia/{triviaId} {
      allow read: if isAuthenticated();
      allow write: if isAdmin();
    }
    
    // Access tokens - read own only
    match /accessTokens/{tokenId} {
      allow read: if isOwner(resource.data.userId);
      allow write: if false; // Only through Cloud Functions
    }
    
    // Free entries - admin only
    match /freeEntries/{entryId} {
      allow read: if isAdmin();
      allow write: if isAdmin();
    }
    
    // Relay batches - admin only
    match /relayBatches/{batchId} {
      allow read: if isAdmin();
      allow write: if isAdmin();
    }
    
    // Admin collections
    match /paymentLedger/{document=**} {
      allow read, write: if isAdmin();
    }
    
    match /reconciliations/{document=**} {
      allow read, write: if isAdmin();
    }
    
    match /payoutBatches/{document=**} {
      allow read, write: if isAdmin();
    }
    
    // Notification queue - system only
    match /notificationQueue/{document=**} {
      allow read: if isAdmin();
      allow write: if false; // Only through Cloud Functions
    }
  }
}`;

// =====================================
// FIRESTORE INDEXES
// =====================================

const firestoreIndexes = {
  indexes: [
    // User queries
    {
      collectionGroup: "users",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "currentTiers", arrayConfig: "CONTAINS" },
        { fieldPath: "createdAt", order: "DESCENDING" },
      ],
    },

    // Donation queries
    {
      collectionGroup: "donations",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "userId", order: "ASCENDING" },
        { fieldPath: "status", order: "ASCENDING" },
        { fieldPath: "createdAt", order: "DESCENDING" },
      ],
    },
    {
      collectionGroup: "donations",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "tierId", order: "ASCENDING" },
        { fieldPath: "telegramAccessGranted", order: "ASCENDING" },
        { fieldPath: "accessExpiresAt", order: "ASCENDING" },
      ],
    },

    // Game queries
    {
      collectionGroup: "games",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "status", order: "ASCENDING" },
        { fieldPath: "startTime", order: "ASCENDING" },
      ],
    },
    {
      collectionGroup: "games",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "sport", order: "ASCENDING" },
        { fieldPath: "gameType", order: "ASCENDING" },
        { fieldPath: "startTime", order: "DESCENDING" },
      ],
    },

    // Board queries
    {
      collectionGroup: "boards",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "gameId", order: "ASCENDING" },
        { fieldPath: "tierId", order: "ASCENDING" },
      ],
    },
    {
      collectionGroup: "boards",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "tierId", order: "ASCENDING" },
        { fieldPath: "gameType", order: "ASCENDING" },
        { fieldPath: "isActive", order: "ASCENDING" },
      ],
    },

    // Square claim queries
    {
      collectionGroup: "squareClaims",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "userId", order: "ASCENDING" },
        { fieldPath: "boardId", order: "ASCENDING" },
      ],
    },
    {
      collectionGroup: "squareClaims",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "boardId", order: "ASCENDING" },
        { fieldPath: "isWinner", order: "ASCENDING" },
      ],
    },

    // SKILL-BASED: Trivia session queries
    {
      collectionGroup: "triviaSessions",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "userId", order: "ASCENDING" },
        { fieldPath: "answered", order: "ASCENDING" },
        { fieldPath: "createdAt", order: "DESCENDING" },
      ],
    },
    {
      collectionGroup: "triviaSessions",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "boardId", order: "ASCENDING" },
        { fieldPath: "isCorrect", order: "ASCENDING" },
        { fieldPath: "answerTimeMs", order: "ASCENDING" },
      ],
    },

    // Winner queries
    {
      collectionGroup: "winners",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "gameId", order: "ASCENDING" },
        { fieldPath: "quarter", order: "ASCENDING" },
      ],
    },
    {
      collectionGroup: "winners",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "userId", order: "ASCENDING" },
        { fieldPath: "status", order: "ASCENDING" },
        { fieldPath: "createdAt", order: "DESCENDING" },
      ],
    },
    {
      collectionGroup: "winners",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "status", order: "ASCENDING" },
        { fieldPath: "createdAt", order: "ASCENDING" },
      ],
    },

    // Trivia queries
    {
      collectionGroup: "trivia",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "sport", order: "ASCENDING" },
        { fieldPath: "difficulty", order: "ASCENDING" },
        { fieldPath: "isActive", order: "ASCENDING" },
      ],
    },

    // Access token queries
    {
      collectionGroup: "accessTokens",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "userId", order: "ASCENDING" },
        { fieldPath: "usedForSquare", order: "ASCENDING" },
        { fieldPath: "expiresAt", order: "ASCENDING" },
      ],
    },
    {
      collectionGroup: "accessTokens",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "isConsolationToken", order: "ASCENDING" },
        { fieldPath: "boardId", order: "ASCENDING" },
        { fieldPath: "expiresAt", order: "ASCENDING" },
      ],
    },

    // Relay batch queries
    {
      collectionGroup: "relayBatches",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "status", order: "ASCENDING" },
        { fieldPath: "scheduledFor", order: "ASCENDING" },
        { fieldPath: "createdAt", order: "DESCENDING" },
      ],
    },
    {
      collectionGroup: "relayBatches",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "scheduledFor", order: "ASCENDING" },
        { fieldPath: "dateRange.start", order: "ASCENDING" },
        { fieldPath: "dateRange.end", order: "ASCENDING" },
      ],
    },
  ],
};

// =====================================
// DATA MIGRATION SCRIPTS
// =====================================

// SKILL-BASED: Migrate to skill-based system
async function migrateToSkillBasedSystem(db) {
  console.log("Starting skill-based system migration...");

  const batch = db.batch();
  let updateCount = 0;

  try {
    // 1. Update all boards to new square structure
    const boards = await db.collection("boards").get();

    boards.forEach((doc) => {
      const board = doc.data();
      const newSquares = {};

      // Convert old format to new skill-based format
      Object.entries(board.squares || {}).forEach(([position, square]) => {
        if (square && square.userId) {
          // Old format had single user
          newSquares[position] = {
            claims: [
              {
                userId: square.userId,
                claimId: square.claimId || `legacy-${doc.id}-${position}`,
                answerTimeSeconds: 5.0, // Default time for old squares
              },
            ],
            isFull: false, // Can accept one more player
          };
        }
      });

      batch.update(doc.ref, {
        squares: newSquares,
        maxPlayersPerSquare: 2,
        consolationSquaresAwarded: 0,
      });
      updateCount++;
    });

    // 2. Update existing claims with default timing
    const claims = await db.collection("squareClaims").get();

    claims.forEach((doc) => {
      batch.update(doc.ref, {
        triviaAnswerTimeMs: 5000, // Default 5 seconds
        triviaAnswerTimeSeconds: 5.0,
        isConsolationSquare: false,
        sourceWinnerId: null,
        canEarnConsolation: true,
      });
      updateCount++;
    });

    // 3. Update winners with skill fields
    const winners = await db.collection("winners").get();

    winners.forEach((doc) => {
      batch.update(doc.ref, {
        winnerAnswerTimeMs: 5000,
        winnerAnswerTimeSeconds: 5.0,
        loserAnswerTimeMs: null,
        loserUserId: null,
        consolationSquareGranted: false,
        consolationSquareId: null,
      });
      updateCount++;
    });

    // 4. Update access tokens (previously squareTokens)
    const tokens = await db.collection("accessTokens").get();

    tokens.forEach((doc) => {
      batch.update(doc.ref, {
        isConsolationToken: false,
        sourceWinnerId: null,
        canEarnConsolation: true,
        answerTimeMs: 5000,
        answerTimeSeconds: 5.0,
      });
      updateCount++;
    });

    await batch.commit();
    console.log(
      `Skill-based migration complete: ${updateCount} documents updated`
    );
  } catch (error) {
    console.error("Error during skill-based migration:", error);
    throw error;
  }
}

// =====================================
// SEED DATA SCRIPTS
// =====================================

// Create initial trivia questions
const seedTriviaQuestions = [
  // NFL Questions
  {
    question: "Which NFL team has won the most Super Bowl championships?",
    answers: [
      "New England Patriots (6)",
      "Pittsburgh Steelers (6)",
      "Dallas Cowboys (5)",
      "San Francisco 49ers (5)",
    ],
    correctAnswerIndex: 1,
    sport: "NFL",
    category: "history",
    difficulty: "medium",
  },
  {
    question: "Who holds the NFL record for most career passing touchdowns?",
    answers: ["Peyton Manning", "Drew Brees", "Tom Brady", "Brett Favre"],
    correctAnswerIndex: 2,
    sport: "NFL",
    category: "records",
    difficulty: "medium",
  },
  {
    question: "Which NFL team plays in the newest stadium?",
    answers: [
      "Las Vegas Raiders",
      "Los Angeles Rams",
      "Minnesota Vikings",
      "Atlanta Falcons",
    ],
    correctAnswerIndex: 0,
    sport: "NFL",
    category: "current",
    difficulty: "hard",
  },

  // NBA Questions
  {
    question: "Who holds the NBA record for most points in a single game?",
    answers: [
      "Kobe Bryant (81)",
      "Michael Jordan (69)",
      "Wilt Chamberlain (100)",
      "David Thompson (73)",
    ],
    correctAnswerIndex: 2,
    sport: "NBA",
    category: "records",
    difficulty: "easy",
  },
  {
    question: "Which NBA team has won the most championships?",
    answers: [
      "Los Angeles Lakers",
      "Boston Celtics",
      "Chicago Bulls",
      "Golden State Warriors",
    ],
    correctAnswerIndex: 1,
    sport: "NBA",
    category: "history",
    difficulty: "medium",
  },

  // Add more questions as needed...
];

// Initialize system with seed data
async function initializeSystem(db) {
  console.log("Initializing Square Trivia system...");

  try {
    // 1. Run migration to skill-based system
    await migrateToSkillBasedSystem(db);

    // 2. Seed trivia questions if collection is empty
    const triviaSnapshot = await db.collection("trivia").limit(1).get();

    if (triviaSnapshot.empty) {
      console.log("Seeding trivia questions...");
      const batch = db.batch();

      seedTriviaQuestions.forEach((question) => {
        const ref = db.collection("trivia").doc();
        batch.set(ref, {
          ...question,
          timesUsed: 0,
          timesCorrect: 0,
          successRate: 0,
          isActive: true,
          requiresUpdate: false,
          createdAt: Date.now(),
          createdBy: "system",
          lastUsed: null,
          tags: [],
        });
      });

      await batch.commit();
      console.log(`Seeded ${seedTriviaQuestions.length} trivia questions`);
    }

    console.log("System initialization complete!");
  } catch (error) {
    console.error("Error during system initialization:", error);
    throw error;
  }
}

// =====================================
// EXPORTS (CommonJS)
// =====================================

module.exports = {
  // Individual schemas
  UserSchema,
  DonationSchema,
  GameSchema,
  BoardSchema,
  SquareClaimSchema,
  WinnerSchema,
  TriviaSchema,
  TriviaSessionSchema,
  AccessTokenSchema,
  FreeEntrySchema,
  RelayBatchSchema,

  // Grouped schemas
  schemas: {
    UserSchema,
    DonationSchema,
    GameSchema,
    BoardSchema,
    SquareClaimSchema,
    WinnerSchema,
    TriviaSchema,
    TriviaSessionSchema,
    AccessTokenSchema,
    FreeEntrySchema,
    RelayBatchSchema,
  },

  // Security rules and indexes
  firestoreRules,
  firestoreIndexes,

  // Migration functions
  migrations: {
    migrateToSkillBasedSystem,
  },

  // Seed data and initialization
  seedData: {
    seedTriviaQuestions,
    initializeSystem,
  },
};
