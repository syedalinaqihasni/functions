// Square Trivia - Centralized Constants & Configuration
// This file fixes tier naming inconsistencies and centralizes all constants

// =====================================
// TIER CONFIGURATION
// =====================================
// Standardized tier system - use these everywhere
const TIERS = {
  TIER_25: {
    id: "tier_25",
    amount: 25,
    label: "$25 Tier",
    color: "bg-gray-600",
    textColor: "text-gray-600",
    telegramGroupKey: "tier_25_group_id",
    maxSquaresPerUser: 3,
    availableIn: ["regular", "playoff", "championship"],
    payoutPercentage: 0.64, // 64% to winners
  },
  TIER_50: {
    id: "tier_50",
    amount: 50,
    label: "$50 Tier",
    color: "bg-blue-600",
    textColor: "text-blue-600",
    telegramGroupKey: "tier_50_group_id",
    maxSquaresPerUser: 3,
    availableIn: ["regular", "playoff", "championship"],
    payoutPercentage: 0.64, // 64% to winners
  },
  TIER_100: {
    id: "tier_100",
    amount: 100,
    label: "$100 Tier",
    color: "bg-green-600",
    textColor: "text-green-600",
    telegramGroupKey: "tier_100_group_id",
    maxSquaresPerUser: 3,
    availableIn: ["regular", "playoff", "championship"],
    payoutPercentage: 0.64, // 64% to winners
  },
  TIER_250: {
    id: "tier_250",
    amount: 250,
    label: "$250 Tier",
    color: "bg-purple-600",
    textColor: "text-purple-600",
    telegramGroupKey: "tier_250_group_id",
    maxSquaresPerUser: 3,
    availableIn: ["playoff", "championship"],
    badge: "Playoff Exclusive",
    payoutPercentage: 0.72, // 72% to winners
  },
  TIER_500: {
    id: "tier_500",
    amount: 500,
    label: "$500 Tier",
    color: "bg-yellow-600",
    textColor: "text-yellow-600",
    telegramGroupKey: "tier_500_group_id",
    maxSquaresPerUser: 3,
    availableIn: ["playoff", "championship"],
    badge: "Playoff Exclusive",
    payoutPercentage: 0.72, // 72% to winners
  },
  TIER_1000: {
    id: "tier_1000",
    amount: 1000,
    label: "$1000 Tier",
    color: "bg-red-600",
    textColor: "text-red-600",
    telegramGroupKey: "tier_1000_group_id",
    maxSquaresPerUser: 3,
    availableIn: ["championship"],
    badge: "Championship Only",
    payoutPercentage: 0.72, // 72% to winners
  },
};

// Helper to get tier by ID
function getTierById(tierId) {
  return Object.values(TIERS).find((tier) => tier.id === tierId);
}

// Helper to get tier by amount
function getTierByAmount(amount) {
  return Object.values(TIERS).find((tier) => tier.amount === amount);
}

// Helper to get all tier IDs
function getAllTierIds() {
  return Object.values(TIERS).map((tier) => tier.id);
}

