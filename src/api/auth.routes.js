const { Router } = require("express");
const { z } = require("zod");
const createError = require("http-errors");
const rateLimit = require("express-rate-limit");
const asyncHandler = require("../middleware/asyncHandler");
const { requireAuth } = require("../middleware/auth");
const authService = require("../services/auth.service");
const userService = require("../services/user.service");
const env = require("../config/env");

const router = Router();

// Brute-force guard on everything that checks a credential.
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many attempts, try again in a few minutes" },
});

const email = z.string().trim().toLowerCase().email("Enter a valid email").max(254);
// bcrypt only uses the first 72 bytes, so longer passwords would be silently cut.
const password = z.string().min(8, "Password must be at least 8 characters").max(72);

const parse = (schema, body) => {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw createError(400, parsed.error.issues[0].message);
  return parsed.data;
};

// Which sign-in methods the client should show.
router.get("/providers", (req, res) => {
  res.json({ password: true, google: env.googleClientId || null });
});

router.post(
  "/register",
  credentialLimiter,
  asyncHandler(async (req, res) => {
    const data = parse(
      z.object({ email, password, name: z.string().trim().min(1, "Enter your name").max(60) }),
      req.body
    );
    res.status(201).json(await authService.register(data));
  })
);

router.post(
  "/login",
  credentialLimiter,
  asyncHandler(async (req, res) => {
    const data = parse(z.object({ email, password: z.string().min(1).max(72) }), req.body);
    res.json(await authService.login(data));
  })
);

router.post(
  "/google",
  credentialLimiter,
  asyncHandler(async (req, res) => {
    const data = parse(z.object({ credential: z.string().min(1) }), req.body);
    res.json(await authService.google(data));
  })
);

// Current user, fresh from the DB (the token's copy can be up to 7 days old).
router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await userService.byId(req.user.uid);
    if (!user) throw createError(401, "Account no longer exists");
    res.json({ user: authService.publicUser(user) });
  })
);

module.exports = router;
