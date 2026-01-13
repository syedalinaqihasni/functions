// Square Trivia - Utility Functions
// Core utilities used throughout the system for consistency and security

const admin = require("firebase-admin");
const crypto = require("crypto");
const functions = require("firebase-functions");

// Import constants from config file with fallback
let RATE_LIMITS, VALIDATION_RULES, ERROR_MESSAGES, FEATURE_FLAGS, TIER_CONFIG;

try {
  const config = require("./constants-configuration-fixed");
  RATE_LIMITS = config.RATE_LIMITS;
  VALIDATION_RULES = config.VALIDATION_RULES;
  ERROR_MESSAGES = config.ERROR_MESSAGES;
  FEATURE_FLAGS = config.FEATURE_FLAGS;
  TIER_CONFIG = config.TIER_CONFIG;
} catch (error) {
  console.log("Config file not found, using defaults");

  // Default configurations if config file is missing
  RATE_LIMITS = {
    GLOBAL_PER_USER: { max: 100, window: 3600000 }, // 1 hour
    TRIVIA_ANSWER: { max: 10, window: 60000 }, // 1 minute
    SQUARE_PLACEMENT: { max: 50, window: 3600000 }, // 1 hour
  };

  VALIDATION_RULES = {
    EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    TELEGRAM_USERNAME: /^@[a-zA-Z0-9_]{5,32}$/,
    MAX_EMAIL_LENGTH: 254,
    MIN_SQUARE_POSITION: 0,
    MAX_SQUARE_POSITION: 99,
    MIN_DONATION: 1,
    MAX_DONATION: 10000,
  };

  ERROR_MESSAGES = {
    INVALID_EMAIL: "Invalid email address",
    INVALID_TELEGRAM: "Invalid Telegram username",
    INVALID_PHONE: "Invalid phone number",
    INVALID_AMOUNT: "Invalid entry fee amount",
    SYSTEM_ERROR: "An error occurred. Please try again.",
    RATE_LIMITED: "Too many requests.",
  };

  FEATURE_FLAGS = {
    DEBUG_MODE: false,
  };

  // Tier configuration for skill-based system
  TIER_CONFIG = {
    tier_25: { id: "tier_25", amount: 25, payoutPercentage: 0.77 },
    tier_50: { id: "tier_50", amount: 50, payoutPercentage: 0.77 },
    tier_100: { id: "tier_100", amount: 100, payoutPercentage: 0.77 },
    tier_250: { id: "tier_250", amount: 250, payoutPercentage: 0.8 },
    tier_500: { id: "tier_500", amount: 500, payoutPercentage: 0.8 },
    tier_1000: { id: "tier_1000", amount: 1000, payoutPercentage: 0.8 },
  };
}

// =====================================
// TIMESTAMP UTILITIES
// =====================================

/**
 * Get server timestamp for new documents
 * ALWAYS use this instead of new Date()
 */
function getTimestamp() {
  return admin.firestore.FieldValue.serverTimestamp();
}

/**
 * Get current Firestore timestamp for comparisons
 */
function getNow() {
  return admin.firestore.Timestamp.now();
}

/**
 * Convert Firestore timestamp to Date
 */
function timestampToDate(timestamp) {
  if (!timestamp) return null;
  return timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
}

/**
 * Get timestamp for future date
 */
function getFutureTimestamp(days = 0, hours = 0, minutes = 0) {
  const future = new Date();
  future.setDate(future.getDate() + days);
  future.setHours(future.getHours() + hours);
  future.setMinutes(future.getMinutes() + minutes);
  return admin.firestore.Timestamp.fromDate(future);
}

/**
 * Check if timestamp is expired
 */
function isExpired(timestamp) {
  if (!timestamp) return true;
  const now = new Date();
  const expiry = timestampToDate(timestamp);
  return now > expiry;
}

/**
 * Format timestamp for display
 */
