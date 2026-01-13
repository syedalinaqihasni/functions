const { logger } = require("firebase-functions");
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { QuickValueProp } = require("./extra-social-posts");
const { twPublish } = require("./social-posts");
const { ValueComparisons } = require("./extra-social-posts");

admin.initializeApp();
exports.twPostQuickValueProp = functions.pubsub
  .schedule("every day 18:00")
  .timeZone("America/Denver")
  .onRun(async () => {
    // Example: dynamically fetched gameplay stats
    const gameTimeSec = 42;
    const earnings = 19;
    const link = "https://squaretrivia.com/play";

    const message = QuickValueProp({ gameTimeSec, earnings, link });

    logger.info("Generated message:", message);

    await twPublish(message);

    return null;
  });

exports.twPostValueComparisons = functions.pubsub
  .schedule("every day 20:00")
  .timeZone("America/Denver")
  .onRun(async () => {
    // Example: dynamically fetched gameplay stats
    const gameTimeSec = 42;
    const earnings = 19;
    const link = "https://squaretrivia.com/play";

    const message = ValueComparisons({ gameTimeSec, earnings, link });

    logger.info("Generated message:", message);

    await twPublish(message);

    return null;
  });
