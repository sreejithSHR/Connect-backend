const chatService = require("../services/chat.service");
const { SOCKET_EVENTS } = require("../config/constants");

function register(io, socket) {
  socket.on(SOCKET_EVENTS.SEND_MESSAGE, async (payload = {}) => {
    const { roomID, message } = payload;
    if (!roomID || !message) return;

    const user = socket.data.user;
    const body = String(message).trim().slice(0, 2000);
    if (!body) return;

    // Try to persist, but always relay in real-time — a DB issue (missing
    // migration / FK) must not silence live chat.
    let id = null;
    try {
      const saved = await chatService.save({ roomId: roomID, userId: user.uid, body });
      id = saved?.id || null;
    } catch (err) {
      console.error("[socket] chat persist failed:", err.message);
    }

    io.to(roomID).emit(SOCKET_EVENTS.MESSAGE, {
      id: id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      roomID,
      user: { id: user.uid, name: user.name, profilePic: user.photoURL },
      message: body,
      createdAt: new Date().toISOString(),
    });
  });
}

module.exports = { register };
