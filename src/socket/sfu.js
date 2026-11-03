const sfu = require("../services/sfu.service");
const { ROLES } = require("../config/constants");

// A viewer consumes the host's audio + video; a little headroom on top.
const MAX_CONSUMERS = 4;

const transportParams = (t) => ({
  id: t.id,
  iceParameters: t.iceParameters,
  iceCandidates: t.iceCandidates,
  dtlsParameters: t.dtlsParameters,
});

// Request/response for the live-stream SFU. Every handler answers through the
// Socket.IO ack with a result or { error }. socket.data.sfu exists only once
// the socket was admitted to a stream (presence.joinStream), and who may send
// comes from the verified role, never from the payload.
function register(io, socket) {
  const isHost = () => socket.data.role === ROLES.HOST;

  const handle = (event, fn) =>
    socket.on(event, async (payload, ack) => {
      if (typeof ack !== "function") return;
      const peer = socket.data.sfu;
      if (!peer) return ack({ error: "not in a stream" });
      try {
        ack((await fn(peer, payload || {})) || {});
      } catch (err) {
        console.warn(`[sfu] ${event}: ${err.message}`);
        ack({ error: "media server error" });
      }
    });

  handle("sfu:join", async (peer) => ({
    rtpCapabilities: (await sfu.router(peer.roomID)).rtpCapabilities,
    producers: sfu.listProducers(peer.roomID),
  }));

  handle("sfu:create-transport", async (peer, { direction }) => {
    if (direction !== "send" && direction !== "recv") throw new Error("bad direction");
    if (direction === "send" && !isHost()) throw new Error("only the host sends");
    if (direction in peer.transports) throw new Error(`${direction} transport exists`);
    peer.transports[direction] = null; // claim the slot before awaiting
    try {
      const transport = await sfu.createTransport(peer.roomID, direction);
      peer.transports[direction] = transport;
      return transportParams(transport);
    } catch (err) {
      delete peer.transports[direction];
      throw err;
    }
  });

  handle("sfu:connect-transport", async (peer, { direction, dtlsParameters }) => {
    const transport = peer.transports[direction];
    if (!transport) throw new Error("no such transport");
    await transport.connect({ dtlsParameters });
  });

  // The host sends at most one audio and one video track (camera or screen,
  // swapped with replaceTrack on the client).
  handle("sfu:produce", async (peer, { kind, rtpParameters }) => {
    const transport = peer.transports.send;
    if (!transport || !isHost()) throw new Error("not a sender");
    if (kind !== "audio" && kind !== "video") throw new Error("bad kind");
    if (kind in peer.producers) throw new Error(`already sending ${kind}`);
    peer.producers[kind] = null;
    try {
      const producer = await transport.produce({
        kind,
        rtpParameters,
        appData: { socketId: socket.id, user: socket.data.user },
      });
      peer.producers[kind] = producer;
      sfu.addProducer(peer.roomID, producer);
      socket.to(peer.roomID).emit("sfu:new-producer", sfu.describe(producer));
      return { id: producer.id };
    } catch (err) {
      delete peer.producers[kind];
      throw err;
    }
  });

  handle("sfu:consume", async (peer, { producerId, rtpCapabilities }) => {
    const transport = peer.transports.recv;
    if (!transport) throw new Error("no recv transport");
    if (peer.consumers.size >= MAX_CONSUMERS) throw new Error("too many consumers");
    if (!sfu.getProducer(peer.roomID, producerId)) throw new Error("no such producer");
    if ([...peer.consumers.values()].some((c) => c.producerId === producerId)) {
      throw new Error("already consuming");
    }
    const router = await sfu.router(peer.roomID);
    if (!router.canConsume({ producerId, rtpCapabilities })) throw new Error("can't consume");

    // Paused until the client's consumer is ready, so the first keyframe
    // isn't sent into the void.
    const consumer = await transport.consume({ producerId, rtpCapabilities, paused: true });
    peer.consumers.set(consumer.id, consumer);
    consumer.observer.on("close", () => peer.consumers.delete(consumer.id));
    consumer.on("producerclose", () => socket.emit("sfu:consumer-closed", { consumerId: consumer.id }));
    return {
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    };
  });

  handle("sfu:resume", async (peer, { consumerId }) => {
    const consumer = peer.consumers.get(consumerId);
    if (!consumer) throw new Error("no such consumer");
    await consumer.resume();
  });

  socket.on("disconnect", () => {
    if (socket.data.sfu) sfu.leave(socket.data.sfu, socket.id);
  });
}

module.exports = { register };
