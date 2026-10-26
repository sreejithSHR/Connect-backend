const presenceService = require("../services/presence.service");
const { SOCKET_EVENTS, MODES, ROLES } = require("../config/constants");

// May this socket exchange WebRTC signals with `targetId`? Both must be admitted
// to the same room; in a stream, media only flows between the host and a viewer.
async function canSignal(socket, targetId) {
  const { roomID, joined, mode, role } = socket.data;
  if (!joined || typeof targetId !== "string" || targetId === socket.id) return false;
  const target = await presenceService.get(roomID, targetId);
  if (!target) return false;
  if (mode === MODES.STREAM) return role === ROLES.HOST || target.role === ROLES.HOST;
  return true;
}

// WebRTC signaling passthrough. Identity/role are taken from the authenticated
// socket, never from client-supplied payload fields.
function register(io, socket) {
  socket.on(SOCKET_EVENTS.SENDING_SIGNAL, async (payload = {}) => {
    if (!(await canSignal(socket, payload.userToSignal))) return;
    io.to(payload.userToSignal).emit(SOCKET_EVENTS.USER_JOINED, {
      signal: payload.signal,
      callerID: socket.id,
      user: socket.data.user,
      role: socket.data.role,
    });
  });

  socket.on(SOCKET_EVENTS.RETURNING_SIGNAL, async (payload = {}) => {
    if (!(await canSignal(socket, payload.callerID))) return;
    io.to(payload.callerID).emit(SOCKET_EVENTS.RECEIVING_RETURNED_SIGNAL, {
      signal: payload.signal,
      id: socket.id,
    });
  });
}

module.exports = { register };
