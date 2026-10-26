require("dotenv").config();

const parseOrigins = (raw) => {
  if (!raw || raw === "*") return "*";
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
};

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  isProd: process.env.NODE_ENV === "production",
  port: Number(process.env.PORT) || 5000,
  origin: parseOrigins(process.env.ORIGIN),

  databaseUrl: process.env.DATABASE_URL || "",
  redisUrl: process.env.REDIS_URL || "",

  // Signs session tokens (src/auth/tokens.js). Required in production.
  jwtSecret: process.env.JWT_SECRET || "",
  // Google OAuth "Web application" client ID. Empty -> Google sign-in hidden.
  googleClientId: process.env.GOOGLE_CLIENT_ID || "",

  // Room capacity. Media is peer-to-peer at 720p (~1 Mbps + one encode per
  // receiver), so these protect the sender's upload and CPU.
  streamMaxViewers: Number(process.env.STREAM_MAX_VIEWERS) || 15,
  meetMaxParticipants: Number(process.env.MEET_MAX_PARTICIPANTS) || 6,

  // TURN (coturn with `use-auth-secret`). Empty -> clients get STUN only.
  turn: {
    urls: (process.env.TURN_URLS || "")
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean),
    secret: process.env.TURN_SECRET || "",
    ttlSeconds: Number(process.env.TURN_TTL_SECONDS) || 6 * 60 * 60,
  },
};

module.exports = env;
