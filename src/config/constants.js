// Shared domain constants. Kept in sync with the client's src/config.js.

const ROLES = Object.freeze({
  PARTICIPANT: "participant", // meet: sends + receives (mesh)
  HOST: "host", // stream: broadcaster (uploads media)
  VIEWER: "viewer", // stream: receive-only (never uploads)
});

const MODES = Object.freeze({
  MEET: "meet",
  STREAM: "stream",
});

const MEDIA_MODES = Object.freeze({
  INTERACTIVE: "interactive", // simple-peer WebRTC
  HLS: "hls", // phase 2: HLS/CDN distribution
});

// Phase-2 seam: when a stream's viewer count crosses this threshold, new viewers
// would be moved to an HLS feed instead of a WebRTC peer. Not active yet.
const VIEWER_HLS_THRESHOLD = 50;

const SOCKET_EVENTS = Object.freeze({
  JOIN_ROOM: "join room",
  ALL_USERS: "all users",
  USER_JOINED: "user joined",
  SENDING_SIGNAL: "sending signal",
  RETURNING_SIGNAL: "returning signal",
  RECEIVING_RETURNED_SIGNAL: "receiving returned signal",
  USER_LEFT: "user left",
  ROOM_STATE: "room state",
  SEND_MESSAGE: "send message",
  MESSAGE: "message",
  MEDIA_STATE: "media state",
  STREAM_ENDED: "stream ended",
  ERROR: "error",
});

module.exports = { ROLES, MODES, MEDIA_MODES, VIEWER_HLS_THRESHOLD, SOCKET_EVENTS };
