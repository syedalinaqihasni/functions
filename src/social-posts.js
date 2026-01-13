require("dotenv").config();
const axios = require("axios");
const admin = require("firebase-admin");
const { logger } = require("firebase-functions");
const { TwitterApi } = require("twitter-api-v2");

// Initialize Firebase Admin (safe re-init)
if (!admin.apps.length) admin.initializeApp();

// Load keys from env
const FB_PAGE_ID = process.env.FB_PAGE_ID;
const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const IG_USER_ID = process.env.IG_USER_ID;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const client = new TwitterApi({
  appKey: process.env.X_CONSUMER_KEY,
  appSecret: process.env.X_CONSUMER_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN,
  accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
});

// Unified logging helper
function logInfo(context, data) {
  console.log(`🟢 [INFO] ${context}:`, data);
  logger.info(`[${context}]`, data);
}
function logError(context, error) {
  console.error(
    `🔴 [ERROR] ${context}:`,
    error.response?.data || error.message
  );
  logger.error(`[${context}]`, error.response?.data || error.message);
}

// =============================
// Facebook Graph API Functions
// =============================

// Unified Facebook Post (Image, Video, Text, or Link)
async function fbPublish({ media, caption, link, type }) {
  try {
    let url, data;
    const baseURL = `https://graph.facebook.com/v20.0/${FB_PAGE_ID}`;
    const token = FB_PAGE_ACCESS_TOKEN;

    switch (type?.toUpperCase()) {
      case "IMAGE":
        // 🖼️ Image Post
        url = `${baseURL}/photos`;
        data = {
          url: media,
          caption,
          access_token: token,
        };
        break;

      case "VIDEO":
        // 🎥 Video Post
        url = `${baseURL}/videos`;
        data = {
          file_url: media,
          description: caption,
          access_token: token,
        };
        break;

      case "LINK":
        // 🔗 Link Post
        url = `${baseURL}/feed`;
        data = {
          message: caption,
          link,
          access_token: token,
        };
        break;

      case "TEXT":
        // 📝 Text-only Post
        url = `${baseURL}/feed`;
        data = {
          message: caption,
          access_token: token,
        };
        break;

      default:
        throw new Error(`❌ Unsupported post type: ${type}`);
    }

    // 🚀 Execute API Request
    logInfo(`Facebook ${type} Post`, { url, data });
    const res = await axios.post(url, data);
    logInfo(`Facebook ${type} Post Response`, res.data);

    return res.data;
  } catch (error) {
    logError("Facebook Publish Error", error.response?.data || error);
    throw error;
  }
}

// =============================
// Instagram Graph API Functions
// =============================

// Unified Instagram Media Upload + Publish Function
// Upload + Publish to Instagram (Image or Video)

// Configurable settings
const IG_PUBLISH_CONFIG = {
  maxCreateRetries: 5, // Retries for container creation
  createRetryDelayMs: 2000,
  maxStatusChecks: 10, // Polling attempts for video readiness
  statusCheckDelayMs: 3000,
};