// =====================================
// GAME CONFIGURATION
// =====================================
const GAME_CONFIG = {
  SQUARES_PER_BOARD: 50,
  MAX_SQUARES_PER_USER_PER_BOARD: 3,
  PRIZE_POOL_PERCENTAGE: 0.75, // 75% to winners (deprecated - use tier-specific percentages)
  PLATFORM_FEE_PERCENTAGE: 0.25, // 25% platform fee (deprecated - calculated from tier)
  QUARTERS_PER_GAME: 4,

  // Instant payout configuration
  INSTANT_PAYOUT_FEE: 0.08, // 8% fee for instant payouts

  // Batch payout configuration
  BATCH_PAYOUT_DAYS: ["tuesday", "friday"], // Batch payout days
  BATCH_PAYOUT_SCHEDULE: {
    tuesday: {
      processRange: ["friday", "saturday", "sunday", "monday"],
      label: "Tuesday Batch (Fri-Mon games)",
    },
    friday: {
      processRange: ["tuesday", "wednesday", "thursday"],
      label: "Friday Batch (Tue-Thu games)",
    },
  },

  // Relay configuration for batch payments
  RELAY_CONFIG: {
    enabled: true,
    provider: "relay",
    csvFormat: {
      headers: ["name", "email", "amount", "method", "account_details"],
      delimiter: ",",
      encoding: "utf-8",
    },
    batchLimits: {
      maxRecipientsPerBatch: 250,
      maxAmountPerBatch: 100000, // $100,000
    },
    processingWindow: {
      startHour: 9, // 9 AM
      endHour: 17, // 5 PM
    },
  },

  // Game types
  TYPES: {
    REGULAR: {
      id: "regular",
      label: "Regular Season",
      description: "Standard regular season game",
      availableTiers: ["tier_25", "tier_50", "tier_100"],
    },
    PLAYOFF: {
      id: "playoff",
      label: "Playoff Game",
      description: "Playoff/Tournament game (unlocks $250 & $500 tiers)",
      availableTiers: [
        "tier_25",
        "tier_50",
        "tier_100",
        "tier_250",
        "tier_500",
      ],
    },
    CHAMPIONSHIP: {
      id: "championship",
      label: "Championship Game",
      description: "Championship/Finals (unlocks all tiers including $1000)",
      availableTiers: [
        "tier_25",
        "tier_50",
        "tier_100",
        "tier_250",
        "tier_500",
        "tier_1000",
      ],
    },
  },

  // Game statuses
  STATUS: {
    UPCOMING: "scheduled",
    ACTIVE: "active",
    COMPLETED: "completed",
    CANCELLED: "cancelled",
  },

  // Quarter names
  QUARTERS: {
    q1: { id: "q1", label: "1st Quarter", order: 1 },
    q2: { id: "q2", label: "2nd Quarter (Halftime)", order: 2 },
    q3: { id: "q3", label: "3rd Quarter", order: 3 },
    q4: { id: "q4", label: "4th Quarter (Final)", order: 4 },
    ot: { id: "ot", label: "Overtime", order: 5 },
  },
};

// =====================================
// PRIZE CALCULATIONS
// =====================================
function calculatePrizes(tierAmount, gameType = "regular") {
  // Get tier-specific payout percentage
  const tier = getTierByAmount(tierAmount);
  if (!tier) {
    throw new Error(`Invalid tier amount: ${tierAmount}`);
  }

  const payoutPercentage = tier.payoutPercentage;
  const platformFeePercentage = 1 - payoutPercentage;

  const totalPot = tierAmount * GAME_CONFIG.SQUARES_PER_BOARD;
  const prizePool = totalPot * payoutPercentage;
  const platformFee = totalPot * platformFeePercentage;

  // Standard quarter prizes (equal split)
  const quarterPrize = prizePool / GAME_CONFIG.QUARTERS_PER_GAME;

  return {
    totalPot,
    prizePool,
    platformFee,
    quarterPrize,
    payoutPercentage,
    platformFeePercentage,
    // Special game variations (future use)
    finalOnlyPrize: prizePool, // If only final score wins
    progressivePrizes: {
      q1: prizePool * 0.2,
      q2: prizePool * 0.2,
      q3: prizePool * 0.25,
      q4: prizePool * 0.35,
    },
  };
}

// Helper function to calculate instant payout after fee
function calculateInstantPayout(prizeAmount) {
  const instantPayoutFee = prizeAmount * GAME_CONFIG.INSTANT_PAYOUT_FEE;
  const netPayout = prizeAmount - instantPayoutFee;

  return {
    originalPrize: prizeAmount,
    instantPayoutFee: instantPayoutFee,
    netPayout: netPayout,
    feePercentage: GAME_CONFIG.INSTANT_PAYOUT_FEE,
  };
}

// =====================================
// SPORTS CONFIGURATION
// =====================================
const SPORTS_CONFIG = {
  NFL: {
    id: "NFL",
    name: "NFL Football",
    apiSportsId: 1,
    apiHost: "v1.american-football.api-sports.io",
    endpoint: "/v3/nfl/scores/json/ScoresByWeek", // SportsData.io endpoint
    // endpoint: "/games",
    hasQuarters: true,
    quarterCount: 4,
    seasonMonths: [9, 10, 11, 12, 1, 2], // Sep-Feb
    leagueId: 1,
  },
  NBA: {
    id: "NBA",
    name: "NBA Basketball",
    apiSportsId: 12,
    apiHost: "v1.basketball.api-sports.io",
    endpoint: "/games",
    hasQuarters: true,
    quarterCount: 4,
    seasonMonths: [10, 11, 12, 1, 2, 3, 4, 5, 6], // Oct-Jun
  },
  NCAA_FB: {
    id: "NCAA_FB",
    name: "College Football",
    apiSportsId: 2,
    apiHost: "v1.american-football.api-sports.io",
    endpoint: "/v3/cfb/scores/json/GamesByWeek", // SportsData.io endpoint
    // endpoint: "/games",
    hasQuarters: true,
    quarterCount: 4,
    seasonMonths: [8, 9, 10, 11, 12, 1], // Aug-Jan
  },
  NCAA_BB: {
    id: "NCAA_BB",
    name: "College Basketball",
    apiSportsId: 116,
    apiHost: "v1.basketball.api-sports.io",
    endpoint: "/games",
    hasQuarters: true,
    quarterCount: 2, // Halves, but we'll split into 4 for consistency
    seasonMonths: [11, 12, 1, 2, 3, 4], // Nov-Apr
  },
};

