const functions = require("firebase-functions");
const { onRequest, onCall } = require("firebase-functions/v2/https");
const { validateTelegramUsername } = require("./utility-functions-fixed");
const admin = require("firebase-admin");
const { grantTelegramAccess } = require("./payment-system-modified");
const { verifyUserTierAccess } = require("./trivia-system-fixed");
const { default: axios } = require("axios");
// import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
const { logger } = require("firebase-functions");
const { GAME_CONFIG } = require("./constants-configuration-fixed");
const {
  BoardGoingFastPost,
  LastChancePost,
  BoardFullAnnouncementPost,
  FinalCallPost,
  TierStatusUpdatePost,
  UpcomingGamePost,
} = require("./social-posts-functions");
const { generateImage } = require("./backend-game-functions");
const { getShortCode } = require("./utils");

const db = admin.firestore();
require("dotenv").config();

// User Data Collection & Monetization System

// =====================================
// ENHANCED USER PROFILE SCHEMA
// =====================================

const enhancedUserSchema = {
  // Basic Info (already collecting)
  email: "user@example.com",
  telegramUsername: "@username",
  createdAt: "Timestamp",

  // Financial Profile
  totalDonations: 0,
  lifetimeValue: 0,
  averageDonation: 0,
  preferredTiers: ["100", "250"],
  lastDonation: "Timestamp",
  churnRisk: "low", // low, medium, high

  // Game Preferences
  favoriteTeams: {
    NFL: ["Chiefs", "Bills"],
    NBA: ["Lakers"],
    NCAA_FB: ["Alabama"],
    NCAA_BB: ["Duke"],
  },
  sportsEngagement: {
    NFL: { gamesPlayed: 45, winRate: 0.22 },
    NBA: { gamesPlayed: 23, winRate: 0.25 },
    NCAA_FB: { gamesPlayed: 12, winRate: 0.18 },
    NCAA_BB: { gamesPlayed: 8, winRate: 0.31 },
  },

  // Behavioral Data
  lastActive: "Timestamp",
  loginFrequency: "weekly", // daily, weekly, monthly
  notificationPreferences: {
    email: true,
    telegram: true,
    sms: false,
    marketing: true, // KEY for monetization
  },

  // Geographic/Demographic
  location: {
    city: "Dallas",
    state: "TX",
    country: "US",
    timezone: "America/Chicago",
  },
  estimatedAge: "25-34", // Based on game choices

  // Engagement Metrics
  referralCode: "MIKE123",
  referredUsers: 3,
  socialShares: 12,
  supportTickets: 0,

  // Monetization Flags
  segments: ["high_roller", "nfl_enthusiast", "playoff_player"],
  partnerOffers: {
    draftkings: { eligible: true, converted: false },
    fanduel: { eligible: true, converted: false },
    youtubetv: { eligible: false, converted: false },
  },
};

const TELEGRAM_BOT_TOKEN = "7718801037:AAEV4HynXs0vdMTDFcVtVphzFU1PpaLooAQ";

// Helper: send Telegram message
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

const API_SPORTS_CONFIG = {
  NFL: {
    endpoint: "/v3/nfl/scores/json/ScoresByWeek",
    leagueId: 1,
  },
  CFB: {
    endpoint: "/v3/cfb/scores/json/GamesByWeek",
  },
};
// =====================================
// DATA COLLECTION FUNCTIONS
// =====================================

// Track every user action
exports.trackUserEvent = functions.https.onCall(async (data, context) => {
  if (!context.auth) return;

  const { eventType, eventData } = data;
  const userId = context.auth.uid;

  // Record raw event
  await db.collection("userEvents").add({
    userId,
    eventType,
    eventData,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    sessionId: context.auth.token.sessionId,
    ip: context.rawRequest.ip,
  });

  // Update user profile based on event
  await updateUserProfile(userId, eventType, eventData);
});

/**
 * Internal helper: safely grant Telegram access for a user & tier
 */
/**
 * Internal helper: safely grant Telegram access for a user & tier
 */
async function handleGrantTelegramAccess(userId, telegramUsername, tier) {
  try {
    // Step 1: Verify user has access to the tier
    const hasAccess = await verifyUserTierAccess(userId, tier);
    if (!hasAccess) {
      console.warn(
        `User ${userId} does not have access to tier ${tier}, skipping Telegram grant`
      );
      return { success: false, message: "No active access to this tier" };
    }

    // Step 2: Grant access (re-uses your existing function)
    await grantTelegramAccess(userId, telegramUsername, tier);

    // Step 3: Return result for logging
    return {
      success: true,
      message: `Telegram access granted for tier ${tier}`,
    };
  } catch (err) {
    console.error(
      `Failed to grant Telegram access for user ${userId}, tier ${tier}:`,
      err
    );
    return { success: false, message: err.message || "Grant failed" };
  }
}
async function handleGameCommand(chatId) {
  const gamesSnapshot = await admin.firestore().collection("games").get();

  if (gamesSnapshot.empty) {
    await sendTelegramNotification(chatId, "No games available at the moment.");
    return;
  }

  const promises = [];

  gamesSnapshot.forEach((doc) => {
    const game = doc.data();
    let formattedDate = "";
    if (game.gameDate && game.gameDate.toDate) {
      formattedDate = game.gameDate.toDate().toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    }

    const message =
      `📅 Game Date: ${formattedDate}\n` +
      `🏟 Sports: ${game.sport}\n` +
      `🏠 Home Team: ${game.teams.home || "TBD"}\n` +
      `🛫 Away Team: ${game.teams.away || "TBD"}`;

    promises.push(sendTelegramNotification(chatId, message));
  });

  await Promise.all(promises);
}