function formatTimestamp(timestamp, format = "full") {
  const date = timestampToDate(timestamp);
  if (!date) return "N/A";

  const options = {
    full: {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
    date: {
      year: "numeric",
      month: "short",
      day: "numeric",
    },
    time: {
      hour: "2-digit",
      minute: "2-digit",
    },
  };

  return date.toLocaleString("en-US", options[format] || options.full);
}

// =====================================
// INPUT VALIDATION
// =====================================

/**
 * Validate email address
 */
function validateEmail(email) {
  if (!email || typeof email !== "string") {
    return { valid: false, error: ERROR_MESSAGES.INVALID_EMAIL };
  }

  const trimmed = email.trim().toLowerCase();
  if (trimmed.length > VALIDATION_RULES.MAX_EMAIL_LENGTH) {
    return { valid: false, error: "Email address too long" };
  }

  if (!VALIDATION_RULES.EMAIL.test(trimmed)) {
    return { valid: false, error: ERROR_MESSAGES.INVALID_EMAIL };
  }

  return { valid: true, value: trimmed };
}

/**
 * Validate Telegram username
 */
function validateTelegramUsername(username) {
  // Allow empty/null values
  if (!username || username === "" || username.trim() === "") {
    return { valid: true, value: null, isEmpty: true };
  }

  if (typeof username !== "string") {
    return { valid: false, error: ERROR_MESSAGES.INVALID_TELEGRAM };
  }

  // Remove @ if present and trim
  const cleaned = username.trim().replace(/^@/, "");

  if (!VALIDATION_RULES.TELEGRAM_USERNAME.test("@" + cleaned)) {
    return { valid: false, error: ERROR_MESSAGES.INVALID_TELEGRAM };
  }

  return { valid: true, value: "@" + cleaned, isEmpty: false };
}

/**
 * Validate phone number (US only)
 */
function validatePhone(phone) {
  if (!phone || typeof phone !== "string") {
    return { valid: false, error: ERROR_MESSAGES.INVALID_PHONE };
  }

  // Remove all non-digits
  const digits = phone.replace(/\D/g, "");

  // Check if it's 10 digits (US) or 11 with country code
  if (digits.length === 10) {
    return { valid: true, value: "+1" + digits };
  } else if (digits.length === 11 && digits[0] === "1") {
    return { valid: true, value: "+" + digits };
  }

  return { valid: false, error: ERROR_MESSAGES.INVALID_PHONE };
}

/**
 * Validate square position
 */
function validateSquarePosition(position) {
  const pos = parseInt(position);

  if (
    isNaN(pos) ||
    pos < VALIDATION_RULES.MIN_SQUARE_POSITION ||
    pos > VALIDATION_RULES.MAX_SQUARE_POSITION
  ) {
    return { valid: false, error: "Invalid square position" };
  }

  return { valid: true, value: pos };
}

/**
 * Validate donation amount
 */
function validateDonationAmount(amount, tierId) {
  const num = parseFloat(amount);

  if (
    isNaN(num) ||
    num < VALIDATION_RULES.MIN_DONATION ||
    num > VALIDATION_RULES.MAX_DONATION
  ) {
    return { valid: false, error: ERROR_MESSAGES.INVALID_AMOUNT };
  }

  // Check if amount matches tier
  const tier = getTierById(tierId);
  if (tier && num !== tier.amount) {
    return { valid: false, error: "Amount does not match selected tier" };
  }

  return { valid: true, value: num };
}

/**
 * Sanitize user input to prevent XSS
 */
function sanitizeInput(input) {
  if (typeof input !== "string") return input;

  return input
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");
}

/**
 * Validate request data against schema
 */
function validateRequestData(data, requiredFields) {
  const errors = [];

  // Check required fields
  for (const field of requiredFields) {
    if (!data[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Validate specific fields if present
  if (data.email) {
    const emailValidation = validateEmail(data.email);
    if (!emailValidation.valid) errors.push(emailValidation.error);
  }

  if (data.telegramUsername !== undefined) {
    const telegramValidation = validateTelegramUsername(data.telegramUsername);
    if (!telegramValidation.valid) errors.push(telegramValidation.error);
    // Note: empty telegram is now valid
  }

  if (data.phone) {
    const phoneValidation = validatePhone(data.phone);
    if (!phoneValidation.valid) errors.push(phoneValidation.error);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// =====================================
// ERROR HANDLING
// =====================================

/**
 * Wrap async functions with error handling
 */
function asyncHandler(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      console.error(`Error in ${fn.name}:`, error);

      // Check if it's already a Firebase error
      if (error.code && error.message) {
        throw error;
      }

      // Convert to Firebase error
      throw new functions.https.HttpsError(
        "internal",
        ERROR_MESSAGES.SYSTEM_ERROR,
        { originalError: error.message }
      );
    }
  };
}

/**
 * Create standardized error response
 */
function createError(code, message, details = {}) {
  const errorCodes = {
    auth: "unauthenticated",
    permission: "permission-denied",
    validation: "invalid-argument",
    "not-found": "not-found",
    exists: "already-exists",
    "rate-limit": "resource-exhausted",
    internal: "internal",
  };

  return new functions.https.HttpsError(
    errorCodes[code] || "internal",
    message,
    details
  );
}

/**
 * Log error with context
 */
function logError(error, context = {}) {
  const errorLog = {
    message: error.message,
    stack: error.stack,
    code: error.code,
    timestamp: new Date().toISOString(),
    ...context,
  };

  console.error("ERROR:", JSON.stringify(errorLog, null, 2));

  // In production, send to error tracking service
  if (!FEATURE_FLAGS.DEBUG_MODE) {
    // Send to Sentry, LogRocket, etc.
  }
}

/**
 * Retry failed operations
 */
async function retryOperation(operation, maxRetries = 3, delay = 1000) {
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      console.log(`Attempt ${attempt + 1} failed:`, error.message);

      if (attempt < maxRetries - 1) {
        // Exponential backoff
        await new Promise((resolve) =>
          setTimeout(resolve, delay * Math.pow(2, attempt))
        );
      }
    }
  }

  throw lastError;
}

// =====================================
// TRANSACTION HELPERS
// =====================================

/**
 * Run transaction with automatic retry on conflicts
 */
async function safeTransaction(db, transactionFn, maxRetries = 5) {
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await db.runTransaction(transactionFn);
      return result;
    } catch (error) {
      lastError = error;

      // Check if it's a conflict error
      if (error.code === 6 || error.code === "aborted") {
        console.log(`Transaction conflict, retry ${attempt + 1}/${maxRetries}`);
        if (attempt < maxRetries - 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(100 * Math.pow(2, attempt), 1000))
          );
          continue;
        }
      }
      throw error;
    }
  }

  throw createError("internal", "Transaction failed after retries", {
    originalError: lastError.message,
  });
}

