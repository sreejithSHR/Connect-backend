const express = require("express");
const cors = require("cors");
const env = require("./config/env");

const healthRoutes = require("./api/health.routes");
const streamRoutes = require("./api/streams.routes");
const roomRoutes = require("./api/rooms.routes");
const messageRoutes = require("./api/messages.routes");
const { notFound, errorHandler } = require("./middleware/error");

const app = express();

app.use(
  cors({
    origin: env.origin,
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));

app.use("/api/health", healthRoutes);
app.use("/api/streams", streamRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/messages", messageRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