async function handleWinCommand(chatId) {
  const userSnapshot = await admin
    .firestore()
    .collection("users")
    .where("telegramChatId", "==", chatId)
    .limit(1)
    .get();

  if (userSnapshot.empty) {
    await sendTelegramNotification(
      chatId,
      "⚠️ User not linked. Please start again with /start <userId>."
    );
    return;
  }

  const userId = userSnapshot.docs[0].id;

  const winsSnapshot = await admin
    .firestore()
    .collection("winners")
    .where("userId", "==", userId)
    .get();

  if (winsSnapshot.empty) {
    await sendTelegramNotification(chatId, "❌ You don’t have any wins yet.");
    return;
  }

  const messages = [];

  for (const doc of winsSnapshot.docs) {
    const win = doc.data();

    let formattedDate = "";
    if (win.createdAt?.toDate) {
      formattedDate = win.createdAt.toDate().toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    }

    // 🔍 Fetch related game from "games" collection
    let gameInfo = "";
    if (win.gameId) {
      const gameDoc = await admin
        .firestore()
        .collection("games")
        .doc(win.gameId)
        .get();

      if (gameDoc.exists) {
        const gameData = gameDoc.data();
        gameInfo = `${gameData?.teams?.home} 🆚 ${gameData?.teams?.away}`;
      }
    }

    const msg =
      `🏆 Win Details\n` +
      `📅 Date: ${formattedDate}\n` +
      (gameInfo ? `🎮 Game: ${gameInfo}\n` : "") +
      `🎯 Position: ${win.position}\n` +
      `👤 Solo Win: ${win.isSoloWin ? "Yes" : "No"}\n` +
      `📌 Status: ${win.status}`;

    messages.push(msg);
  }

  await sendTelegramNotification(chatId, messages.join("\n\n"));
}

async function handleStatusCommand(chatId) {
  const userSnapshot = await admin
    .firestore()
    .collection("users")
    .where("telegramChatId", "==", chatId)
    .limit(1)
    .get();

  if (userSnapshot.empty) {
    await sendTelegramNotification(
      chatId,
      "⚠️ User not linked. Please start again with /start <userId>."
    );
    return;
  }

  const userData = userSnapshot.docs[0].data();
  const tiers = userData.currentTiers || [];

  if (tiers.length === 0) {
    await sendTelegramNotification(
      chatId,
      "ℹ️ You are not subscribed to any tier."
    );
    return;
  }

  // Format tiers nicely (convert "tier_100" → "Tier 100")
  const tierList = tiers
    .map((t, i) => `#${i + 1}: ${t.replace("tier_", "Tier ")}`)
    .join("\n");

  const message =
    `📊 Your Current Tiers:\n\n${tierList}\n\n` +
    `Keep playing and climbing up the tiers! 🚀`;

  await sendTelegramNotification(chatId, message);
}

async function handleSquaresCommand(chatId) {
  const userSnapshot = await admin
    .firestore()
    .collection("users")
    .where("telegramChatId", "==", chatId)
    .limit(1)
    .get();

  if (userSnapshot.empty) {
    await sendTelegramNotification(
      chatId,
      "⚠️ User not linked. Please start again with /start <userId>."
    );
    return;
  }

  const userId = userSnapshot.docs[0].id;

  // Get all boards
  const boardsSnapshot = await admin.firestore().collection("boards").get();

  let userSquares = [];

  boardsSnapshot.forEach((boardDoc) => {
    const boardData = boardDoc.data();
    const squares = boardData.squares || {};

    // squares is a map (keys: "0", "1", ...)
    Object.values(squares).forEach((square) => {
      const claims = square.claims || [];
      claims.forEach((claim) => {
        if (claim.userId === userId) {
          let claimedAtFormatted = "";
          if (claim.claimedAt?.toDate) {
            claimedAtFormatted = claim.claimedAt
              .toDate()
              .toLocaleString("en-US");
          }

          userSquares.push(
            `🟩 Square Claim\n` +
              `🆔 Token: ${claim.tokenId}\n` +
              `⏱️ Answer Time: ${Number(claim.answerTime || 0).toFixed(3)}ms\n` +
              `📅 Claimed At: ${claimedAtFormatted}\n` +
              `🏟 Sports: ${boardData?.gameInfo?.sport}\n` +
              `🏠 Home Team: ${boardData?.gameInfo?.teams?.home || "TBD"}\n` +
              `🛫 Away Team: ${boardData?.gameInfo?.teams?.away || "TBD"}\n`
          );
        }
      });
    });
  });

  if (userSquares.length === 0) {
    await sendTelegramNotification(
      chatId,
      "❌ You have not claimed any squares yet."
    );
    return;
  }

  // Combine all found squares into one message
  await sendTelegramNotification(chatId, userSquares.join("\n\n"));
}

async function handleReferCommand(chatId) {
  const userSnapshot = await admin
    .firestore()
    .collection("users")
    .where("telegramChatId", "==", chatId)
    .limit(1)
    .get();

  if (userSnapshot.empty) {
    await sendTelegramNotification(
      chatId,
      "⚠️ User not linked. Please start again with /start <userId>."
    );
    return;
  }

  const userData = userSnapshot.docs[0].data();
  const referralCode = userData.referralCode || "❌ Not available";

  await sendTelegramNotification(
    chatId,
    `🎉 *Your Referral Code*\n\n🔑 Code: ${referralCode}\n\n📢 Share this code with friends and earn exciting rewards when they join!`
  );
}

async function handleHelpCommand(chatId) {
  const userSnapshot = await admin
    .firestore()
    .collection("users")
    .where("telegramChatId", "==", chatId)
    .limit(1)
    .get();

  if (userSnapshot.empty) {
    await sendTelegramNotification(
      chatId,
      "⚠️ User not linked. Please start again with /start <userId>."
    );
    return;
  }

  await sendTelegramNotification(
    chatId,
    `📌 *SquareTrivia Support*\n\n` +
      `📧 Email: support@squaretrivia.com\n` +
      `💬 Telegram: @SquareTriviaSupport\n` +
      `📖 Documentation: [docs.squaretrivia.com](https://docs.squaretrivia.com)\n\n` +
      `If you need any assistance, feel free to reach out to us through the above channels. We’re here to help! 🤝`
  );
}

async function handlePayoutCommand(chatId) {
  const userSnapshot = await admin
    .firestore()
    .collection("users")
    .where("telegramChatId", "==", chatId)
    .limit(1)
    .get();

  if (userSnapshot.empty) {
    await sendTelegramNotification(
      chatId,
      "⚠️ User not linked. Please start again with /start <userId>."
    );
    return;
  }

  const userId = userSnapshot.docs[0].id;

  const winsSnapshot = await admin
    .firestore()
    .collection("winners")
    .where("userId", "==", userId)
    .get();

  if (winsSnapshot.empty) {
    await sendTelegramNotification(
      chatId,
      "❌ You don’t have any payouts yet."
    );
    return;
  }

  const messages = [];

  for (const doc of winsSnapshot.docs) {
    const win = doc.data();

    let formattedDate = "";
    if (win.createdAt?.toDate) {
      formattedDate = win.createdAt.toDate().toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    }

    // 🔍 Fetch related game from "games" collection
    let gameInfo = "";
    if (win.gameId) {
      const gameDoc = await admin
        .firestore()
        .collection("games")
        .doc(win.gameId)
        .get();

      if (gameDoc.exists) {
        const gameData = gameDoc.data();
        gameInfo = `${gameData?.teams?.home} 🆚 ${gameData?.teams?.away}`;
      }
    }

    const msg =
      `💸 Payout Details\n` +
      `📅 Date: ${formattedDate}\n` +
      (gameInfo ? `🎮 Game: ${gameInfo}\n` : "") +
      `📌 Status: ${win.status}`;

    messages.push(msg);
  }

  await sendTelegramNotification(chatId, messages.join("\n\n"));
}