/**
 * Batch write with automatic chunking (Firestore limit: 500)
 */
async function safeBatchWrite(db, operations) {
  const BATCH_SIZE = 500;
  const chunks = [];

  // Split operations into chunks
  for (let i = 0; i < operations.length; i += BATCH_SIZE) {
    chunks.push(operations.slice(i, i + BATCH_SIZE));
  }

  // Process each chunk
  for (const chunk of chunks) {
    const batch = db.batch();

    for (const op of chunk) {
      switch (op.type) {
        case "set":
          batch.set(op.ref, op.data, op.options || {});
          break;
        case "update":
          batch.update(op.ref, op.data);
          break;
        case "delete":
          batch.delete(op.ref);
          break;
      }
    }

    await batch.commit();
  }

  return {
    success: true,
    totalOperations: operations.length,
    batches: chunks.length,
  };
}

/**
 * Distributed counter update (for high-frequency updates)
 */
async function updateDistributedCounter(db, docPath, field, delta = 1) {
  const shards = 10; // Number of shards
  const shardId = Math.floor(Math.random() * shards);
  const shardRef = db.doc(`${docPath}_counter_${shardId}`);

  await safeTransaction(db, async (transaction) => {
    const shard = await transaction.get(shardRef);
    const currentValue = shard.exists ? shard.data()[field] || 0 : 0;
    transaction.set(
      shardRef,
      {
        [field]: currentValue + delta,
      },
      { merge: true }
    );
  });
}

/**
 * Read distributed counter value
 */
async function readDistributedCounter(db, docPath, field) {
  const shards = 10;
  let total = 0;

  for (let i = 0; i < shards; i++) {
    const shardRef = db.doc(`${docPath}_counter_${i}`);
    const shard = await shardRef.get();
    if (shard.exists) {
      total += shard.data()[field] || 0;
    }
  }

  return total;
}

// =====================================
// RATE LIMITING
// =====================================

