const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");

const env = require("../config/env");
const { pubClient, subClient, usingRedis } = require("../db/redis");
const { verifyIdToken } = require("../auth/firebaseAdmin");
const userService = require("../services/user.service");

const presence = require("./presence");
const signaling = require("./signaling");
const chat = require("./chat");

function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.origin, credentials: true },
  });

  // Horizontal scale-out: share rooms/broadcasts across instances.
  if (usingRedis && pubClient && subClient) {
    io.adapter(createAdapter(pubClient, subClient));
    console.log("[socket] Redis adapter enabled (multi-instance ready)");
  } else {
    console.warn("[socket] single-instance mode (no Redis adapter)");
  }

  // Authenticated handshake — identity comes from a verified Firebase token.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const user = await verifyIdToken(token);
      if (!user?.uid) return next(new Error("unauthorized"));
      await userService.upsert(user);
      socket.data.user = user;
      next();
    } catch (err) {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    presence.register(io, socket);
    signaling.register(io, socket);
    chat.register(io, socket);
  });

  return io;
}

module.exports = { initSocket };
