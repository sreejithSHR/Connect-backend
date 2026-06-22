const createError = require("http-errors");
const { verifyIdToken } = require("../auth/firebaseAdmin");
const userService = require("../services/user.service");

/**
 * Express middleware: requires a valid Firebase ID token in the
 * `Authorization: Bearer <token>` header. Attaches req.user.
 * Also upserts the user record so foreign keys (messages/streams) are valid.
 */
const requireAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) throw createError(401, "Missing Authorization header");

    const user = await verifyIdToken(token);
    if (!user?.uid) throw createError(401, "Invalid token");

    req.user = user;
    // Best-effort: a DB hiccup (e.g. missing migration) must not block auth.
    userService.upsert(user).catch((e) => console.error("[auth] upsert failed:", e.message));
    next();
  } catch (err) {
    if (err.status) return next(err);
    next(createError(401, "Authentication failed"));
  }
};

module.exports = { requireAuth };