exports.addTelegramToAccount = functions.https.onCall(async (data, context) => {
  console.log(data, "dataCcQCCCAQ   ");
  const { userId, telegramUsername } = data;

  console.log("addTelegramToAccount called", { userId, telegramUsername });

  // Optional: check authentication
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "User must be authenticated."
    );
  }
  console.log("context.auth.uid", context.auth.uid, userId);
  // Optional: validate userId matches authenticated user
  if (context.auth.uid !== userId) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Cannot add Telegram for another user."
    );
  }

  try {
    // Validate telegram username
    const validation = validateTelegramUsername(telegramUsername);
    if (!validation.valid || validation.isEmpty) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        validation.error || "Please enter a valid Telegram username"
      );
    }

    const userRef = db.collection("users").doc(userId);
    console.log("userRef....!....", userRef);

    const userDoc = await userRef.get();
    const userData = userDoc.data() || {};

    const updates = {
      telegramUsername: validation.value,
      hasTelegram: true,
      preferredNotificationMethod: "both",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    let addedExtraAttempts = false;

    // ✅ Only adjust if they are adding Telegram for the first time
    if (!userData.hasTelegram && !userData.telegramUsername) {
      const currentAttempts = userData.dailyTriviaAttempts || 0;

      // Cap at 10 for Telegram users
      const newAttempts = Math.min(currentAttempts + 5, 10);

      updates.dailyTriviaAttempts = newAttempts;
      addedExtraAttempts = true;
    } else {
      // Just make sure they’re not above the cap
      const currentAttempts = userData.dailyTriviaAttempts || 0;
      const maxAllowed = telegramUsername ? 10 : 5;

      if (currentAttempts > maxAllowed) {
        updates.dailyTriviaAttempts = maxAllowed;
      }
    }

    // Save updates
    await userRef.set(updates, { merge: true });

    // Grant Telegram access for active tiers
    // 🔑 Instead of httpsCallable, use the helper directly
    // 🔑 Instead of httpsCallable, use the helper directly
    if (userData.currentTiers && userData.currentTiers.length > 0) {
      for (const tier of userData.currentTiers) {
        await handleGrantTelegramAccess(userId, telegramUsername, tier);
      }
    }

    return {
      success: true,
      message: addedExtraAttempts
        ? "Telegram added successfully! +5 daily attempts unlocked 🎉"
        : "Telegram updated successfully.",
      benefits: {
        extraAttempts: addedExtraAttempts ? 5 : 0,
        instantNotifications: true,
        communityAccess: true,
      },
    };
  } catch (error) {
    console.error("Add Telegram error:", error);
    throw new functions.https.HttpsError("internal", error.message);
  }
});

exports.telegramWebhook = functions.https.onRequest(async (req, res) => {
  const body = req.body;

  if (!body || !body.message) {
    return res.send("ok");
  }
  logger.info("Incoming update", { body: req.body });

  const msg = body.message;
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!msg) {
    logger.warn("No message in update", { update: req.body });
    return res.send("ok");
  }

  logger.debug("Chat ID extracted", { chatId });
  logger.debug("MESSAGE", { msg });

  if (text && text.startsWith("/start")) {
    const parts = text.split(" ");
    const userId = parts[1];

    if (userId) {
      // Case 1: /start <userId>
      try {
        await admin.firestore().collection("users").doc(userId).update({
          telegramChatId: chatId,
        });

        await sendTelegramNotification(
          chatId,
          "✅ Bot Connected Successfully!"
        );
      } catch (error) {
        await sendTelegramNotification(
          chatId,
          "⚠️ Failed to connect bot. Please try again."
        );
      }
    } else {
      // Case 2: just /start
      const usersRef = admin.firestore().collection("users");
      const snap = await usersRef
        .where("telegramChatId", "==", chatId)
        .limit(1)
        .get();

      if (!snap.empty) {
        await sendTelegramNotification(chatId, "👋 Hello, how can I help you?");
      } else {
        await sendTelegramNotification(
          chatId,
          "⚠️ Hello! Please register on our website to connect your account."
        );
      }
    }
  }

  if (text && text.startsWith("/games")) {
    await handleGameCommand(chatId);
  }
  if (text && text.startsWith("/wins")) {
    await handleWinCommand(chatId);
  }
  if (text && text.startsWith("/status")) {
    await handleStatusCommand(chatId);
  }
  if (text && text.startsWith("/squares")) {
    await handleSquaresCommand(chatId);
  }
  if (text && text.startsWith("/refer")) {
    await handleReferCommand(chatId);
  }
  if (text && text.startsWith("/help")) {
    await handleHelpCommand(chatId);
  }
  if (text && text.startsWith("/payout")) {
    await handlePayoutCommand(chatId);
  }

  res.send("ok");
});

// Cloud function triggered every 3 hours (Alert for trivia question availability)
exports.sendTriviaAttemptNotifications = functions.pubsub
  .schedule("every 3 hours")
  .timeZone("UTC")
  .onRun(async (context) => {
    const usersSnapshot = await admin.firestore().collection("users").get();

    const promises = [];

    usersSnapshot.forEach((doc) => {
      const user = doc.data();
      const attempts = user.dailyTriviaAttempts ?? 0;
      const chatId = user.telegramChatId;

      // ✅ Only send if user has telegramChatId
      if (chatId && user?.notifications?.telegram) {
        let message = "";
        if (attempts > 0) {
          message = `You have ${attempts} daily trivia attempts left. 🎯`;
        } else {
          message =
            "You have 0 attempts left. Please check again after midnight. ⏰";
        }

        promises.push(sendTelegramNotification(chatId, message));
      }
    });

    await Promise.all(promises);
    console.log(
      "Trivia attempt notifications sent to all users with Telegram."
    );
  });

