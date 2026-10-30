const express = require("express");
const router  = express.Router();
const { getNotifications, markNotificationsRead } = require("../db");
const { requireAuth } = require("../auth");

router.use(requireAuth);

// GET /api/notifications — latest 30 for the caller + unread count
router.get("/", async function(req, res, next) {
  try {
    res.json(await getNotifications(req.user.id, 30));
  } catch (err) { next(err); }
});

// POST /api/notifications/read  { ids?: [...], sessionId?: "..." } — no body marks everything read
router.post("/read", async function(req, res, next) {
  try {
    const body = req.body || {};
    await markNotificationsRead(req.user.id, Array.isArray(body.ids) ? body.ids.slice(0, 100) : null,
      typeof body.sessionId === "string" ? body.sessionId : null);
    res.json(await getNotifications(req.user.id, 30));
  } catch (err) { next(err); }
});

module.exports = router;
