const { redis } = require("../db/redis");
const { VIEWER_HLS_THRESHOLD } = require("../config/constants");

/**
 * Presence is ephemeral and lives in Redis so it is shared across all backend
 * instances (the Socket.IO Redis adapter handles the actual fan-out; this gives
 * us a queryable membership list + viewer counts, including from REST handlers).
 *
 * Key layout:
 *   room:{roomID}:users  -> hash of socketId -> JSON({ user, role })
 */

const usersKey = (roomID) => `room:${roomID}:users`;

const presenceService = {
  async join(roomID, socketId, { user, role }) {
    await redis.hset(usersKey(roomID), socketId, JSON.stringify({ user, role }));
    return redis.hlen(usersKey(roomID));
  },

  async leave(roomID, socketId) {
    await redis.hdel(usersKey(roomID), socketId);
    return redis.hlen(usersKey(roomID));
  },

  async count(roomID) {
    return redis.hlen(usersKey(roomID));
  },

  // All present members (optionally excluding one socketId, e.g. the caller).
  async members(roomID, excludeSocketId = null) {
    const raw = await redis.hgetall(usersKey(roomID));
    return Object.entries(raw)
      .filter(([socketId]) => socketId !== excludeSocketId)
      .map(([socketId, value]) => {
        const parsed = JSON.parse(value);
        return { userId: socketId, user: parsed.user, role: parsed.role };
      });
  },

  async clear(roomID) {
    return redis.del(usersKey(roomID));
  },

  // Phase-2 seam: would trigger an HLS upgrade for new viewers. Not active.
  async crossedHlsThreshold(roomID) {
    const count = await redis.hlen(usersKey(roomID));
    return count >= VIEWER_HLS_THRESHOLD;
  },
};

module.exports = presenceService;
