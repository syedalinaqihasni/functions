// Artifact #12: Monitoring & Alerts
// Comprehensive system health monitoring and automated alerts
// Updated with new payment structure monitoring (77%/80% tiers, instant payouts, Relay batches)

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const nodemailer = require("nodemailer");
const {
  DailyRecapPost,
  WeeklyChampionPost,
  NoFeesPost,
  SkillCelebration,
  RecordBreakerPost,
  PlatformMilestonePost,
  ReferralLeaderboard,
  TeamRivalryPost,
  MultiGameUpdatePost,
} = require("./social-posts-functions");
const { generateImage } = require("./backend-game-functions");

// admin.initializeApp();
const db = admin.firestore();

// Initialize services
const mailTransport = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

// =====================================
// CONSTANTS
// =====================================
const ALERT_LEVELS = {
  INFO: "info",
  WARNING: "warning",
  ERROR: "error",
  CRITICAL: "critical",
};

const HEALTH_STATUS = {
  HEALTHY: "healthy",
  DEGRADED: "degraded",
  DOWN: "down",
  UNKNOWN: "unknown",
};

const MONITORING_CONFIG = {
  API_TIMEOUT: 5000, // 5 seconds
  STALE_GAME_HOURS: 4,
  LOW_BALANCE_THRESHOLD: 1000,
  HIGH_ERROR_RATE_THRESHOLD: 0.05, // 5%
  RESPONSE_TIME_THRESHOLD: 3000, // 3 seconds
  BACKUP_AGE_WARNING_DAYS: 1,
  NOTIFICATION_RETRY_HOURS: 1,
  // New payment monitoring thresholds
  INSTANT_PAYOUT_FAILURE_THRESHOLD: 0.1, // 10% failure rate
  INSTANT_PAYOUT_SLOW_THRESHOLD: 10000, // 10 seconds
  RELAY_BATCH_AGE_WARNING_HOURS: 24,
  FEE_DEVIATION_THRESHOLD: 0.02, // 2% deviation from expected
  MIN_INSTANT_PAYOUTS_FOR_ALERT: 10, // Minimum sample size
};

// Payment structure constants - CONFIGURE DURING DEPLOYMENT
const PAYMENT_TIERS = {
  "$25 Tier": { amount: 25, payoutPercentage: 0.77 },
  "$50 Tier": { amount: 50, payoutPercentage: 0.77 },
  "$100 Tier": { amount: 100, payoutPercentage: 0.77 },
  "$250 Tier": { amount: 250, payoutPercentage: 0.8 },
  "$500 Tier": { amount: 500, payoutPercentage: 0.8 },
  "$1000 Tier": { amount: 1000, payoutPercentage: 0.8 },
};

// Instant payout fee - CONFIGURE DURING DEPLOYMENT
const INSTANT_PAYOUT_FEE = 0.08; // 8%

const BATCH_PAYOUT_DAYS = ["tuesday", "friday"];

// =====================================
// SYSTEM HEALTH CHECKS
// =====================================

/**
 * Main health check - runs every 5 minutes
 */
exports.systemHealthCheck = functions.pubsub
  .schedule("every 5 minutes")
  .timeZone("America/New_York")
  .onRun(async (context) => {
    console.log("Starting system health check");

    const healthReport = {
      timestamp: new Date(),
      checks: {},
      overallStatus: HEALTH_STATUS.HEALTHY,
      issues: [],
    };

    try {
      // Run all health checks
      healthReport.checks.apiSports = await checkApiSportsHealth();
      healthReport.checks.stripe = await checkStripeHealth();
      healthReport.checks.telegram = await checkTelegramHealth();
      healthReport.checks.database = await checkDatabaseHealth();
      healthReport.checks.games = await checkGameProcessing();
      healthReport.checks.notifications = await checkNotificationDelivery();
      healthReport.checks.payments = await checkPaymentProcessing();
      healthReport.checks.storage = await checkStorageHealth();
      // New payment structure checks
      healthReport.checks.instantPayouts = await checkInstantPayoutHealth();
      healthReport.checks.relayBatches = await checkRelayBatchHealth();
      healthReport.checks.payoutDistribution = await checkPayoutDistribution();

      // Determine overall status
      const statuses = Object.values(healthReport.checks).map((c) => c.status);
      if (statuses.includes(HEALTH_STATUS.DOWN)) {
        healthReport.overallStatus = HEALTH_STATUS.DOWN;
      } else if (statuses.includes(HEALTH_STATUS.DEGRADED)) {
        healthReport.overallStatus = HEALTH_STATUS.DEGRADED;
      }

      // Collect all issues
      Object.values(healthReport.checks).forEach((check) => {
        if (check.issues) {
          healthReport.issues.push(...check.issues);
        }
      });

      // Store health report
      await admin
        .firestore()
        .collection("healthReports")
        .add({
          ...healthReport,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });

      // Send alerts if needed
      if (healthReport.overallStatus !== HEALTH_STATUS.HEALTHY) {
        await handleHealthIssues(healthReport);
      }

      console.log(`Health check complete: ${healthReport.overallStatus}`);
    } catch (error) {
      console.error("Health check failed:", error);
      await sendAlert(
        ALERT_LEVELS.CRITICAL,
        "Health Check Failed",
        error.message
      );
    }
  });

/**
 * Check API-Sports connectivity and rate limits
 */
async function checkApiSportsHealth() {
  const result = {
    service: "API-Sports",
    status: HEALTH_STATUS.HEALTHY,
    issues: [],
    metrics: {},
  };

  try {
    const startTime = Date.now();
    const response = await axios.get(
      "https://v1.american-football.api-sports.io/status",
      {
        headers: {
          "x-rapidapi-key":
            // functions.config().apisports.key ||
            process.env.APISPORTS_KEY,
          "x-rapidapi-host": "v1.american-football.api-sports.io",
        },
        timeout: MONITORING_CONFIG.API_TIMEOUT,
      }
    );

    const responseTime = Date.now() - startTime;
    result.metrics.responseTime = responseTime;

    // Check response - FIXED: Complete the truncated condition
    if (response.data.errors?.length > 0) {
      result.status = HEALTH_STATUS.DEGRADED;
      result.issues.push("API-Sports reporting errors");
    }

    // Check rate limits
    const remaining = response.headers["x-ratelimit-requests-remaining"];
    const limit = response.headers["x-ratelimit-requests-limit"];

    if (remaining !== undefined && limit !== undefined) {
      result.metrics.rateLimitRemaining = parseInt(remaining);
      result.metrics.rateLimitTotal = parseInt(limit);

      const usagePercent = ((limit - remaining) / limit) * 100;
      if (usagePercent > 90) {
        result.status = HEALTH_STATUS.DEGRADED;
        result.issues.push(
          `API rate limit near exhaustion: ${remaining}/${limit} remaining`
        );
      }
    }

    // Check response time
    if (responseTime > MONITORING_CONFIG.RESPONSE_TIME_THRESHOLD) {
      result.status = HEALTH_STATUS.DEGRADED;
      result.issues.push(`Slow API response: ${responseTime}ms`);
    }
  } catch (error) {
    result.status = HEALTH_STATUS.DOWN;
    result.issues.push(`API-Sports unreachable: ${error.message}`);
    result.error = error.message;
  }

  return result;
}

/**
 * Check Stripe connectivity and webhook status
 */
async function checkStripeHealth() {
  const result = {
    service: "Stripe",
    status: HEALTH_STATUS.HEALTHY,
    issues: [],
    metrics: {},
  };

  try {
    // Check recent webhook events
    const recentEvents = await admin
      .firestore()
      .collection("stripeEvents")
      .where("receivedAt", ">=", new Date(Date.now() - 60 * 60 * 1000)) // Last hour
      .get();

    result.metrics.webhooksLastHour = recentEvents.size;

    // Check for failed webhooks
    const failedWebhooks = recentEvents.docs.filter(
      (doc) =>
        !doc.data().processed &&
        doc.data().receivedAt.toMillis() < Date.now() - 10 * 60 * 1000 // Older than 10 min
    );

    if (failedWebhooks.length > 0) {
      result.status = HEALTH_STATUS.DEGRADED;
      result.issues.push(`${failedWebhooks.length} unprocessed webhooks`);
    }

    // Check payment failure rate
    const recentPayments = await admin
      .firestore()
      .collection("donations")
      .where("createdAt", ">=", new Date(Date.now() - 24 * 60 * 60 * 1000)) // Last 24 hours
      .get();

    const failed = recentPayments.docs.filter(
      (doc) => doc.data().status === "failed"
    ).length;
    const total = recentPayments.size;

    if (total > 0) {
      const failureRate = failed / total;
      result.metrics.paymentFailureRate = (failureRate * 100).toFixed(2) + "%";

      if (failureRate > MONITORING_CONFIG.HIGH_ERROR_RATE_THRESHOLD) {
        result.status = HEALTH_STATUS.DEGRADED;
        result.issues.push(
          `High payment failure rate: ${(failureRate * 100).toFixed(2)}%`
        );
      }
    }
  } catch (error) {
    result.status = HEALTH_STATUS.UNKNOWN;
    result.issues.push(`Could not check Stripe health: ${error.message}`);
  }

  return result;
}

/**
 * Check Telegram bot connectivity
 */
