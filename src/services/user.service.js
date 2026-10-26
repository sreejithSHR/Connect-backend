const prisma = require("../db/prisma");

const userService = {
  async byId(id) {
    return prisma.user.findUnique({ where: { id } });
  },
};

module.exports = userService;