// =====================================
// API CONFIGURATION
// =====================================
const API_CONFIG = {
  API_SPORTS: {
    BASE_URL: "https://{host}{endpoint}",
    RATE_LIMIT: {
      FREE: { requests: 100, period: "day" },
      BASIC: { requests: 10000, period: "month" },
      PRO: { requests: 100000, period: "month" },
    },
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 1000, // ms
    TIMEOUT: 10000, // ms
  },

  STRIPE: {
    WEBHOOK_TOLERANCE: 300, // 5 minutes
    SUPPORTED_CURRENCIES: ["usd"],
    PAYMENT_METHODS: ["card"],
    MIN_AMOUNT: 25,
    MAX_AMOUNT: 1000,
  },
};

// =====================================
// NOTIFICATION CONFIGURATION
// =====================================
const NOTIFICATION_CONFIG = {
  EMAIL: {
    FROM_ADDRESS: "Square Trivia <noreply@squaretrivia.com>",
    SUPPORT_ADDRESS: "support@squaretrivia.com",
    ADMIN_ADDRESS: "admin@squaretrivia.com",
    TEMPLATES: {
      WELCOME: "welcome",
      DONATION_CONFIRM: "donation_confirm",
      SQUARE_ASSIGNED: "square_assigned",
      WINNER: "winner",
      PAYOUT_SENT: "payout_sent",
    },
  },

  TELEGRAM: {
    PARSE_MODE: "Markdown",
    MAX_MESSAGE_LENGTH: 4096,
    RATE_LIMIT: {
      DM: { messages: 30, period: "second" },
      GROUP: { messages: 20, period: "minute" },
    },
  },

  SMS: {
    ENABLED: false, // Set to true when Twilio is configured
    MAX_LENGTH: 160,
    COUNTRY_CODE: "+1", // US
  },
};

// =====================================
// RATE LIMITING CONFIGURATION
// =====================================
const RATE_LIMITS = {
  // Function name: { max attempts, window in ms }
  placeSquare: { max: 10, window: 300000 }, // 10 per 5 min
  answerTrivia: { max: 20, window: 300000 }, // 20 per 5 min
  createDonation: { max: 5, window: 3600000 }, // 5 per hour
  requestPayout: { max: 3, window: 86400000 }, // 3 per day
  sendNotification: { max: 10, window: 3600000 }, // 10 per hour

  // Global limits
  GLOBAL_PER_USER: { max: 100, window: 3600000 }, // 100 requests per hour
  GLOBAL_PER_IP: { max: 1000, window: 3600000 }, // 1000 per hour per IP
};

// =====================================
// VALIDATION RULES
// =====================================
const VALIDATION_RULES = {
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  TELEGRAM_USERNAME: /^@?[a-zA-Z0-9_]{5,32}$/,
  PHONE: /^\+?1?\d{10}$/,

  // Field constraints
  MIN_PASSWORD_LENGTH: 8,
  MAX_EMAIL_LENGTH: 255,
  MAX_USERNAME_LENGTH: 32,

  // Square constraints
  MIN_SQUARE_POSITION: 0,
  MAX_SQUARE_POSITION: 49,

  // Financial constraints
  MIN_DONATION: 25,
  MAX_DONATION: 1000,
  MIN_PAYOUT: 10,
  TAX_REPORTING_THRESHOLD: 600, // IRS 1099 requirement
};