// Cloud function triggered every 3 hours (Alert for Game start Reminders)
exports.sendGameReminders = functions.pubsub
  .schedule("every 3 hours")
  .timeZone("UTC")
  .onRun(async (context) => {
    const now = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(now.getDate() + 1);

    const gamesSnapshot = await admin.firestore().collection("games").get();

    const promises = [];

    gamesSnapshot.forEach((doc) => {
      const game = doc.data();

      // Ensure gameDate exists
      if (!game.gameDate) return;

      const gameDate = game.gameDate.toDate
        ? game.gameDate.toDate()
        : new Date(game.gameDate);

      if (
        gameDate.toDateString() !== now.toDateString() &&
        gameDate.toDateString() !== tomorrow.toDateString()
      ) {
        return;
      }

      const message =
        `📢 Game Reminder!\n` +
        `📅 Date: ${gameDate.toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })}\n` +
        `🏟 Sport: ${game.sport}\n` +
        `🏠 Home: ${game.teams?.home}\n` +
        `🛫 Away: ${game.teams?.away}`;

      // Send to all users with Telegram
      promises.push(
        admin
          .firestore()
          .collection("users")
          .where("telegramChatId", "!=", null)
          .get()
          .then((usersSnapshot) => {
            const userPromises = [];
            usersSnapshot.forEach((userDoc) => {
              const chatId = userDoc.data().telegramChatId;
              if (chatId && userDoc.data()?.notifications?.telegram) {
                userPromises.push(sendTelegramNotification(chatId, message));
              }
            });
            return Promise.all(userPromises);
          })
      );
    });

    await Promise.all(promises);
  });