async function igPublish({ media, caption, type = "IMAGE" }) {
  const createUrl = `https://graph.facebook.com/v20.0/${IG_USER_ID}/media`;
  const publishUrl = `https://graph.facebook.com/v20.0/${IG_USER_ID}/media_publish`;

  logInfo("📦 Instagram POST initiated", { type, media, caption });

  try {
    // 🧩 Validate input
    if (!media) {
      logInfo("ℹ️ Skipping Instagram post — no media provided.", { caption });
      return { skipped: true, reason: "no_media" };
    }

    // 🧱 Step 1 — Build payload (auto-select fields based on type)
    const payload = {
      caption,
      access_token: FB_PAGE_ACCESS_TOKEN,
      ...(type === "VIDEO"
        ? { media_type: "VIDEO", video_url: media }
        : { image_url: media }),
    };

    // 🧱 Step 2 — Create media container with retries
    let creationId = null;

    for (let i = 0; i < IG_PUBLISH_CONFIG.maxCreateRetries; i++) {
      try {
        const res = await axios.post(createUrl, payload);
        creationId = res.data?.id;

        if (creationId) {
          logInfo(`✅ Instagram container created [Attempt ${i + 1}]`, {
            creationId,
          });
          break;
        }
      } catch (err) {
        const errData = err.response?.data || err.message;
        logError(`⚠️ Error creating container [Attempt ${i + 1}]`, errData);
      }

      await new Promise((r) =>
        setTimeout(r, IG_PUBLISH_CONFIG.createRetryDelayMs)
      );
    }

    if (!creationId) {
      throw new Error("❌ Failed to receive creation_id after all retries.");
    }

    // ⏳ Step 3 — For video, poll until it's ready (status_code = FINISHED)
    if (type === "VIDEO") {
      const statusUrl = `https://graph.facebook.com/v20.0/${creationId}?fields=status_code&access_token=${FB_PAGE_ACCESS_TOKEN}`;
      let ready = false;

      for (let i = 0; i < IG_PUBLISH_CONFIG.maxStatusChecks; i++) {
        try {
          const statusRes = await axios.get(statusUrl);
          const status = statusRes.data?.status_code;
          logInfo(
            `🎞️ Video processing status [${i + 1}/${IG_PUBLISH_CONFIG.maxStatusChecks}]`,
            { status }
          );

          if (status === "FINISHED") {
            ready = true;
            break;
          } else if (status === "ERROR") {
            throw new Error("Video processing failed on Instagram side.");
          }
        } catch (err) {
          const errData = err.response?.data || err.message;
          logError("⚠️ Error checking video status", errData);
        }

        await new Promise((r) =>
          setTimeout(r, IG_PUBLISH_CONFIG.statusCheckDelayMs)
        );
      }

      if (!ready) {
        throw new Error("❌ Video not ready after polling attempts.");
      }

      logInfo("✅ Video processing finished, ready to publish.", {
        creationId,
      });
    }

    // 🚀 Step 4 — Publish media container
    const publishData = {
      creation_id: creationId,
      access_token: FB_PAGE_ACCESS_TOKEN,
    };

    logInfo("🚀 Attempting to publish Instagram media", { creationId, type });

    try {
      const publishRes = await axios.post(publishUrl, publishData);
      logInfo("🎉 Instagram Publish Success", publishRes.data);
      return { success: true, type, ...publishRes.data };
    } catch (publishErr) {
      const errData = publishErr.response?.data || publishErr.message;
      logError("❌ Instagram Publish Failed", { creationId, errData });
      return { error: true, stage: "publish", details: errData };
    }
  } catch (error) {
    const errData = error.response?.data || error.message || error;
    logError("💥 Unhandled Instagram Publish Error", errData);
    return { error: true, stage: "container_creation", details: errData };
  }
}

// =============================
// Telegram Bot API Functions
// =============================

async function tgGetMe() {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`;
  try {
    logInfo("Telegram GetMe", url);
    const res = await axios.post(url);
    logInfo("Telegram GetMe Response", res.data);
    return res.data;
  } catch (error) {
    logError("Telegram GetMe", error);
    throw error;
  }
}

async function tgGetUpdates() {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates`;
  try {
    logInfo("Telegram GetUpdates", url);
    const res = await axios.post(url);
    logInfo("Telegram GetUpdates Response", res.data);
    return res.data;
  } catch (error) {
    logError("Telegram GetUpdates", error);
    throw error;
  }
}
// Unified Telegram Post (Text, Photo, or Video)
async function tgPublish({ media, caption, link, text, type }) {
  try {
    const baseURL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
    const chat_id = TELEGRAM_CHAT_ID;
    const ext = media?.split(".").pop()?.toLowerCase();
    let url, data;

    // Normalize type if passed
    const postType = type?.toUpperCase();

    switch (postType) {
      case "IMAGE":
        // 🖼️ Photo Post
        url = `${baseURL}/sendPhoto`;
        data = { chat_id, photo: media, caption };
        break;

      case "VIDEO":
        // 🎥 Video Post
        url = `${baseURL}/sendVideo`;
        data = { chat_id, video: media, caption };
        break;

      case "LINK":
        // 🔗 Link Post
        url = `${baseURL}/sendMessage`;
        data = { chat_id, text: `${caption || ""}\n${link}`.trim() };
        break;

      case "TEXT":
        // 📝 Text Post
        url = `${baseURL}/sendMessage`;
        data = { chat_id, text: caption || text };
        break;

      default:
        // 🧠 Auto-detect if type is not provided
        if (!media && (text || caption)) {
          url = `${baseURL}/sendMessage`;
          data = { chat_id, text: text || caption };
          type = "TEXT";
        } else if (["jpg", "jpeg", "png"].includes(ext)) {
          url = `${baseURL}/sendPhoto`;
          data = { chat_id, photo: media, caption };
          type = "IMAGE";
        } else if (ext === "mp4") {
          url = `${baseURL}/sendVideo`;
          data = { chat_id, video: media, caption };
          type = "VIDEO";
        } else {
          throw new Error(
            `❌ Unsupported or missing Telegram post type: ${ext || "unknown"}`
          );
        }
    }

    // 🚀 Execute API call
    logInfo(`Telegram ${type || postType} Post`, { url, data });
    const res = await axios.post(url, data);
    logInfo(`Telegram ${type || postType} Post Response`, res.data);

    return res.data;
  } catch (error) {
    logError("Telegram Publish Error", error.response?.data || error);
    throw error;
  }
}

