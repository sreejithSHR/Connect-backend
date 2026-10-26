const crypto = require("crypto");
const { Router } = require("express");
const { requireAuth } = require("../middleware/auth");
const env = require("../config/env");

const router = Router();

const STUN = { urls: ["stun:stun.l.google.com:19302"] };

/**
 * ICE servers for WebRTC. TURN credentials are short-lived and per-user, using
 * coturn's `use-auth-secret` scheme (username = "<expiry>:<uid>",
 * credential = base64(HMAC-SHA1(secret, username))), so nothing long-lived ships
 * in the client bundle.
 */
router.get("/", requireAuth, (req, res) => {
  const { urls, secret, ttlSeconds } = env.turn;
  if (!urls.length || !secret) return res.json({ iceServers: [STUN], ttlSeconds });

  const username = `${Math.floor(Date.now() / 1000) + ttlSeconds}:${req.user.uid}`;
  const credential = crypto.createHmac("sha1", secret).update(username).digest("base64");
  res.json({ iceServers: [STUN, { urls, username, credential }], ttlSeconds });
});

module.exports = router;