async function checkTelegramHealth() {
  const result = {
    service: "Telegram",
    status: HEALTH_STATUS.HEALTHY,
    issues: [],
    metrics: {},
  };

  // First check how many users actually have Telegram
  const totalUsers = await admin.firestore().collection("users").count().get();
  const telegramUsers = await admin
    .firestore()
    .collection("users")
    .where("hasTelegram", "==", true)
    .count()
    .get();

  result.metrics.totalUsers = totalUsers.data().count;
  result.metrics.telegramUsers = telegramUsers.data().count;
  result.metrics.telegramAdoptionRate =
    ((telegramUsers.data().count / totalUsers.data().count) * 100).toFixed(2) +
    "%";

  // Only check Telegram bot health if we have Telegram users
  if (telegramUsers.data().count === 0) {
    result.metrics.note = "No users have Telegram configured";
    return result;
  }

  try {
    const TelegramBot = require("node-telegram-bot-api");
    const bot = new TelegramBot(functions.config().telegram.bot_token, {
      polling: false,
    });

    const startTime = Date.now();
    const botInfo = await bot.getMe();
    const responseTime = Date.now() - startTime;

    result.metrics.responseTime = responseTime;
    result.metrics.botUsername = botInfo.username;

    if (responseTime > MONITORING_CONFIG.RESPONSE_TIME_THRESHOLD) {
      result.status = HEALTH_STATUS.DEGRADED;
      result.issues.push(`Slow Telegram response: ${responseTime}ms`);
    }

    // Check recent notification failures
    const recentNotifications = await admin
      .firestore()
      .collection("winners")
      .where("notifiedAt", ">=", new Date(Date.now() - 24 * 60 * 60 * 1000))
      .where("notificationStatus", "==", "failed")
      .get();

    if (recentNotifications.size > 0) {
      result.status = HEALTH_STATUS.DEGRADED;
      result.issues.push(
        `${recentNotifications.size} failed Telegram notifications in last 24h`
      );
    }
  } catch (error) {
    result.status = HEALTH_STATUS.DOWN;
    result.issues.push(`Telegram bot error: ${error.message}`);
  }

  return result;
}

/**
 * Check database performance and connectivity
 */
async function checkDatabaseHealth() {
  const result = {
    service: "Firestore",
    status: HEALTH_STATUS.HEALTHY,
    issues: [],
    metrics: {},
  };

  try {
    // Test write
    const startWrite = Date.now();
    const testRef = await admin.firestore().collection("healthChecks").add({
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      type: "write_test",
    });
    const writeTime = Date.now() - startWrite;

    // Test read
    const startRead = Date.now();
    await testRef.get();
    const readTime = Date.now() - startRead;

    // Clean up
    await testRef.delete();

    result.metrics.writeTime = writeTime;
    result.metrics.readTime = readTime;

    // Check performance
    if (writeTime > 1000 || readTime > 500) {
      result.status = HEALTH_STATUS.DEGRADED;
      result.issues.push(
        `Slow database performance: write ${writeTime}ms, read ${readTime}ms`
      );
    }

    // Check collection sizes
    const collections = ["users", "donations", "boards", "winners"];
    for (const collection of collections) {
      const count = await admin
        .firestore()
        .collection(collection)
        .count()
        .get();
      result.metrics[`${collection}Count`] = count.data().count;
    }
  } catch (error) {
    result.status = HEALTH_STATUS.DOWN;
    result.issues.push(`Database error: ${error.message}`);
  }

  return result;
}

/**
 * Check game processing status
 */
async function checkGameProcessing() {
  const result = {
    service: "Game Processing",
    status: HEALTH_STATUS.HEALTHY,
    issues: [],
    metrics: {},
  };

  try {
    // Check for stuck games
    const stuckThreshold = new Date(
      Date.now() - MONITORING_CONFIG.STALE_GAME_HOURS * 60 * 60 * 1000
    );

    const stuckGames = await admin
      .firestore()
      .collection("games")
      .where("status", "==", "active")
      .where("startTime", "<", stuckThreshold)
      .get();

    result.metrics.activeGames = (
      await admin
        .firestore()
        .collection("games")
        .where("status", "==", "active")
        .get()
    ).size;

    if (stuckGames.size > 0) {
      result.status = HEALTH_STATUS.DEGRADED;
      result.issues.push(`${stuckGames.size} games stuck in active status`);

      // List stuck games
      const stuckGamesList = stuckGames.docs.map((doc) => {
        const game = doc.data();
        return `${game.teams.away} @ ${game.teams.home}`;
      });
      result.metrics.stuckGames = stuckGamesList;
    }

    // Check for games missing API IDs
    const upcomingGames = await admin
      .firestore()
      .collection("games")
      .where("status", "==", "scheduled")
      .where("startTime", "<=", new Date(Date.now() + 24 * 60 * 60 * 1000)) // Next 24h
      .get();

    const missingApiId = upcomingGames.docs.filter(
      (doc) => !doc.data().apiSportsId
    );

    if (missingApiId.length > 0) {
      result.status = HEALTH_STATUS.DEGRADED;
      result.issues.push(
        `${missingApiId.length} scheduled games missing API Sports ID`
      );
    }
  } catch (error) {
    result.status = HEALTH_STATUS.UNKNOWN;
    result.issues.push(`Could not check game processing: ${error.message}`);
  }

  return result;
}

/**
 * Check notification delivery status
 */
async function checkNotificationDelivery() {
  const result = {
    service: "Notifications",
    status: HEALTH_STATUS.HEALTHY,
    issues: [],
    metrics: {},
  };

  try {
    // Check for unnotified winners
    const retryThreshold = new Date(
      Date.now() - MONITORING_CONFIG.NOTIFICATION_RETRY_HOURS * 60 * 60 * 1000
    );

    const unnotifiedWinners = await admin
      .firestore()
      .collection("winners")
      .where("notificationStatus", "==", "pending")
      .where("createdAt", "<", retryThreshold)
      .get();

    result.metrics.pendingNotifications = unnotifiedWinners.size;

    if (unnotifiedWinners.size > 0) {
      result.status = HEALTH_STATUS.DEGRADED;
      result.issues.push(
        `${unnotifiedWinners.size} winners not notified after ${MONITORING_CONFIG.NOTIFICATION_RETRY_HOURS} hour(s)`
      );
    }

    // Check email service
    try {
      await mailTransport.verify();
      result.metrics.emailServiceStatus = "connected";
    } catch (error) {
      result.status = HEALTH_STATUS.DEGRADED;
      result.issues.push(`Email service error: ${error.message}`);
      result.metrics.emailServiceStatus = "disconnected";
    }
  } catch (error) {
    result.status = HEALTH_STATUS.UNKNOWN;
    result.issues.push(`Could not check notifications: ${error.message}`);
  }

  return result;
}

/**
 * Check payment processing status
 */
async function checkPaymentProcessing() {
  const result = {
    service: "Payment Processing",
    status: HEALTH_STATUS.HEALTHY,
    issues: [],
    metrics: {},
  };

  try {
    // Check Mercury balance
    const mercuryBalance = await getMercuryBalance();
    result.metrics.mercuryBalance = mercuryBalance.toFixed(2);

    if (mercuryBalance < MONITORING_CONFIG.LOW_BALANCE_THRESHOLD) {
      result.status = HEALTH_STATUS.DEGRADED;
      result.issues.push(`Low Mercury balance: $${mercuryBalance.toFixed(2)}`);
    }

    // Check pending payouts - FIXED: Complete the truncated collection name
    const pendingPayouts = await admin
      .firestore()
      .collection("winners")
      .where("status", "==", "pending_payout")
      .get();

    let totalPending = 0;
    let pendingByType = { instant: 0, batch: 0 };

    pendingPayouts.forEach((doc) => {
      const winner = doc.data();
      totalPending += winner.prizeAmount;

      // Track by payout type
      if (winner.payoutType === "instant") {
        pendingByType.instant += winner.prizeAmount;
      } else {
        pendingByType.batch += winner.prizeAmount;
      }
    });

    result.metrics.pendingPayouts = pendingPayouts.size;
    result.metrics.pendingAmount = totalPending.toFixed(2);
    result.metrics.pendingInstantAmount = pendingByType.instant.toFixed(2);
    result.metrics.pendingBatchAmount = pendingByType.batch.toFixed(2);

    // Check if we can cover pending payouts
    if (totalPending > mercuryBalance) {
      result.status = HEALTH_STATUS.DEGRADED;
      result.issues.push(
        `Insufficient funds: Need $${totalPending.toFixed(
          2
        )}, have $${mercuryBalance.toFixed(2)}`
      );
    }

    // Check for old pending payouts
    const oldPayouts = pendingPayouts.docs.filter((doc) => {
      const createdAt = doc.data().createdAt?.toMillis() || 0;
      return createdAt < Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days
    });

    if (oldPayouts.length > 0) {
      result.status = HEALTH_STATUS.DEGRADED;
      result.issues.push(
        `${oldPayouts.length} payouts pending for over 7 days`
      );
    }
  } catch (error) {
    result.status = HEALTH_STATUS.UNKNOWN;
    result.issues.push(`Could not check payment processing: ${error.message}`);
  }

  return result;
}

/**
 * Check instant payout system health
 */
async function checkInstantPayoutHealth() {
  const result = {
    service: "Instant Payouts",
    status: HEALTH_STATUS.HEALTHY,
    issues: [],
    metrics: {},
  };

  try {
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Get recent instant payouts
    const instantPayouts = await admin
      .firestore()
      .collection("payouts")
      .where("payoutType", "==", "instant")
      .where("createdAt", ">=", last24h)
      .get();

    result.metrics.instantPayoutsLast24h = instantPayouts.size;

    if (instantPayouts.size > 0) {
      let totalProcessingTime = 0;
      let failedCount = 0;
      let totalFees = 0;
      let successfulPayouts = 0;

      instantPayouts.forEach((doc) => {
        const payout = doc.data();

        if (payout.status === "failed") {
          failedCount++;
        } else if (payout.status === "completed") {
          successfulPayouts++;
          if (payout.processingTime) {
            totalProcessingTime += payout.processingTime;
          }
          if (payout.instantPayoutFee) {
            totalFees += payout.instantPayoutFee;
          }
        }
      });

      // Calculate metrics
      const failureRate = failedCount / instantPayouts.size;
      result.metrics.instantPayoutFailureRate =
        (failureRate * 100).toFixed(2) + "%";

      if (successfulPayouts > 0) {
        result.metrics.avgProcessingTime = Math.round(
          totalProcessingTime / successfulPayouts
        );
        result.metrics.totalInstantFees24h = totalFees.toFixed(2);
      }

      // Check failure rate
      if (
        failureRate > MONITORING_CONFIG.INSTANT_PAYOUT_FAILURE_THRESHOLD &&
        instantPayouts.size >= MONITORING_CONFIG.MIN_INSTANT_PAYOUTS_FOR_ALERT
      ) {
        result.status = HEALTH_STATUS.DEGRADED;
        result.issues.push(
          `High instant payout failure rate: ${(failureRate * 100).toFixed(2)}%`
        );
      }

      // Check processing time
      if (
        result.metrics.avgProcessingTime >
        MONITORING_CONFIG.INSTANT_PAYOUT_SLOW_THRESHOLD
      ) {
        result.status = HEALTH_STATUS.DEGRADED;
        result.issues.push(
          `Slow instant payout processing: avg ${result.metrics.avgProcessingTime}ms`
        );
      }
    } else {
      result.metrics.note = "No instant payouts in last 24 hours";
    }

    // Check instant payout adoption rate
    const allWinners24h = await admin
      .firestore()
      .collection("winners")
      .where("createdAt", ">=", last24h)
      .get();

    if (allWinners24h.size > 0) {
      const instantWinners = allWinners24h.docs.filter(
        (doc) => doc.data().payoutType === "instant"
      ).length;

      result.metrics.instantPayoutAdoption =
        ((instantWinners / allWinners24h.size) * 100).toFixed(2) + "%";
    }
  } catch (error) {
    result.status = HEALTH_STATUS.UNKNOWN;
    result.issues.push(
      `Could not check instant payout health: ${error.message}`
    );
  }

  return result;
}

