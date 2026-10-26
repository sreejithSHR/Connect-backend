const env = require("../config/env");
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

// The room this socket was actually admitted to, or null. Every room-scoped
// event uses this instead of a client-supplied roomID.
const joinedRoom = (socket) => (socket.data.joined ? socket.data.roomID : null);

// Add a socket to the room for real: join, register presence, hand it the list
// of existing peers so it can build connections.
async function completeJoin(io, socket, roomID, role) {
  const user = socket.data.user;
  socket.data.role = role;
  socket.data.joined = true;
  socket.join(roomID);
  const existing = await presenceService.members(roomID, socket.id);
  await presenceService.join(roomID, socket.id, { user, role });
  socket.emit(SOCKET_EVENTS.ALL_USERS, existing);
  await emitRoomState(io, roomID);
}

// Stream join: the host is whoever owns the live Stream row; everyone else is a
// viewer, regardless of what the client asked for.
async function joinStream(io, socket, roomID, requestedRole) {
  const stream = await streamService.byId(roomID);
  if (!stream || !stream.isLive) {
    socket.emit(SOCKET_EVENTS.STREAM_ENDED, { roomID });
    return;
  }

  const role =
    requestedRole === ROLES.HOST && stream.hostId === socket.data.user.uid
      ? ROLES.HOST
      : ROLES.VIEWER;

  if (role === ROLES.VIEWER) {
    const members = await presenceService.members(roomID);
    const viewers = members.filter((m) => m.role === ROLES.VIEWER).length;
    if (viewers >= env.streamMaxViewers) {
      socket.emit(SOCKET_EVENTS.ROOM_FULL, { max: env.streamMaxViewers });
      return;
    }
  }

  socket.data.roomID = roomID;
  socket.data.mode = MODES.STREAM;
  await completeJoin(io, socket, roomID, role);
  socket.emit(SOCKET_EVENTS.ADMITTED, { host: role === ROLES.HOST, role });
}

// Meetings use a lobby: the first person becomes host; others must be admitted.
async function joinMeeting(io, socket, roomID) {
  // A stream id can't be joined as a meeting (that would skip viewer-only mode).
  // If the DB is unreachable, fall through: meetings don't otherwise need it.
  const stream = await streamService.byId(roomID).catch(() => null);
  if (stream) {
    socket.emit(SOCKET_EVENTS.ERROR, { message: "This link is a live stream, not a meeting" });
    return;
  }

  socket.data.roomID = roomID;
  socket.data.mode = MODES.MEET;

  const hostId = lobbyService.getHost(roomID);
  if (!hostId) {
    lobbyService.setHost(roomID, socket.id);
    socket.data.isHost = true;
    roomService.create({ roomID, hostId: socket.data.user.uid }).catch(() => {});
    await completeJoin(io, socket, roomID, ROLES.PARTICIPANT);
    socket.emit(SOCKET_EVENTS.ADMITTED, { host: true, role: ROLES.PARTICIPANT });
    return;
  }

  lobbyService.addPending(roomID, socket.id, socket.data.user);
  socket.data.waiting = true;
  socket.emit(SOCKET_EVENTS.WAITING);
  io.to(hostId).emit(SOCKET_EVENTS.JOIN_REQUEST, {
    socketId: socket.id,
    user: socket.data.user,
  });
}

