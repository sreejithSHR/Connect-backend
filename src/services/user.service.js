const prisma = require("../db/prisma");

const userService = {
  // Upsert from a verified token identity so FK references stay valid.
  async upsert({ uid, email, name, photoURL }) {
    return prisma.user.upsert({
      where: { id: uid },
      create: { id: uid, email, name, photoURL },
      update: { email, name, photoURL },
    });
  },

  async byId(id) {
    return prisma.user.findUnique({ where: { id } });
  },
};

module.exports = userService;