/**
 * Check Relay batch processing health
 */
async function checkRelayBatchHealth() {
  const result = {
    service: "Relay Batches",
    status: HEALTH_STATUS.HEALTHY,
    issues: [],
    metrics: {},
  };

  try {
    // Check for pending Relay batches
    const pendingBatches = await admin
      .firestore()
      .collection("relayBatches")
      .where("status", "==", "pending")
      .get();

    result.metrics.pendingBatches = pendingBatches.size;

    // Check for old pending batches
    const oldBatchThreshold = new Date(
      Date.now() -
        MONITORING_CONFIG.RELAY_BATCH_AGE_WARNING_HOURS * 60 * 60 * 1000
    );

    const oldBatches = pendingBatches.docs.filter((doc) => {
      const createdAt = doc.data().createdAt?.toMillis() || Date.now();
      return createdAt < oldBatchThreshold.getTime();
    });

    if (oldBatches.length > 0) {
      result.status = HEALTH_STATUS.DEGRADED;
      result.issues.push(
        `${oldBatches.length} Relay batches pending for over ${MONITORING_CONFIG.RELAY_BATCH_AGE_WARNING_HOURS} hours`
      );
    }

    // Check for failed batches in last 7 days
    const last7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const failedBatches = await admin
      .firestore()
      .collection("relayBatches")
      .where("status", "==", "failed")
      .where("createdAt", ">=", last7Days)
      .get();

    if (failedBatches.size > 0) {
      result.status = HEALTH_STATUS.DEGRADED;
      result.issues.push(
        `${failedBatches.size} failed Relay batches in last 7 days`
      );
      result.metrics.failedBatches = failedBatches.size;
    }

    // Check batch processing schedule
    const today = new Date();
    const dayName = today.toLocaleDateString("en-US", { weekday: "lowercase" });

    if (BATCH_PAYOUT_DAYS.includes(dayName)) {
      // On batch days, check if batch has been processed
      const todayStart = new Date(today);
      todayStart.setHours(0, 0, 0, 0);

      const todaysBatches = await admin
        .firestore()
        .collection("relayBatches")
        .where("createdAt", ">=", todayStart)
        .get();

      if (todaysBatches.empty && new Date().getHours() > 12) {
        result.status = HEALTH_STATUS.DEGRADED;
        result.issues.push(`No batch processed today (${dayName})`);
      }
    }

    // Get batch statistics
    const completedBatches = await admin
      .firestore()
      .collection("relayBatches")
      .where("status", "==", "completed")
      .where("createdAt", ">=", last7Days)
      .orderBy("createdAt", "desc")
      .limit(10)
      .get();

    if (!completedBatches.empty) {
      let totalAmount = 0;
      let totalPayouts = 0;

      completedBatches.forEach((doc) => {
        const batch = doc.data();
        totalAmount += batch.totalAmount || 0;
        totalPayouts += batch.payoutCount || 0;
      });

      result.metrics.avgBatchAmount = (
        totalAmount / completedBatches.size
      ).toFixed(2);
      result.metrics.avgBatchSize = Math.round(
        totalPayouts / completedBatches.size
      );
    }
  } catch (error) {
    result.status = HEALTH_STATUS.UNKNOWN;
    result.issues.push(`Could not check Relay batch health: ${error.message}`);
  }

  return result;
}

/**
 * Check payout percentage distribution
 */
async function checkPayoutDistribution() {
  const result = {
    service: "Payout Distribution",
    status: HEALTH_STATUS.HEALTHY,
    issues: [],
    metrics: {},
  };

  try {
    const last7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Get recent donations to check tier distribution
    const recentDonations = await admin
      .firestore()
      .collection("donations")
      .where("status", "==", "completed")
      .where("createdAt", ">=", last7Days)
      .get();

    // Calculate revenue by payout percentage
    let revenue77 = 0;
    let revenue80 = 0;
    let count77 = 0;
    let count80 = 0;
    let platformFees77 = 0;
    let platformFees80 = 0;

    recentDonations.forEach((doc) => {
      const donation = doc.data();
      const tier = PAYMENT_TIERS[donation.tier];

      if (tier) {
        if (tier.payoutPercentage === 0.77) {
          revenue77 += donation.amount;
          count77++;
          platformFees77 += donation.amount * 0.23;
        } else if (tier.payoutPercentage === 0.8) {
          revenue80 += donation.amount;
          count80++;
          platformFees80 += donation.amount * 0.2;
        }
      }
    });

    result.metrics.revenue77Percent = revenue77.toFixed(2);
    result.metrics.revenue80Percent = revenue80.toFixed(2);
    result.metrics.count77Percent = count77;
    result.metrics.count80Percent = count80;
    result.metrics.platformFees77 = platformFees77.toFixed(2);
    result.metrics.platformFees80 = platformFees80.toFixed(2);
    result.metrics.totalPlatformFees = (
      platformFees77 + platformFees80
    ).toFixed(2);

    // Check if percentages are being applied correctly
    const winnersToCheck = await admin
      .firestore()
      .collection("winners")
      .where("createdAt", ">=", last7Days)
      .limit(100)
      .get();

    let incorrectPayouts = 0;

    winnersToCheck.forEach((doc) => {
      const winner = doc.data();
      const expectedTier = PAYMENT_TIERS[winner.tier];

      if (expectedTier && winner.donationAmount) {
        const expectedPrize =
          winner.donationAmount * expectedTier.payoutPercentage;
        const actualPrize = winner.prizeAmount;

        // Allow for small rounding differences
        if (Math.abs(expectedPrize - actualPrize) > 0.01) {
          incorrectPayouts++;
        }
      }
    });

    if (incorrectPayouts > 0) {
      result.status = HEALTH_STATUS.DEGRADED;
      result.issues.push(
        `${incorrectPayouts} winners have incorrect payout calculations`
      );
    }

    // Check instant payout fee collection
    const instantPayouts = await admin
      .firestore()
      .collection("payouts")
      .where("payoutType", "==", "instant")
      .where("status", "==", "completed")
      .where("createdAt", ">=", last7Days)
      .get();

    let totalInstantFees = 0;
    let incorrectFees = 0;

    instantPayouts.forEach((doc) => {
      const payout = doc.data();
      if (payout.instantPayoutFee) {
        totalInstantFees += payout.instantPayoutFee;

        // Check if fee is correct (8%)
        const expectedFee = payout.originalAmount * INSTANT_PAYOUT_FEE;
        if (Math.abs(expectedFee - payout.instantPayoutFee) > 0.01) {
          incorrectFees++;
        }
      }
    });

    result.metrics.instantPayoutFeesCollected = totalInstantFees.toFixed(2);

    if (incorrectFees > 0) {
      result.status = HEALTH_STATUS.DEGRADED;
      result.issues.push(
        `${incorrectFees} instant payouts have incorrect fee calculations`
      );
    }

    // Calculate effective platform revenue
    const totalRevenue = revenue77 + revenue80;
    const totalPlatformRevenue =
      platformFees77 + platformFees80 + totalInstantFees;

    if (totalRevenue > 0) {
      result.metrics.effectivePlatformRate =
        ((totalPlatformRevenue / totalRevenue) * 100).toFixed(2) + "%";
    }
  } catch (error) {
    result.status = HEALTH_STATUS.UNKNOWN;
    result.issues.push(`Could not check payout distribution: ${error.message}`);
  }

  return result;
}

/**
 * Check storage and backup status
 */
async function checkStorageHealth() {
  const result = {
    service: "Storage & Backups",
    status: HEALTH_STATUS.HEALTHY,
    issues: [],
    metrics: {},
  };

  try {
    // Check last backup time
    const lastBackup = await admin
      .firestore()
      .collection("backups")
      .orderBy("timestamp", "desc")
      .limit(1)
      .get();

    if (!lastBackup.empty) {
      const backupTime = lastBackup.docs[0].data().timestamp.toMillis();
      const backupAge = Date.now() - backupTime;
      const backupAgeDays = backupAge / (24 * 60 * 60 * 1000);

      result.metrics.lastBackupAge = `${backupAgeDays.toFixed(1)} days`;

      if (backupAgeDays > MONITORING_CONFIG.BACKUP_AGE_WARNING_DAYS) {
        result.status = HEALTH_STATUS.DEGRADED;
        result.issues.push(
          `Last backup is ${backupAgeDays.toFixed(1)} days old`
        );
      }
    } else {
      // FIXED: Complete the truncated else block
      result.status = HEALTH_STATUS.DEGRADED;
      result.issues.push("No backups found");
    }

    // Check storage usage (this is a placeholder - actual implementation depends on your setup)
    result.metrics.estimatedStorage = "N/A";
  } catch (error) {
    result.status = HEALTH_STATUS.UNKNOWN;
    result.issues.push(`Could not check storage health: ${error.message}`);
  }

  return result;
}

// =====================================
// ERROR TRACKING
// =====================================

