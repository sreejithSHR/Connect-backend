const presenceService = require("../services/presence.service");
const roomService = require("../services/room.service");
const streamService = require("../services/stream.service");
const { SOCKET_EVENTS, MODES, ROLES } = require("../config/constants");

// Broadcast the current participant list + viewer count to a room.
async function emitRoomState(io, roomID) {
  const members = await presenceService.members(roomID);
  const viewerCount = members.length;
  io.to(roomID).emit(SOCKET_EVENTS.ROOM_STATE, {
    roomID,
    viewerCount,
    participants: members.map((m) => ({
      socketId: m.userId,
      user: m.user,
      role: m.role,
    })),
  });
  // Keep peakViewers accurate for streams.
  streamService.recordViewerCount(roomID, viewerCount).catch(() => {});
}

function register(io, socket) {
  socket.on(SOCKET_EVENTS.JOIN_ROOM, async (payload = {}) => {
    try {
      const { roomID, mode = MODES.MEET, role = ROLES.PARTICIPANT } = payload;
      if (!roomID) return;

      const user = socket.data.user; // server-authoritative identity
      socket.data.roomID = roomID;
      socket.data.role = role;
      socket.data.mode = mode;

      socket.join(roomID);

      // Existing members BEFORE adding self -> the joiner builds peers from these.
      const existing = await presenceService.members(roomID, socket.id);
      await presenceService.join(roomID, socket.id, { user, role });

      if (mode === MODES.MEET) {
        roomService.create({ roomID, hostId: user.uid }).catch(() => {});
      }

      socket.emit(SOCKET_EVENTS.ALL_USERS, existing);
      await emitRoomState(io, roomID);
    } catch (err) {
      console.error("[socket] join room error:", err.message);
      socket.emit(SOCKET_EVENTS.ERROR, { message: "Failed to join room" });
    }
  });

  // Mic/cam on-off broadcast so peers can update indicators.
  socket.on(SOCKET_EVENTS.MEDIA_STATE, ({ roomID, kind, enabled } = {}) => {
    if (!roomID) return;
    socket.to(roomID).emit(SOCKET_EVENTS.MEDIA_STATE, {
      socketId: socket.id,
      kind,
      enabled,
    });
  });

  socket.on("disconnect", async () => {
    const { roomID, role, mode, user } = socket.data;
    if (!roomID) return;
    try {
      await presenceService.leave(roomID, socket.id);
      socket.to(roomID).emit(SOCKET_EVENTS.USER_LEFT, socket.id);
      await emitRoomState(io, roomID);

      // If the broadcaster leaves, the stream is over.
      if (mode === MODES.STREAM && role === ROLES.HOST) {
        await streamService.end(roomID, user?.uid).catch(() => {});
        io.to(roomID).emit(SOCKET_EVENTS.STREAM_ENDED, { roomID });
      }
    } catch (err) {
      console.error("[socket] disconnect cleanup error:", err.message);
    }
  });
}

module.exports = { register, emitRoomState };
