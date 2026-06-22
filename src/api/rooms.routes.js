const { Router } = require("express");
const { z } = require("zod");
const asyncHandler = require("../middleware/asyncHandler");
const { requireAuth } = require("../middleware/auth");
const roomService = require("../services/room.service");

const router = Router();

const createSchema = z.object({ roomID: z.string().min(1) });

router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const room = await roomService.create({ roomID: parsed.data.roomID, hostId: req.user.uid });
    res.status(201).json({ room });
  })
);

router.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const room = await roomService.get(req.params.id);
    res.json({ room });
  })
);

module.exports = router;
