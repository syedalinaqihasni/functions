require("dotenv").config();
// Artifact #11: Financial System
// Complete financial tracking, reconciliation, and payout management

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const stripeKey = functions.config().stripe.key;
const stripe = require("stripe")(stripeKey);
const { Parser } = require("json2csv");
const nodemailer = require("nodemailer");
const { sendMail } = require("./payment-system-modified");
// console.log("Stripe secret key:", process.env.STRIPE_SECRET_KEY);

// Initialize mail transport
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
const TIER_CONFIG = {
  tier_25: { amount: 25, name: "$25 Tier", payoutPercentage: 0.64 },
  tier_50: { amount: 50, name: "$50 Tier", payoutPercentage: 0.64 },
  tier_100: { amount: 100, name: "$100 Tier", payoutPercentage: 0.64 },
  tier_250: { amount: 250, name: "$250 Tier", payoutPercentage: 0.72 },
  tier_500: { amount: 500, name: "$500 Tier", payoutPercentage: 0.72 },
  tier_1000: { amount: 1000, name: "$1000 Tier", payoutPercentage: 0.72 },
};

const PAYOUT_STATUS = {
  PENDING: "pending",
  QUEUED: "queued",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
  PAID_INSTANT: "paid_instant",
};

const INSTANT_PAYOUT_FEE = 0.08; // 8% fee for instant payouts

const RECONCILIATION_STATUS = {
  PENDING: "pending",
  MATCHED: "matched",
  VARIANCE: "variance",
  RESOLVED: "resolved",
};

// =====================================
// INSTANT PAYOUT PROCESSING
// =====================================

/**
 * Process instant payout for a winner
 */
