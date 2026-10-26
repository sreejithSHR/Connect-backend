const createError = require("http-errors");
const { verifyToken } = require("../auth/tokens");

/**
 * Express middleware: requires a valid session token in the
 * `Authorization: Bearer <token>` header. Attaches req.user.
 */
const requireAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) throw createError(401, "Missing Authorization header");

    const user = await verifyToken(token);
    if (!user?.uid) throw createError(401, "Invalid token");

    req.user = user;
    next();
  } catch (err) {
    if (err.status) return next(err);
    next(createError(401, "Authentication failed"));
  }
};

module.exports = { requireAuth };
