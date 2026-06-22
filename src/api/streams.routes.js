const { Router } = require("express");
const { z } = require("zod");
const createError = require("http-errors");
const asyncHandler = require("../middleware/asyncHandler");
const { requireAuth } = require("../middleware/auth");
const streamService = require("../services/stream.service");
const { MEDIA_MODES } = require("../config/constants");

const router = Router();

// Public-ish: list of live streams for the Browse directory (still requires auth
// so we have a known viewer identity; relax if you want anonymous browsing).
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const streams = await streamService.listLive();
    res.json({ streams });
  })
);

router.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const stream = await streamService.get(req.params.id);
    if (!stream) throw createError(404, "Stream not found");
    res.json({ stream });
  })
);

const goLiveSchema = z.object({
  roomID: z.string().min(1),
  title: z.string().max(140).optional(),
  category: z.string().max(80).optional(),
  mediaMode: z.enum([MEDIA_MODES.INTERACTIVE, MEDIA_MODES.HLS]).optional(),
});

router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = goLiveSchema.safeParse(req.body);
    if (!parsed.success) throw createError(400, parsed.error.issues[0].message);
    const stream = await streamService.goLive({
      ...parsed.data,
      hostId: req.user.uid,
    });
    res.status(201).json({ stream });
  })
);

router.patch(
  "/:id/end",
  requireAuth,
  asyncHandler(async (req, res) => {
    const stream = await streamService.end(req.params.id, req.user.uid);
    if (!stream) throw createError(404, "Stream not found");
    res.json({ stream });
  })
);

module.exports = router;
