const express = require("express");
const router  = express.Router();
const {
  getSessions, getSessionById, upsertSession, deleteSession,
  getFeedback, createFeedback, updateFeedback, deleteFeedback, getFeedbackById,
  createShare, getSharesForSession, deleteShare, getShareRecord,
  getOrgUsers,
} = require("../db");
const { requireAuth } = require("../auth");

router.use(requireAuth);

// GET /api/sessions/org-users — all authenticated users can fetch their org's user list (for sharing)
router.get("/org-users", async function(req, res, next) {
  try {
    var users = await getOrgUsers(req.user.orgId);
    res.json(users.map(function(u) {
      return { id: u.id, displayName: u.displayName, email: u.email, role: u.role };
    }));
  } catch (err) { next(err); }
});

// Parse scope query param for admins:
//   ?scope=self | user:{id} | users:{id,id,...} | team:{id} | org
function parseScope(scopeStr) {
  if (!scopeStr || scopeStr === "self") return null;
  if (scopeStr === "org") return { type: "org" };
  if (scopeStr.startsWith("user:"))  return { type: "user",  userId:  scopeStr.slice(5) };
  if (scopeStr.startsWith("team:"))  return { type: "team",  teamId:  scopeStr.slice(5) };
  if (scopeStr.startsWith("users:")) {
    const ids = scopeStr.slice(6).split(",").filter(Boolean);
    return { type: "users", userIds: ids };
  }
  return null;
}

// GET /api/sessions
router.get("/", async function(req, res, next) {
  try {
    const { scope, deckId, mode, outcome, from, to } = req.query;
    const filters = { deckId, mode, outcome, from, to };

    let parsedScope = null;
    if (req.user.role === "admin" && scope) {
      parsedScope = parseScope(scope);
    }

    const sessions = await getSessions(parsedScope, req.user.orgId, req.user.id, filters);
    res.json(sessions);
  } catch (err) { next(err); }
});

// POST /api/sessions  (upsert)
router.post("/", async function(req, res, next) {
  try {
    if (!req.body || !req.body.id) {
      return res.status(400).json({ error: "Session id is required" });
    }
    const session = await upsertSession(req.body, req.user.id, req.user.orgId);
    res.json({ ok: true, session });
  } catch (err) { next(err); }
});

// DELETE /api/sessions/:id
router.delete("/:id", async function(req, res, next) {
  try {
    const existing = await getSessionById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Session not found" });

    // Admins in the same org can delete any session; users can only delete their own
    const canDelete = req.user.role === "admin"
      ? existing.orgId === req.user.orgId
      : existing.userId === req.user.id;

    if (!canDelete) return res.status(403).json({ error: "Access denied" });

    await deleteSession(req.params.id, existing.userId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── FEEDBACK ─────────────────────────────────────────────────────────────────
async function canAccessFeedback(session, user) {
  if (!session) return false;
  if (user.role === "admin" && session.orgId === user.orgId) return true;
  if (session.userId === user.id) return true;
  const share = await getShareRecord(session.id, user.id);
  return !!share;
}

// GET /api/sessions/:id/feedback
router.get("/:id/feedback", async function(req, res, next) {
  try {
    const session = await getSessionById(req.params.id);
    if (!await canAccessFeedback(session, req.user)) return res.status(403).json({ error: "Access denied" });
    res.json(await getFeedback(req.params.id));
  } catch (err) { next(err); }
});

// POST /api/sessions/:id/feedback
router.post("/:id/feedback", async function(req, res, next) {
  try {
    const session = await getSessionById(req.params.id);
    if (!session || session.orgId !== req.user.orgId) return res.status(404).json({ error: "Session not found" });
    // Only admins and share recipients can write feedback; session owner cannot write on their own
    const isAdmin         = req.user.role === "admin";
    const isShareRecipient = !!(await getShareRecord(session.id, req.user.id));
    if (!isAdmin && !isShareRecipient) return res.status(403).json({ error: "Access denied" });

    const { text, cardId, cardTitle } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: "text is required" });
    if (text.trim().length > 5000) return res.status(400).json({ error: "Feedback text must be 5000 characters or less" });

    const fb = await createFeedback({
      sessionId:  session.id,
      orgId:      session.orgId,
      authorId:   req.user.id,
      authorName: req.user.displayName,
      cardId:     cardId    || null,
      cardTitle:  cardTitle || null,
      text:       text.trim(),
    });
    res.json(fb);
  } catch (err) { next(err); }
});

// PUT /api/sessions/:id/feedback/:fid
router.put("/:id/feedback/:fid", async function(req, res, next) {
  try {
    const fb = await getFeedbackById(req.params.fid);
    if (!fb || fb.sessionId !== req.params.id) return res.status(404).json({ error: "Not found" });
    if (fb.authorId !== req.user.id) return res.status(403).json({ error: "Access denied" });
    const { text, cardId, cardTitle } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: "text is required" });
    if (text.trim().length > 5000) return res.status(400).json({ error: "Feedback text must be 5000 characters or less" });
    const updated = await updateFeedback(fb.id, text.trim(), cardId || null, cardTitle || null, req.user.id);
    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /api/sessions/:id/feedback/:fid
router.delete("/:id/feedback/:fid", async function(req, res, next) {
  try {
    const fb = await getFeedbackById(req.params.fid);
    if (!fb || fb.sessionId !== req.params.id) return res.status(404).json({ error: "Not found" });
    const session = await getSessionById(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });
    const canDelete = req.user.role === "admin"
      ? session.orgId === req.user.orgId
      : fb.authorId === req.user.id;
    if (!canDelete) return res.status(403).json({ error: "Access denied" });
    await deleteFeedback(fb.id, session.orgId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── SHARES ───────────────────────────────────────────────────────────────────
// POST /api/sessions/:id/share
router.post("/:id/share", async function(req, res, next) {
  try {
    const session = await getSessionById(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });

    // Session owner OR admin in the same org can share
    const canShare = session.userId === req.user.id ||
      (req.user.role === "admin" && session.orgId === req.user.orgId);
    if (!canShare) return res.status(403).json({ error: "Access denied" });

    const { toUserId, context } = req.body;
    if (!toUserId) return res.status(400).json({ error: "toUserId is required" });

    const orgUsers = await getOrgUsers(req.user.orgId);
    const target   = orgUsers.find(function(u) { return u.id === toUserId; });
    if (!target) return res.status(400).json({ error: "User not found in org" });
    if (target.id === req.user.id) return res.status(400).json({ error: "Cannot share with yourself" });

    const share = await createShare({ sessionId: session.id, fromUserId: req.user.id, toUserId, context: context || null });
    res.json(share);
  } catch (err) { next(err); }
});

// GET /api/sessions/:id/shares
router.get("/:id/shares", async function(req, res, next) {
  try {
    const session = await getSessionById(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });
    const canView = req.user.role === "admin"
      ? session.orgId === req.user.orgId
      : session.userId === req.user.id;
    if (!canView) return res.status(403).json({ error: "Access denied" });
    res.json(await getSharesForSession(req.params.id));
  } catch (err) { next(err); }
});

// DELETE /api/sessions/:id/shares/:shareId
router.delete("/:id/shares/:shareId", async function(req, res, next) {
  try {
    const session = await getSessionById(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });
    const canRevoke = req.user.role === "admin"
      ? session.orgId === req.user.orgId
      : session.userId === req.user.id;
    if (!canRevoke) return res.status(403).json({ error: "Access denied" });
    await deleteShare(req.params.shareId, session.orgId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
