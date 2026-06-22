const { Router } = require("express");
const asyncHandler = require("../middleware/asyncHandler");
const { requireAuth } = require("../middleware/auth");
const chatService = require("../services/chat.service");

const router = Router();

// Chat history for a room (used to backfill the chat panel on join).
router.get(
  "/:roomId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const messages = await chatService.history(req.params.roomId);
    res.json({ messages });
  })
);

module.exports = router;
