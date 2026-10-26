const createError = require("http-errors");
const prisma = require("../db/prisma");
const presenceService = require("./presence.service");
const { MEDIA_MODES } = require("../config/constants");

const streamService = {
  // Host goes live. Idempotent on roomID (re-going-live reuses the row), but only
  // for the stream's original host, and never on a meeting's id.
  async goLive({ roomID, hostId, title, category, mediaMode }) {
    const [existing, meeting] = await Promise.all([
      prisma.stream.findUnique({ where: { id: roomID } }),
      prisma.room.findUnique({ where: { id: roomID } }),
    ]);
    if (existing && existing.hostId !== hostId) throw createError(403, "Not your stream");
    if (meeting) throw createError(409, "This id belongs to a meeting");

    const data = {
      hostId,
      title: title?.trim() || "Untitled Stream",
      category: category?.trim() || "Just Chatting",
      mediaMode: mediaMode === MEDIA_MODES.HLS ? MEDIA_MODES.HLS : MEDIA_MODES.INTERACTIVE,
      isLive: true,
      endedAt: null,
    };
    return prisma.stream.upsert({
      where: { id: roomID },
      create: { id: roomID, ...data, startedAt: new Date() },
      update: { ...data, startedAt: new Date() },
    });
  },

  async end(roomID, hostId) {
    const stream = await prisma.stream.findUnique({ where: { id: roomID } });
    if (!stream) return null;
    // Only the host may end their stream via REST.
    if (hostId && stream.hostId !== hostId) return stream;
    await presenceService.clear(roomID);
    return prisma.stream.update({
      where: { id: roomID },
      data: { isLive: false, endedAt: new Date() },
    });
  },

  // Raw row, used by the socket layer to decide mode + role server-side.
  async byId(roomID) {
    return prisma.stream.findUnique({ where: { id: roomID } });
  },

  async get(roomID) {
    const stream = await prisma.stream.findUnique({
      where: { id: roomID },
      include: { host: { select: { id: true, name: true, photoURL: true } } },
    });
    if (!stream) return null;
    const viewers = await presenceService.count(roomID);
    return { ...stream, viewers };
  },

  // Live directory for the Browse page, enriched with live viewer counts.
  async listLive() {
    const streams = await prisma.stream.findMany({
      where: { isLive: true },
      orderBy: { startedAt: "desc" },
      include: { host: { select: { id: true, name: true, photoURL: true } } },
    });
    return Promise.all(
      streams.map(async (s) => ({
        ...s,
        viewers: await presenceService.count(s.id),
      }))
    );
  },

  // Keep peakViewers accurate as audiences grow (called from socket presence updates).
  async recordViewerCount(roomID, viewers) {
    const stream = await prisma.stream.findUnique({ where: { id: roomID } });
    if (!stream || !stream.isLive) return;
    if (viewers > stream.peakViewers) {
      await prisma.stream.update({ where: { id: roomID }, data: { peakViewers: viewers } });
    }
  },
};

module.exports = streamService;