// =============================
// Firebase HTTPS Function Wrapper
// =============================

const CTA_VARIATIONS = [
  "Speed Wins. Always. Play now → {link}",
  "Your speed = Your winnings 💰",
  "NO FEES - Test your speed → {link}",
  "Think you’re fast? Prove it → {link}",
  "Join {activePlayerCount} winners. Speed Wins. Always.",
  "Next game in {time} - Get your square NOW",
  "The fastest finger wins. Always. → {link}",
  "Turn milliseconds into money → {link}",
];

/**
 * Replace placeholders with dynamic values.
 */
function replacePlaceholders(cta, { link, activePlayerCount, time }) {
  return cta
    .replace("{link}", link || "")
    .replace("{activePlayerCount}", activePlayerCount || "thousands of")
    .replace("{time}", time || "a few minutes");
}

/**
 * Generate a random CTA variation.
 * Only select CTAs that have required placeholders available.
 */
function getRandomCTA(context = {}) {
  const { link, activePlayerCount, time } = context;

  // Filter CTAs that can be filled
  const eligibleCTAs = CTA_VARIATIONS.filter((cta) => {
    if (cta.includes("{link}") && !link) return false;
    if (cta.includes("{activePlayerCount}") && !activePlayerCount) return false;
    if (cta.includes("{time}") && !time) return false;
    return true;
  });

  // Fallback: if none eligible, use a default CTA
  const finalCTAs = eligibleCTAs.length
    ? eligibleCTAs
    : ["Speed Wins. Always. Play now →"];

  const randomCTA = finalCTAs[Math.floor(Math.random() * finalCTAs.length)];
  return replacePlaceholders(randomCTA, context);
}

// ✅ Append CTA to post template
// const template = "🔥 The next trivia challenge is LIVE!";
// const content = `${template}\n\n\n${ctaText}`;

// ✅ Unified Twitter Publish Function
async function twPublish({ message, link, media, type }) {
  try {
    const textBase = message || "";
    const text = link ? `${textBase}\n\n${link}` : textBase;
    const mediaIds = [];
    const ext = media?.split(".").pop()?.toLowerCase();

    // 🧠 Auto-detect or normalize type
    const postType =
      type?.toUpperCase() ||
      (ext
        ? ["jpg", "jpeg", "png"].includes(ext)
          ? "IMAGE"
          : ext === "mp4"
            ? "VIDEO"
            : "TEXT"
        : "TEXT");

    // 🎞️ Upload media if applicable
    if (postType === "IMAGE" && media) {
      const mediaId = await client.v2.uploadMedia(media);
      mediaIds.push(mediaId);
    } else if (postType === "VIDEO" && media) {
      const mediaId = await client.v2.uploadMedia(media, { type: "video" });
      mediaIds.push(mediaId);
    }

    // 🧾 Prepare payload
    const payload =
      mediaIds.length > 0 ? { text, media: { media_ids: mediaIds } } : { text };

    logInfo(`Twitter ${postType} Post`, payload);

    // 🚀 Post to Twitter
    const res = await client.v2.tweet(payload);
    logInfo(`Twitter ${postType} Post Response`, res.data);

    return res.data;
  } catch (error) {
    logError("Twitter Publish Error", error);
    throw error;
  }
}

function getHashtags(context = {}) {
  const { category } = context; // e.g. "standard", "nfl", "bigwin"

  const HASHTAG_SETS = {
    standard: [
      "#SquareTrivia",
      "#SpeedWins",
      "#SpeedWinsAlways",
      "#NoFees",
      "#WinWithSpeed",
    ],
    nfl: ["#NFLSunday", "#SpeedWins", "#SundaySquares", "#FastestFingerWins"],
    bigwin: ["#BigWin", "#SpeedPays", "#TriviaMaster", "#SpeedWinsAlways"],
  };

  // Pick matching set (default = standard)
  const hashtags =
    HASHTAG_SETS[category?.toLowerCase()] || HASHTAG_SETS.standard;

  // Shuffle a bit for variation
  const shuffled = hashtags.sort(() => 0.5 - Math.random());

  // Return as joined string
  return shuffled.join(" ");
}

// =============================
// Exports for local use
// =============================

module.exports = {
  getRandomCTA,
  getHashtags,
  tgGetMe,
  tgGetUpdates,
  twPublish,
  fbPublish,
  igPublish,
  tgPublish,
};
