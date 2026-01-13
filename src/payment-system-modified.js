// Artifact #8: Donation & Payment System
// Complete payment processing with Stripe, free entry, and tier management
// Updated with new payment structure: 77%/80% payouts and 8% instant payout fee

const functions = require("firebase-functions");

const admin = require("firebase-admin");
const stripeKey = functions.config().stripe.key;
const stripe = require("stripe")(stripeKey);
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { default: axios } = require("axios");
const TelegramBot = require("node-telegram-bot-api");
const bot = new TelegramBot(functions.config().telegram.bot_token, {
  polling: false,
});

// // Initialize mail transport
// const mailTransport = nodemailer.createTransport({
//   service: "gmail",
//   auth: {
//     user: process.env.EMAIL_USER,
//     pass: process.env.EMAIL_PASSWORD,
//   },
// });

const sgMail = require("@sendgrid/mail");

const TELEGRAM_BOT_TOKEN = "7718801037:AAEV4HynXs0vdMTDFcVtVphzFU1PpaLooAQ";

async function sendTelegramNotification(chatId, message) {
  if (!chatId) return;

  await axios.post(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      chat_id: chatId,
      text: message,
    }
  );
}

// Set API key
sgMail.setApiKey(process.env.REACT_SENDGRID_API_KEY);

// Example send function
const sendMail = async ({ to, subject, html }) => {
  const msg = {
    to,
    from: process.env.REACT_SENDGRID_FROM_EMAIL,
    subject,
    html,
    text: html.replace(/<[^>]+>/g, ""), // Fallback to plain text
  };

  try {
    await sgMail.send(msg);
    console.log("Email sent successfully");
  } catch (error) {
    console.error("Error sending email:", error);

    // SendGrid sometimes nests errors
    if (error.response) {
      console.error(error.response.body);
    }
  }
};
// =====================================
// CONSTANTS (from Artifact #1)
// =====================================
// const TIER_CONFIG = {
//   tier_25: { amount: 25, name: '$25 Tier', telegramGroupId: functions.config().telegram.tier_25_group_id, payoutPercentage: 0.77 },
//   tier_50: { amount: 50, name: '$50 Tier', telegramGroupId: functions.config().telegram.tier_50_group_id, payoutPercentage: 0.77 },
//   tier_100: { amount: 100, name: '$100 Tier', telegramGroupId: functions.config().telegram.tier_100_group_id, payoutPercentage: 0.77 },
//   tier_250: { amount: 250, name: '$250 Tier', telegramGroupId: functions.config().telegram.tier_250_group_id, payoutPercentage: 0.80 },
//   tier_500: { amount: 500, name: '$500 Tier', telegramGroupId: functions.config().telegram.tier_500_group_id, payoutPercentage: 0.80 },
//   tier_1000: { amount: 1000, name: '$1000 Tier', telegramGroupId: functions.config().telegram.tier_1000_group_id, payoutPercentage: 0.80 }
// };

const TIER_CONFIG = {
  tier_25: {
    amount: 25,
    name: "$25 Tier",
    telegramGroupId: "-1002279525248",
    payoutPercentage: 0.77,
  },
  tier_50: {
    amount: 50,
    name: "$50 Tier",
    telegramGroupId: "-1002862739955",
    payoutPercentage: 0.77,
  },
  tier_100: {
    amount: 100,
    name: "$100 Tier",
    telegramGroupId: "-1002749874729",
    payoutPercentage: 0.77,
  },
  tier_250: {
    amount: 250,
    name: "$250 Tier",
    telegramGroupId: "-1002554143674",
    payoutPercentage: 0.8,
  },
  tier_500: {
    amount: 500,
    name: "$500 Tier",
    telegramGroupId: "-1002477878800",
    payoutPercentage: 0.8,
  },
  tier_1000: {
    amount: 1000,
    name: "$1000 Tier",
    telegramGroupId: "-1002775562003",
    payoutPercentage: 0.8,
  },
};

const DONATION_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
  REFUNDED: "refunded",
};

// Payout constants
const INSTANT_PAYOUT_FEE = 0.08; // 8% fee for instant payouts
const BATCH_PAYOUT_DAYS = ["tuesday", "friday"];

// =====================================
// STRIPE PAYMENT PROCESSING
// =====================================

/**
 * Create a payment intent for donation
 * Includes rate limiting and validation
 */