function register(io, socket) {
  socket.on(SOCKET_EVENTS.JOIN_ROOM, async (payload = {}) => {
    try {
      const { roomID, mode = MODES.MEET, role } = payload;
      if (!roomID || typeof roomID !== "string") return;
      // One room per socket: re-joining could be used to dodge the lobby.
      if (socket.data.roomID) return;

      if (mode === MODES.STREAM) await joinStream(io, socket, roomID, role);
      else await joinMeeting(io, socket, roomID);
    } catch (err) {
      console.error("[socket] join room error:", err.message);
      socket.emit(SOCKET_EVENTS.ERROR, { message: "Failed to join room" });
    }
  });

  // Host admits a waiting guest.
  socket.on(SOCKET_EVENTS.ADMIT, async ({ socketId } = {}) => {
    const roomID = joinedRoom(socket);
    if (!roomID || !lobbyService.isHost(roomID, socket.id)) return;
    const user = lobbyService.removePending(roomID, socketId);
    if (!user) return;
    socket.emit(SOCKET_EVENTS.REQUEST_HANDLED, { socketId });
    // NOTE: the lobby is per-instance, so the guest must be on this instance.
    const guest = io.sockets.sockets.get(socketId);
    if (!guest) return;

    if ((await presenceService.count(roomID)) >= env.meetMaxParticipants) {
      guest.emit(SOCKET_EVENTS.ROOM_FULL, { max: env.meetMaxParticipants });
      return;
    }
    guest.data.waiting = false;
    await completeJoin(io, guest, roomID, ROLES.PARTICIPANT);
    guest.emit(SOCKET_EVENTS.ADMITTED, { host: false, role: ROLES.PARTICIPANT });
  });

  // Host declines a waiting guest.
  socket.on(SOCKET_EVENTS.DENY, ({ socketId } = {}) => {
    const roomID = joinedRoom(socket);
    if (!roomID || !lobbyService.isHost(roomID, socket.id)) return;
    if (!lobbyService.removePending(roomID, socketId)) return;
    io.to(socketId).emit(SOCKET_EVENTS.DENIED);
    socket.emit(SOCKET_EVENTS.REQUEST_HANDLED, { socketId });
  });

  // ---- Host moderation (host-only, target must be in the host's room) ----
  const moderate = (event) => async ({ socketId } = {}) => {
    const roomID = joinedRoom(socket);
    if (!roomID || !lobbyService.isHost(roomID, socket.id)) return;
    if (!(await presenceService.get(roomID, socketId))) return;
    io.to(socketId).emit(event);
  };
  socket.on(SOCKET_EVENTS.FORCE_MUTE, moderate(SOCKET_EVENTS.FORCE_MUTE));
  socket.on(SOCKET_EVENTS.FORCE_CAMERA_OFF, moderate(SOCKET_EVENTS.FORCE_CAMERA_OFF));

  socket.on(SOCKET_EVENTS.SET_CHAT_DISABLED, ({ disabled } = {}) => {
    const roomID = joinedRoom(socket);
    if (roomID && lobbyService.isHost(roomID, socket.id)) {
      lobbyService.setChatDisabled(roomID, disabled);
      io.to(roomID).emit(SOCKET_EVENTS.CHAT_DISABLED, { disabled: !!disabled });
    }
  });

  socket.on(SOCKET_EVENTS.MEDIA_STATE, ({ kind, enabled } = {}) => {
    const roomID = joinedRoom(socket);
    if (!roomID || (kind !== "audio" && kind !== "video")) return;
    socket.to(roomID).emit(SOCKET_EVENTS.MEDIA_STATE, {
      socketId: socket.id,
      kind,
      enabled: !!enabled,
    });
  });

  // Live captions: relay a final transcript line to the rest of the room.
  // Only people who send audio (not stream viewers) can caption.
  socket.on(SOCKET_EVENTS.CAPTION, ({ text } = {}) => {
    const roomID = joinedRoom(socket);
    if (!roomID || !text || socket.data.role === ROLES.VIEWER) return;
    socket.to(roomID).emit(SOCKET_EVENTS.CAPTION, {
      socketId: socket.id,
      user: socket.data.user,
      text: String(text).slice(0, 500),
      ts: Date.now(),
    });
  });

  socket.on("disconnect", async () => {
    const { roomID, role, mode, waiting, joined } = socket.data;
    if (!roomID) return;
    try {
      // A waiting guest just leaves the lobby.
      if (waiting) {
        lobbyService.removePending(roomID, socket.id);
        const hostId = lobbyService.getHost(roomID);
        if (hostId) io.to(hostId).emit(SOCKET_EVENTS.REQUEST_HANDLED, { socketId: socket.id });
        return;
      }
      if (!joined) return;

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

      // Broadcaster left a stream -> end it. `role` was verified against the
      // Stream row at join time, so only the real host can trigger this.
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
