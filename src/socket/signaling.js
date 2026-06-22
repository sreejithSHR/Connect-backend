const { SOCKET_EVENTS } = require("../config/constants");

// WebRTC signaling passthrough. Identity/role are taken from the authenticated
// socket, never from client-supplied payload fields.
function register(io, socket) {
  socket.on(SOCKET_EVENTS.SENDING_SIGNAL, (payload = {}) => {
    io.to(payload.userToSignal).emit(SOCKET_EVENTS.USER_JOINED, {
      signal: payload.signal,
      callerID: payload.callerID,
      user: socket.data.user,
      role: socket.data.role,
    });
  });

  socket.on(SOCKET_EVENTS.RETURNING_SIGNAL, (payload = {}) => {
    io.to(payload.callerID).emit(SOCKET_EVENTS.RECEIVING_RETURNED_SIGNAL, {
      signal: payload.signal,
      id: socket.id,
    });
  });
}

module.exports = { register };