// In-memory store for rate limits (use Redis in production)
const rateLimitStore = new Map();

/**
 * Check rate limit for a user action
 */
async function checkRateLimit(userId, action, customLimits = null) {
  const limits =
    customLimits || RATE_LIMITS[action] || RATE_LIMITS.GLOBAL_PER_USER;
  const key = `${userId}:${action}`;
  const now = Date.now();

  // Get current state
  let state = rateLimitStore.get(key);

  if (!state) {
    state = { count: 0, resetAt: now + limits.window };
    rateLimitStore.set(key, state);
  }

  // Check if window has expired
  if (now > state.resetAt) {
    state.count = 0;
    state.resetAt = now + limits.window;
  }

  // Check if limit exceeded
  if (state.count >= limits.max) {
    const waitTime = Math.ceil((state.resetAt - now) / 1000);
    throw createError(
      "rate-limit",
      `${ERROR_MESSAGES.RATE_LIMITED} Please wait ${waitTime} seconds.`,
      { retryAfter: waitTime }
    );
  }

  // Increment counter
  state.count++;

  return {
    allowed: true,
    remaining: limits.max - state.count,
    resetAt: state.resetAt,
  };
}

/**
 * Reset rate limit for a user
 */
function resetRateLimit(userId, action = null) {
  if (action) {
    rateLimitStore.delete(`${userId}:${action}`);
  } else {
    // Reset all limits for user
    for (const key of rateLimitStore.keys()) {
      if (key.startsWith(`${userId}:`)) {
        rateLimitStore.delete(key);
      }
    }
  }
}

/**
 * Clean up expired rate limits
 */
function cleanupRateLimits() {
  const now = Date.now();

  for (const [key, state] of rateLimitStore.entries()) {
    if (now > state.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupRateLimits, 5 * 60 * 1000);

// =====================================
// RANDOM NUMBER GENERATION
// =====================================

/**
 * Generate cryptographically secure random integer without modulo bias
 */
function secureRandomInt(min, max) {
  if (min >= max) {
    throw new Error("Min must be less than max");
  }

  const range = max - min;
  const bytesNeeded = Math.ceil(Math.log2(range) / 8);
  const maxValid = Math.floor(256 ** bytesNeeded / range) * range;

  let randomValue;
  do {
    const randomBytes = crypto.randomBytes(bytesNeeded);
    randomValue = randomBytes.readUIntBE(0, bytesNeeded);
  } while (randomValue >= maxValid);

  return min + (randomValue % range);
}

/**
 * Select random element from array
 */
function secureRandomElement(array) {
  if (!array || array.length === 0) {
    throw new Error("Array cannot be empty");
  }

  const index = secureRandomInt(0, array.length);
  return array[index];
}

/**
 * Shuffle array using Fisher-Yates algorithm
 */
function secureShuffleArray(array) {
  const shuffled = [...array];

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = secureRandomInt(0, i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

/**
 * Generate random string for IDs
 */
function generateRandomId(length = 16) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";

  for (let i = 0; i < length; i++) {
    result += chars[secureRandomInt(0, chars.length)];
  }

  return result;
}

/**
 * Generate referral code
 */
function generateReferralCode() {
  const code = generateRandomId(6).toUpperCase();
  return code;
}

// =====================================
// DATA HELPERS
// =====================================

/**
 * Deep clone object (Firestore-safe)
 */
function deepClone(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  if (obj instanceof Date) return new Date(obj.getTime());
  if (obj instanceof admin.firestore.Timestamp) return obj;
  if (obj instanceof admin.firestore.FieldValue) return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => deepClone(item));
  }

  const cloned = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }

  return cloned;
}

/**
 * Merge objects with Firestore FieldValues preserved
 */
function safeMerge(target, source) {
  const result = deepClone(target);

  for (const key in source) {
    if (source.hasOwnProperty(key)) {
      if (source[key] instanceof admin.firestore.FieldValue) {
        result[key] = source[key];
      } else if (
        typeof source[key] === "object" &&
        !Array.isArray(source[key])
      ) {
        result[key] = safeMerge(result[key] || {}, source[key]);
      } else {
        result[key] = deepClone(source[key]);
      }
    }
  }

  return result;
}

/**
 * Remove undefined values from object
 */
