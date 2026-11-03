const mediasoup = require("mediasoup");
const env = require("../config/env");

// Live streams go through this SFU: the host uploads ONE copy and mediasoup's
// C++ worker forwards the packets to every viewer, so the host's upload no
// longer grows with the audience. Meetings stay peer-to-peer.

// Opus + VP8 work in every browser, and VP8 simulcast lets each viewer receive
// the layer their connection can take.
const MEDIA_CODECS = [
  { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: { "x-google-start-bitrate": 1000 },
  },
];

let worker = null;
let webRtcServer = null;
// roomID -> { router: Promise<Router>, producers: Map<id, Producer>, sockets: Set<socketId> }
const rooms = new Map();

async function init() {
  if (!env.sfu.announcedAddress) {
    console.warn("[sfu] SFU_ANNOUNCED_IP not set: streams stay peer-to-peer");
    return;
  }
  try {
    worker = await mediasoup.createWorker({ logLevel: "warn" });
    // The worker carries every live stream; if it dies they are all dead, so
    // let Docker restart the backend instead of limping on without media.
    worker.on("died", (err) => {
      console.error("[sfu] mediasoup worker died:", err?.message);
      process.exit(1);
    });
    // One UDP port (TCP fallback) for all streams: one firewall rule, and
    // nothing to change as the audience grows.
    const listen = (protocol) => ({
      protocol,
      ip: "0.0.0.0",
      announcedAddress: env.sfu.announcedAddress,
      port: env.sfu.port,
    });
    webRtcServer = await worker.createWebRtcServer({ listenInfos: [listen("udp"), listen("tcp")] });
    console.log(
      `[sfu] mediasoup ${mediasoup.version} on ${env.sfu.announcedAddress}:${env.sfu.port} (udp+tcp)`
    );
  } catch (err) {
    console.error("[sfu] failed to start, streams stay peer-to-peer:", err.message);
    worker?.close();
    worker = null;
    webRtcServer = null;
  }
}

const enabled = () => !!webRtcServer;

// Register a socket in a room's SFU and return its per-socket state.
function join(roomID, socketId) {
  let room = rooms.get(roomID);
  if (!room) {
    room = { router: worker.createRouter({ mediaCodecs: MEDIA_CODECS }), producers: new Map(), sockets: new Set() };
    room.router.catch(() => rooms.delete(roomID));
    rooms.set(roomID, room);
  }
  room.sockets.add(socketId);
  return { roomID, transports: {}, producers: {}, consumers: new Map() };
}

// Close everything a socket opened (its producers end the viewers' consumers),
// and the room's router once the last socket is gone.
function leave(peer, socketId) {
  Object.values(peer.transports).forEach((t) => t?.close());
  const room = rooms.get(peer.roomID);
  if (!room) return;
  room.sockets.delete(socketId);
  if (room.sockets.size) return;
  rooms.delete(peer.roomID);
  room.router.then((r) => r.close()).catch(() => {});
}

const router = (roomID) => rooms.get(roomID).router;

async function createTransport(roomID, direction) {
  const transport = await (await router(roomID)).createWebRtcTransport({
    webRtcServer,
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate: 1_000_000,
  });
  if (direction === "send") await transport.setMaxIncomingBitrate(env.sfu.maxIncomingBitrate);
  return transport;
}

const describe = (p) => ({ id: p.id, kind: p.kind, socketId: p.appData.socketId, user: p.appData.user });

function addProducer(roomID, producer) {
  const room = rooms.get(roomID);
  room.producers.set(producer.id, producer);
  producer.observer.on("close", () => room.producers.delete(producer.id));
}

const getProducer = (roomID, id) => rooms.get(roomID)?.producers.get(id);
const listProducers = (roomID) => [...(rooms.get(roomID)?.producers.values() || [])].map(describe);

module.exports = {
  init,
  enabled,
  join,
  leave,
  router,
  createTransport,
  describe,
  addProducer,
  getProducer,
  listProducers,
};