exports.sendPayoutMessages = functions.pubsub
  .schedule("every 5 minutes")
  .onRun(async (context) => {
    try {
      logger.info("Hello Payout Function");
      const winnersSnap = await db
        .collection("winners")
        .where("status", "==", "completed")
        .get();

      const pendingDocs = winnersSnap.docs.filter(
        (doc) => !doc.data().isTelegramSend
      );

      if (pendingDocs.length === 0) {
        console.log(
          "No winners found with completed payout and unsent message."
        );
        return null;
      }

      const tasks = pendingDocs.map(async (winnerDoc) => {
        const winnerData = winnerDoc.data();
        const userId = winnerData.userId;

        if (!userId) {
          console.log(`Winner ${winnerDoc.id} has no userId`);
          return;
        }

        // Get user info
        const userSnap = await db.collection("users").doc(userId).get();
        if (!userSnap.exists) {
          console.log(`User ${userId} not found`);
          return;
        }

        const userData = userSnap.data();
        const chatId = userData.telegramChatId;

        if (!chatId) {
          console.log(`User ${userId} has no Telegram chatId`);
          return;
        }

        const gameId = winnerData.gameId;
        let message = "🎉 Congratulations! Your payout has been completed.";

        if (gameId) {
          const gameSnap = await db.collection("games").doc(gameId).get();
          if (gameSnap.exists) {
            const gameData = gameSnap.data();
            const teamA = gameData?.teams?.home || "Team A";
            const teamB = gameData?.teams?.away || "Team B";

            message = `🎉 Congratulations! Your payout for the game *${teamA} vs ${teamB}* has been completed 🏆\n\nEnjoy your winnings 🚀`;
          }
        }

        try {
          await sendTelegramNotification(chatId, message);

          console.log(`Message sent to ${userId} (${chatId})`);

          // Mark as sent
          await winnerDoc.ref.update({
            isTelegramSend: true,
            telegramSentAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        } catch (err) {
          console.error(`Failed to send Telegram message to ${chatId}`, err);
        }
      });

      await Promise.all(tasks);

      return null;
    } catch (error) {
      console.error("Error in sendPayoutMessages function:", error);
      return null;
    }
  });

exports.checkCancelledGames = functions.pubsub
  .schedule("every 5 minutes")
  .timeZone("America/Denver")
  .onRun(async (context) => {
    const db = admin.firestore();
    const now = new Date();
    const year = now.getFullYear();
    // const year = 2021;

    try {
      logger.info("checkCancelledGames started");

      // Get all games that are not cancelled
      const gamesSnap = await db
        .collection("games")
        .where("status", "!=", GAME_CONFIG.STATUS.CANCELLED)
        .get();

      logger.info(`📊 Found ${gamesSnap.size} non-cancelled games`);

      if (gamesSnap.empty) return;

      for (const gameDoc of gamesSnap.docs) {
        const game = gameDoc.data();
        const { externalGameId, week, sport } = game;
        if (!externalGameId) continue;

        logger.info(
          `🔎 Checking game ${gameDoc.id} (extId: ${externalGameId}, week: ${week}, sport: ${sport})`
        );

        let apiGame = null;

        if (sport === "NFL") {
          // --- NFL via API-Sports ---
          const config = API_SPORTS_CONFIG[sport];
          const url = `https://v1.american-football.api-sports.io/games?league=${config.leagueId}&season=${year}`;

          const res = await fetch(url, {
            headers: { "X-RapidAPI-Key": process.env.REACT_APP_APISPORTS_KEY },
          });
          const data = await res.json();
          const gamesList = data.response || [];

          logger.info(
            `📡 API returned ${gamesList.length} games for league ${config.leagueId}`
          );

          apiGame = gamesList.find(
            (g) => g.game.id.toString() === externalGameId.toString()
          );
        } else if (sport === "CFB") {
          // --- CFB via ESPN ---
          const url = `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard`;
          const res = await fetch(
            `${url}?week=${week}&year=${year}&seasontype=2`,
            { headers: { accept: "application/json" } }
          );
          const data = await res.json();

          const events = data.events || [];
          logger.info(`📡 ESPN returned ${events.length} games for CFB`);

          apiGame = events.find(
            (e) => e.id.toString() === externalGameId.toString()
          );

          // normalize ESPN -> API shape (so cancellation check works)
          if (apiGame) {
            apiGame = {
              game: {
                id: apiGame.id,
                status: {
                  long: apiGame.competitions?.[0]?.status?.type?.description,
                },
              },
            };
          }
        }

        logger.info("Game:", { apiGame });
        if (!apiGame) {
          logger.info(`⚠️ API did not return game ${externalGameId}`);
          continue;
        }

        // Check if the game is cancelled
        if (
          apiGame.game.status?.long === "Canceled" ||
          apiGame.game.status?.long === "Cancelled"
        ) {
          logger.info(`❌ Game ${gameDoc.id} is cancelled. Refunding tiers...`);

          const batch = db.batch();

          // 1. Mark game as cancelled
          batch.update(gameDoc.ref, {
            status: GAME_CONFIG.STATUS.CANCELLED,
            cancelledAt: getTimestamp(),
          });

          // 2. Refund tiers for all claims on this game's boards
          const boardsSnap = await db
            .collection("boards")
            .where("gameId", "==", gameDoc.id)
            .get();

          for (const boardDoc of boardsSnap.docs) {
            const board = boardDoc.data();
            const squares = board.squares || {};

            Object.values(squares).forEach((square) => {
              const claims = square.claims || [];
              claims.forEach((claim) => {
                const { userId, tierId } = claim;
                if (!userId || !tierId) return;

                const userRef = db.collection("users").doc(userId);
                batch.update(userRef, {
                  currentTiers: admin.firestore.FieldValue.arrayUnion(tierId),
                });
              });
            });
          }

          await batch.commit();

          // 3. Log
          await db.collection("systemLogs").add({
            type: "game_cancelled",
            gameId: gameDoc.id,
            externalGameId,
            refunded: true,
            timestamp: getTimestamp(),
          });

          logger.info(`✅ Refunded tiers for cancelled game ${gameDoc.id}`);
        }
      }
    } catch (error) {
      logger.error("Error in Checking Cancel Game: ", { error });
    }
  });

exports.checkBoardsFillingFast = functions.pubsub
  .schedule("every 5 minutes")
  .timeZone("America/Denver")
  .onRun(async (context) => {
    console.log("🚀 Checking boards filling fast...");

    const now = new Date();

    const gamesSnap = await db
      .collection("games")
      .where("status", "==", "active")
      .get();

    for (const gameDoc of gamesSnap.docs) {
      const gameId = gameDoc.id;
      const game = gameDoc.data();

      const team1 = game.teams?.home || "Home Team";
      const team2 = game.teams?.away || "Away Team";

      const startTime = game.startTime?.toDate
        ? game.startTime.toDate()
        : new Date(game.startTime);
      const timeDiffHrs = (startTime - now) / (1000 * 60 * 60);

      const currentQuarterNum = Number(game.currentQuarter) || 1;
      const boundedQuarter = Math.min(Math.max(currentQuarterNum, 1), 4);
      const quarterLabel = `Q${boundedQuarter}`;

      const boardsSnap = await db
        .collection("boards")
        .where("gameId", "==", gameId)
        .get();

      for (const boardDoc of boardsSnap.docs) {
        const board = boardDoc.data();
        logger.info("BOARD: ", { board });
        const boardId = boardDoc.id;

        const tierId = board.tierId || "unknown_tier";
        const totalSquares = 50;
        const claimedSquares = board.claimedSquares || 0;
        logger.info("TOTAL CLAIMS: ", { claimedSquares });
        const fillPercent = (claimedSquares / totalSquares) * 100;

        const postKey = `${gameId}_Q${boundedQuarter}_${tierId}_${boardId}`;
        const postRef = db.collection("fastFillPosts").doc(postKey);
        const existingPost = await postRef.get();

        const nowTs = admin.firestore.Timestamp.now();
        const postData = existingPost.exists ? existingPost.data() : {};
        const lastPostedAt = postData.lastTriggeredAt?.toDate?.() || null;
        const triggerCount = postData.triggerCount || 0;
        const timeSinceLastPost = lastPostedAt
          ? (now - lastPostedAt) / (1000 * 60)
          : Infinity;

        // Helper function to record a new post event
        async function recordPost(type, extraData = {}) {
          await postRef.set(
            {
              gameId,
              quarter: boundedQuarter,
              quarterLabel,
              tierId,
              boardId,
              fillPercent,
              type,
              triggerCount: admin.firestore.FieldValue.increment(1),
              lastTriggeredAt: admin.firestore.FieldValue.serverTimestamp(),
              postedAt: admin.firestore.FieldValue.serverTimestamp(),
              ...extraData,
            },
            { merge: true }
          );
        }

        // ---------------------------
        // 🎯 FULL BOARD ANNOUNCEMENT (once only)
        // ---------------------------
        if (fillPercent === 100 && postData.type !== "boardFull") {
          console.log(
            `🎯 [${gameId}] ${quarterLabel} - ${tierId} board FULL (${boardId})`
          );
          // 1. Generate dynamic image
          const formValues = {
            HTeam: getShortCode(team1) || "TBD",
            ATeam: getShortCode(team2) || "TBD",
            time: game.startTime.toDate().toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            }),
          };
          const selectedTemplate = "boardFull";
          const payload = {
            templateID: selectedTemplate,
            data: formValues,
            savePath: `savedimages/${gameId}/${boardId}/${selectedTemplate}.jpg`,
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
          await BoardFullAnnouncementPost({
            team1,
            team2,
            totalPrize: board.prizeAmount,
            mediaToUpload: imageUrl,
            captionLink: "https://squaretrivia.com",
          });

          await recordPost("boardFull");
          continue; // Skip rest once full
        }

        // ---------------------------
        // ⚡ FAST FILL (70%–99%) — trigger once only
        // ---------------------------
        if (
          fillPercent >= 70 &&
          fillPercent < 100 &&
          postData.type !== "fastFill"
        ) {
          console.log(
            `📣 [${gameId}] ${quarterLabel} - ${tierId} board ${fillPercent.toFixed(
              1
            )}% filled (fast fill alert)`
          );
          // 1. Generate dynamic image
          const formValues = {
            HTeam: getShortCode(team1) || "TBD",
            ATeam: getShortCode(team2) || "TBD",
            time: game.startTime.toDate().toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            }),
          };
          const selectedTemplate = "board70Full";
          const payload = {
            templateID: selectedTemplate,
            data: formValues,
            savePath: `savedimages/${gameId}/${boardId}/${selectedTemplate}.jpg`,
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
          await BoardGoingFastPost({
            team1,
            team2,
            tier: tierId,
            totalClaims: { total: totalSquares, claimed: claimedSquares },
            mediaToUpload: imageUrl,
            captionLink: "https://squaretrivia.com",
          });

          await recordPost("fastFill");
        }

        // ---------------------------
        // ⚠️ LAST CHANCE (<20%) — up to twice (2–3h before)
        // ---------------------------
        if (timeDiffHrs > 2 && timeDiffHrs <= 3 && triggerCount < 2) {
          console.log(
            `⚠️ [${gameId}] ${quarterLabel} - ${tierId} (${fillPercent.toFixed(
              1
            )}% filled) — Last Chance alert`
          );

          const spotsLeft = totalSquares - claimedSquares;
          // 1. Generate dynamic image
          const formValues = {
            HTeam: getShortCode(team1) || "TBD",
            ATeam: getShortCode(team2) || "TBD",
          };
          const selectedTemplate = "finalCall2Hrs";
          const payload = {
            templateID: selectedTemplate,
            data: formValues,
            savePath: `savedimages/${gameId}/${boardId}/${selectedTemplate}.jpg`,
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
          await LastChancePost({
            team1,
            team2,
            spotsLeft,
            highestTier: tierId,
            mediaToUpload: imageUrl,
            captionLink: "https://squaretrivia.com",
          });

          await recordPost("lastChance");
        }

        // ---------------------------
        // 📅 UPCOMING GAME (2–3 days before) — up to twice
        // ---------------------------
        if (
          timeDiffHrs >= 48 &&
          timeDiffHrs <= 72 &&
          triggerCount < 2 &&
          timeSinceLastPost >= 360 // 6 hours
        ) {
          console.log(
            `📅 [${gameId}] Upcoming Game — ${team1} vs ${team2} (${Math.round(
              timeDiffHrs / 24
            )} days)`
          );
          // 1. Generate dynamic image
          const formValues = {};
          const selectedTemplate = "2to3DaysOut"; // to be created
          const payload = {
            templateID: selectedTemplate,
            data: formValues,
            savePath: `savedimages/${gameId}/${boardId}/${selectedTemplate}.jpg`,
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
          try {
            await UpcomingGamePost({
              team1,
              team2,
              mediaToUpload:
                imageResult?.path ||
                "https://squaretrivia.com/apple-touch-icon.png",
              captionLink: "https://squaretrivia.com",
            });
            await recordPost("upcomingGame");
          } catch (err) {
            console.error("❌ Error posting upcoming game alert:", err);
          }
        }

        // ---------------------------
        // ⏰ FINAL CALL (1–2h before) — up to twice
        // ---------------------------
        if (
          timeDiffHrs > 1 &&
          timeDiffHrs <= 2 &&
          triggerCount < 2 &&
          timeSinceLastPost >= 30
        ) {
          console.log(
            `⏰ [${gameId}] Final Call — ${team1} vs ${team2} starts in ${timeDiffHrs.toFixed(
              1
            )}h`
          );

          const squaresLeft = totalSquares - claimedSquares;
          // 1. Generate dynamic image
          const formValues = {
            HTeam: getShortCode(team1) || "TBD",
            ATeam: getShortCode(team2) || "TBD",
          };
          const selectedTemplate = "finalCall2Hrs";
          const payload = {
            templateID: selectedTemplate,
            data: formValues,
            savePath: `savedimages/${gameId}/${boardId}/${selectedTemplate}.jpg`,
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
          await FinalCallPost({
            team1,
            team2,
            timeLeft: `${Math.round(timeDiffHrs * 60)} minutes`,
            squaresLeft,
            mediaToUpload: imageUrl,
            captionLink: "https://squaretrivia.com",
          });

          await recordPost("finalCall");
        }

        // ---------------------------
        // 💎 PREMIUM TIER STATUS UPDATES — once per quarter
        // ---------------------------
        const premiumTiers = ["tier_100", "tier_250", "tier_500", "tier_1000"];

        if (
          premiumTiers.includes(tierId) &&
          fillPercent >= 70 &&
          fillPercent < 100 &&
          postData.type !== "tierStatusUpdate"
        ) {
          const tierDocs = await db
            .collection("boards")
            .where("gameId", "==", gameId)
            .where("tierId", "in", premiumTiers)
            .get();

          const tiers = tierDocs.docs.map((doc) => {
            const d = doc.data();
            const total = d.totalSquares || 100;
            const claimed = d.claimedSquares || 0;
            const left = total - claimed;
            return { tier: Number(d.tierId.replace("tier_", "")), left };
          });

          tiers.sort((a, b) => b.tier - a.tier);
          // 1. Generate dynamic image
          const formValues = {};
          const selectedTemplate = "tirerStatusUpdate"; // to be created
          const payload = {
            templateID: selectedTemplate,
            data: formValues,
            savePath: `savedimages/${gameId}/${boardId}/${selectedTemplate}.jpg`,
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
          await TierStatusUpdatePost({
            team1,
            team2,
            tiers,
            mediaToUpload: imageUrl,
            captionLink: "https://squaretrivia.com",
          });

          await recordPost("tierStatusUpdate", { tiersSnapshot: tiers });
        }
      }
    }

    console.log("✅ All active games checked and processed.");
    return null;
  });

async function sendTelegramNotification(chatId, message) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message }),
  });
}

