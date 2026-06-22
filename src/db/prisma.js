const { PrismaClient } = require("@prisma/client");
const env = require("../config/env");

// Singleton PrismaClient (avoids exhausting DB connections on hot-reload).
const globalForPrisma = globalThis;

const prisma =
  globalForPrisma.__connectPrisma ||
  new PrismaClient({
    log: env.isProd ? ["error"] : ["warn", "error"],
  });

if (!env.isProd) globalForPrisma.__connectPrisma = prisma;

module.exports = prisma;
