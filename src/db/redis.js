const Redis = require("ioredis");
const env = require("../config/env");

/**
 * Redis powers three things:
 *   1. Presence sets + live viewer counts (presence.service).
 *   2. The Socket.IO adapter (pub/sub) for horizontal scale-out across instances.
 *
 * If REDIS_URL is not set, we fall back to an in-memory shim implementing the
 * small subset of set commands we use. The shim is single-instance only — fine
 * for local dev, NOT for multi-instance production (where the adapter is needed).
 */

let client = null;
let pubClient = null;
let subClient = null;
let usingRedis = false;

// ---- In-memory fallback (dev / single instance) ----
const createMemoryClient = () => {
  const hashes = new Map();
  const getHash = (key) => {
    if (!hashes.has(key)) hashes.set(key, new Map());
    return hashes.get(key);
  };
  return {
    isMemory: true,
    async hset(key, field, value) {
      const h = getHash(key);
      const isNew = !h.has(field);
      h.set(field, value);
      return isNew ? 1 : 0;
    },
    async hget(key, field) {
      return hashes.has(key) ? hashes.get(key).get(field) ?? null : null;
    },
    async hdel(key, ...fields) {
      if (!hashes.has(key)) return 0;
      const h = hashes.get(key);
      let removed = 0;
      for (const f of fields) if (h.delete(f)) removed++;
      if (h.size === 0) hashes.delete(key);
      return removed;
    },
    async hgetall(key) {
      if (!hashes.has(key)) return {};
      return Object.fromEntries(hashes.get(key));
    },
    async hlen(key) {
      return hashes.has(key) ? hashes.get(key).size : 0;
    },
    async del(key) {
      return hashes.delete(key) ? 1 : 0;
    },
    async ping() {
      return "PONG";
    },
    duplicate() {
      return this;
    },
    on() {},
  };
};

if (env.redisUrl) {
  try {
    client = new Redis(env.redisUrl, { maxRetriesPerRequest: 3, lazyConnect: false });
    client.on("error", (err) => console.error("[redis] error:", err.message));
    client.on("connect", () => console.log("[redis] connected"));
    pubClient = client.duplicate();
    subClient = client.duplicate();
    usingRedis = true;
  } catch (err) {
    console.error("[redis] failed to init, using in-memory fallback:", err.message);
    client = createMemoryClient();
  }
} else {
  console.warn(
    "[redis] REDIS_URL not set — using in-memory presence (single instance only)."
  );
  client = createMemoryClient();
}

module.exports = {
  redis: client,
  pubClient,
  subClient,
  usingRedis,
};