exports.setAdminClaim = functions.https.onCall(async (data, context) => {
  const { uid } = data;

  if (!uid) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "User UID is required"
    );
  }

  try {
    // Temporarily allow anyone to call this for the first admin
    // ⚠️ Remove this code after the first admin is created
    await admin.auth().setCustomUserClaims(uid, { admin: true });
    return { success: true, message: `Admin claim set for ${uid}` };
  } catch (error) {
    console.error("Error setting admin claim:", error);
    throw new functions.https.HttpsError("internal", error.message);
  }
});

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
exports.sendTelegramMessage = functions.https.onRequest(async (req, res) => {
  const TelegramBot = require("node-telegram-bot-api");

  try {
    console.log("Request body:", req.body);

    const { telegramUsername, tier } = req.body;

    if (!telegramUsername || !tier) {
      console.log("Missing parameters!");
      return res
        .status(400)
        .send({ error: "telegramUsername and tier are required" });
    }
    console.log(
      `Sending Telegram message to user: ${telegramUsername}, tier: ${tier}`
    );

    const bot = new TelegramBot(
      "7718801037:AAEV4HynXs0vdMTDFcVtVphzFU1PpaLooAQ"
      // { polling: false }
    );
    console.log("Telegram bot initialized");

    // Get your groupId from TIER_CONFIG
    const groupId = TIER_CONFIG[tier].telegramGroupId;
    console.log(`Using groupId: ${groupId}`);

    // Generate invite link
    const inviteLink = await bot.createChatInviteLink(groupId, {
      member_limit: 1,
      expire_date: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours
    });
    console.log("Invite link generated:", inviteLink.invite_link);

    // Optionally store in Firestore
    const docRef = await admin.firestore().collection("telegramInvites").add({
      telegramUsername,
      tier,
      inviteLink: inviteLink.invite_link,
      // createdAt: admin.firestore.FieldValue.serverTimestamp(),
      used: false,
    });
    console.log("Invite link stored in Firestore with ID:", docRef.id);

    // Send DM
    try {
      await bot.sendMessage(
        `@${telegramUsername}`,
        `Welcome to Square Trivia ${TIER_CONFIG[tier].name}!\n\n` +
          `Click here to join: ${inviteLink.invite_link}\n\n` +
          `This link expires in 24 hours.`
      );
      console.log("Message sent to user via Telegram");
    } catch (dmError) {
      console.log(
        "Could not DM user, they need to start conversation with bot first"
      );
    }

    res.status(200).send({
      message: "Message sent (or invite generated)",
      inviteLink: inviteLink.invite_link,
    });
  } catch (error) {
    console.error("Error sending Telegram message:", error);
    res.status(500).send({ error: error.message });
  }
});