// =====================================
// FEATURE FLAGS
// =====================================
const FEATURE_FLAGS = {
  ENABLE_SMS: false,
  ENABLE_CRYPTO_PAYOUTS: false,
  ENABLE_REFERRAL_PROGRAM: true,
  ENABLE_PROGRESSIVE_PRIZES: false,
  ENABLE_SPECIAL_EVENTS: true,
  ENABLE_ANALYTICS: true,
  ENABLE_A_B_TESTING: false,

  // Maintenance mode
  MAINTENANCE_MODE: false,
  MAINTENANCE_MESSAGE:
    "Square Trivia is undergoing maintenance. Please check back soon!",

  // Debug flags (set to false in production)
  DEBUG_MODE: process.env.NODE_ENV !== "production",
  LOG_API_CALLS: process.env.NODE_ENV !== "production",
  MOCK_API_SPORTS: process.env.NODE_ENV === "test",
};

// =====================================
// ERROR MESSAGES
// =====================================
const ERROR_MESSAGES = {
  // Authentication
  AUTH_REQUIRED: "Authentication required",
  INVALID_CREDENTIALS: "Invalid email or password",
  USER_NOT_FOUND: "User not found",

  // Authorization
  PERMISSION_DENIED: "You do not have permission to perform this action",
  ADMIN_ONLY: "Admin access required",

  // Game errors
  BOARD_FULL: "This board is full",
  SQUARE_TAKEN: "This square is already taken",
  MAX_SQUARES_REACHED:
    "You have reached the maximum number of squares for this board",
  GAME_NOT_FOUND: "Game not found",
  GAME_ALREADY_STARTED: "Game has already started",

  // Payment errors
  PAYMENT_FAILED: "Payment processing failed",
  INVALID_AMOUNT: "Invalid donation amount",
  TIER_NOT_AVAILABLE: "This tier is not available for the selected game type",

  // Validation errors
  INVALID_EMAIL: "Please enter a valid email address",
  INVALID_TELEGRAM: "Please enter a valid Telegram username",
  INVALID_PHONE: "Please enter a valid phone number",

  // System errors
  SYSTEM_ERROR: "An unexpected error occurred. Please try again.",
  RATE_LIMITED: "Too many requests. Please slow down.",
  MAINTENANCE: "System is under maintenance",
};

// =====================================
// SUCCESS MESSAGES
// =====================================
const SUCCESS_MESSAGES = {
  DONATION_COMPLETE:
    "Thank you for your donation! Check your email for confirmation.",
  SQUARE_PLACED: "Square placed successfully!",
  TRIVIA_CORRECT: "Correct! You earned a square.",
  PROFILE_UPDATED: "Profile updated successfully",
  WINNER_NOTIFIED: "Congratulations! Check your email for prize details.",
  PAYOUT_SENT: "Your prize has been sent!",
};

// =====================================
// TIMEZONE CONFIGURATION
// =====================================
const TIMEZONE_CONFIG = {
  DEFAULT: "America/Denver",
  DISPLAY: "America/New_York", // For user display
  SUPPORTED: [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Phoenix",
  ],
};

const TIER_CONFIG = {
  tier_25: { id: "tier_25", amount: 25, payoutPercentage: 0.77 },
  tier_50: { id: "tier_50", amount: 50, payoutPercentage: 0.77 },
  tier_100: { id: "tier_100", amount: 100, payoutPercentage: 0.77 },
  tier_250: { id: "tier_250", amount: 250, payoutPercentage: 0.8 },
  tier_500: { id: "tier_500", amount: 500, payoutPercentage: 0.8 },
  tier_1000: { id: "tier_1000", amount: 1000, payoutPercentage: 0.8 },
};

