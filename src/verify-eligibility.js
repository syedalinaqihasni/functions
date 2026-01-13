const functions = require("firebase-functions");
const admin = require("firebase-admin");

// Initialize admin if not already done
if (!admin.apps.length) {
  admin.initializeApp();
}
require("dotenv").config();
// Env setup
const RESTRICTED_STATES = (process.env.RESTRICTED_STATES || "AZ,TN,MD,LA")
  .split(",")
  .map(s => s.trim().toUpperCase());
const HARDFAIL = process.env.RESTRICTION_HARDFAIL !== "false";

// Normalize helper
const normalize = s => (s ? s.trim().toUpperCase() : null);

// Core decision
const isRestricted = ({ ip, gps, billing }) => {
  if (ip && RESTRICTED_STATES.includes(normalize(ip))) return true;
  if (gps && RESTRICTED_STATES.includes(normalize(gps))) return true;
  if (billing && RESTRICTED_STATES.includes(normalize(billing))) return true;
  return false;
};
const db = admin.firestore();

// Callable function: verify eligibility
exports.verifyEligibility = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid || null;
  if (!uid) throw new functions.https.HttpsError("unauthenticated", "User not logged in");

  const { ip_state, gps_state, billing_state, is_vpn } = data;

  // VPN handling
  if (is_vpn && !gps_state)
    throw new functions.https.HttpsError(
      "failed-precondition",
      "We couldn't verify your location. Enable location or update your billing address."
    );

  const restricted = isRestricted({
    ip: ip_state,
    gps: gps_state,
    billing: billing_state,
  });

  const anyVerified = ip_state || gps_state || billing_state;
  if (!anyVerified && HARDFAIL)
    throw new functions.https.HttpsError(
      "failed-precondition",
      "We couldn't verify your location. Enable location or update your billing address."
    );

  const status = restricted ? "restricted" : "eligible";
  const reason = restricted
    ? "Contests are unavailable in your state (AZ, TN, MD, LA)."
    : "Eligible";

  await db.collection("locationChecks").add({
    uid,
    ip_state,
    gps_state,
    billing_state,
    eligibility_status: status,
    reason,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
  });

  if (restricted)
    throw new functions.https.HttpsError("permission-denied", reason);

  return { status: "eligible", message: "You are eligible to play paid contests" };
});

/**
 * Export all functions
 */
module.exports = {
  verifyEligibility: exports.verifyEligibility,
};