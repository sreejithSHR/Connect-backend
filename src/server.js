const http = require("http");
const env = require("./config/env");
const app = require("./app");
const { initSocket } = require("./socket");
const { init: initFirebase } = require("./auth/firebaseAdmin");

initFirebase();

const server = http.createServer(app);
initSocket(server);

server.listen(env.port, () => {
  console.log(`[connect] server listening on http://localhost:${env.port} (${env.nodeEnv})`);
});

const shutdown = (signal) => {
  console.log(`\n[connect] ${signal} received, shutting down...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