/**
 * Central error handler for all functions
 */
exports.handleFunctionError = functions.https.onCall(async (data, context) => {
  const { functionName, error, metadata } = data;

  try {
    // Log error
    const errorRef = await admin
      .firestore()
      .collection("errors")
      .add({
        functionName,
        error: {
          message: error.message,
          stack: error.stack,
          code: error.code,
        },
        metadata,
        userId: context.auth?.uid,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

    // Determine severity
    const severity = determineSeverity(error, functionName);

    // Send alert if critical
    if (severity === ALERT_LEVELS.CRITICAL || severity === ALERT_LEVELS.ERROR) {
      await sendAlert(severity, `Error in ${functionName}`, error.message, {
        errorId: errorRef.id,
        ...metadata,
      });
    }

    // Update error metrics
    await updateErrorMetrics(functionName, severity);

    return { success: true, errorId: errorRef.id };
  } catch (trackingError) {
    console.error("Error tracking failed:", trackingError);
    return { success: false, error: trackingError.message };
  }
});

/**
 * Monitor error rates
 */
exports.monitorErrorRates = functions.pubsub
  .schedule("every 15 minutes")
  .onRun(async (context) => {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

    // Get recent errors
    const recentErrors = await admin
      .firestore()
      .collection("errors")
      .where("timestamp", ">=", fifteenMinutesAgo)
      .get();

    // Group by function
    const errorsByFunction = {};
    recentErrors.forEach((doc) => {
      const error = doc.data();
      if (!errorsByFunction[error.functionName]) {
        errorsByFunction[error.functionName] = 0;
      }
      errorsByFunction[error.functionName]++;
    });

    // Check for high error rates
    const alerts = [];
    Object.entries(errorsByFunction).forEach(([functionName, count]) => {
      if (count > 10) {
        alerts.push({
          function: functionName,
          errors: count,
          level: count > 50 ? ALERT_LEVELS.CRITICAL : ALERT_LEVELS.WARNING,
        });
      }
    });

    if (alerts.length > 0) {
      await sendAlert(
        ALERT_LEVELS.WARNING,
        "High Error Rates Detected",
        `Multiple functions experiencing errors:\n${alerts
          .map((a) => `- ${a.function}: ${a.errors} errors`)
          .join("\n")}`
      );
    }
  });

// =====================================
// PERFORMANCE MONITORING
// =====================================

/**
 * Track function performance
 */
exports.trackPerformance = functions.https.onCall(async (data, context) => {
  const { functionName, duration, success, metadata } = data;

  try {
    await admin.firestore().collection("performance").add({
      functionName,
      duration,
      success,
      metadata,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Check if slow
    if (duration > 5000) {
      await sendAlert(
        ALERT_LEVELS.WARNING,
        "Slow Function Execution",
        `${functionName} took ${duration}ms to execute`,
        metadata
      );
    }

    return { success: true };
  } catch (error) {
    console.error("Performance tracking error:", error);
    return { success: false };
  }
});

/**
 * Generate performance report
 */
exports.generatePerformanceReport = functions.pubsub
  .schedule("every day 06:00")
  .timeZone("America/Denver")
  .onRun(async (context) => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get performance data
    const perfData = await admin
      .firestore()
      .collection("performance")
      .where("timestamp", ">=", yesterday)
      .where("timestamp", "<", today)
      .get();

    // Aggregate by function
    const functionStats = {};

    perfData.forEach((doc) => {
      const data = doc.data();
      if (!functionStats[data.functionName]) {
        functionStats[data.functionName] = {
          count: 0,
          totalDuration: 0,
          maxDuration: 0,
          failures: 0,
        };
      }

      const stats = functionStats[data.functionName];
      stats.count++;
      stats.totalDuration += data.duration;
      stats.maxDuration = Math.max(stats.maxDuration, data.duration);
      if (!data.success) stats.failures++;
    });

    // Calculate averages
    const report = Object.entries(functionStats).map(([name, stats]) => ({
      function: name,
      executions: stats.count,
      avgDuration: Math.round(stats.totalDuration / stats.count),
      maxDuration: stats.maxDuration,
      failureRate: ((stats.failures / stats.count) * 100).toFixed(2) + "%",
    }));

    // Store report
    await admin.firestore().collection("performanceReports").add({
      date: yesterday,
      report,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Send summary - FIXED: Complete filter comparison
    await sendPerformanceReport(report, yesterday);
  });

// =====================================
// AUTOMATED ISSUE DETECTION
// =====================================

/**
 * Detect anomalies in system behavior
 */
exports.detectAnomalies = functions.pubsub
  .schedule("every 30 minutes")
  .onRun(async (context) => {
    const anomalies = [];

    // Check donation patterns
    const donationAnomaly = await checkDonationPatterns();
    if (donationAnomaly) anomalies.push(donationAnomaly);

    // Check square placement patterns
    const squareAnomaly = await checkSquarePatterns();
    if (squareAnomaly) anomalies.push(squareAnomaly);

    // Check winner distribution
    const winnerAnomaly = await checkWinnerDistribution();
    if (winnerAnomaly) anomalies.push(winnerAnomaly);

    // Check payout anomalies
    const payoutAnomaly = await checkPayoutAnomalies();
    if (payoutAnomaly) anomalies.push(payoutAnomaly);

    // Send alerts if anomalies detected
    if (anomalies.length > 0) {
      await sendAlert(
        ALERT_LEVELS.WARNING,
        "Anomalies Detected",
        `System anomalies detected:\n${anomalies
          .map((a) => `- ${a.type}: ${a.description}`)
          .join("\n")}`,
        { anomalies }
      );
    }
  });

async function checkDonationPatterns() {
  const lastHour = new Date(Date.now() - 60 * 60 * 1000);

  // Get recent donations
  const recentDonations = await admin
    .firestore()
    .collection("donations")
    .where("createdAt", ">=", lastHour)
    .get();

  // Check for unusual patterns - FIXED: Complete the function
  const userDonations = {};
  recentDonations.forEach((doc) => {
    const donation = doc.data();
    if (!userDonations[donation.userId]) {
      userDonations[donation.userId] = 0;
    }
    userDonations[donation.userId]++;
  });

  // Check for users with many donations
  const suspiciousUsers = Object.entries(userDonations).filter(
    ([_, count]) => count > 5
  );

  if (suspiciousUsers.length > 0) {
    return {
      type: "Donation Pattern",
      description: `${suspiciousUsers.length} users made 5+ donations in the last hour`,
    };
  }

  // Check for unusual donation rate
  const hourlyRate = recentDonations.size;
  if (hourlyRate > 100) {
    // Example threshold
    return {
      type: "donation_spike",
      description: `Unusual donation rate: ${hourlyRate} donations in last hour`,
    };
  }

  return null;
}

async function checkSquarePatterns() {
  const lastHour = new Date(Date.now() - 60 * 60 * 1000);

  // Get recent square claims
  const recentClaims = await admin
    .firestore()
    .collection("squareClaims")
    .where("claimedAt", ">=", lastHour)
    .get();

  // Check for boards filling too quickly
  const boardClaims = {};
  recentClaims.forEach((doc) => {
    const claim = doc.data();
    if (!boardClaims[claim.boardId]) {
      boardClaims[claim.boardId] = 0;
    }
    boardClaims[claim.boardId]++;
  });

  const suspiciousBoards = Object.entries(boardClaims).filter(
    ([_, count]) => count > 20
  ); // More than 20 squares in an hour

  if (suspiciousBoards.length > 0) {
    return {
      type: "Square Pattern",
      description: `${suspiciousBoards.length} boards had 20+ squares claimed in the last hour`,
    };
  }

  return null;
}

async function checkWinnerDistribution() {
  const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Get recent winners
  const recentWinners = await admin
    .firestore()
    .collection("winners")
    .where("createdAt", ">=", lastWeek)
    .get();

  // Check for users winning too frequently
  const userWins = {};
  recentWinners.forEach((doc) => {
    const winner = doc.data();
    if (!userWins[winner.userId]) {
      userWins[winner.userId] = 0;
    }
    userWins[winner.userId]++;
  });

  const frequentWinners = Object.entries(userWins).filter(
    ([_, count]) => count > 5
  ); // More than 5 wins in a week

  if (frequentWinners.length > 0) {
    return {
      type: "Winner Distribution",
      description: `${frequentWinners.length} users won 5+ times in the last week`,
    };
  }

  return null;
}

async function checkPayoutAnomalies() {
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Check for unusual instant payout patterns
  const instantPayouts = await admin
    .firestore()
    .collection("payouts")
    .where("payoutType", "==", "instant")
    .where("createdAt", ">=", last24h)
    .get();

  // Check for repeated instant payouts to same user
  const userPayouts = {};
  instantPayouts.forEach((doc) => {
    const payout = doc.data();
    if (!userPayouts[payout.userId]) {
      userPayouts[payout.userId] = 0;
    }
    userPayouts[payout.userId]++;
  });

  const suspiciousPayouts = Object.entries(userPayouts).filter(
    ([_, count]) => count > 3
  ); // More than 3 instant payouts in 24h

  if (suspiciousPayouts.length > 0) {
    return {
      type: "Payout Pattern",
      description: `${suspiciousPayouts.length} users received 3+ instant payouts in 24 hours`,
    };
  }

  return null;
}

// =====================================
// BACKUP VERIFICATION
// =====================================

/**
 * Verify backups are working
 */
exports.verifyBackups = functions.pubsub
  .schedule("every day 03:00")
  .timeZone("America/Denver")
  .onRun(async (context) => {
    try {
      // Create test backup entry
      const testData = {
        type: "backup_test",
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        collections: ["users", "donations", "boards", "games", "winners"],
      };

      const backupRef = await admin
        .firestore()
        .collection("backups")
        .add(testData);

      // Verify it was created
      const backup = await backupRef.get();
      if (!backup.exists) {
        throw new Error(
          "Backup verification failed - could not create test entry"
        );
      }

      // Clean up
      await backupRef.delete();

      console.log("Backup verification successful");
    } catch (error) {
      await sendAlert(
        ALERT_LEVELS.CRITICAL,
        "Backup Verification Failed",
        error.message
      );
    }
  });

// =====================================
// PAYMENT STRUCTURE MONITORING
// =====================================

/**
 * Monitor payment structure compliance
 */
exports.monitorPaymentStructure = functions.pubsub
  .schedule("every 6 hours")
  .onRun(async (context) => {
    const issues = [];

    // Check recent donations for correct tier assignment
    const last6Hours = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const recentDonations = await admin
      .firestore()
      .collection("donations")
      .where("createdAt", ">=", last6Hours)
      .where("status", "==", "completed")
      .get();

    let incorrectTiers = 0;
    recentDonations.forEach((doc) => {
      const donation = doc.data();
      const expectedTier = PAYMENT_TIERS[donation.tier];

      if (
        !expectedTier ||
        donation.payoutPercentage !== expectedTier.payoutPercentage
      ) {
        incorrectTiers++;
      }
    });

    if (incorrectTiers > 0) {
      issues.push(
        `${incorrectTiers} donations have incorrect payout percentages`
      );
    }

    // Check instant payout fees
    const instantPayouts = await admin
      .firestore()
      .collection("payouts")
      .where("payoutType", "==", "instant")
      .where("createdAt", ">=", last6Hours)
      .get();

    let incorrectFees = 0;
    instantPayouts.forEach((doc) => {
      const payout = doc.data();
      if (payout.instantPayoutFee) {
        const expectedFee = payout.originalAmount * INSTANT_PAYOUT_FEE;
        if (Math.abs(expectedFee - payout.instantPayoutFee) > 0.01) {
          incorrectFees++;
        }
      }
    });

    if (incorrectFees > 0) {
      issues.push(
        `${incorrectFees} instant payouts have incorrect fee calculations`
      );
    }

    // Send alert if issues found
    if (issues.length > 0) {
      await sendAlert(
        ALERT_LEVELS.ERROR,
        "Payment Structure Compliance Issues",
        issues.join("\n")
      );
    }
  });

/**
 * DAILY RECAP FUNCTION
 * Runs every day at 11:59 PM (America/Denver time)
 */
exports.dailyRecapTrigger = functions.pubsub
  .schedule("every day 23:59")
  .timeZone("America/Denver")
  .onRun(async () => {
    const now = new Date();
    // Convert current time to America/Denver timezone
    const denverNow = new Date(
      now.toLocaleString("en-US", { timeZone: "America/Denver" })
    );

    // Get start (00:00:00) and end (23:59:59) of current Denver day
    const startOfDay = new Date(denverNow);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(denverNow);
    endOfDay.setHours(23, 59, 59, 999);

    // Convert to Firestore Timestamp.seconds range (UTC-based)
    const startSeconds = Math.floor(startOfDay.getTime() / 1000);
    const endSeconds = Math.floor(endOfDay.getTime() / 1000);

    const snapshot = await db
      .collection("winners")
      .where("createdAt.seconds", ">=", startSeconds)
      .where("createdAt.seconds", "<=", endSeconds)
      .get();

    if (snapshot.empty) {
      console.log("⚠️ No winners found for today.");
      return null;
    }

    const winners = snapshot.docs.map((doc) => doc.data());
    const totalPrizes = winners.reduce(
      (sum, w) => sum + (w.prizeAmount || 0),
      0
    );
    const winnerCount = winners.length;

    const fastest = winners.reduce((a, b) =>
      a.answerTime < b.answerTime ? a : b
    );
    const fastestTime = fastest.answerTime?.toFixed(2) || "0.00";
    const fastestUser = fastest.user?.displayName || "Anonymous";

    const biggest = winners.reduce((a, b) =>
      a.prizeAmount > b.prizeAmount ? a : b
    );
    const biggestWin = biggest.prizeAmount || 0;
    // 1. Generate dynamic image
    const formValues = {
      totalPaid: Math.round(totalPrizes).toString(), // ensures it's a whole number string
      gameCount: winnerCount / 5, // stays numeric unless you need string
      winnerCount: winnerCount,
      fastTime: fastestTime, // unchanged
      fastName: fastestUser, // unchanged
      bigPrice: biggestWin,
    };

    const selectedTemplate = "dailySummary";
    const nowDate = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("/");
    const payload = {
      templateID: selectedTemplate,
      data: formValues,
      savePath: `savedimages/${nowDate}/${selectedTemplate}.jpg`,
    };
    let imageUrl = "https://squaretrivia.com/apple-touch-icon.png"; // default fallback

    try {
      const imageResult = await generateImage(payload);

      if (imageResult && imageResult.response === "success") {
        imageUrl = imageResult.path; // use generated image if successful
      } else {
        console.warn("Image generation failed:", imageResult);
      }
    } catch (err) {
      console.error("Image generation error:", err);
    }
    await DailyRecapPost({
      totalPrizes,
      winnerCount,
      fastestTime,
      fastestUser,
      biggestWin,
      mediaToUpload: imageUrl,
      captionLink: "https://squaretrivia.com",
    });

    console.log("✅ Daily Recap Post published successfully.");
    return null;
  });

exports.weeklyRecapTrigger = functions.pubsub
  .schedule("1 1 * * 1") // Runs every Monday at 1:01 AM Denver time
  // .schedule("*/5 * * * *")
  .timeZone("America/Denver")
  .onRun(async () => {
    const now = new Date();

    function getWeekNumber(date = new Date()) {
      const target = new Date(date.valueOf());
      const dayNumber = (date.getDay() + 6) % 7;
      target.setDate(target.getDate() - dayNumber + 3);
      const firstThursday = new Date(target.getFullYear(), 0, 4);
      const diff = target - firstThursday;
      return 1 + Math.round(diff / 604800000); // ms in a week
    }

    const weekNumber = getWeekNumber();
    // Convert current UTC time → Denver local time
    const denverNow = new Date(
      now.toLocaleString("en-US", { timeZone: "America/Denver" })
    );

    // 🗓️ Determine the *previous week's* Monday 00:00:00
    const day = denverNow.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const diffToPreviousMonday = ((day + 6) % 7) + 7; // force previous week’s Monday
    const startOfWeek = new Date(denverNow);
    startOfWeek.setDate(denverNow.getDate() - diffToPreviousMonday);
    startOfWeek.setHours(0, 0, 0, 0);

    // 🗓️ Determine end of that week (Sunday 23:59:59)
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    console.log("📅 Weekly Range (Denver):");
    console.log("Start:", startOfWeek.toISOString());
    console.log("End:", endOfWeek.toISOString());

    // 🎯 Query winners created within that week
    const snapshot = await db
      .collection("winners")
      .where("createdAt", ">=", admin.firestore.Timestamp.fromDate(startOfWeek))
      .where("createdAt", "<=", admin.firestore.Timestamp.fromDate(endOfWeek))
      .get();

    console.log("snapshot.docs:", snapshot.docs);

    if (snapshot.empty) {
      console.log("⚠️ No winners found for last week.");
      return null;
    }

    const winners = snapshot.docs.map((doc) => doc.data());
    const totalPrizes = winners.reduce(
      (sum, w) => sum + (w.prizeAmount || 0),
      0
    );
    const winnerCount = winners.length;

    const fastest = winners.reduce((a, b) =>
      a.answerTime < b.answerTime ? a : b
    );
    const fastestTime = fastest.answerTime?.toFixed(2) || "0.00";
    const fastestUser = fastest.user?.displayName || "Anonymous";

    const biggest = winners.reduce((a, b) =>
      a.prizeAmount > b.prizeAmount ? a : b
    );
    const biggestWin = biggest.prizeAmount || 0;

    console.log(`✅ Found ${winners.length} weekly winners.`);

    // 🧠 Aggregate stats per userId
    const userStats = {};
    winners.forEach((w) => {
      if (!w.userId) return; // Skip invalid
      if (!userStats[w.userId]) userStats[w.userId] = { total: 0, wins: 0 };
      userStats[w.userId].total += w.prizeAmount || 0;
      userStats[w.userId].wins += 1;
    });

    const userIds = Object.keys(userStats);
    if (userIds.length === 0) {
      console.log("⚠️ No valid userIds found in winners data.");
      return null;
    }

    // 👥 Fetch corresponding user documents
    const userDocs = await Promise.all(
      userIds.map(async (id) => {
        const userSnap = await db.collection("users").doc(id).get();
        return { id, data: userSnap.exists ? userSnap.data() : null };
      })
    );

    // 🧾 Merge user display names into stats
    const userList = userDocs.map((u) => {
      const name = u.data?.displayName || u.data?.email || "Anonymous";
      const stats = userStats[u.id];
      return {
        userId: u.id,
        name,
        total: stats.total,
        wins: stats.wins,
      };
    });

    // 🥇 Sort by total prize (and wins as tiebreaker)
    const sorted = userList
      .sort((a, b) => b.total - a.total || b.wins - a.wins)
      .slice(0, 3);

    const [w1, w2, w3] = sorted;

    if (!w1) {
      console.log("⚠️ No valid weekly champions found.");
      return null;
    }
    // 1. Generate dynamic image
    const formValues = {
      totalPaid: Math.round(totalPrizes).toString(), // ensures it's a whole number string
      gameCount: winnerCount / 5, // stays numeric unless you need string
      winnerCount: winnerCount,
      fastTime: fastestTime, // unchanged
      fastName: fastestUser, // unchanged
      bigPrice: biggestWin,
    };

    const selectedTemplate = "weeklySummary";
    const payload = {
      templateID: selectedTemplate,
      data: formValues,
      savePath: `savedimages/weekly/${weekNumber}/${selectedTemplate}.jpg`,
    };
    let imageUrl = "https://squaretrivia.com/apple-touch-icon.png"; // default fallback

    try {
      const imageResult = await generateImage(payload);

      if (imageResult && imageResult.response === "success") {
        imageUrl = imageResult.path; // use generated image if successful
      } else {
        console.warn("Image generation failed:", imageResult);
      }
    } catch (err) {
      console.error("Image generation error:", err);
    }
    // 📣 Publish the post
    await WeeklyChampionPost({
      winner1: w1?.name || "—",
      amount1: w1?.total || 0,
      wins1: w1?.wins || 0,
      winner2: w2?.name || "—",
      amount2: w2?.total || 0,
      wins2: w2?.wins || 0,
      winner3: w3?.name || "—",
      amount3: w3?.total || 0,
      wins3: w3?.wins || 0,
      mediaToUpload: imageUrl,
      captionLink: "https://squaretrivia.com",
    });

    console.log("✅ Weekly Recap Post published successfully.");
    return null;
  });

/**
 * WEEKLY "NO FEES" REMINDER
 * Runs every Friday at 6 PM (America/Denver)
 */
exports.noFeesTrigger = functions.pubsub
  .schedule("every friday 18:00")
  .timeZone("America/Denver")
  .onRun(async () => {
    console.log("🚀 Running NoFeesPost trigger...");
    // 1. Generate dynamic image
    const formValues = {};
    const selectedTemplate = "noFeesReminder"; //to be created
    const payload = {
      templateID: selectedTemplate,
      data: formValues,
      savePath: `savedimages/extra/${selectedTemplate}.jpg`,
    };
    let imageUrl = "https://squaretrivia.com/apple-touch-icon.png"; // default fallback

    try {
      const imageResult = await generateImage(payload);

      if (imageResult && imageResult.response === "success") {
        imageUrl = imageResult.path; // use generated image if successful
      } else {
        console.warn("Image generation failed:", imageResult);
      }
    } catch (err) {
      console.error("Image generation error:", err);
    }
    await NoFeesPost({
      mediaToUpload: imageUrl,
      captionLink: "https://squaretrivia.com",
    });

    console.log("✅ No Fees Post published successfully.");
    return null;
  });

/**
 * SKILL CELEBRATION POST
 * Runs every 3 hours (America/Denver)
 * Finds the most recent winner with answerTime < 1s
 */
exports.skillCelebrationTrigger = functions.pubsub
  .schedule("every 3 hours")
  .timeZone("America/Denver")
  .onRun(async () => {
    console.log("⚡ Running SkillCelebration trigger...");

    const snapshot = await db
      .collection("winners")
      .orderBy("createdAt.seconds", "desc")
      .limit(20)
      .get();

    if (snapshot.empty) {
      console.log("⚠️ No winners found.");
      return null;
    }

    const winners = snapshot.docs.map((doc) => doc.data());
    const notable = winners.find((w) => w.answerTime && w.answerTime < 1);

    if (!notable) {
      console.log("⏸ No fast winners found (<1s).");
      return null;
    }

    const recentWinner = notable.user?.displayName || "Anonymous";
    const time = notable.answerTime.toFixed(2);
    const prize = notable.prizeAmount || 0;
    // 1. Generate dynamic image
    const formValues = {};
    const selectedTemplate = "skillCelebration"; //to be created
    const payload = {
      templateID: selectedTemplate,
      data: formValues,
      savePath: `savedimages/extra/${selectedTemplate}.jpg`,
    };
    let imageUrl = "https://squaretrivia.com/apple-touch-icon.png"; // default fallback

    try {
      const imageResult = await generateImage(payload);

      if (imageResult && imageResult.response === "success") {
        imageUrl = imageResult.path; // use generated image if successful
      } else {
        console.warn("Image generation failed:", imageResult);
      }
    } catch (err) {
      console.error("Image generation error:", err);
    }
    await SkillCelebration({
      recentWinner,
      time,
      prize,
      mediaToUpload: imageUrl,
      captionLink: "https://squaretrivia.com",
    });

    console.log(
      `✅ Skill Celebration posted for ${recentWinner} (${time}s / $${prize})`
    );
    return null;
  });

/**
 * PLATFORM MILESTONE CHECKER
 * Runs every 6 hours — posts when total payouts cross a major milestone
 */
exports.platformMilestoneTrigger = functions.pubsub
  .schedule("every 12 hours")
  .timeZone("America/Denver")
  .onRun(async () => {
    console.log("🚀 Checking for payout milestones...");

    const snapshot = await db.collection("winners").get();
    if (snapshot.empty) {
      console.log("⚠️ No winners found.");
      return null;
    }

    const winners = snapshot.docs.map((doc) => doc.data());
    const totalPayouts = winners.reduce(
      (sum, w) => sum + (w.prizeAmount || 0),
      0
    );
    const totalWinners = winners.length;

    // milestones to track
    const milestones = [
      10000, 50000, 100000, 250000, 500000, 1000000, 5000000, 10000000,
      50000000, 100000000,
    ];
    const lastMilestoneRef = db.collection("system").doc("milestoneTracker");
    const lastMilestoneDoc = await lastMilestoneRef.get();
    const lastMilestone = lastMilestoneDoc.exists
      ? lastMilestoneDoc.data().lastAmount
      : 0;

    // find next milestone reached
    const crossed = milestones.find(
      (m) => totalPayouts >= m && lastMilestone < m
    );

    if (!crossed) {
      console.log("⏸ No new milestones reached yet.");
      return null;
    }

    console.log(`🎉 Milestone crossed: $${crossed}`);
    // 1. Generate dynamic image
    const formValues = {};
    const selectedTemplate = "milestoneCelebration"; //to be created
    const payload = {
      templateID: selectedTemplate,
      data: formValues,
      savePath: `savedimages/extra/${selectedTemplate}.jpg`,
    };
    let imageUrl = "https://squaretrivia.com/apple-touch-icon.png"; // default fallback

    try {
      const imageResult = await generateImage(payload);

      if (imageResult && imageResult.response === "success") {
        imageUrl = imageResult.path; // use generated image if successful
      } else {
        console.warn("Image generation failed:", imageResult);
      }
    } catch (err) {
      console.error("Image generation error:", err);
    }
    await PlatformMilestonePost({
      amount: crossed.toLocaleString(),
      totalWinners,
      mediaToUpload: imageUrl,
      captionLink: "https://squaretrivia.com",
    });

    // Update tracker
    await lastMilestoneRef.set({ lastAmount: crossed }, { merge: true });

    console.log(`✅ Milestone Post published for $${crossed}`);
    return null;
  });

/**
 * RECORD BREAKER CHECKER
 * Runs every hour — posts when a new fastest-answer record is set
 */
exports.recordBreakerTrigger = functions.pubsub
  .schedule("every 1 hours")
  .timeZone("America/Denver")
  .onRun(async () => {
    console.log("⚡ Checking for record-breaking answers...");

    // 🔹 Fetch fastest winner
    const snapshot = await db
      .collection("winners")
      .orderBy("answerTime", "asc")
      .limit(1)
      .get({ source: "server" }); // Force fresh read

    if (snapshot.empty) {
      console.log("⚠️ No winners found.");
      return null;
    }

    const fastestDoc = snapshot.docs[0];
    const fastest = fastestDoc.data();
    const fastestId = String(fastestDoc.id);
    const currentFastestTime = Number(fastest.answerTime);
    const userId = fastest.userId;
    const gameId = fastest.gameId || "unknown";

    console.log(fastest, "FASTEST");
    console.log(fastestId, "FASTEST ID");

    if (!userId) {
      console.log("⚠️ Missing userId in winner doc:", fastestId);
      return null;
    }

    // 🔹 Fetch user info
    const userRef = db.collection("users").doc(userId);
    const userSnap = await userRef.get({ source: "server" });
    const userData = userSnap.exists ? userSnap.data() : {};
    const winner = userData.displayName || userData.email || `User ${userId}`;

    console.log(
      `🏃 Fastest: ${winner} (${userId}), time: ${currentFastestTime}s`
    );

    // 🔹 Fetch record tracker from new collection "fastestRecord"
    const recordRef = db.collection("system").doc("recordTracker");
    const recordDoc = await recordRef.get({ source: "server" });
    const recordData = recordDoc.exists ? recordDoc.data() : {};

    console.log(recordData, "RECORD DATA");

    const lastFastestTime = Number(recordData.fastestTime) || null;
    const lastRecordId = String(recordData.lastRecordId || "");

    console.log("📘 Current fastestId:", fastestId);
    console.log("📗 Last recordId:", lastRecordId);
    console.log("⏱ Current:", currentFastestTime, "Last:", lastFastestTime);

    // ✅ Skip if same record or not faster
    if (lastRecordId === fastestId) {
      console.log("⏸ Same record detected. Skipping post.");
      return null;
    }

    if (lastFastestTime && currentFastestTime >= lastFastestTime) {
      console.log(
        `⏸ Not a new record. Current (${currentFastestTime}s) is slower than or equal to last (${lastFastestTime}s).`
      );
      return null;
    }

    if (!currentFastestTime || isNaN(currentFastestTime)) {
      console.log("⚠️ Invalid current fastest time, skipping...");
      return null;
    }

    console.log("🏁 New record detected — posting...");
    // 1. Generate dynamic image
    const formValues = {};
    const selectedTemplate = "recordBreaker"; //to be created
    const payload = {
      templateID: selectedTemplate,
      data: formValues,
      savePath: `savedimages/extra/${selectedTemplate}.jpg`,
    };
    let imageUrl = "https://squaretrivia.com/apple-touch-icon.png"; // default fallback

    try {
      const imageResult = await generateImage(payload);

      if (imageResult && imageResult.response === "success") {
        imageUrl = imageResult.path; // use generated image if successful
      } else {
        console.warn("Image generation failed:", imageResult);
      }
    } catch (err) {
      console.error("Image generation error:", err);
    }
    await RecordBreakerPost({
      winner,
      time: currentFastestTime.toFixed(3),
      oldTime: lastFastestTime ? lastFastestTime.toFixed(3) : "—",
      mediaToUpload: imageUrl,
      captionLink: "https://squaretrivia.com",
    });

    await recordRef.set(
      {
        fastestTime: currentFastestTime,
        winner,
        lastRecordId: fastestId,
        lastUpdated: admin.firestore.Timestamp.now(),
        userId,
        gameId,
      },
      { merge: true }
    );

    console.log(
      `✅ RecordBreaker updated (${currentFastestTime}s by ${winner}, game: ${gameId}, user: ${userId})`
    );

    return null;
  });

/**
 * REFERRAL LEADERBOARD TRIGGER
 * Runs weekly (Monday 9:00 AM Denver time)
 */
exports.referralLeaderboardTrigger = functions.pubsub
  .schedule("0 9 * * MON") // Runs weekly (Monday 9:00 AM Denver time)
  .timeZone("America/Denver")
  .onRun(async () => {
    console.log("🏆 Running Referral Leaderboard Trigger...");

    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);

    // Get users who referred others within the last week
    const snapshot = await db
      .collection("users")
      .where("referrals", ">", 0)
      .get();

    if (snapshot.empty) {
      console.log("⚠️ No referral data found.");
      return null;
    }

    const leaderboard = snapshot.docs
      .map((doc) => {
        const d = doc.data();
        const referrals = d.referrals || 0;
        const totalEarned = d.totalEarned || 0;
        return {
          name: d.displayName || "Anonymous",
          referrals,
          amount: totalEarned,
        };
      })
      .sort((a, b) => b.referrals - a.referrals)
      .slice(0, 5);
    // 1. Generate dynamic image
    const selectedTemplate = "referalPost";
    const payload = {
      templateID: selectedTemplate,
      data: null,
      savePath: `savedimages/${selectedTemplate}.jpg`,
    };
    let imageUrl = "https://squaretrivia.com/apple-touch-icon.png"; // default fallback

    try {
      const imageResult = await generateImage(payload);

      if (imageResult && imageResult.response === "success") {
        imageUrl = imageResult.path; // use generated image if successful
      } else {
        console.warn("Image generation failed:", imageResult);
      }
    } catch (err) {
      console.error("Image generation error:", err);
    }
    await ReferralLeaderboard({
      winners: leaderboard,
      mediaToUpload: imageUrl,
      captionLink: "https://squaretrivia.com/referrals",
    });

    console.log("✅ Referral Leaderboard post published.");
    return null;
  });

/**
 * TEAM RIVALRY TRIGGER
 * Runs mid-week (Wednesday 11:00 AM Denver time)
 */
exports.teamRivalryTrigger = functions.pubsub
  .schedule("0 11 * * WED") // Runs mid-week (Wednesday 11:00 AM Denver time)
  .timeZone("America/Denver")
  .onRun(async () => {
    console.log("⚔️ Running Team Rivalry Trigger...");

    // Example rivalry list (expand or fetch dynamically)
    const rivalries = [
      { teamA: "Cowboys", teamB: "Eagles" },
      { teamA: "Chiefs", teamB: "Bills" },
      { teamA: "49ers", teamB: "Rams" },
    ];

    // Pick a random rivalry each week
    const matchup = rivalries[Math.floor(Math.random() * rivalries.length)];

    // Count recent team wins (past week)
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const snapshot = await db
      .collection("winners")
      .where("createdAt", ">", weekAgo)
      .get();

    let teamAWins = 0,
      teamBWins = 0;
    snapshot.forEach((doc) => {
      const data = doc.data();
      const team = data.team || "";
      if (team === matchup.teamA) teamAWins++;
      if (team === matchup.teamB) teamBWins++;
    });
    // 1. Generate dynamic image
    const formValues = {};
    const selectedTemplate = "teamRivalry"; //to be created
    const payload = {
      templateID: selectedTemplate,
      data: formValues,
      savePath: `savedimages/extra/${selectedTemplate}.jpg`,
    };
    let imageUrl = "https://squaretrivia.com/apple-touch-icon.png"; // default fallback

    try {
      const imageResult = await generateImage(payload);

      if (imageResult && imageResult.response === "success") {
        imageUrl = imageResult.path; // use generated image if successful
      } else {
        console.warn("Image generation failed:", imageResult);
      }
    } catch (err) {
      console.error("Image generation error:", err);
    }
    await TeamRivalryPost({
      teamA: matchup.teamA,
      teamB: matchup.teamB,
      teamAWins,
      teamBWins,
      mediaToUpload: imageUrl,
      captionLink: "https://squaretrivia.com",
    });

    console.log(
      `✅ Rivalry post published: ${matchup.teamA} vs ${matchup.teamB}`
    );
    return null;
  });

exports.multiGameUpdateTrigger = functions.pubsub
  .schedule("50 23 * * *") // Runs daily at 11:50 PM
  // .schedule("*/5 * * * *") // Runs every 5 minutes for testing
  .timeZone("America/Denver")
  .onRun(async () => {
    console.log("🚀 [multiGameUpdateTrigger] Function started...");

    try {
      // Step 1: Calculate tomorrow's date range
      const now = new Date();
      console.log("🕓 [Step 1] Current Date (Server):", now.toISOString());

      const tomorrow = new Date(now);
      tomorrow.setDate(now.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      const dayAfter = new Date(tomorrow);
      dayAfter.setDate(tomorrow.getDate() + 1);

      console.log("📅 [Step 1] Tomorrow:", tomorrow.toISOString());
      console.log("📅 [Step 1] Day After Tomorrow:", dayAfter.toISOString());

      // Step 2: Convert to Timestamps
      const startTimestampSeconds = Math.floor(tomorrow.getTime() / 1000);
      const endTimestampSeconds = Math.floor(dayAfter.getTime() / 1000);

      console.log("🧭 [Step 2] startTimestampSeconds:", startTimestampSeconds);
      console.log("🧭 [Step 2] endTimestampSeconds:", endTimestampSeconds);

      const startTimestamp = admin.firestore.Timestamp.fromMillis(
        startTimestampSeconds * 1000
      );
      const endTimestamp = admin.firestore.Timestamp.fromMillis(
        endTimestampSeconds * 1000
      );

      console.log(
        "📌 [Step 2] Firestore Start Timestamp:",
        startTimestamp.toDate().toISOString()
      );
      console.log(
        "📌 [Step 2] Firestore End Timestamp:",
        endTimestamp.toDate().toISOString()
      );

      // Step 3: Query Games
      console.log(
        `🔍 [Step 3] Querying games scheduled between ${startTimestamp.toDate().toISOString()} and ${endTimestamp.toDate().toISOString()}`
      );

      const snapshot = await db
        .collection("games")
        .where("gameDate", ">=", startTimestamp)
        .where("gameDate", "<", endTimestamp)
        .get();

      console.log("📝 [Step 3] Query executed. Docs found:", snapshot.size);

      if (snapshot.empty) {
        console.log("❌ [Step 3] No games found for tomorrow.");
        return null;
      }

      // Step 4: Format Game Data
      const games = snapshot.docs.map((doc) => {
        const data = doc.data();
        console.log(
          `🎮 [Step 4] Game ID: ${doc.id} | gameDate:`,
          data.gameDate?.toDate?.().toISOString?.() || data.gameDate
        );
        return {
          id: doc.id,
          ...data,
        };
      });

      // Step 5: Determine Day Name
      const dayName = tomorrow.toLocaleDateString("en-US", { weekday: "long" });
      console.log(`📆 [Step 5] Day Name for tomorrow: ${dayName}`);

      // Step 6: Trigger Post
      console.log("📣 [Step 6] Triggering MultiGameUpdatePost with payload:", {
        gameCount: games.length,
        mediaToUpload:
          imageResult?.path || "https://squaretrivia.com/apple-touch-icon.png",
        captionLink: "https://squaretrivia.com",
        day: dayName,
      });
      // 1. Generate dynamic image
      const formValues = {};
      const selectedTemplate = "multiGameUpdate"; // to be created
      const imageResult = await generateImage({
        templateID: selectedTemplate,
        data: formValues,
        savePath: `savedimages/extra/${selectedTemplate}.jpg`,
      });

      if (!imageResult || imageResult.response !== "success") {
        console.error("Image generation failed:", imageResult);
        return;
      }
      await MultiGameUpdatePost({
        games,
        mediaToUpload:
          imageResult?.path || "https://squaretrivia.com/apple-touch-icon.png",
        captionLink: "https://squaretrivia.com",
        day: dayName,
      });

      console.log(
        `✅ [Step 6] Multi-game update post triggered successfully for ${dayName}.`
      );
      return null;
    } catch (error) {
      console.error("❌ [ERROR] multiGameUpdateTrigger failed:", error);
      console.error("🧠 [ERROR STACK]", error?.stack);
      return null;
    }
  });

// =====================================
// ALERT SYSTEM
// =====================================

async function sendAlert(level, subject, message, metadata = {}) {
  // Store alert
  const alertRef = await admin.firestore().collection("alerts").add({
    level,
    subject,
    message,
    metadata,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    acknowledged: false,
  });

  // Determine recipients based on level
  const recipients =
    level === ALERT_LEVELS.CRITICAL
      ? ["admin@squaretrivia.com", "oncall@squaretrivia.com"]
      : ["admin@squaretrivia.com"];

  // Send email
  const emailPromise = sendMail({
    // from: "Square Trivia Alerts <alerts@squaretrivia.com>",
    to: recipients.join(","),
    subject: `[${level.toUpperCase()}] ${subject}`,
    text: `
Alert Level: ${level.toUpperCase()}
Time: ${new Date().toISOString()}

${message}

Metadata:
${JSON.stringify(metadata, null, 2)}

Alert ID: ${alertRef.id}
    `,
    priority: level === ALERT_LEVELS.CRITICAL ? "high" : "normal",
  });

  // Send Telegram for critical alerts
  const telegramPromise =
    level === ALERT_LEVELS.CRITICAL || level === ALERT_LEVELS.ERROR
      ? sendTelegramAlert(level, subject, message)
      : Promise.resolve();

  await Promise.all([emailPromise, telegramPromise]);
}

async function sendTelegramAlert(level, subject, message) {
  if (!functions.config().telegram?.admin_chat_id) return;

  const TelegramBot = require("node-telegram-bot-api");
  const bot = new TelegramBot(functions.config().telegram.bot_token, {
    polling: false,
  });

  const icon =
    {
      [ALERT_LEVELS.CRITICAL]: "🚨",
      [ALERT_LEVELS.ERROR]: "❌",
      [ALERT_LEVELS.WARNING]: "⚠️",
      [ALERT_LEVELS.INFO]: "ℹ️",
    }[level] || "📢";

  try {
    await bot.sendMessage(
      functions.config().telegram.admin_chat_id,
      `${icon} *${level.toUpperCase()}: ${subject}*\n\n${message}`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    console.error("Telegram alert failed:", error);
  }
}

async function handleHealthIssues(healthReport) {
  const criticalServices = Object.entries(healthReport.checks)
    .filter(([_, check]) => check.status === HEALTH_STATUS.DOWN)
    .map(([_, check]) => check.service);

  if (criticalServices.length > 0) {
    await sendAlert(
      ALERT_LEVELS.CRITICAL,
      "Services Down",
      `The following services are down: ${criticalServices.join(
        ", "
      )}\n\nIssues:\n${healthReport.issues.join("\n")}`
    );
  } else if (healthReport.overallStatus === HEALTH_STATUS.DEGRADED) {
    await sendAlert(
      ALERT_LEVELS.WARNING,
      "System Degraded",
      `System is experiencing issues:\n${healthReport.issues.join("\n")}`
    );
  }
}

async function sendPerformanceReport(report, date) {
  // FIXED: Complete the filter comparison
  const slowFunctions = report.filter((f) => f.avgDuration > 3000);
  const failingFunctions = report.filter((f) => parseFloat(f.failureRate) > 10);

  let message = `Daily Performance Report for ${date.toDateString()}\n\n`;

  if (slowFunctions.length > 0) {
    message += "Slow Functions:\n";
    slowFunctions.forEach((f) => {
      message += `- ${f.function}: avg ${f.avgDuration}ms, max ${f.maxDuration}ms\n`;
    });
    message += "\n";
  }

  if (failingFunctions.length > 0) {
    message += "High Failure Rates:\n";
    failingFunctions.forEach((f) => {
      message += `- ${f.function}: ${f.failureRate} failure rate\n`;
    });
  }

  // Add payment structure metrics
  const paymentMetrics = await getPaymentMetrics(date);
  if (paymentMetrics) {
    message += "\nPayment Structure Metrics:\n";
    message += `- 77% Tier Revenue: $${paymentMetrics.revenue77}\n`;
    message += `- 80% Tier Revenue: $${paymentMetrics.revenue80}\n`;
    message += `- Instant Payout Adoption: ${paymentMetrics.instantAdoption}%\n`;
    message += `- Instant Payout Fees Collected: $${paymentMetrics.instantFees}\n`;
    message += `- Platform Revenue (fees): $${paymentMetrics.totalPlatformRevenue}\n`;
  }

  await sendMail({
    // from: "Square Trivia Monitoring <monitoring@squaretrivia.com>",
    to: "admin@squaretrivia.com",
    subject: "Daily Performance Report",
    text: message,
  });
}

// =====================================
// HELPER FUNCTIONS
// =====================================

async function getMercuryBalance() {
  const balanceHistory = await admin
    .firestore()
    .collection("accountBalances")
    .where("account", "==", "mercury")
    .orderBy("timestamp", "asc")
    .get();

  let balance = 0;
  balanceHistory.forEach((doc) => {
    balance += doc.data().amount;
  });

  return balance;
}

async function getPaymentMetrics(date) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  // Get donations for the day
  const donations = await admin
    .firestore()
    .collection("donations")
    .where("status", "==", "completed")
    .where("createdAt", ">=", startOfDay)
    .where("createdAt", "<=", endOfDay)
    .get();

  let revenue77 = 0;
  let revenue80 = 0;
  let platformFees77 = 0;
  let platformFees80 = 0;

  donations.forEach((doc) => {
    const donation = doc.data();
    const tier = PAYMENT_TIERS[donation.tier];

    if (tier) {
      if (tier.payoutPercentage === 0.77) {
        revenue77 += donation.amount;
        platformFees77 += donation.amount * 0.23;
      } else if (tier.payoutPercentage === 0.8) {
        revenue80 += donation.amount;
        platformFees80 += donation.amount * 0.2;
      }
    }
  });

  // Get instant payout data
  const instantPayouts = await admin
    .firestore()
    .collection("payouts")
    .where("payoutType", "==", "instant")
    .where("status", "==", "completed")
    .where("createdAt", ">=", startOfDay)
    .where("createdAt", "<=", endOfDay)
    .get();

  let instantFees = 0;
  instantPayouts.forEach((doc) => {
    instantFees += doc.data().instantPayoutFee || 0;
  });

  // Get total winners for adoption rate
  const allWinners = await admin
    .firestore()
    .collection("winners")
    .where("createdAt", ">=", startOfDay)
    .where("createdAt", "<=", endOfDay)
    .get();

  const instantWinners = allWinners.docs.filter(
    (doc) => doc.data().payoutType === "instant"
  ).length;

  const instantAdoption =
    allWinners.size > 0
      ? ((instantWinners / allWinners.size) * 100).toFixed(2)
      : "0.00";

  return {
    revenue77: revenue77.toFixed(2),
    revenue80: revenue80.toFixed(2),
    instantAdoption,
    instantFees: instantFees.toFixed(2),
    totalPlatformRevenue: (
      platformFees77 +
      platformFees80 +
      instantFees
    ).toFixed(2),
  };
}

function determineSeverity(error, functionName) {
  // Critical errors
  if (
    error.message.includes("INSUFFICIENT FUNDS") ||
    error.message.includes("Database error") ||
    error.message.includes("Stripe webhook") ||
    error.message.includes("instant payout failed") ||
    error.message.includes("Relay batch failed") ||
    functionName.includes("payment")
  ) {
    return ALERT_LEVELS.CRITICAL;
  }

  // Error level
  if (
    error.code === "internal" ||
    error.message.includes("API-Sports") ||
    error.message.includes("Telegram bot error") ||
    error.message.includes("payout percentage")
  ) {
    return ALERT_LEVELS.ERROR;
  }

  // Warning level
  if (
    error.code === "resource-exhausted" ||
    error.code === "deadline-exceeded" ||
    error.message.includes("slow payout")
  ) {
    return ALERT_LEVELS.WARNING;
  }

  return ALERT_LEVELS.INFO;
}

async function updateErrorMetrics(functionName, severity) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const metricsRef = admin
    .firestore()
    .collection("errorMetrics")
    .doc(`${functionName}_${today.toISOString().split("T")[0]}`);

  await metricsRef.set(
    {
      functionName,
      date: today,
      [severity]: admin.firestore.FieldValue.increment(1),
      total: admin.firestore.FieldValue.increment(1),
      lastError: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

// =====================================
// ADMIN DASHBOARD DATA
// =====================================

/**
 * Get monitoring dashboard data
 */
exports.getMonitoringDashboard = functions.https.onCall(
  async (data, context) => {
    if (!context.auth?.token?.admin) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Admin access required"
      );
    }

    try {
      // Get latest health report
      const healthReport = await admin
        .firestore()
        .collection("healthReports")
        .orderBy("timestamp", "desc")
        .limit(1)
        .get();

      // Get recent alerts
      const recentAlerts = await admin
        .firestore()
        .collection("alerts")
        .orderBy("timestamp", "desc")
        .limit(10)
        .get();

      // Get error summary
      const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentErrors = await admin
        .firestore()
        .collection("errors")
        .where("timestamp", ">=", last24h)
        .get();

      // Group errors by function
      const errorSummary = {};
      recentErrors.forEach((doc) => {
        const error = doc.data();
        if (!errorSummary[error.functionName]) {
          errorSummary[error.functionName] = 0;
        }
        errorSummary[error.functionName]++;
      });

      // Get payment structure metrics
      const paymentMetrics = await getPaymentStructureMetrics();

      return {
        health: healthReport.empty ? null : healthReport.docs[0].data(),
        alerts: recentAlerts.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })),
        errorSummary,
        totalErrors24h: recentErrors.size,
        paymentMetrics,
      };
    } catch (error) {
      console.error("Get monitoring dashboard error:", error);
      throw new functions.https.HttpsError(
        "internal",
        "Failed to get monitoring data"
      );
    }
  }
);

async function getPaymentStructureMetrics() {
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Get instant payout metrics
  const instantPayouts = await admin
    .firestore()
    .collection("payouts")
    .where("payoutType", "==", "instant")
    .where("createdAt", ">=", last24h)
    .get();

  let instantCount = 0;
  let instantTotal = 0;
  let instantFees = 0;

  instantPayouts.forEach((doc) => {
    const payout = doc.data();
    if (payout.status === "completed") {
      instantCount++;
      instantTotal += payout.amount;
      instantFees += payout.instantPayoutFee || 0;
    }
  });

  // Get batch payout metrics
  const batchPayouts = await admin
    .firestore()
    .collection("relayBatches")
    .where("createdAt", ">=", last24h)
    .get();

  let batchCount = 0;
  let batchTotal = 0;

  batchPayouts.forEach((doc) => {
    const batch = doc.data();
    batchCount += batch.payoutCount || 0;
    batchTotal += batch.totalAmount || 0;
  });

  // Get tier distribution
  const donations = await admin
    .firestore()
    .collection("donations")
    .where("status", "==", "completed")
    .where("createdAt", ">=", last24h)
    .get();

  let tierDistribution = {
    "77%": { count: 0, revenue: 0 },
    "80%": { count: 0, revenue: 0 },
  };

  donations.forEach((doc) => {
    const donation = doc.data();
    const tier = PAYMENT_TIERS[donation.tier];

    if (tier) {
      const key = tier.payoutPercentage === 0.77 ? "77%" : "80%";
      tierDistribution[key].count++;
      tierDistribution[key].revenue += donation.amount;
    }
  });

  return {
    instant: {
      count: instantCount,
      totalAmount: instantTotal.toFixed(2),
      feesCollected: instantFees.toFixed(2),
      avgFee:
        instantCount > 0 ? (instantFees / instantCount).toFixed(2) : "0.00",
    },
    batch: {
      count: batchCount,
      totalAmount: batchTotal.toFixed(2),
    },
    tierDistribution,
    totalPlatformRevenue: (
      tierDistribution["77%"].revenue * 0.23 +
      tierDistribution["80%"].revenue * 0.2 +
      instantFees
    ).toFixed(2),
  };
}
