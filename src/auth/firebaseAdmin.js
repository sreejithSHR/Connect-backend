const admin = require("firebase-admin");
const fs = require("fs");
const env = require("../config/env");

/**
 * Initialises the Firebase Admin SDK for server-side ID-token verification.
 *
 * Credentials are resolved in this order:
 *   1. FIREBASE_SERVICE_ACCOUNT       (inline JSON string)
 *   2. FIREBASE_SERVICE_ACCOUNT_PATH  (path to JSON file)
 *   3. none -> DEV AUTH FALLBACK (tokens are decoded WITHOUT verification)
 */

let initialized = false;
let devFallback = false;

const loadServiceAccount = () => {
  if (env.firebase.serviceAccount) {
    try {
      return JSON.parse(env.firebase.serviceAccount);
    } catch (err) {
      console.error("[firebase] FIREBASE_SERVICE_ACCOUNT is not valid JSON:", err.message);
    }
  }
  if (env.firebase.serviceAccountPath && fs.existsSync(env.firebase.serviceAccountPath)) {
    try {
      return JSON.parse(fs.readFileSync(env.firebase.serviceAccountPath, "utf8"));
    } catch (err) {
      console.error("[firebase] could not read service account file:", err.message);
    }
  }
  return null;
};

const init = () => {
  if (initialized) return;
  const serviceAccount = loadServiceAccount();

  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id || env.firebase.projectId || undefined,
    });
    console.log("[firebase] admin initialised (verified mode)");
  } else {
    devFallback = true;
    console.warn(
      "[firebase] No service account configured — DEV AUTH FALLBACK enabled.\n" +
        "           Tokens are decoded WITHOUT verification. Do NOT use in production."
    );
  }
  initialized = true;
};

// Decode a JWT payload without verifying its signature (dev fallback only).
const decodeUnsafe = (token) => {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed token");
  const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
  return payload;
};

/**
 * Verifies an ID token and returns a normalised user object.
 * Throws if the token is missing/invalid.
 */
const verifyIdToken = async (token) => {
  if (!token) throw new Error("Missing token");
  init();

  if (devFallback) {
    const payload = decodeUnsafe(token);
    return {
      uid: payload.user_id || payload.sub || payload.uid,
      email: payload.email || null,
      name: payload.name || null,
      photoURL: payload.picture || null,
    };
  }

  const decoded = await admin.auth().verifyIdToken(token);
  return {
    uid: decoded.uid,
    email: decoded.email || null,
    name: decoded.name || null,
    photoURL: decoded.picture || null,
  };
};

module.exports = { init, verifyIdToken };