exports.createPaymentIntent = functions.https.onCall(async (data, context) => {
  // Authentication check
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "User must be authenticated"
    );
  }

  const { tier, telegramUsername } = data;
  const userId = context.auth.uid;

  // Input validation
  if (!tier || !TIER_CONFIG[tier]) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Invalid tier selected"
    );
  }

  // Validate Telegram if provided (now optional)
  let validatedTelegram = null;
  let hasTelegram = false;

  if (telegramUsername && telegramUsername.trim() !== "") {
    if (!telegramUsername.match(/^@?[a-zA-Z0-9_]{5,32}$/)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Invalid Telegram username format"
      );
    }
    validatedTelegram = telegramUsername.replace("@", "");
    hasTelegram = true;
  }

  // Rate limiting check (5 attempts per hour)
  const rateLimitKey = `payment_attempts:${userId}`;
  const attempts = await checkRateLimit(rateLimitKey, 5, 3600);
  if (!attempts.allowed) {
    throw new functions.https.HttpsError(
      "resource-exhausted",
      `Too many payment attempts. Try again in ${attempts.retryAfter} minutes.`
    );
  }

  try {
    // Determine payout percentage based on tier
    const payoutPercentage = TIER_CONFIG[tier].payoutPercentage;

    // Create donation record
    const donationRef = await admin
      .firestore()
      .collection("donations")
      .add({
        userId,
        tier,
        amount: TIER_CONFIG[tier].amount,
        payoutPercentage, // Store tier-specific payout percentage
        telegramUsername: validatedTelegram,
        hasTelegram: hasTelegram,
        webOnlyAccess: !hasTelegram,
        status: DONATION_STATUS.PENDING,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        metadata: {
          userAgent: context.rawRequest.headers["user-agent"],
          ip: context.rawRequest.ip,
        },
      });

    // Create Stripe payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: TIER_CONFIG[tier].amount * 100, // Convert to cents
      currency: "usd",
      payment_method_types: ["card"],
      metadata: {
        userId,
        donationId: donationRef.id,
        tier,
        telegramUsername: validatedTelegram || "",
        payoutPercentage: payoutPercentage.toString(), // Store in metadata too
      },
      description: `Square Trivia ${TIER_CONFIG[tier].name} Access`,
      statement_descriptor: "SQUARETRIVIA",
    });

    // Update donation with payment intent ID
    await donationRef.update({
      stripePaymentIntentId: paymentIntent.id,
      status: DONATION_STATUS.PROCESSING,
    });

    // Log for monitoring
    console.log(
      `Payment intent created: ${paymentIntent.id} for user ${userId}`
    );

    return {
      success: true,
      clientSecret: paymentIntent.client_secret,
      donationId: donationRef.id,
    };
  } catch (error) {
    console.error("Payment intent creation error:", error);

    // Clean up failed donation record
    if (donationRef) {
      await donationRef.update({
        status: DONATION_STATUS.FAILED,
        error: error.message,
      });
    }

    throw new functions.https.HttpsError(
      "internal",
      "Payment processing failed"
    );
  }
});

// =====================================
// STRIPE WEBHOOK HANDLER
// =====================================

/**
 * Handle Stripe webhook events with replay protection
 */
exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
  // Only accept POST requests
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const sig = req.headers["stripe-signature"];
  const endpointSecret = functions.config().stripe.webhook_secret;

  let event;

  try {
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  // Check for replay attacks
  const eventRef = admin.firestore().collection("stripeEvents").doc(event.id);
  const eventDoc = await eventRef.get();

  if (eventDoc.exists) {
    console.log(`Duplicate webhook event detected: ${event.id}`);
    res.json({ received: true, duplicate: true });
    return;
  }

  // Record event to prevent replay
  await eventRef.set({
    type: event.type,
    processed: false,
    receivedAt: admin.firestore.FieldValue.serverTimestamp(),
    data: event.data,
  });

  // Process the event
  try {
    switch (event.type) {
      case "payment_intent.succeeded":
        await handleSuccessfulPayment(event.data.object);
        break;

      case "payment_intent.payment_failed":
        await handleFailedPayment(event.data.object);
        break;

      case "charge.refunded":
        await handleRefund(event.data.object);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    // Mark event as processed
    await eventRef.update({
      processed: true,
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error(`Error processing webhook ${event.type}:`, error);
    res.status(500).send("Webhook processing failed");
    return;
  }

  res.json({ received: true });
});

// =====================================
// PAYMENT PROCESSING HANDLERS
// =====================================

async function handleSuccessfulPayment(paymentIntent) {
  const { metadata } = paymentIntent;
  const { userId, donationId, tierId, payoutPercentage, telegramUsername } =
    metadata;

  console.log(
    `Processing successful payment for donation ${donationId} with ${payoutPercentage}% payout`
  );

  const db = admin.firestore();
  const batch = db.batch();

  try {
    // ✅ Update donation status
    const donationRef = db.collection("donations").doc(donationId);
    batch.update(donationRef, {
      status: DONATION_STATUS.COMPLETED,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      stripeChargeId: paymentIntent.payment_intent.latest_charge,
      payoutPercentage: parseFloat(payoutPercentage),
    });

    // ✅ Update user's record
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();
    const userData = userDoc.data() || {};

    const newCurrentTiers = [...(userData.currentTiers || []), tierId];

    batch.set(
      userRef,
      {
        totalDonations:
          (userData.totalDonations || 0) + TIER_CONFIG[tierId].amount,
        currentTiers: newCurrentTiers,
        lastDonation: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // ✅ Tier access: create or extend
    const accessQuery = await db
      .collection("tierAccess")
      .where("userId", "==", userId)
      .where("tier", "==", tierId)
      .where("active", "==", true)
      .limit(1)
      .get();

    if (accessQuery.empty) {
      const accessRef = db.collection("tierAccess").doc();

      const accessData = {
        userId,
        tier: tierId,
        donationId,
        grantedAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        active: true,
      };

      // only set optional fields if they exist
      if (telegramUsername) {
        accessData.telegramUsername = telegramUsername;
      }
      if (userData.telegramUsername) {
        accessData.telegramUsername = userData.telegramUsername;
      }

      batch.set(accessRef, accessData);
    } else {
      const accessDoc = accessQuery.docs[0];
      const accessRef = accessDoc.ref;
      batch.update(accessRef, {
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // ✅ Commit batch
    await batch.commit();

    // ✅ Send Telegram invite (only if chatId exists)
    const updatedUserDoc = await userRef.get();
    const updatedUserData = updatedUserDoc.data() || {};
    const telegramChatId = updatedUserData.telegramChatId;

    if (telegramChatId) {
      functions.logger.info(`Got CHATID: ${telegramChatId}`);

      const tierGroupId = TIER_CONFIG[tierId].telegramGroupId;

      try {
        const inviteLink = await bot.createChatInviteLink(tierGroupId, {
          member_limit: 1,
          expire_date: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours
        });

        const message =
          `🎉 Tier Purchased: ${TIER_CONFIG[tierId].name}!\n\n` +
          `Thank you for your support!\n\n` +
          `Click here to join our Telegram group: ${inviteLink.invite_link}\n` +
          `(Link expires in 24 hours)`;

        await sendTelegramNotification(telegramChatId, message);

        functions.logger.info(`Telegram invite sent to user ${telegramChatId}`);
      } catch (err) {
        console.error(
          `Failed to send Telegram invite to ${telegramChatId}:`,
          err.response?.data || err.message
        );
      }
    } else {
      console.log(
        `User ${userId} has no Telegram chatId. Web-only access for tier ${tierId}`
      );
    }

    // ✅ Send email confirmation
    await sendPaymentConfirmation(userId, donationId, tierId);

    // ✅ Update analytics
    await updateAnalytics("donation_completed", {
      tier: tierId,
      amount: TIER_CONFIG[tierId].amount,
      userId,
    });
  } catch (error) {
    console.error("Error processing successful payment:", error);
    throw error;
  }
}

async function handleFailedPayment(paymentIntent) {
  const { metadata } = paymentIntent;
  const { donationId, userId } = metadata;

  await admin
    .firestore()
    .collection("donations")
    .doc(donationId)
    .update({
      status: DONATION_STATUS.FAILED,
      failedAt: admin.firestore.FieldValue.serverTimestamp(),
      failureReason:
        paymentIntent.last_payment_error?.message || "Unknown error",
    });

  // Send failure notification
  await sendPaymentFailureNotification(userId, donationId);
}

async function handleRefund(charge) {
  const { metadata } = charge;
  const { donationId, userId, tierId } = metadata;

  const batch = admin.firestore().batch();

  // Update donation status
  const donationRef = admin.firestore().collection("donations").doc(donationId);
  const donationDoc = await donationRef.get();
  const donation = donationDoc.data();

  batch.update(donationRef, {
    status: DONATION_STATUS.REFUNDED,
    refundedAt: admin.firestore.FieldValue.serverTimestamp(),
    refundAmount: charge.amount_refunded / 100,
  });

  // Check if any instant payouts were made from this donation
  const instantPayouts = await admin
    .firestore()
    .collection("payouts")
    .where("donationId", "==", donationId)
    .where("payoutType", "==", "instant")
    .get();

  let totalInstantFees = 0;
  instantPayouts.forEach((doc) => {
    const payout = doc.data();
    totalInstantFees += payout.instantPayoutFee || 0;
  });

  // Revoke tier access
  const accessQuery = await admin
    .firestore()
    .collection("tierAccess")
    .where("donationId", "==", donationId)
    .where("active", "==", true)
    .get();

  accessQuery.forEach((doc) => {
    batch.update(doc.ref, {
      active: false,
      revokedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  // Remove tier from user
  const userRef = admin.firestore().collection("users").doc(userId);
  batch.update(userRef, {
    currentTiers: admin.firestore.FieldValue.arrayRemove(tierId),
  });

  await batch.commit();

  // Revoke Telegram access
  await revokeTelegramAccess(userId, tierId);

  // Send refund notification with instant fee info if applicable
  await sendRefundNotification(
    userId,
    donationId,
    charge.amount_refunded / 100,
    totalInstantFees
  );
}

// =====================================
// FREE ENTRY METHOD (AMOE)
// =====================================

/**
 * Process free entry submissions
 */
exports.processFreeEntry = functions.https.onCall(async (data, context) => {
  const { entryCode, email, mailingAddress, tier } = data;

  // Validate entry code (sent via mail)
  const entryDoc = await admin
    .firestore()
    .collection("freeEntries")
    .doc(entryCode)
    .get();

  if (!entryDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Invalid entry code");
  }

  const entry = entryDoc.data();

  if (entry.used) {
    throw new functions.https.HttpsError(
      "already-exists",
      "Entry code already used"
    );
  }

  if (entry.expiresAt.toMillis() < Date.now()) {
    throw new functions.https.HttpsError(
      "deadline-exceeded",
      "Entry code expired"
    );
  }

  // Validate tier
  if (!TIER_CONFIG[tier]) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Invalid tier selected"
    );
  }

  try {
    // Create or update user
    const userQuery = await admin
      .firestore()
      .collection("users")
      .where("email", "==", email)
      .limit(1)
      .get();

    let userId;
    if (userQuery.empty) {
      // Create new user
      const userRef = await admin.firestore().collection("users").add({
        email,
        mailingAddress,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        source: "free_entry",
      });
      userId = userRef.id;
    } else {
      userId = userQuery.docs[0].id;
    }

    // Process free entry as a "donation"
    const donationRef = await admin
      .firestore()
      .collection("donations")
      .add({
        userId,
        tier,
        amount: 0,
        payoutPercentage: TIER_CONFIG[tier].payoutPercentage, // Include payout percentage for free entries too
        isFreeEntry: true,
        entryCode,
        status: DONATION_STATUS.COMPLETED,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

    // Grant tier access
    await admin
      .firestore()
      .collection("tierAccess")
      .add({
        userId,
        tier,
        donationId: donationRef.id,
        isFreeEntry: true,
        grantedAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        active: true,
      });

    // Update user tiers
    await admin
      .firestore()
      .collection("users")
      .doc(userId)
      .update({
        currentTiers: admin.firestore.FieldValue.arrayUnion(tier),
      });

    // Mark entry as used
    await entryDoc.ref.update({
      used: true,
      usedAt: admin.firestore.FieldValue.serverTimestamp(),
      userId,
    });

    // Send confirmation
    await sendFreeEntryConfirmation(email, tier);

    return {
      success: true,
      message: "Free entry processed successfully",
      userId,
    };
  } catch (error) {
    console.error("Free entry processing error:", error);
    throw new functions.https.HttpsError(
      "internal",
      "Failed to process free entry"
    );
  }
});

// =====================================
// TELEGRAM ACCESS MANAGEMENT
// =====================================

async function grantTelegramAccess(userId, telegramUsername, tier) {
  const TelegramBot = require("node-telegram-bot-api");
  const bot = new TelegramBot(functions.config().telegram.bot_token, {
    polling: false,
  });

  try {
    // Generate invite link
    const groupId = TIER_CONFIG[tier].telegramGroupId;
    const inviteLink = await bot.createChatInviteLink(groupId, {
      member_limit: 1,
      expire_date: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours
    });

    // Store invite link
    await admin.firestore().collection("telegramInvites").add({
      userId,
      tier,
      telegramUsername,
      inviteLink: inviteLink.invite_link,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      used: false,
    });

    // Send invite via bot DM if possible
    try {
      await bot.sendMessage(
        `@${telegramUsername}`,
        `Welcome to Square Trivia ${TIER_CONFIG[tier].name}!\n\n` +
          `Click here to join: ${inviteLink.invite_link}\n\n` +
          `This link expires in 24 hours.`
      );
    } catch (dmError) {
      console.log(
        "Could not DM user, they need to start conversation with bot first"
      );
    }
  } catch (error) {
    console.error("Telegram access grant error:", error);
    // Don't throw - payment was successful even if Telegram fails
  }
}

async function revokeTelegramAccess(userId, tier) {
  // Implementation depends on Telegram bot capabilities
  // May need to maintain a member list and kick users
  console.log(`Revoking Telegram access for user ${userId} from tier ${tier}`);
}

// =====================================
// INSTANT PAYOUT PROCESSING
// =====================================

/**
 * Process instant payout for winners
 * Deducts 8% fee and processes immediately via Stripe
 */
async function processInstantPayout(winnerId, prizeAmount, tierInfo) {
  try {
    // Calculate payout after instant fee
    const instantFee = prizeAmount * INSTANT_PAYOUT_FEE;
    const payoutAmount = prizeAmount - instantFee;

    // Get winner's connected account info
    const winnerDoc = await admin
      .firestore()
      .collection("users")
      .doc(winnerId)
      .get();
    const winner = winnerDoc.data();

    if (!winner.stripeConnectedAccountId) {
      throw new Error("Winner does not have a connected Stripe account");
    }

    // Create instant payout via Stripe
    const payout = await stripe.payouts.create({
      amount: Math.round(payoutAmount * 100), // Convert to cents
      currency: "usd",
      method: "instant",
      destination: winner.stripeConnectedAccountId,
      metadata: {
        winnerId,
        originalPrize: prizeAmount.toString(),
        instantFee: instantFee.toString(),
        tier: tierInfo.tier,
        payoutType: "instant",
      },
    });

    // Record payout in database
    await admin.firestore().collection("payouts").add({
      winnerId,
      tier: tierInfo.tier,
      originalAmount: prizeAmount,
      instantPayoutFee: instantFee,
      finalAmount: payoutAmount,
      payoutType: "instant",
      stripePayout: payout.id,
      status: "completed",
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Update winner's instant payout stats
    await admin
      .firestore()
      .collection("users")
      .doc(winnerId)
      .update({
        totalInstantPayoutFees:
          admin.firestore.FieldValue.increment(instantFee),
        lastInstantPayout: admin.firestore.FieldValue.serverTimestamp(),
      });

    // Send instant payout confirmation
    await sendInstantPayoutConfirmation(winnerId, payoutAmount, instantFee);

    return {
      success: true,
      payoutId: payout.id,
      amount: payoutAmount,
      fee: instantFee,
    };
  } catch (error) {
    console.error("Instant payout processing error:", error);
    throw error;
  }
}

/**
 * Calculate instant payout amount after fee
 */
function calculateInstantPayout(prizeAmount) {
  const fee = prizeAmount * INSTANT_PAYOUT_FEE;
  return {
    originalAmount: prizeAmount,
    fee: fee,
    finalAmount: prizeAmount - fee,
  };
}

// =====================================
// EMAIL NOTIFICATIONS
// =====================================

async function sendPaymentConfirmation(userId, donationId, tier) {
  const userDoc = await admin.firestore().collection("users").doc(userId).get();
  const donationDoc = await admin
    .firestore()
    .collection("donations")
    .doc(donationId)
    .get();

  const user = userDoc.data();
  const donation = donationDoc.data();

  const mailOptions = {
    to: user.email,
    subject: `Payment Confirmed - ${TIER_CONFIG[tier].name} Access`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #0066FF; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background-color: #f5f5f5; padding: 20px; border-radius: 0 0 10px 10px; }
    .info-box { background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0; }
    .button { background-color: #0066FF; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Payment Confirmed! 🎉</h1>
    </div>
    <div class="content">
      <p>Thank you for supporting Square Trivia!</p>
      
      <div class="info-box">
        <h3>Your Access Details:</h3>
        <p><strong>Tier:</strong> ${TIER_CONFIG[tier].name}</p>
        <p><strong>Amount:</strong> $${TIER_CONFIG[tier].amount}</p>
        <p><strong>Access Period:</strong> 30 days</p>
        ${donation.telegramUsername ? `<p><strong>Telegram Username:</strong> @${donation.telegramUsername}</p>` : ""}
      </div>
      
      <h3>What's Next?</h3>
      <ol>
        <li>Check your Telegram messages for the group invite link</li>
        <li>If you haven't already, start a chat with @SquareTriviaBot</li>
        <li>Join the trivia challenges to earn squares!</li>
      </ol>
      
      <center>
        <a href="https://squaretrivia.com/dashboard" class="button">Go to Dashboard</a>
      </center>
      
      <div class="info-box" style="background-color: #FFF3CD; border: 1px solid #FFE69C;">
        <p><strong>Tax Information:</strong> Your donation may be tax-deductible. 
        You'll receive a tax receipt if your total donations exceed $250 this year.</p>
      </div>
      
      <p style="color: #666; font-size: 12px; margin-top: 20px;">
        Donation ID: ${donationId}<br>
        If you have any questions, contact support@squaretrivia.com
      </p>
    </div>
  </div>
</body>
</html>
    `,
  };

  await sendMail(mailOptions);
}

async function sendPaymentFailureNotification(userId, donationId) {
  const userDoc = await admin.firestore().collection("users").doc(userId).get();
  const user = userDoc.data();

  const mailOptions = {
    // from: "Square Trivia <noreply@squaretrivia.com>",
    to: user.email,
    subject: "Payment Failed - Square Trivia",
    html: `
      <h2>Payment Processing Failed</h2>
      <p>We were unable to process your payment for Square Trivia access.</p>
      <p>Common reasons for payment failure:</p>
      <ul>
        <li>Insufficient funds</li>
        <li>Card declined by bank</li>
        <li>Incorrect card information</li>
      </ul>
      <p>Please try again or use a different payment method.</p>
      <p>If you continue to experience issues, contact support@squaretrivia.com</p>
    `,
  };

  await sendMail(mailOptions);
}

async function sendRefundNotification(
  userId,
  donationId,
  amount,
  instantFees = 0
) {
  const userDoc = await admin.firestore().collection("users").doc(userId).get();
  const user = userDoc.data();

  const mailOptions = {
    // from: "Square Trivia <noreply@squaretrivia.com>",
    to: user.email,
    subject: "Refund Processed - Square Trivia",
    html: `
      <h2>Refund Confirmation</h2>
      <p>Your refund has been processed.</p>
      <p><strong>Amount:</strong> $${amount}</p>
      ${instantFees > 0 ? `<p><strong>Note:</strong> Instant payout fees of $${instantFees.toFixed(2)} are non-refundable.</p>` : ""}
      <p><strong>Processing Time:</strong> 5-10 business days</p>
      <p>Your tier access has been revoked. If this was a mistake, please contact support.</p>
      <p>Reference: ${donationId}</p>
    `,
  };

  await sendMail(mailOptions);
}

async function sendFreeEntryConfirmation(email, tier) {
  const mailOptions = {
    // from: "Square Trivia <noreply@squaretrivia.com>",
    to: email,
    subject: `Free Entry Confirmed - ${TIER_CONFIG[tier].name} Access`,
    html: `
      <h2>Free Entry Confirmed!</h2>
      <p>Your free entry has been processed successfully.</p>
      <p>You now have access to the ${TIER_CONFIG[tier].name} for 30 days.</p>
      <p>Visit <a href="https://squaretrivia.com">squaretrivia.com</a> to get started!</p>
    `,
  };

  await sendMail(mailOptions);
}

async function sendInstantPayoutConfirmation(
  winnerId,
  payoutAmount,
  instantFee
) {
  const userDoc = await admin
    .firestore()
    .collection("users")
    .doc(winnerId)
    .get();
  const user = userDoc.data();

  const mailOptions = {
    // from: "Square Trivia <noreply@squaretrivia.com>",
    to: user.email,
    subject: "Instant Payout Processed - Square Trivia",
    html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #00D632; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background-color: #f5f5f5; padding: 20px; border-radius: 0 0 10px 10px; }
    .info-box { background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0; }
    .fee-box { background-color: #FFF3CD; border: 1px solid #FFE69C; padding: 15px; border-radius: 8px; margin: 15px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Instant Payout Sent! 💸</h1>
    </div>
    <div class="content">
      <p>Great news! Your instant payout has been processed and is on its way to your account.</p>
      
      <div class="info-box">
        <h3>Payout Details:</h3>
        <p><strong>Original Prize:</strong> $${(payoutAmount + instantFee).toFixed(2)}</p>
        <p><strong>Instant Processing Fee (8%):</strong> -$${instantFee.toFixed(2)}</p>
        <hr style="border: 1px solid #eee;">
        <p><strong>Amount Sent:</strong> $${payoutAmount.toFixed(2)}</p>
        <p><strong>Arrival Time:</strong> Within minutes</p>
      </div>
      
      <div class="fee-box">
        <p><strong>Why the fee?</strong> The 8% instant payout fee covers the cost of immediate transfer processing. 
        You can always choose standard batch payouts (Tuesday/Friday) to receive the full prize amount with no fees.</p>
      </div>
      
      <p style="color: #666; font-size: 12px; margin-top: 20px;">
        If you have any questions about your payout, contact support@squaretrivia.com
      </p>
    </div>
  </div>
</body>
</html>
    `,
  };

  await sendMail(mailOptions);
}

// =====================================
// REFUND PROCESSING
// =====================================

/**
 * Process refund requests (admin only)
 */
exports.processRefund = functions.https.onCall(async (data, context) => {
  // Verify admin
  if (!context.auth?.token?.admin) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Admin access required"
    );
  }

  const { donationId, reason } = data;

  // Get donation record
  const donationDoc = await admin
    .firestore()
    .collection("donations")
    .doc(donationId)
    .get();

  if (!donationDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Donation not found");
  }

  const donation = donationDoc.data();

  if (donation.status !== DONATION_STATUS.COMPLETED) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Can only refund completed donations"
    );
  }

  try {
    // Create Stripe refund
    const refund = await stripe.refunds.create({
      charge: donation.stripeChargeId,
      reason: "requested_by_customer",
      metadata: {
        donationId,
        adminId: context.auth.uid,
        reason,
      },
    });

    // Log refund
    await admin
      .firestore()
      .collection("refunds")
      .add({
        donationId,
        stripeRefundId: refund.id,
        amount: refund.amount / 100,
        reason,
        processedBy: context.auth.uid,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    return {
      success: true,
      refundId: refund.id,
      amount: refund.amount / 100,
    };
  } catch (error) {
    console.error("Refund processing error:", error);
    throw new functions.https.HttpsError(
      "internal",
      "Refund processing failed"
    );
  }
});

// =====================================
// INSTANT PAYOUT REQUEST HANDLER
// =====================================

/**
 * Handle instant payout request from winner
 */
exports.requestInstantPayout = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "User must be authenticated"
    );
  }

  const { gameId, prizeAmount } = data;
  const userId = context.auth.uid;

  try {
    // Verify user is the winner of this game
    const gameDoc = await admin
      .firestore()
      .collection("games")
      .doc(gameId)
      .get();
    if (!gameDoc.exists) {
      throw new functions.https.HttpsError("not-found", "Game not found");
    }

    const game = gameDoc.data();
    if (game.winnerId !== userId) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "You are not the winner of this game"
      );
    }

    if (game.status === "completed") {
      throw new functions.https.HttpsError(
        "already-exists",
        "Payout already processed"
      );
    }

    // Get tier info
    const tierInfo = {
      tier: game.tier,
      payoutPercentage: TIER_CONFIG[game.tier].payoutPercentage,
    };

    // Process instant payout
    const result = await processInstantPayout(userId, prizeAmount, tierInfo);

    // Update game with payout info
    await gameDoc.ref.update({
      status: "completed",
      payoutType: "instant",
      payoutId: result.payoutId,
      instantPayoutFee: result.fee,
      finalPayoutAmount: result.amount,
      payoutProcessedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      message: "Instant payout processed successfully",
      amount: result.amount,
      fee: result.fee,
    };
  } catch (error) {
    console.error("Instant payout request error:", error);
    throw new functions.https.HttpsError(
      "internal",
      "Failed to process instant payout"
    );
  }
});

// =====================================
// TIER ACCESS VERIFICATION
// =====================================

/**
 * Check if user has active access to a tier
 */
exports.verifyTierAccess = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "User must be authenticated"
    );
  }

  const { tier } = data;
  const userId = context.auth.uid;

  const accessQuery = await admin
    .firestore()
    .collection("tierAccess")
    .where("userId", "==", userId)
    .where("tier", "==", tier)
    .where("active", "==", true)
    .get();

  let hasAccess = false;
  let expiresAt = null;

  accessQuery.forEach((doc) => {
    const access = doc.data();
    if (access.expiresAt.toMillis() > Date.now()) {
      hasAccess = true;
      expiresAt = access.expiresAt;
    }
  });

  return {
    hasAccess,
    expiresAt: expiresAt ? expiresAt.toMillis() : null,
    tier,
  };
});

/**
 * Grant Telegram access for existing user who adds it later
 */
exports.grantTelegramAccessForTier = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "User must be authenticated"
      );
    }

    const { userId, tier, telegramUsername } = data;

    // Verify the requesting user is the same as userId or is admin
    if (context.auth.uid !== userId && !context.auth.token.admin) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Cannot modify another user"
      );
    }

    try {
      // Verify user has active access to this tier
      const hasAccess = await verifyUserTierAccess(userId, tier);
      if (!hasAccess) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "No active access to this tier"
        );
      }

      // Grant Telegram access
      await grantTelegramAccess(userId, telegramUsername, tier);

      return {
        success: true,
        message: `Telegram access granted for ${TIER_CONFIG[tier].name}`,
      };
    } catch (error) {
      console.error("Grant Telegram access error:", error);
      throw new functions.https.HttpsError(
        "internal",
        "Failed to grant Telegram access"
      );
    }
  }
);

