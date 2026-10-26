const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const env = require("../config/env");

/**
 * Session tokens: HS256 JWTs signed with JWT_SECRET, sent by the client as
 * `Authorization: Bearer <token>` (REST) and `auth.token` (Socket.IO).
 *
 * Without JWT_SECRET, development uses a random per-process secret (everyone is
 * logged out on restart); production refuses to start.
 */

const TOKEN_TTL = "7d";
let secret = null;

const init = () => {
  if (secret) return;
  if (env.jwtSecret) {
    secret = env.jwtSecret;
    return;
  }
  if (env.isProd) throw new Error("[auth] JWT_SECRET is required when NODE_ENV=production");
  secret = crypto.randomBytes(32).toString("hex");
  console.warn("[auth] JWT_SECRET not set — using a random dev secret (sessions reset on restart).");
};

// Token for a User row.
const sign = (user) => {
  init();
  return jwt.sign(
    { name: user.name || null, email: user.email || null, picture: user.photoURL || null },
    secret,
    { subject: user.id, expiresIn: TOKEN_TTL, algorithm: "HS256" }
  );
};

/**
 * Verifies a token and returns the normalised identity used across the app.
 * Throws if the token is missing/invalid/expired.
 */
const verifyToken = async (token) => {
  if (!token) throw new Error("Missing token");
  init();
  const payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
  return {
    uid: payload.sub,
    email: payload.email || null,
    name: payload.name || null,
    photoURL: payload.picture || null,
  };
};

module.exports = { init, sign, verifyToken };