async function updateUserProfile(userId, eventType, eventData) {
  const userRef = db.collection("users").doc(userId);

  switch (eventType) {
    case "game_played":
      await userRef.update({
        [`sportsEngagement.${eventData.sport}.gamesPlayed`]:
          admin.firestore.FieldValue.increment(1),
        lastActive: admin.firestore.FieldValue.serverTimestamp(),
      });
      break;

    case "donation_made":
      await userRef.update({
        totalDonations: admin.firestore.FieldValue.increment(eventData.amount),
        lastDonation: admin.firestore.FieldValue.serverTimestamp(),
        [`tierHistory.${eventData.tier}`]:
          admin.firestore.FieldValue.increment(1),
      });
      break;

    case "team_interest":
      await userRef.update({
        [`favoriteTeams.${eventData.sport}`]:
          admin.firestore.FieldValue.arrayUnion(eventData.team),
      });
      break;
  }

  // Run segmentation
  await updateUserSegments(userId);
}

// =====================================
// SEGMENTATION ENGINE
// =====================================

async function updateUserSegments(userId) {
  const userDoc = await db.collection("users").doc(userId).get();
  const user = userDoc.data();

  const segments = [];

  // Financial segments
  if (user.totalDonations >= 1000) segments.push("vip");
  else if (user.totalDonations >= 500) segments.push("high_roller");
  else if (user.totalDonations >= 200) segments.push("regular");
  else segments.push("casual");

  // Sport preference segments
  const sports = Object.entries(user.sportsEngagement || {});
  sports.forEach(([sport, data]) => {
    if (data.gamesPlayed > 20)
      segments.push(`${sport.toLowerCase()}_enthusiast`);
  });

  // Behavioral segments
  const daysSinceLastActive =
    (Date.now() - user.lastActive?.toMillis()) / (1000 * 60 * 60 * 24);
  if (daysSinceLastActive > 30) segments.push("at_risk");
  if (daysSinceLastActive > 60) segments.push("churned");

  // Seasonal segments
  if (user.sportsEngagement?.NCAA_BB?.gamesPlayed > 5)
    segments.push("march_madness");
  if (user.sportsEngagement?.NFL?.gamesPlayed > 10)
    segments.push("nfl_playoff_ready");

  await userDoc.ref.update({ segments });

  // Check for monetization opportunities
  await checkMonetizationOpportunities(userId, segments);
}

// =====================================
// MONETIZATION AUTOMATION
// =====================================

async function checkMonetizationOpportunities(userId, segments) {
  const opportunities = [];

  // DraftKings/FanDuel eligibility
  if (segments.includes("high_roller") || segments.includes("vip")) {
    opportunities.push({
      partner: "draftkings",
      value: 100,
      message: "Exclusive $500 deposit match for Square Trivia VIPs",
    });
  }

  // Sports streaming for engaged users
  if (segments.filter((s) => s.includes("_enthusiast")).length >= 2) {
    opportunities.push({
      partner: "youtubetv",
      value: 50,
      message: "Get 2 months free YouTube TV to watch your squares live",
    });
  }

  // Merchandise for team fans
  const userDoc = await db.collection("users").doc(userId).get();
  const favoriteTeams = userDoc.data().favoriteTeams || {};

  Object.entries(favoriteTeams).forEach(([sport, teams]) => {
    if (teams.length > 0) {
      opportunities.push({
        partner: "fanatics",
        value: 20,
        message: `20% off ${teams[0]} gear at Fanatics`,
        metadata: { team: teams[0], sport },
      });
    }
  });

  // Store opportunities
  if (opportunities.length > 0) {
    await db.collection("monetizationQueue").add({
      userId,
      opportunities,
      segments,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: "pending",
    });
  }
}

// =====================================
// MARKETING CAMPAIGN SYSTEM
// =====================================

exports.runTargetedCampaign = functions.https.onCall(async (data, context) => {
  if (!context.auth?.token?.admin) {
    throw new functions.https.HttpsError("permission-denied", "Admin only");
  }

  const { campaignType, filters, message } = data;

  // Build query based on filters
  let query = db.collection("users");

  if (filters.minDonation) {
    query = query.where("totalDonations", ">=", filters.minDonation);
  }

  if (filters.segment) {
    query = query.where("segments", "array-contains", filters.segment);
  }

  const targetUsers = await query.get();

  console.log(`Campaign targeting ${targetUsers.size} users`);

  // Queue campaign messages
  const batch = db.batch();

  targetUsers.forEach((doc) => {
    const user = doc.data();

    if (user.notificationPreferences?.marketing) {
      const campaignRef = db.collection("marketingQueue").doc();
      batch.set(campaignRef, {
        userId: doc.id,
        email: user.email,
        campaignType,
        message: personalizeMessage(message, user),
        scheduledFor: admin.firestore.FieldValue.serverTimestamp(),
        status: "pending",
      });
    }
  });

  await batch.commit();

  return {
    success: true,
    targetedUsers: targetUsers.size,
    campaignType,
  };
});

function personalizeMessage(template, user) {
  return template
    .replace("{name}", user.email.split("@")[0])
    .replace("{tier}", user.preferredTiers?.[0] || "100")
    .replace(
      "{sport}",
      user.segments.find((s) => s.includes("_enthusiast"))?.split("_")[0] ||
        "NFL"
    )
    .replace("{totalSpent}", user.totalDonations || 0);
}

// =====================================
// ANALYTICS DASHBOARD DATA
// =====================================

exports.getBusinessAnalytics = functions.https.onCall(async (data, context) => {
  if (!context.auth?.token?.admin) {
    throw new functions.https.HttpsError("permission-denied", "Admin only");
  }

  const analytics = {
    userMetrics: await getUserMetrics(),
    revenueMetrics: await getRevenueMetrics(),
    engagementMetrics: await getEngagementMetrics(),
    monetizationMetrics: await getMonetizationMetrics(),
  };

  return analytics;
});

