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

  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || "",
    serviceAccount: process.env.FIREBASE_SERVICE_ACCOUNT || "",
    serviceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "",
  },
};

module.exports = env;
