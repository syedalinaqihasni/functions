// const functions = require("firebase-functions");
// const admin = require("firebase-admin");
// const cors = require("./corsConfig");
// // Initialize Firebase Admin
// admin.initializeApp();

// // Import all your function modules
// const userData = require("./src/user-data-monetization-fixed");
// const monitoringAlerts = require("./src/monitoring-alerts-fixed");
// const financialSystem = require("./src/financial-system-complete");
// const adminPanel = require("./src/admin-panel-complete");
// const triviaSystem = require("./src/trivia-system-fixed");
// const paymentSystem = require("./src/payment-system-modified");
// const automatedGameMonitoring = require("./src/automated-game-monitoring-fixed");
// const enhancedWinnerNotifications = require("./src/enhanced-winner-notifications-fixed");

// // Test function using v1 API
// exports.helloWorld = functions.https.onRequest((req, res) => {
//   cors(req, res, () => {
//     functions.logger.info("Hello logs!", { structuredData: true });
//     res.status(200).send("Hello from Firebase Functions!");
//   });
// });

// // Export all other functions
// Object.assign(exports, {
//   ...userData,
//   ...paymentSystem,
//   ...triviaSystem,
//   ...monitoringAlerts,
//   ...financialSystem,
//   ...adminPanel,
//   ...automatedGameMonitoring,
//   ...enhancedWinnerNotifications,
// });

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const cors = require("./corsConfig");
const axios = require("axios");

// Initialize Firebase Admin
admin.initializeApp();

const db = admin.firestore();

// Telegram Bot Token
const TELEGRAM_BOT_TOKEN = "7718801037:AAEV4HynXs0vdMTDFcVtVphzFU1PpaLooAQ";
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// Function to handle Telegram webhook and store chat_id
// exports.addTelegramToAccount = functions.https.onRequest(async (req, res) => {
//   try {
//     // Ensure it's a POST from Telegram
//     if (req.method !== "POST") {
//       return res.status(405).send("Method Not Allowed");
//     }

//     const message = req.body.message;
//     if (!message || !message.chat || !message.chat.id) {
//       return res.status(400).send("Invalid Telegram message format");
//     }

//     const chatId = message.chat.id;
//     const text = message.text;

//     // If user sends /start, store chat_id
//     if (text && text.startsWith("/start")) {
//       await db.collection("telegramUsers").doc(String(chatId)).set({
//         chatId,
//         firstName: message.chat.first_name || "",
//         username: message.chat.username || "",
//         dateAdded: admin.firestore.FieldValue.serverTimestamp(),
//       });

//       // Reply to user
//       await axios.post(`${TELEGRAM_API}/sendMessage`, {
//         chat_id: chatId,
//         text: "✅ Your Telegram account has been linked successfully!",
//       });
//     }

//     return res.status(200).send("OK");
//   } catch (error) {
//     console.error("Error handling Telegram webhook:", error);
//     return res.status(500).send("Internal Server Error");
//   }
// });

// Test function using v1 API
exports.helloWorld = functions.https.onRequest((req, res) => {
  cors(req, res, () => {
    functions.logger.info("Hello logs!", { structuredData: true });
    res.status(200).send("Hello from Firebase Functions!");
  });
});

// Import all your function modules
const userData = require("./src/user-data-monetization-fixed");
const monitoringAlerts = require("./src/monitoring-alerts-fixed");
const financialSystem = require("./src/financial-system-complete");
const adminPanel = require("./src/admin-panel-complete");
const triviaSystem = require("./src/trivia-system-fixed");
const paymentSystem = require("./src/payment-system-modified");
const automatedGameMonitoring = require("./src/automated-game-monitoring-fixed");
const enhancedWinnerNotifications = require("./src/enhanced-winner-notifications-fixed");
const backendGameFunctions = require("./src/backend-game-functions");
const verifyEligibility = require("./src/verify-eligibility");

// Export all other functions
Object.assign(exports, {
  ...userData,
  ...paymentSystem,
  ...triviaSystem,
  ...monitoringAlerts,
  ...financialSystem,
  ...adminPanel,
  ...automatedGameMonitoring,
  ...enhancedWinnerNotifications,
  ...backendGameFunctions,
  ...verifyEligibility,
});
