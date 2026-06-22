const { Router } = require("express");
const { usingRedis } = require("../db/redis");

const router = Router();

router.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "connect-server",
    redis: usingRedis ? "connected" : "in-memory-fallback",
    time: new Date().toISOString(),
  });
});

module.exports = router;