// Helper function for verifying tier access
async function verifyUserTierAccess(userId, tier) {
  const accessQuery = await admin
    .firestore()
    .collection("tierAccess")
    .where("userId", "==", userId)
    .where("tier", "==", tier)
    .where("active", "==", true)
    .get();

  for (const doc of accessQuery.docs) {
    const access = doc.data();
    if (access.expiresAt.toMillis() > Date.now()) {
      return true;
    }
  }

  return false;
}

// =====================================
// UTILITIES
// =====================================

async function checkRateLimit(key, limit, windowSeconds) {
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;

  const attemptsRef = admin.firestore().collection("rateLimits").doc(key);
  const doc = await attemptsRef.get();

  let attempts = [];
  if (doc.exists) {
    attempts = doc.data().attempts || [];
  }

  // Filter out old attempts
  attempts = attempts.filter((timestamp) => timestamp > windowStart);

  if (attempts.length >= limit) {
    const oldestAttempt = Math.min(...attempts);
    const retryAfter = Math.ceil(
      (oldestAttempt + windowSeconds * 1000 - now) / 60000
    );

    return {
      allowed: false,
      retryAfter,
    };
  }

  // Add current attempt
  attempts.push(now);
  await attemptsRef.set({ attempts }, { merge: true });

  return { allowed: true };
}

