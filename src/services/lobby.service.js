/**
 * In-memory meeting lobby: which socket is the host of each meeting room, and
 * who is waiting to be admitted.
 *
 * NOTE: this is per-instance state. It is correct for a single backend instance
 * (our current deployment). For multi-instance scale-out this would need to move
 * to Redis alongside presence — left as a follow-up.
 */

const hosts = new Map(); // roomID -> hostSocketId
const pending = new Map(); // roomID -> Map(socketId -> user)

const lobbyService = {
  getHost(roomID) {
    return hosts.get(roomID) || null;
  },
  setHost(roomID, socketId) {
    hosts.set(roomID, socketId);
  },
  isHost(roomID, socketId) {
    return hosts.get(roomID) === socketId;
  },
  clearHost(roomID) {
    hosts.delete(roomID);
  },

  addPending(roomID, socketId, user) {
    if (!pending.has(roomID)) pending.set(roomID, new Map());
    pending.get(roomID).set(socketId, user);
  },
  removePending(roomID, socketId) {
    const map = pending.get(roomID);
    if (!map) return null;
    const user = map.get(socketId) || null;
    map.delete(socketId);
    if (map.size === 0) pending.delete(roomID);
    return user;
  },
  listPending(roomID) {
    const map = pending.get(roomID);
    if (!map) return [];
    return [...map.entries()].map(([socketId, user]) => ({ socketId, user }));
  },
  clearPending(roomID) {
    pending.delete(roomID);
  },
};

module.exports = lobbyService;
