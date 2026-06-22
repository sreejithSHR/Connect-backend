const prisma = require("../db/prisma");

const roomService = {
  // Create (or reuse) a meeting room. Idempotent on roomID.
  async create({ roomID, hostId }) {
    return prisma.room.upsert({
      where: { id: roomID },
      create: { id: roomID, hostId, mode: "meet" },
      update: {},
    });
  },

  async get(roomID) {
    return prisma.room.findUnique({ where: { id: roomID } });
  },
};

module.exports = roomService;