exports.processInstantPayout = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Authentication required"
    );
  }

  const { winnerId } = data;

  try {
    // Get winner data
    const winnerDoc = await admin
      .firestore()
      .collection("winners")
      .doc(winnerId)
      .get();

    if (!winnerDoc.exists) {
      throw new functions.https.HttpsError("not-found", "Winner not found");
    }

    const winner = winnerDoc.data();

    // Verify winner belongs to user
    if (winner.userId !== context.auth.uid) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Not authorized"
      );
    }

    // Check if already paid
    if (winner.status !== PAYOUT_STATUS.PENDING) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Payout already processed"
      );
    }

    // Get user payment info
    const userDoc = await admin
      .firestore()
      .collection("users")
      .doc(context.auth.uid)
      .get();

    const user = userDoc.data();
    if (!user.stripeConnectedAccountId) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "No connected Stripe account"
      );
    }

    // Calculate instant payout amount (original prize minus 8% fee)
    const instantPayoutFee = winner.prizeAmount * INSTANT_PAYOUT_FEE;
    const payoutAmount = winner.prizeAmount - instantPayoutFee;

    // Process instant payout via Stripe
    const payout = await stripe.payouts.create({
      amount: Math.round(payoutAmount * 100), // Convert to cents
      currency: "usd",
      method: "instant",
      destination: user.stripeConnectedAccountId,
      metadata: {
        winnerId,
        userId: context.auth.uid,
        originalPrize: winner.prizeAmount.toFixed(2),
        instantFee: instantPayoutFee.toFixed(2),
      },
    });

    // Create payout record
    const payoutRef = await admin
      .firestore()
      .collection("payouts")
      .add({
        userId: context.auth.uid,
        email: user.email,
        amount: payoutAmount,
        originalAmount: winner.prizeAmount,
        instantPayoutFee,
        winDetails: [
          {
            winnerId,
            game: winner.game,
            quarter: winner.quarter,
            position: winner.position,
            amount: winner.prizeAmount,
          },
        ],
        payoutMethod: user.payoutMethod || {},
        payoutType: "instant",
        stripePayoutId: payout.id,
        status: PAYOUT_STATUS.COMPLETED,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    // Update winner status
    await winnerDoc.ref.update({
      status: PAYOUT_STATUS.PAID_INSTANT,
      payoutId: payoutRef.id,
      instantPayoutFee,
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Update user stats
    await userDoc.ref.update({
      totalInstantPayoutFees:
        admin.firestore.FieldValue.increment(instantPayoutFee),
      lastInstantPayout: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Record fee revenue
    await admin.firestore().collection("revenue").add({
      type: "instant_payout_fee",
      amount: instantPayoutFee,
      userId: context.auth.uid,
      winnerId,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Send confirmation
    await sendInstantPayoutConfirmation(
      context.auth.uid,
      payoutAmount,
      instantPayoutFee,
      payout.id
    );

    return {
      success: true,
      payoutAmount: payoutAmount.toFixed(2),
      instantFee: instantPayoutFee.toFixed(2),
      stripePayoutId: payout.id,
    };
  } catch (error) {
    console.error("Instant payout error:", error);
    throw new functions.https.HttpsError(
      "internal",
      "Failed to process instant payout"
    );
  }
});

// =====================================
// STRIPE → MERCURY RECONCILIATION
// =====================================

/**
 * Daily reconciliation of Stripe payments to Mercury deposits
 */
exports.dailyStripeToMercuryReconciliation = functions.pubsub
  .schedule("every day 09:00")
  .timeZone("America/Denver")
  .onRun(async (context) => {
    console.log("Starting daily Stripe → Mercury reconciliation");

    // Get yesterday's date range
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    try {
      // Get all completed donations from yesterday
      const donations = await admin
        .firestore()
        .collection("donations")
        .where("status", "==", "completed")
        .where("completedAt", ">=", yesterday)
        .where("completedAt", "<", today)
        .get();

      let grossAmount = 0;
      let stripeFees = 0;
      let netAmount = 0;
      const paymentDetails = [];

      for (const doc of donations.docs) {
        const donation = doc.data();
        const amount = donation.amount;

        // Calculate Stripe fees (2.9% + $0.30)
        const fee = amount * 0.029 + 0.3;

        grossAmount += amount;
        stripeFees += fee;
        netAmount += amount - fee;

        paymentDetails.push({
          donationId: doc.id,
          amount,
          fee: fee.toFixed(2),
          net: (amount - fee).toFixed(2),
          stripePaymentIntentId: donation.stripePaymentIntentId,
        });
      }

      // Create reconciliation record
      const reconRef = await admin
        .firestore()
        .collection("reconciliations")
        .add({
          type: "stripe_to_mercury",
          date: yesterday,
          transactions: donations.size,
          grossAmount: grossAmount.toFixed(2),
          stripeFees: stripeFees.toFixed(2),
          expectedDeposit: netAmount.toFixed(2),
          actualDeposit: null,
          variance: null,
          status: RECONCILIATION_STATUS.PENDING,
          paymentDetails,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      // Send notification to admin
      await sendReconciliationNotification({
        reconciliationId: reconRef.id,
        date: yesterday.toDateString(),
        transactions: donations.size,
        expectedDeposit: netAmount.toFixed(2),
      });

      console.log(
        `Reconciliation created: ${donations.size} transactions, expected deposit: $${netAmount.toFixed(2)}`
      );
    } catch (error) {
      console.error("Reconciliation error:", error);
      await sendAdminAlert("Reconciliation Failed", error.message);
    }
  });

/**
 * Confirm Mercury deposit (admin function)
 */
exports.confirmMercuryDeposit = functions.https.onCall(
  async (data, context) => {
    // Verify admin
    if (!context.auth?.token?.admin) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Admin access required"
      );
    }

    const { reconciliationId, actualAmount, mercuryTransactionId, notes } =
      data;

    try {
      const reconDoc = await admin
        .firestore()
        .collection("reconciliations")
        .doc(reconciliationId)
        .get();

      if (!reconDoc.exists) {
        throw new functions.https.HttpsError(
          "not-found",
          "Reconciliation not found"
        );
      }

      const recon = reconDoc.data();
      const expectedAmount = parseFloat(recon.expectedDeposit);
      const actual = parseFloat(actualAmount);
      const variance = actual - expectedAmount;
      const variancePercent = ((variance / expectedAmount) * 100).toFixed(2);

      // Update reconciliation
      await reconDoc.ref.update({
        actualDeposit: actual.toFixed(2),
        mercuryTransactionId,
        variance: variance.toFixed(2),
        variancePercent,
        status:
          Math.abs(variance) < 0.01
            ? RECONCILIATION_STATUS.MATCHED
            : RECONCILIATION_STATUS.VARIANCE,
        reconciledAt: admin.firestore.FieldValue.serverTimestamp(),
        reconciledBy: context.auth.uid,
        notes,
      });

      // Record Mercury balance
      await admin.firestore().collection("accountBalances").add({
        account: "mercury",
        type: "deposit",
        amount: actual,
        source: "stripe",
        reconciliationId,
        mercuryTransactionId,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Update running balance
      await updateMercuryBalance(actual);

      // Alert if variance detected
      if (Math.abs(variance) >= 0.01) {
        await sendAdminAlert(
          "Reconciliation Variance Detected",
          `Expected: $${expectedAmount.toFixed(2)}, Actual: $${actual.toFixed(2)}, Variance: $${variance.toFixed(2)} (${variancePercent}%)`
        );
      }

      return {
        success: true,
        matched: Math.abs(variance) < 0.01,
        variance: variance.toFixed(2),
        variancePercent,
      };
    } catch (error) {
      console.error("Confirm deposit error:", error);
      throw new functions.https.HttpsError(
        "internal",
        "Failed to confirm deposit"
      );
    }
  }
);

// =====================================
// PAYOUT BATCH PROCESSING
// =====================================

/**
 * Process Tuesday payouts (Friday-Monday games)
 */
exports.processTuesdayPayouts = functions.pubsub
  .schedule("every tuesday 08:00")
  .timeZone("America/Denver")
  .onRun(async (context) => {
    await processScheduledPayouts("tuesday", 4, 1); // 4 days back to Friday, 1 day back to Monday
  });

/**
 * Process Friday payouts (Tuesday-Thursday games)
 */
exports.processFridayPayouts = functions.pubsub
  .schedule("every friday 08:00")
  .timeZone("America/Denver")
  .onRun(async (context) => {
    await processScheduledPayouts("friday", 3, 1); // 3 days back to Tuesday, 1 day back to Thursday
  });

async function processScheduledPayouts(batchDay, daysBackStart, daysBackEnd) {
  console.log(`Processing ${batchDay} payout batch`);

  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(now.getDate() - daysBackStart);
  startDate.setHours(0, 0, 0, 0);

  const endDate = new Date(now);
  endDate.setDate(now.getDate() - daysBackEnd);
  endDate.setHours(23, 59, 59, 999);

  try {
    // Get Mercury balance
    const mercuryBalance = await getMercuryBalance();

    // Get pending winners in date range (exclude instant payouts)
    const winners = await admin
      .firestore()
      .collection("winners")
      .where("createdAt", ">=", startDate)
      .where("createdAt", "<=", endDate)
      .where("status", "==", PAYOUT_STATUS.PENDING)
      .get();

    if (winners.empty) {
      console.log("No pending winners for this batch");
      return;
    }

    // Group by user for efficiency
    const payoutsByUser = {};
    let totalPayoutAmount = 0;

    for (const winnerDoc of winners.docs) {
      const winner = winnerDoc.data();

      // Get user data
      const userDoc = await admin
        .firestore()
        .collection("users")
        .doc(winner.userId)
        .get();

      if (!userDoc.exists) {
        console.error(`User not found: ${winner.userId}`);
        continue;
      }

      const user = userDoc.data();

      if (!payoutsByUser[winner.userId]) {
        payoutsByUser[winner.userId] = {
          userId: winner.userId,
          email: user.email,
          payoutMethod: user.payoutMethod || {},
          wins: [],
          totalAmount: 0,
        };
      }

      payoutsByUser[winner.userId].wins.push({
        winnerId: winnerDoc.id,
        game: winner.game,
        quarter: winner.quarter,
        position: winner.position,
        amount: winner.prizeAmount,
      });

      payoutsByUser[winner.userId].totalAmount += winner.prizeAmount;
      totalPayoutAmount += winner.prizeAmount;
    }

    // Check if sufficient balance
    if (mercuryBalance < totalPayoutAmount) {
      await sendAdminAlert(
        "INSUFFICIENT FUNDS",
        `Need $${totalPayoutAmount.toFixed(2)}, have $${mercuryBalance.toFixed(2)}`
      );
      return;
    }

    // Create payout batch
    const batchRef = await admin
      .firestore()
      .collection("payoutBatches")
      .add({
        batchDay,
        dateRange: { start: startDate, end: endDate },
        userCount: Object.keys(payoutsByUser).length,
        winnerCount: winners.size,
        totalAmount: totalPayoutAmount,
        mercuryBalance,
        status: PAYOUT_STATUS.PENDING,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    // Create individual payouts
    const batch = admin.firestore().batch();
    const relayData = [];

    for (const [userId, userData] of Object.entries(payoutsByUser)) {
      const payoutRef = admin.firestore().collection("payouts").doc();

      batch.set(payoutRef, {
        batchId: batchRef.id,
        userId,
        email: userData.email,
        amount: userData.totalAmount,
        winDetails: userData.wins,
        payoutMethod: userData.payoutMethod,
        payoutType: "batch",
        status: PAYOUT_STATUS.QUEUED,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Mark winners as queued
      for (const win of userData.wins) {
        const winnerRef = admin
          .firestore()
          .collection("winners")
          .doc(win.winnerId);
        batch.update(winnerRef, {
          status: PAYOUT_STATUS.QUEUED,
          payoutId: payoutRef.id,
          batchId: batchRef.id,
        });
      }

      // Prepare Relay data
      relayData.push({
        payoutId: payoutRef.id,
        name: userData.payoutMethod.name || userData.email.split("@")[0],
        email: userData.email,
        amount: userData.totalAmount.toFixed(2),
        method: userData.payoutMethod.type || "ach",
        accountNumber: userData.payoutMethod.accountNumber || "",
        routingNumber: userData.payoutMethod.routingNumber || "",
        zelle: userData.payoutMethod.zelleEmail || "",
        paypal: userData.payoutMethod.paypalEmail || "",
        venmo: userData.payoutMethod.venmoUsername || "",
      });
    }

    await batch.commit();

    // Generate CSV for Relay
    const csv = await generateRelayCSV(relayData);

    // Update batch with CSV
    await batchRef.update({
      relayCSV: csv,
      relayData,
      status: PAYOUT_STATUS.PROCESSING,
    });

    // Send admin notification
    await sendPayoutBatchNotification({
      batchId: batchRef.id,
      batchDay,
      userCount: Object.keys(payoutsByUser).length,
      totalAmount: totalPayoutAmount,
      mercuryBalance,
    });

    console.log(
      `Payout batch created: ${winners.size} winners, $${totalPayoutAmount.toFixed(2)} total`
    );
  } catch (error) {
    console.error("Payout batch error:", error);
    await sendAdminAlert("Payout Batch Failed", error.message);
  }
}

/**
 * Confirm Relay payouts (admin function)
 */
exports.confirmRelayPayouts = functions.https.onCall(async (data, context) => {
  if (!context.auth?.token?.admin) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Admin access required"
    );
  }

  const { batchId, confirmations } = data;

  if (!Array.isArray(confirmations)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Confirmations must be an array"
    );
  }

  try {
    const batch = admin.firestore().batch();
    let successCount = 0;
    let failureCount = 0;
    let totalPaid = 0;

    for (const confirmation of confirmations) {
      const { payoutId, status, transactionId, failureReason } = confirmation;

      const payoutRef = admin.firestore().collection("payouts").doc(payoutId);
      const payoutDoc = await payoutRef.get();

      if (!payoutDoc.exists) {
        console.error(`Payout not found: ${payoutId}`);
        continue;
      }

      const payout = payoutDoc.data();

      if (status === "completed") {
        successCount++;
        totalPaid += payout.amount;

        // Update payout
        batch.update(payoutRef, {
          status: PAYOUT_STATUS.COMPLETED,
          relayTransactionId: transactionId,
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Update winners
        for (const win of payout.winDetails) {
          const winnerRef = admin
            .firestore()
            .collection("winners")
            .doc(win.winnerId);
          batch.update(winnerRef, {
            status: PAYOUT_STATUS.COMPLETED,
            paidAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }

        // Send confirmation to user
        await sendPayoutConfirmation(
          payout.userId,
          payout.amount,
          transactionId
        );
      } else {
        failureCount++;

        // Update payout
        batch.update(payoutRef, {
          status: PAYOUT_STATUS.FAILED,
          failureReason,
          failedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Revert winners to pending
        for (const win of payout.winDetails) {
          const winnerRef = admin
            .firestore()
            .collection("winners")
            .doc(win.winnerId);
          batch.update(winnerRef, {
            status: PAYOUT_STATUS.PENDING,
            payoutId: null,
            batchId: null,
          });
        }
      }
    }

    // Update batch
    const batchRef = admin.firestore().collection("payoutBatches").doc(batchId);
    batch.update(batchRef, {
      status: PAYOUT_STATUS.COMPLETED,
      successCount,
      failureCount,
      totalPaid,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      completedBy: context.auth.uid,
    });

    await batch.commit();

    // Record Mercury withdrawal
    if (totalPaid > 0) {
      await admin.firestore().collection("accountBalances").add({
        account: "mercury",
        type: "withdrawal",
        amount: -totalPaid,
        destination: "relay",
        batchId,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      await updateMercuryBalance(-totalPaid);
    }

    return {
      success: true,
      successCount,
      failureCount,
      totalPaid: totalPaid.toFixed(2),
    };
  } catch (error) {
    console.error("Confirm payouts error:", error);
    throw new functions.https.HttpsError(
      "internal",
      "Failed to confirm payouts"
    );
  }
});

// =====================================
// FINANCIAL REPORTING
// =====================================

/**
 * Generate financial reports
 */
exports.generateFinancialReport = functions.https.onCall(
  async (data, context) => {
    if (!context.auth?.token?.admin) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Admin access required"
      );
    }

    const { reportType, startDate, endDate } = data;

    try {
      let report;

      switch (reportType) {
        case "daily_summary":
          report = await generateDailySummary(new Date(startDate));
          break;
        case "weekly_pnl":
          report = await generateWeeklyPnL(
            new Date(startDate),
            new Date(endDate)
          );
          break;
        case "monthly_reconciliation":
          report = await generateMonthlyReconciliation(
            new Date(startDate),
            new Date(endDate)
          );
          break;
        case "tax_summary":
          report = await generateTaxSummary(
            new Date(startDate),
            new Date(endDate)
          );
          break;
        case "tier_analysis":
          report = await generateTierAnalysis(
            new Date(startDate),
            new Date(endDate)
          );
          break;
        default:
          throw new functions.https.HttpsError(
            "invalid-argument",
            "Invalid report type"
          );
      }

      // Store report
      const reportRef = await admin
        .firestore()
        .collection("financialReports")
        .add({
          type: reportType,
          dateRange: { start: startDate, end: endDate },
          generatedBy: context.auth.uid,
          generatedAt: admin.firestore.FieldValue.serverTimestamp(),
          data: report,
        });

      return {
        success: true,
        reportId: reportRef.id,
        report,
      };
    } catch (error) {
      console.error("Generate report error:", error);
      throw new functions.https.HttpsError(
        "internal",
        "Failed to generate report"
      );
    }
  }
);

async function generateDailySummary(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);

  // Get donations
  const donations = await admin
    .firestore()
    .collection("donations")
    .where("completedAt", ">=", start)
    .where("completedAt", "<=", end)
    .where("status", "==", "completed")
    .get();

  let grossRevenue = 0;
  let stripeFees = 0;
  let totalPrizeAllocation = 0;
  let totalOperatingRevenue = 0;
  const revenueByTier = {};

  donations.forEach((doc) => {
    const donation = doc.data();
    const amount = donation.amount;
    const fee = amount * 0.029 + 0.3;
    const tier = donation.tier;
    const payoutPercentage = TIER_CONFIG[tier]?.payoutPercentage || 0.77;
    const platformPercentage = 1 - payoutPercentage;

    grossRevenue += amount;
    stripeFees += fee;

    const netAmount = amount - fee;
    totalPrizeAllocation += netAmount * payoutPercentage;
    totalOperatingRevenue += netAmount * platformPercentage;

    if (!revenueByTier[tier]) {
      revenueByTier[tier] = {
        count: 0,
        amount: 0,
        payoutPercentage,
        platformPercentage,
      };
    }
    revenueByTier[tier].count++;
    revenueByTier[tier].amount += amount;
  });

  const netRevenue = grossRevenue - stripeFees;

  // Get payouts
  const payouts = await admin
    .firestore()
    .collection("payouts")
    .where("completedAt", ">=", start)
    .where("completedAt", "<=", end)
    .where("status", "==", PAYOUT_STATUS.COMPLETED)
    .get();

  let totalPayouts = 0;
  let instantPayouts = 0;
  let batchPayouts = 0;
  let instantPayoutFees = 0;

  payouts.forEach((doc) => {
    const payout = doc.data();
    totalPayouts += payout.amount;

    if (payout.payoutType === "instant") {
      instantPayouts += payout.amount;
      instantPayoutFees += payout.instantPayoutFee || 0;
    } else {
      batchPayouts += payout.amount;
    }
  });

  return {
    date: date.toISOString().split("T")[0],
    revenue: {
      gross: grossRevenue.toFixed(2),
      stripeFees: stripeFees.toFixed(2),
      net: netRevenue.toFixed(2),
      byTier: revenueByTier,
    },
    allocations: {
      operatingRevenue: totalOperatingRevenue.toFixed(2),
      prizePool: totalPrizeAllocation.toFixed(2),
      instantPayoutFees: instantPayoutFees.toFixed(2),
    },
    payouts: {
      total: totalPayouts.toFixed(2),
      instant: instantPayouts.toFixed(2),
      batch: batchPayouts.toFixed(2),
      count: payouts.size,
    },
    profit: {
      daily: (totalOperatingRevenue + instantPayoutFees).toFixed(2),
    },
    transactions: {
      donations: donations.size,
      payouts: payouts.size,
    },
  };
}

async function generateWeeklyPnL(startDate, endDate) {
  // Get all revenue
  const donations = await admin
    .firestore()
    .collection("donations")
    .where("completedAt", ">=", startDate)
    .where("completedAt", "<=", endDate)
    .where("status", "==", "completed")
    .get();

  let totalRevenue = 0;
  let totalFees = 0;
  let totalPrizeAllocation = 0;
  let totalOperatingRevenue = 0;
  const revenueByDay = {};
  const revenueByTier = {};

  donations.forEach((doc) => {
    const donation = doc.data();
    const amount = donation.amount;
    const fee = amount * 0.029 + 0.3;
    const tier = donation.tier;
    const payoutPercentage = TIER_CONFIG[tier]?.payoutPercentage || 0.77;
    const platformPercentage = 1 - payoutPercentage;

    totalRevenue += amount;
    totalFees += fee;

    const netAmount = amount - fee;
    totalPrizeAllocation += netAmount * payoutPercentage;
    totalOperatingRevenue += netAmount * platformPercentage;

    // By day
    const day = donation.completedAt.toDate().toISOString().split("T")[0];
    if (!revenueByDay[day]) revenueByDay[day] = 0;
    revenueByDay[day] += amount;

    // By tier
    if (!revenueByTier[tier]) {
      revenueByTier[tier] = {
        revenue: 0,
        count: 0,
        payoutPercentage,
        platformPercentage,
      };
    }
    revenueByTier[tier].revenue += amount;
    revenueByTier[tier].count++;
  });

  // Get all payouts
  const payouts = await admin
    .firestore()
    .collection("payouts")
    .where("completedAt", ">=", startDate)
    .where("completedAt", "<=", endDate)
    .where("status", "==", PAYOUT_STATUS.COMPLETED)
    .get();

  let totalPayouts = 0;
  let instantPayoutFees = 0;

  payouts.forEach((doc) => {
    const payout = doc.data();
    totalPayouts += payout.amount;
    if (payout.payoutType === "instant") {
      instantPayoutFees += payout.instantPayoutFee || 0;
    }
  });

  const netRevenue = totalRevenue - totalFees;
  const actualProfit = totalOperatingRevenue + instantPayoutFees;

  return {
    period: {
      start: startDate.toISOString().split("T")[0],
      end: endDate.toISOString().split("T")[0],
    },
    revenue: {
      gross: totalRevenue.toFixed(2),
      fees: totalFees.toFixed(2),
      net: netRevenue.toFixed(2),
      daily: revenueByDay,
      byTier: revenueByTier,
    },
    allocations: {
      prizePool: totalPrizeAllocation.toFixed(2),
      operatingRevenue: totalOperatingRevenue.toFixed(2),
      instantPayoutFees: instantPayoutFees.toFixed(2),
    },
    expenses: {
      prizePayouts: totalPayouts.toFixed(2),
      stripeFees: totalFees.toFixed(2),
      total: (totalPayouts + totalFees).toFixed(2),
    },
    profit: {
      operating: totalOperatingRevenue.toFixed(2),
      instantFees: instantPayoutFees.toFixed(2),
      total: actualProfit.toFixed(2),
      margin: ((actualProfit / totalRevenue) * 100).toFixed(2) + "%",
    },
    metrics: {
      avgDonation: (totalRevenue / donations.size).toFixed(2),
      avgPayout:
        payouts.size > 0 ? (totalPayouts / payouts.size).toFixed(2) : "0",
      payoutRatio:
        netRevenue > 0
          ? ((totalPayouts / netRevenue) * 100).toFixed(2) + "%"
          : "0%",
    },
  };
}

async function generateMonthlyReconciliation(startDate, endDate) {
  // Get all reconciliations
  const reconciliations = await admin
    .firestore()
    .collection("reconciliations")
    .where("date", ">=", startDate)
    .where("date", "<=", endDate)
    .get();

  let totalExpected = 0;
  let totalActual = 0;
  let totalVariance = 0;
  const unreconciled = [];
  const variances = [];

  reconciliations.forEach((doc) => {
    const recon = doc.data();
    totalExpected += parseFloat(recon.expectedDeposit || 0);

    if (recon.actualDeposit) {
      totalActual += parseFloat(recon.actualDeposit);
      const variance = parseFloat(recon.variance || 0);
      totalVariance += variance;

      if (Math.abs(variance) > 0.01) {
        variances.push({
          date: recon.date.toDate().toISOString().split("T")[0],
          expected: recon.expectedDeposit,
          actual: recon.actualDeposit,
          variance: recon.variance,
          reconciliationId: doc.id,
        });
      }
    } else {
      unreconciled.push({
        date: recon.date.toDate().toISOString().split("T")[0],
        expected: recon.expectedDeposit,
        transactions: recon.transactions,
        reconciliationId: doc.id,
      });
    }
  });

  return {
    period: {
      start: startDate.toISOString().split("T")[0],
      end: endDate.toISOString().split("T")[0],
    },
    summary: {
      totalExpected: totalExpected.toFixed(2),
      totalActual: totalActual.toFixed(2),
      totalVariance: totalVariance.toFixed(2),
      variancePercent:
        totalExpected > 0
          ? ((totalVariance / totalExpected) * 100).toFixed(2) + "%"
          : "0%",
    },
    status: {
      totalReconciliations: reconciliations.size,
      completed: reconciliations.size - unreconciled.length,
      pending: unreconciled.length,
      withVariance: variances.length,
    },
    unreconciled,
    variances,
    recommendations: generateReconciliationRecommendations(
      totalVariance,
      variances,
      unreconciled
    ),
  };
}

async function generateTaxSummary(startDate, endDate) {
  // Get all completed payouts
  const payouts = await admin
    .firestore()
    .collection("payouts")
    .where("completedAt", ">=", startDate)
    .where("completedAt", "<=", endDate)
    .where("status", "==", PAYOUT_STATUS.COMPLETED)
    .get();

  const payoutsByUser = {};
  let totalPaid = 0;
  let totalInstantFees = 0;

  for (const payoutDoc of payouts.docs) {
    const payout = payoutDoc.data();

    if (!payoutsByUser[payout.userId]) {
      const userDoc = await admin
        .firestore()
        .collection("users")
        .doc(payout.userId)
        .get();

      const user = userDoc.data();

      payoutsByUser[payout.userId] = {
        userId: payout.userId,
        email: user.email,
        name: user.payoutMethod?.name || user.email.split("@")[0],
        taxId: user.taxId || "Not provided",
        totalPaid: 0,
        totalInstantFees: 0,
        payoutCount: 0,
        wins: [],
      };
    }

    payoutsByUser[payout.userId].totalPaid += payout.amount;
    payoutsByUser[payout.userId].totalInstantFees +=
      payout.instantPayoutFee || 0;
    payoutsByUser[payout.userId].payoutCount++;
    payoutsByUser[payout.userId].wins.push(...payout.winDetails);
    totalPaid += payout.amount;
    totalInstantFees += payout.instantPayoutFee || 0;
  }

  // Filter for 1099 eligibility (>$600)
  const eligible1099 = Object.values(payoutsByUser)
    .filter((user) => user.totalPaid >= 600)
    .sort((a, b) => b.totalPaid - a.totalPaid);

  // Get revenue for comparison
  const donations = await admin
    .firestore()
    .collection("donations")
    .where("completedAt", ">=", startDate)
    .where("completedAt", "<=", endDate)
    .where("status", "==", "completed")
    .get();

  let grossRevenue = 0;
  let totalOperatingRevenue = 0;
  let stripeFees = 0;

  donations.forEach((doc) => {
    const donation = doc.data();
    const amount = donation.amount;
    const fee = amount * 0.029 + 0.3;
    const tier = donation.tier;
    const platformPercentage =
      1 - (TIER_CONFIG[tier]?.payoutPercentage || 0.77);

    grossRevenue += amount;
    stripeFees += fee;
    totalOperatingRevenue += (amount - fee) * platformPercentage;
  });

  return {
    taxYear: startDate.getFullYear(),
    period: {
      start: startDate.toISOString().split("T")[0],
      end: endDate.toISOString().split("T")[0],
    },
    revenue: {
      gross: grossRevenue.toFixed(2),
      stripeFees: stripeFees.toFixed(2),
      operatingShare: totalOperatingRevenue.toFixed(2),
      instantPayoutFees: totalInstantFees.toFixed(2),
    },
    payouts: {
      total: totalPaid.toFixed(2),
      recipients: Object.keys(payoutsByUser).length,
      require1099: eligible1099.length,
      totalFor1099: eligible1099
        .reduce((sum, u) => sum + u.totalPaid, 0)
        .toFixed(2),
    },
    form1099Recipients: eligible1099.map((user) => ({
      email: user.email,
      name: user.name,
      taxId: user.taxId,
      totalPaid: user.totalPaid.toFixed(2),
      payoutCount: user.payoutCount,
    })),
    taxableProfits: {
      operatingRevenue: totalOperatingRevenue.toFixed(2),
      instantFees: totalInstantFees.toFixed(2),
      total: (totalOperatingRevenue + totalInstantFees).toFixed(2),
    },
  };
}

async function generateTierAnalysis(startDate, endDate) {
  const tiers = [
    "tier_25",
    "tier_50",
    "tier_100",
    "tier_250",
    "tier_500",
    "tier_1000",
  ];
  const analysis = {};

  for (const tier of tiers) {
    // Get donations
    const donations = await admin
      .firestore()
      .collection("donations")
      .where("tier", "==", tier)
      .where("completedAt", ">=", startDate)
      .where("completedAt", "<=", endDate)
      .where("status", "==", "completed")
      .get();

    // Get winners
    const winners = await admin
      .firestore()
      .collection("winners")
      .where("tier", "==", tier)
      .where("createdAt", ">=", startDate)
      .where("createdAt", "<=", endDate)
      .get();

    const revenue = donations.docs.reduce(
      (sum, doc) => sum + doc.data().amount,
      0
    );
    const prizes = winners.docs.reduce(
      (sum, doc) => sum + doc.data().prizeAmount,
      0
    );

    const tierConfig = TIER_CONFIG[tier];
    const payoutPercentage = tierConfig.payoutPercentage;
    const platformPercentage = 1 - payoutPercentage;
    const stripeFees = donations.docs.reduce((sum, doc) => {
      const amount = doc.data().amount;
      return sum + amount * 0.029 + 0.3;
    }, 0);
    const netRevenue = revenue - stripeFees;
    const operatingProfit = netRevenue * platformPercentage;

    analysis[tier] = {
      name: tierConfig.name,
      payoutPercentage: (payoutPercentage * 100).toFixed(0) + "%",
      platformPercentage: (platformPercentage * 100).toFixed(0) + "%",
      donations: donations.size,
      revenue: revenue.toFixed(2),
      netRevenue: netRevenue.toFixed(2),
      winners: winners.size,
      prizes: prizes.toFixed(2),
      operatingProfit: operatingProfit.toFixed(2),
      profitMargin:
        revenue > 0
          ? ((operatingProfit / revenue) * 100).toFixed(2) + "%"
          : "0%",
      avgDonation:
        donations.size > 0 ? (revenue / donations.size).toFixed(2) : "0",
      avgPrize: winners.size > 0 ? (prizes / winners.size).toFixed(2) : "0",
    };
  }

  return {
    period: {
      start: startDate.toISOString().split("T")[0],
      end: endDate.toISOString().split("T")[0],
    },
    byTier: analysis,
    summary: {
      mostPopular: Object.entries(analysis).sort(
        (a, b) => b[1].donations - a[1].donations
      )[0][0],
      mostProfitable: Object.entries(analysis).sort(
        (a, b) =>
          parseFloat(b[1].operatingProfit) - parseFloat(a[1].operatingProfit)
      )[0][0],
      highestMargin: Object.entries(analysis).sort(
        (a, b) => parseFloat(b[1].profitMargin) - parseFloat(a[1].profitMargin)
      )[0][0],
    },
  };
}

// =====================================
// BALANCE TRACKING
// =====================================

async function getMercuryBalance() {
  const lastBalance = await admin
    .firestore()
    .collection("accountBalances")
    .where("account", "==", "mercury")
    .orderBy("timestamp", "desc")
    .limit(1)
    .get();

  if (lastBalance.empty) return 0;

  // Calculate running balance
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

async function updateMercuryBalance(amount) {
  const currentBalance = await getMercuryBalance();
  const newBalance = currentBalance + amount;

  // Store balance snapshot
  await admin.firestore().collection("balanceSnapshots").add({
    account: "mercury",
    previousBalance: currentBalance,
    change: amount,
    newBalance,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Alert if low balance
  if (newBalance < 1000) {
    await sendAdminAlert(
      "LOW MERCURY BALANCE",
      `Balance is now $${newBalance.toFixed(2)}. Consider transferring funds.`
    );
  }
}

// =====================================
// HELPER FUNCTIONS
// =====================================

async function generateRelayCSV(payouts) {
  const fields = [
    "payoutId",
    "name",
    "email",
    "amount",
    "method",
    "accountNumber",
    "routingNumber",
    "zelle",
    "paypal",
    "venmo",
  ];

  try {
    const parser = new Parser({ fields });
    return parser.parse(payouts);
  } catch (error) {
    console.error("CSV generation error:", error);
    throw error;
  }
}

function generateReconciliationRecommendations(
  totalVariance,
  variances,
  unreconciled
) {
  const recommendations = [];

  if (unreconciled.length > 0) {
    recommendations.push(
      `Complete ${unreconciled.length} pending reconciliations`
    );
  }

  if (Math.abs(totalVariance) > 10) {
    recommendations.push(
      "Investigate significant variance - possible fee calculation issue"
    );
  }

  if (variances.length > 5) {
    recommendations.push(
      "Review Stripe fee settings - multiple variances detected"
    );
  }

  if (recommendations.length === 0) {
    recommendations.push("All reconciliations are within acceptable range");
  }

  return recommendations;
}

async function sendReconciliationNotification(data) {
  const message = `
Daily Stripe → Mercury Reconciliation Ready

Date: ${data.date}
Transactions: ${data.transactions}
Expected Deposit: $${data.expectedDeposit}

Please verify the deposit in Mercury and confirm:
https://squaretrivia.com/admin/reconciliation/${data.reconciliationId}
  `;

  await sendAdminEmail("Daily Reconciliation Ready", message);
}

async function sendPayoutBatchNotification(data) {
  const balanceCheck = data.mercuryBalance >= data.totalAmount;

  const message = `
${data.batchDay.toUpperCase()} Payout Batch Ready

Winners: ${data.userCount}
Total Amount: $${data.totalAmount.toFixed(2)}
Mercury Balance: $${data.mercuryBalance.toFixed(2)}
${balanceCheck ? "✅ Sufficient funds" : "⚠️ INSUFFICIENT FUNDS"}

Download Relay CSV:
https://squaretrivia.com/admin/payouts/${data.batchId}
  `;

  await sendAdminEmail(
    balanceCheck ? "Payout Batch Ready" : "⚠️ URGENT: Insufficient Funds",
    message
  );
}

async function sendInstantPayoutConfirmation(
  userId,
  payoutAmount,
  instantFee,
  stripePayoutId
) {
  const userDoc = await admin.firestore().collection("users").doc(userId).get();
  const user = userDoc.data();

  if (!user.email) return;

  const originalAmount = payoutAmount + instantFee;

  // Check if user has Telegram
  const hasTelegram = user.hasTelegram || !!user.telegramUsername;

  // Modify email template based on Telegram status
  const telegramCTA = !hasTelegram
    ? `
    <div style="background-color: #E3F2FD; padding: 15px; border-radius: 8px; margin: 20px 0;">
      <p style="margin: 0;"><strong>💡 Did you know?</strong></p>
      <p style="margin: 5px 0 0 0;">Add Telegram to get instant payout notifications and 2x more daily trivia attempts!</p>
      <a href="https://squaretrivia.com/account/add-telegram" style="color: #0066FF;">Add Telegram Now →</a>
    </div>
  `
    : "";

  await sendMail({
    // from: 'Square Trivia <payouts@squaretrivia.com>',
    to: user.email,
    subject: "⚡ Your Instant Prize Has Been Sent!",
    html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #10B981; color: white; padding: 20px; text-align: center; }
    .amount { font-size: 36px; font-weight: bold; color: #10B981; }
    .breakdown { background-color: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Instant Payment Sent! ⚡</h1>
    </div>
    <div style="padding: 20px;">
      <p>Great news! Your Square Trivia instant payout has been sent.</p>
      
      <div style="text-align: center; margin: 20px 0;">
        <div class="amount">$${payoutAmount.toFixed(2)}</div>
        <p style="color: #666;">Sent to your account</p>
      </div>
      
      <div class="breakdown">
        <h3 style="margin-top: 0;">Payout Breakdown:</h3>
        <p>Original Prize: $${originalAmount.toFixed(2)}</p>
        <p>Instant Payout Fee (8%): -$${instantFee.toFixed(2)}</p>
        <p><strong>Amount Sent: $${payoutAmount.toFixed(2)}</strong></p>
      </div>
      
      <p><strong>Transaction ID:</strong> ${stripePayoutId}</p>
      
      <p>The instant payout should arrive within minutes to your connected bank account.</p>
      
      ${telegramCTA}
      
      <p style="color: #666; font-size: 12px; margin-top: 20px;">
        You chose instant payout for immediate access to your winnings. For future wins, you can also choose standard payout to receive the full amount in 2-3 business days.
      </p>
    </div>
  </div>
</body>
</html>
    `,
  });
}

async function sendPayoutConfirmation(userId, amount, transactionId) {
  const userDoc = await admin.firestore().collection("users").doc(userId).get();
  const user = userDoc.data();

  if (!user.email) return;

  // Check if user has Telegram
  const hasTelegram = user.hasTelegram || !!user.telegramUsername;

  // Modify email template based on Telegram status
  const telegramCTA = !hasTelegram
    ? `
    <div style="background-color: #E3F2FD; padding: 15px; border-radius: 8px; margin: 20px 0;">
      <p style="margin: 0;"><strong>💡 Did you know?</strong></p>
      <p style="margin: 5px 0 0 0;">Add Telegram to get instant payout notifications and 2x more daily trivia attempts!</p>
      <a href="https://squaretrivia.com/account/add-telegram" style="color: #0066FF;">Add Telegram Now →</a>
    </div>
  `
    : "";

  await sendMail({
    // from: 'Square Trivia <payouts@squaretrivia.com>',
    to: user.email,
    subject: "💰 Your Prize Has Been Sent!",
    html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #10B981; color: white; padding: 20px; text-align: center; }
    .amount { font-size: 36px; font-weight: bold; color: #10B981; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Payment Sent! 💰</h1>
    </div>
    <div style="padding: 20px;">
      <p>Great news! Your Square Trivia winnings have been sent.</p>
      
      <div style="text-align: center; margin: 20px 0;">
        <div class="amount">$${amount.toFixed(2)}</div>
      </div>
      
      <p><strong>Transaction ID:</strong> ${transactionId}</p>
      
      <p>The payment should arrive within 1-3 business days depending on your payment method.</p>
      
      ${telegramCTA}
      
      <p style="color: #666; font-size: 12px; margin-top: 20px;">
        For tax purposes, you'll receive a 1099 form if your total winnings exceed $600 this year.
      </p>
    </div>
  </div>
</body>
</html>
    `,
  });
}

async function sendAdminEmail(subject, message) {
  await sendMail({
    // from: 'Square Trivia Finance <finance@squaretrivia.com>',
    to: "admin@squaretrivia.com",
    subject,
    text: message,
  });
}

async function sendAdminAlert(subject, message) {
  // Send urgent email
  await sendMail({
    // from: 'Square Trivia Alerts <alerts@squaretrivia.com>',
    to: "admin@squaretrivia.com",
    subject: `🚨 ${subject}`,
    text: message,
    priority: "high",
  });

  // Also send Telegram if configured
  if (functions.config().telegram?.admin_chat_id) {
    const TelegramBot = require("node-telegram-bot-api");
    const bot = new TelegramBot(functions.config().telegram.bot_token, {
      polling: false,
    });

    try {
      await bot.sendMessage(
        functions.config().telegram.admin_chat_id,
        `🚨 *${subject}*\n\n${message}`,
        { parse_mode: "Markdown" }
      );
    } catch (error) {
      console.error("Telegram alert failed:", error);
    }
  }
}

// =====================================
// SCHEDULED MAINTENANCE
// =====================================

/**
 * Daily financial health check
 */
exports.dailyFinancialHealthCheck = functions.pubsub
  .schedule("every day 10:00")
  .timeZone("America/Denver")
  .onRun(async (context) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Check unreconciled deposits
    const unreconciled = await admin
      .firestore()
      .collection("reconciliations")
      .where("status", "==", RECONCILIATION_STATUS.PENDING)
      .where("date", "<", today)
      .get();

    if (!unreconciled.empty) {
      await sendAdminAlert(
        "Unreconciled Deposits",
        `${unreconciled.size} deposits need reconciliation`
      );
    }

    // Check pending payouts older than 7 days (excluding instant payouts)
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const oldPayouts = await admin
      .firestore()
      .collection("winners")
      .where("status", "==", PAYOUT_STATUS.PENDING)
      .where("createdAt", "<", weekAgo)
      .get();

    if (!oldPayouts.empty) {
      await sendAdminAlert(
        "Old Pending Payouts",
        `${oldPayouts.size} winners waiting more than 7 days for payout`
      );
    }

    // Check Mercury balance
    const balance = await getMercuryBalance();
    const pendingPayouts = await admin
      .firestore()
      .collection("winners")
      .where("status", "==", PAYOUT_STATUS.PENDING)
      .get();

    let totalPending = 0;
    pendingPayouts.forEach((doc) => {
      totalPending += doc.data().prizeAmount;
    });

    if (balance < totalPending) {
      await sendAdminAlert(
        "Insufficient Funds Warning",
        `Balance: $${balance.toFixed(2)}, Pending Payouts: $${totalPending.toFixed(2)}`
      );
    }

    // Check instant payout metrics
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const instantPayouts = await admin
      .firestore()
      .collection("payouts")
      .where("payoutType", "==", "instant")
      .where("createdAt", ">=", yesterday)
      .where("createdAt", "<", today)
      .get();

    if (instantPayouts.size > 50) {
      await sendAdminAlert(
        "High Instant Payout Volume",
        `${instantPayouts.size} instant payouts processed yesterday - verify Stripe balance`
      );
    }
  });

// Ensure module exports is complete
module.exports = exports;
