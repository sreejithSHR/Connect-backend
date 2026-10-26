const express = require("express");
const cors = require("cors");
const env = require("./config/env");

const healthRoutes = require("./api/health.routes");
const streamRoutes = require("./api/streams.routes");
const roomRoutes = require("./api/rooms.routes");
const messageRoutes = require("./api/messages.routes");
const iceRoutes = require("./api/ice.routes");
const authRoutes = require("./api/auth.routes");
const { notFound, errorHandler } = require("./middleware/error");

const app = express();
// One reverse proxy (Coolify's Traefik) in front: use its X-Forwarded-For as
// the client IP, so auth rate limits are per user rather than per proxy.
app.set("trust proxy", 1);

app.use(
  cors({
    origin: env.origin,
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));

app.use("/api/health", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/streams", streamRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/ice", iceRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