async function updateAnalytics(event, data) {
  await admin.firestore().collection("analytics").add({
    event,
    data,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });
}

// =====================================
// SCHEDULED CLEANUP
// =====================================

/**
 * Clean up expired tier access daily
 */
exports.cleanupExpiredAccess = functions.pubsub
  .schedule("every 24 hours")
  .onRun(async (context) => {
    const now = admin.firestore.Timestamp.now();

    const expiredQuery = await admin
      .firestore()
      .collection("tierAccess")
      .where("active", "==", true)
      .where("expiresAt", "<", now)
      .get();

    const batch = admin.firestore().batch();
    const usersToUpdate = new Set();

    expiredQuery.forEach((doc) => {
      const access = doc.data();

      batch.update(doc.ref, {
        active: false,
        expiredAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      usersToUpdate.add({
        userId: access.userId,
        tier: access.tier,
      });
    });

    // Update user tier lists
    for (const { userId, tier } of usersToUpdate) {
      const userRef = admin.firestore().collection("users").doc(userId);
      batch.update(userRef, {
        currentTiers: admin.firestore.FieldValue.arrayRemove(tier),
      });
    }

    await batch.commit();

    console.log(`Cleaned up ${expiredQuery.size} expired tier accesses`);
  });

module.exports = {
  sendMail,
  handleSuccessfulPayment,
  handleFailedPayment,
  handleRefund,
  grantTelegramAccess,
  sendMail,
};