async function getUserMetrics() {
  const users = await db.collection("users").get();

  const segments = {};
  const tiers = {};
  let totalUsers = 0;
  let activeUsers = 0;

  users.forEach((doc) => {
    const user = doc.data();
    totalUsers++;

    // Active in last 30 days
    const daysSinceActive =
      (Date.now() - user.lastActive?.toMillis()) / (1000 * 60 * 60 * 24);
    if (daysSinceActive <= 30) activeUsers++;

    // Segment counts
    (user.segments || []).forEach((segment) => {
      segments[segment] = (segments[segment] || 0) + 1;
    });

    // Tier preferences
    (user.preferredTiers || []).forEach((tier) => {
      tiers[tier] = (tiers[tier] || 0) + 1;
    });
  });

  return {
    totalUsers,
    activeUsers,
    churnRate: (((totalUsers - activeUsers) / totalUsers) * 100).toFixed(1),
    segments,
    tiers,
    avgLifetimeValue: await calculateAvgLTV(),
  };
}

async function calculateAvgLTV() {
  const result = await db.collection("users").aggregate([
    {
      $group: {
        _id: null,
        avgLTV: { $avg: "$totalDonations" },
      },
    },
  ]);

  return result[0]?.avgLTV || 0;
}

// =====================================
// PRIVACY COMPLIANT DATA EXPORT
// =====================================

exports.exportAnonymizedData = functions.https.onCall(async (data, context) => {
  if (!context.auth?.token?.admin) {
    throw new functions.https.HttpsError("permission-denied", "Admin only");
  }

  const { dataType } = data;

  switch (dataType) {
    case "market_research":
      return await exportMarketResearchData();
    case "behavioral_insights":
      return await exportBehavioralData();
    case "revenue_analysis":
      return await exportRevenueData();
  }
});

async function exportMarketResearchData() {
  // Aggregate data only - no PII
  const data = await db.collection("users").get();

  const insights = {
    sportPreferences: {},
    spendingPatterns: {},
    geographicDistribution: {},
    seasonalTrends: {},
  };

  data.forEach((doc) => {
    const user = doc.data();

    // Sport preferences by spending level
    const spendLevel = user.totalDonations > 500 ? "high" : "low";
    Object.entries(user.sportsEngagement || {}).forEach(([sport, data]) => {
      if (!insights.sportPreferences[sport]) {
        insights.sportPreferences[sport] = { high: 0, low: 0 };
      }
      insights.sportPreferences[sport][spendLevel] += data.gamesPlayed;
    });

    // Geographic distribution
    const state = user.location?.state || "Unknown";
    insights.geographicDistribution[state] =
      (insights.geographicDistribution[state] || 0) + 1;
  });

  return insights;
}

// =====================================
// REFERRAL TRACKING
// =====================================

exports.trackReferral = functions.https.onCall(async (data, context) => {
  if (!context.auth) return;

  const { referralCode } = data;
  const newUserId = context.auth.uid;

  // Find referrer
  const referrer = await db
    .collection("users")
    .where("referralCode", "==", referralCode)
    .limit(1)
    .get();

  if (!referrer.empty) {
    const referrerId = referrer.docs[0].id;

    // Credit referrer
    await referrer.docs[0].ref.update({
      referredUsers: admin.firestore.FieldValue.increment(1),
      referralCredits: admin.firestore.FieldValue.increment(25), // $25 credit
    });

    // Track relationship
    await db.collection("referrals").add({
      referrerId,
      referredId: newUserId,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      status: "pending", // Becomes 'completed' after first donation
      creditAmount: 25,
    });
  }
});

// =====================================
// PARTNER DATA SHARING
// =====================================

exports.generatePartnerDataFeed = functions.https.onCall(
  async (data, context) => {
    if (!context.auth?.token?.admin) {
      throw new functions.https.HttpsError("permission-denied", "Admin only");
    }

    const { partner, dataScope } = data;

    // Validate partner
    const validPartners = ["draftkings", "fanduel", "youtubetv", "fanatics"];
    if (!validPartners.includes(partner)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Invalid partner"
      );
    }

    // Generate anonymized data feed based on scope
    const feed = await generateDataFeed(partner, dataScope);

    // Log data sharing for compliance
    await db.collection("dataSharing").add({
      partner,
      dataScope,
      recordCount: feed.length,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      generatedBy: context.auth.uid,
    });

    return feed;
  }
);

async function generateDataFeed(partner, scope) {
  const users = await db
    .collection("users")
    .where(`partnerOffers.${partner}.eligible`, "==", true)
    .get();

  const feed = [];

  users.forEach((doc) => {
    const user = doc.data();

    // Only share based on scope and consent
    if (user.notificationPreferences?.marketing) {
      feed.push({
        anonymousId: crypto.createHash("sha256").update(doc.id).digest("hex"),
        segments: user.segments,
        sportPreferences: Object.keys(user.sportsEngagement || {}),
        valueScore: calculateValueScore(user),
        region: user.location?.state || "Unknown",
      });
    }
  });

  return feed;
}

function calculateValueScore(user) {
  let score = 0;

  // Financial value
  if (user.totalDonations > 1000) score += 50;
  else if (user.totalDonations > 500) score += 30;
  else if (user.totalDonations > 200) score += 20;
  else score += 10;

  // Engagement value
  const totalGames = Object.values(user.sportsEngagement || {}).reduce(
    (sum, sport) => sum + sport.gamesPlayed,
    0
  );

  if (totalGames > 100) score += 30;
  else if (totalGames > 50) score += 20;
  else if (totalGames > 20) score += 10;

  // Referral value
  if (user.referredUsers > 5) score += 20;
  else if (user.referredUsers > 2) score += 10;

  return score;
}

exports.savePayoutDetails = functions.https.onCall(async (data, context) => {
  try {
    // Ensure user is logged in
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "You must be logged in to save payout details."
      );
    }

    const userId = context.auth.uid;
    const { method, ...details } = data;

    if (!method) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Payout method is required."
      );
    }

    // Save to Firestore under user doc
    await db
      .collection("users")
      .doc(userId)
      .set(
        {
          payoutDetails: {
            method,
            ...details,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
        { merge: true } // don’t overwrite whole doc
      );

    return { success: true, message: "Payout details saved successfully" };
  } catch (error) {
    console.error("Error saving payout details:", error);
    throw new functions.https.HttpsError(
      "internal",
      "Something went wrong while saving payout details."
    );
  }
});
