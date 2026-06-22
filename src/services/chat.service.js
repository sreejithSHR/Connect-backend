const prisma = require("../db/prisma");

const chatService = {
  async save({ roomId, userId, body }) {
    const trimmed = (body || "").trim();
    if (!trimmed) return null;
    return prisma.message.create({
      data: { roomId, userId, body: trimmed.slice(0, 2000) },
      include: { user: { select: { id: true, name: true, photoURL: true } } },
    });
  },

  async history(roomId, limit = 100) {
    const rows = await prisma.message.findMany({
      where: { roomId },
      orderBy: { createdAt: "asc" },
      take: limit,
      include: { user: { select: { id: true, name: true, photoURL: true } } },
    });
    return rows;
  },
};

module.exports = chatService;
