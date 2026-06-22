const presenceService = require("../services/presence.service");
const roomService = require("../services/room.service");
const streamService = require("../services/stream.service");
const lobbyService = require("../services/lobby.service");
const { SOCKET_EVENTS, MODES, ROLES } = require("../config/constants");

// Broadcast the current participant list + viewer count to a room.
async function emitRoomState(io, roomID) {
  const members = await presenceService.members(roomID);
  const viewerCount = members.length;
  io.to(roomID).emit(SOCKET_EVENTS.ROOM_STATE, {
    roomID,
    viewerCount,
    hostSocketId: lobbyService.getHost(roomID),
    participants: members.map((m) => ({
      socketId: m.userId,
      user: m.user,
      role: m.role,
    })),
  });
  streamService.recordViewerCount(roomID, viewerCount).catch(() => {});
}

// Add a socket to the room for real: join, register presence, hand it the list
// of existing peers so it can build connections.
async function completeJoin(io, socket, roomID, role) {
  const user = socket.data.user;
  socket.join(roomID);
  const existing = await presenceService.members(roomID, socket.id);
  await presenceService.join(roomID, socket.id, { user, role });
  socket.emit(SOCKET_EVENTS.ALL_USERS, existing);
  await emitRoomState(io, roomID);
}

function register(io, socket) {
  socket.on(SOCKET_EVENTS.JOIN_ROOM, async (payload = {}) => {
    try {
      const { roomID, mode = MODES.MEET, role = ROLES.PARTICIPANT } = payload;
      if (!roomID) return;

      socket.data.roomID = roomID;
      socket.data.mode = mode;
      socket.data.role = role;

      // Streams are public (Twitch-style): host + viewers join immediately.
      if (mode === MODES.STREAM) {
        await completeJoin(io, socket, roomID, role);
        socket.emit(SOCKET_EVENTS.ADMITTED, { host: role === ROLES.HOST });
        return;
      }

      // Meetings use a lobby: the first person becomes host; others must be admitted.
      const hostId = lobbyService.getHost(roomID);
      if (!hostId) {
        lobbyService.setHost(roomID, socket.id);
        socket.data.isHost = true;
        roomService.create({ roomID, hostId: socket.data.user.uid }).catch(() => {});
        await completeJoin(io, socket, roomID, ROLES.PARTICIPANT);
        socket.emit(SOCKET_EVENTS.ADMITTED, { host: true });
      } else {
        lobbyService.addPending(roomID, socket.id, socket.data.user);
        socket.data.waiting = true;
        socket.emit(SOCKET_EVENTS.WAITING);
        io.to(hostId).emit(SOCKET_EVENTS.JOIN_REQUEST, {
          socketId: socket.id,
          user: socket.data.user,
        });
      }
    } catch (err) {
      console.error("[socket] join room error:", err.message);
      socket.emit(SOCKET_EVENTS.ERROR, { message: "Failed to join room" });
    }
  });

  // Host admits a waiting guest.
  socket.on(SOCKET_EVENTS.ADMIT, async ({ roomID, socketId } = {}) => {
    if (!roomID || !lobbyService.isHost(roomID, socket.id)) return;
    const user = lobbyService.removePending(roomID, socketId);
    if (!user) return;
    const guest = io.sockets.sockets.get(socketId);
    socket.emit(SOCKET_EVENTS.REQUEST_HANDLED, { socketId });
    if (!guest) return;
    guest.data.waiting = false;
    await completeJoin(io, guest, roomID, ROLES.PARTICIPANT);
    guest.emit(SOCKET_EVENTS.ADMITTED, { host: false });
  });

  // Host declines a waiting guest.
  socket.on(SOCKET_EVENTS.DENY, ({ roomID, socketId } = {}) => {
    if (!roomID || !lobbyService.isHost(roomID, socket.id)) return;
    lobbyService.removePending(roomID, socketId);
    io.to(socketId).emit(SOCKET_EVENTS.DENIED);
    socket.emit(SOCKET_EVENTS.REQUEST_HANDLED, { socketId });
  });

  // ---- Host moderation (host-only) ----
  socket.on(SOCKET_EVENTS.FORCE_MUTE, ({ roomID, socketId } = {}) => {
    if (roomID && lobbyService.isHost(roomID, socket.id)) {
      io.to(socketId).emit(SOCKET_EVENTS.FORCE_MUTE);
    }
  });

  socket.on(SOCKET_EVENTS.FORCE_CAMERA_OFF, ({ roomID, socketId } = {}) => {
    if (roomID && lobbyService.isHost(roomID, socket.id)) {
      io.to(socketId).emit(SOCKET_EVENTS.FORCE_CAMERA_OFF);
    }
  });

  socket.on(SOCKET_EVENTS.SET_CHAT_DISABLED, ({ roomID, disabled } = {}) => {
    if (roomID && lobbyService.isHost(roomID, socket.id)) {
      lobbyService.setChatDisabled(roomID, disabled);
      io.to(roomID).emit(SOCKET_EVENTS.CHAT_DISABLED, { disabled: !!disabled });
    }
  });

  socket.on(SOCKET_EVENTS.MEDIA_STATE, ({ roomID, kind, enabled } = {}) => {
    if (!roomID) return;
    socket.to(roomID).emit(SOCKET_EVENTS.MEDIA_STATE, {
      socketId: socket.id,
      kind,
      enabled,
    });
  });

  socket.on("disconnect", async () => {
    const { roomID, role, mode, waiting } = socket.data;
    if (!roomID) return;
    try {
      // A waiting guest just leaves the lobby.
      if (waiting) {
        lobbyService.removePending(roomID, socket.id);
        const hostId = lobbyService.getHost(roomID);
        if (hostId) io.to(hostId).emit(SOCKET_EVENTS.REQUEST_HANDLED, { socketId: socket.id });
        return;
      }

      await presenceService.leave(roomID, socket.id);
      socket.to(roomID).emit(SOCKET_EVENTS.USER_LEFT, socket.id);

      // Host left a meeting -> promote the next participant and hand over pending.
      if (mode === MODES.MEET && lobbyService.isHost(roomID, socket.id)) {
        lobbyService.clearHost(roomID);
        const members = await presenceService.members(roomID, socket.id);
        if (members.length) {
          const next = members[0];
          lobbyService.setHost(roomID, next.userId);
          io.to(next.userId).emit(SOCKET_EVENTS.HOST_CHANGED, { youAreHost: true });
          lobbyService
            .listPending(roomID)
            .forEach((p) =>
              io.to(next.userId).emit(SOCKET_EVENTS.JOIN_REQUEST, {
                socketId: p.socketId,
                user: p.user,
              })
            );
        } else {
          lobbyService.clearPending(roomID);
        }
      }

      await emitRoomState(io, roomID);

      // Broadcaster left a stream -> end it.
      if (mode === MODES.STREAM && role === ROLES.HOST) {
        await streamService.end(roomID, socket.data.user?.uid).catch(() => {});
        io.to(roomID).emit(SOCKET_EVENTS.STREAM_ENDED, { roomID });
      }
    } catch (err) {
      console.error("[socket] disconnect cleanup error:", err.message);
    }
  });
}

module.exports = { register, emitRoomState };
