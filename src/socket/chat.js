const chatService = require("../services/chat.service");
const { SOCKET_EVENTS } = require("../config/constants");

function register(io, socket) {
  socket.on(SOCKET_EVENTS.SEND_MESSAGE, async (payload = {}) => {
    const { roomID, message } = payload;
    if (!roomID || !message) return;
    try {
      const saved = await chatService.save({
        roomId: roomID,
        userId: socket.data.user.uid,
        body: message,
      });
      if (!saved) return;

      // Room-scoped (fixes the old global io.emit broadcast) + cross-instance
      // via the Redis adapter.
      io.to(roomID).emit(SOCKET_EVENTS.MESSAGE, {
        id: saved.id,
        roomID,
        user: {
          id: saved.user.id,
          name: saved.user.name,
          profilePic: saved.user.photoURL,
        },
        message: saved.body,
        createdAt: saved.createdAt,
      });
    } catch (err) {
      console.error("[socket] send message error:", err.message);
    }
  });
}

module.exports = { register };