function removeUndefined(obj) {
  const cleaned = {};

  for (const key in obj) {
    if (obj[key] !== undefined) {
      if (typeof obj[key] === "object" && !Array.isArray(obj[key])) {
        cleaned[key] = removeUndefined(obj[key]);
      } else {
        cleaned[key] = obj[key];
      }
    }
  }

  return cleaned;
}

/**
 * Batch array into chunks
 */
function batchArray(array, batchSize) {
  const batches = [];

  for (let i = 0; i < array.length; i += batchSize) {
    batches.push(array.slice(i, i + batchSize));
  }

  return batches;
}

// =====================================
// SKILL-BASED SYSTEM HELPERS
// =====================================

/**
 * Get tier configuration by ID
 * @param {string} tierId - The tier ID (e.g., 'tier_25', 'tier_100')
 * @returns {Object|null} Tier configuration object or null if not found
 */
function getTierById(tierId) {
  return TIER_CONFIG[tierId] || null;
}

/**
 * Calculate prize amounts based on tier
 * @param {number} tierAmount - The tier amount (25, 50, 100, etc.)
 * @returns {Object} Prize calculation with totalPrize, quarterPrize, and payoutPercentage
 */
function calculatePrizes(tierAmount) {
  // Find tier by amount
  const tier = Object.values(TIER_CONFIG).find((t) => t.amount === tierAmount);

  // Default to 77% if tier not found
  const payoutPercentage = tier ? tier.payoutPercentage : 0.77;

  // Calculate total contest prizes (50 squares * tier amount * payout percentage)
  const totalPrize = tierAmount * 50 * payoutPercentage;

  // Each quarter winner gets 1/4 of the total prize
  const quarterPrize = totalPrize / 4;

  return {
    totalPrize,
    quarterPrize,
    payoutPercentage,
  };
}

// =====================================
// PERFORMANCE MONITORING
// =====================================

/**
 * Measure function execution time
 */
function measurePerformance(fn, name = fn.name) {
  return async (...args) => {
    const start = Date.now();

    try {
      const result = await fn(...args);
      const duration = Date.now() - start;

      console.log(`[PERF] ${name} completed in ${duration}ms`);

      // Log slow operations
      if (duration > 1000) {
        console.warn(
          `[PERF] Slow operation detected: ${name} took ${duration}ms`
        );
      }

      return result;
    } catch (error) {
      const duration = Date.now() - start;
      console.error(`[PERF] ${name} failed after ${duration}ms`);
      throw error;
    }
  };
}

/**
 * Cache function results
 */
function memoize(fn, ttl = 300000) {
  // 5 min default
  const cache = new Map();

  return async (...args) => {
    const key = JSON.stringify(args);
    const cached = cache.get(key);

    if (cached && Date.now() - cached.timestamp < ttl) {
      return cached.value;
    }

    const result = await fn(...args);
    cache.set(key, { value: result, timestamp: Date.now() });

    // Clean old entries
    for (const [k, v] of cache.entries()) {
      if (Date.now() - v.timestamp > ttl) {
        cache.delete(k);
      }
    }

    return result;
  };
}

// =====================================
// MODULE EXPORTS
// =====================================

module.exports = {
  // Timestamps
  getTimestamp,
  getNow,
  timestampToDate,
  getFutureTimestamp,
  isExpired,
  formatTimestamp,

  // Validation
  validateEmail,
  validateTelegramUsername,
  validatePhone,
  validateSquarePosition,
  validateDonationAmount,
  sanitizeInput,
  validateRequestData,

  // Error handling
  asyncHandler,
  createError,
  logError,
  retryOperation,

  // Transactions
  safeTransaction,
  safeBatchWrite,
  updateDistributedCounter,
  readDistributedCounter,

  // Rate limiting
  checkRateLimit,
  resetRateLimit,
  cleanupRateLimits,

  // Random generation
  secureRandomInt,
  secureRandomElement,
  secureShuffleArray,
  generateRandomId,
  generateReferralCode,

  // Data helpers
  deepClone,
  safeMerge,
  removeUndefined,
  batchArray,

  // Skill-based system helpers
  getTierById,
  calculatePrizes,

  // Performance
  measurePerformance,
  memoize,
};