// const DUMMY_GAMES = [
//   {
//     GameKey: "202410828",
//     SeasonType: 1,
//     Season: 2024,
//     Week: 8,
//     Date: "2024-10-28T20:15:00",
//     AwayTeam: "NYG",
//     HomeTeam: "PIT",
//     AwayScore: null,
//     HomeScore: null,
//     Channel: "ESPN",
//     PointSpread: -2.3,
//     OverUnder: 14.1,
//     Quarter: null,
//     TimeRemaining: null,
//     Possession: null,
//     Down: null,
//     Distance: "Scrambled",
//     YardLine: null,
//     YardLineTerritory: null,
//     RedZone: null,
//     AwayScoreQuarter1: 11, // update here
//     AwayScoreQuarter2: 12,
//     AwayScoreQuarter3: 13,
//     AwayScoreQuarter4: 16,
//     AwayScoreOvertime: null,
//     HomeScoreQuarter1: 16, //update here
//     HomeScoreQuarter2: 13,
//     HomeScoreQuarter3: 18,
//     HomeScoreQuarter4: 18,
//     HomeScoreOvertime: null,
//     HasStarted: false,
//     IsInProgress: false,
//     IsOver: false,
//     Has1stQuarterStarted: true,
//     Has2ndQuarterStarted: true,
//     Has3rdQuarterStarted: true,
//     Has4thQuarterStarted: true,
//     IsOvertime: false,
//     DownAndDistance: null,
//     QuarterDescription: "",
//     StadiumID: 8,
//     LastUpdated: "2024-11-05T17:15:36",
//     GeoLat: null,
//     GeoLong: null,
//     ForecastTempLow: null,
//     ForecastTempHigh: null,
//     ForecastDescription: null,
//     ForecastWindChill: null,
//     ForecastWindSpeed: null,
//     AwayTeamMoneyLine: 83,
//     HomeTeamMoneyLine: -102,
//     Canceled: false,
//     Closed: false,
//     LastPlay: "Scrambled",
//     Day: "2024-10-28T00:00:00",
//     DateTime: "2024-10-28T20:15:00",
//     AwayTeamID: 23,
//     HomeTeamID: 28,
//     GlobalGameID: 18776,
//     GlobalAwayTeamID: 23,
//     GlobalHomeTeamID: 28,
//     PointSpreadAwayTeamMoneyLine: -41,
//     PointSpreadHomeTeamMoneyLine: -42,
//     ScoreID: 18776,
//     Status: "active",
//     GameEndDateTime: null,
//     HomeRotationNumber: 110,
//     AwayRotationNumber: 109,
//     NeutralVenue: false,
//     RefereeID: null,
//     OverPayout: -42,
//     UnderPayout: -41,
//     HomeTimeouts: null,
//     AwayTimeouts: null,
//     DateTimeUTC: "2024-10-29T00:15:00",
//     Attendance: 0,
//     IsClosed: false,
//     StadiumDetails: {
//       StadiumID: 8,
//       Name: "Acrisure Stadium",
//       City: "Pittsburgh",
//       State: "PA",
//       Country: "USA",
//       Capacity: 68400,
//       PlayingSurface: "Grass",
//       GeoLat: 40.446667,
//       GeoLong: -80.015833,
//       Type: "Outdoor",
//     },
//   },
// ];

const DUMMY_GAMES = [
  {
    game: {
      id: 3622,
      stage: "Regular Season",
      week: "Week 1",
      date: {
        timezone: "UTC",
        date: "2025-10-19",
        time: "12:00",
        timestamp: 1760875200,
      },
      venue: {
        name: null,
        city: null,
      },
      status: {
        short: "Q3",
        long: "3rd Quarter",
        timer: null,
      },
    },
    league: {
      id: 1,
      name: "NFL",
      season: "2025",
      logo: "https://media.api-sports.io/american-football/leagues/1.png",
      country: {
        name: "USA",
        code: "US",
        flag: "https://media.api-sports.io/flags/us.svg",
      },
    },
    teams: {
      home: {
        id: 10,
        name: "Las Vegas Raiders",
        logo: "https://media.api-sports.io/american-football/teams/10.png",
      },
      away: {
        id: 32,
        name: "Minnesota Vikings",
        logo: "https://media.api-sports.io/american-football/teams/32.png",
      },
    },
    scores: {
      home: {
        quarter_1: 10,
        quarter_2: 10,
        quarter_3: null,
        quarter_4: null,
        overtime: null,
        total: 0,
      },
      away: {
        quarter_1: 10,
        quarter_2: 19,
        quarter_3: null,
        quarter_4: null,
        overtime: null,
        total: 0,
      },
    },
  },
];

//  everything as default for easy importing
module.exports = {
  TIERS,
  GAME_CONFIG,
  SPORTS_CONFIG,
  API_CONFIG,
  NOTIFICATION_CONFIG,
  RATE_LIMITS,
  VALIDATION_RULES,
  FEATURE_FLAGS,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  TIMEZONE_CONFIG,
  TIER_CONFIG,
  // Helper functions
  getTierById,
  getTierByAmount,
  getAllTierIds,
  calculatePrizes,
  calculateInstantPayout,
  DUMMY_GAMES,
};
