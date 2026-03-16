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

// Parse scope query param for admins:
//   ?scope=self | user:{id} | users:{id,id,...} | team:{id} | org
function parseScope(scopeStr) {
  if (!scopeStr || scopeStr === "self") return null;
  if (scopeStr === "org") return { type: "org" };
  if (scopeStr.startsWith("user:")) return { type: "user", userId: scopeStr.slice(5) };
  if (scopeStr.startsWith("team:")) return { type: "team", teamId: scopeStr.slice(5) };
  if (scopeStr.startsWith("users:")) {
    const ids = scopeStr.slice(6).split(",").filter(Boolean);
    return { type: "users", userIds: ids };
  }
  return null;
}

// GET /api/sessions
router.get("/", function(req, res) {
  const { scope, deckId, mode, outcome, from, to } = req.query;
  const filters = { deckId, mode, outcome, from, to };

  let parsedScope = null;
  if (req.user.role === "admin" && scope) {
    parsedScope = parseScope(scope);
  }

  const sessions = getSessions(parsedScope, req.user.orgId, req.user.id, filters);
  res.json(sessions);
});

// POST /api/sessions  (upsert)
router.post("/", function(req, res) {
  if (!req.body || !req.body.id) {
    return res.status(400).json({ error: "Session id is required" });
  }
  const session = upsertSession(req.body, req.user.id, req.user.orgId);
  res.json({ ok: true, session });
});

// DELETE /api/sessions/:id
router.delete("/:id", function(req, res) {
  const existing = getSessionById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Session not found" });

  // Admins in the same org can delete any session; users can only delete their own
  const canDelete = req.user.role === "admin"
    ? existing.orgId === req.user.orgId
    : existing.userId === req.user.id;

  if (!canDelete) return res.status(403).json({ error: "Access denied" });

  deleteSession(req.params.id, existing.userId);
  res.json({ ok: true });
});

// ─── FEEDBACK ─────────────────────────────────────────────────────────────────
function canAccessFeedback(session, user) {
  if (!session) return false;
  if (user.role === "admin" && session.orgId === user.orgId) return true;
  if (session.userId === user.id) return true;
  const share = getShareRecord(session.id, user.id);
  return !!share;
}

// GET /api/sessions/:id/feedback
router.get("/:id/feedback", function(req, res) {
  const session = getSessionById(req.params.id);
  if (!canAccessFeedback(session, req.user)) return res.status(403).json({ error: "Access denied" });
  res.json(getFeedback(req.params.id));
});

// POST /api/sessions/:id/feedback
router.post("/:id/feedback", function(req, res) {
  const session = getSessionById(req.params.id);
  if (!session || session.orgId !== req.user.orgId) return res.status(404).json({ error: "Session not found" });
  // Only admins and share recipients can write feedback; session owner cannot write on their own
  const isAdmin = req.user.role === "admin";
  const isShareRecipient = !!getShareRecord(session.id, req.user.id);
  if (!isAdmin && !isShareRecipient) return res.status(403).json({ error: "Access denied" });

  const { text, cardId, cardTitle } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: "text is required" });

  const fb = createFeedback({
    sessionId: session.id,
    orgId: session.orgId,
    authorId: req.user.id,
    authorName: req.user.displayName,
    cardId: cardId || null,
    cardTitle: cardTitle || null,
    text: text.trim(),
  });
  res.json(fb);
});

// PUT /api/sessions/:id/feedback/:fid
router.put("/:id/feedback/:fid", function(req, res) {
  const fb = getFeedbackById(req.params.fid);
  if (!fb || fb.sessionId !== req.params.id) return res.status(404).json({ error: "Not found" });
  if (fb.authorId !== req.user.id) return res.status(403).json({ error: "Access denied" });
  const { text, cardId, cardTitle } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: "text is required" });
  const updated = updateFeedback(fb.id, text.trim(), cardId || null, cardTitle || null, req.user.id);
  res.json(updated);
});

// DELETE /api/sessions/:id/feedback/:fid
router.delete("/:id/feedback/:fid", function(req, res) {
  const fb = getFeedbackById(req.params.fid);
  if (!fb || fb.sessionId !== req.params.id) return res.status(404).json({ error: "Not found" });
  const session = getSessionById(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  const canDelete = req.user.role === "admin"
    ? session.orgId === req.user.orgId
    : fb.authorId === req.user.id;
  if (!canDelete) return res.status(403).json({ error: "Access denied" });
  deleteFeedback(fb.id, session.orgId);
  res.json({ ok: true });
});

// ─── SHARES ───────────────────────────────────────────────────────────────────
// POST /api/sessions/:id/share
router.post("/:id/share", function(req, res) {
  const session = getSessionById(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.userId !== req.user.id) return res.status(403).json({ error: "Only the session owner can share" });

  const { toUserId, context } = req.body;
  if (!toUserId) return res.status(400).json({ error: "toUserId is required" });

  // Target must be a non-admin user in the same org
  const orgUsers = getOrgUsers(req.user.orgId);
  const target = orgUsers.find(function(u) { return u.id === toUserId; });
  if (!target) return res.status(400).json({ error: "User not found in org" });
  if (target.role === "admin") return res.status(400).json({ error: "Cannot share with admins" });
  if (target.id === req.user.id) return res.status(400).json({ error: "Cannot share with yourself" });

  const share = createShare({ sessionId: session.id, fromUserId: req.user.id, toUserId, context: context || null });
  res.json(share);
});

// GET /api/sessions/:id/shares
router.get("/:id/shares", function(req, res) {
  const session = getSessionById(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  const canView = req.user.role === "admin"
    ? session.orgId === req.user.orgId
    : session.userId === req.user.id;
  if (!canView) return res.status(403).json({ error: "Access denied" });
  res.json(getSharesForSession(req.params.id));
});

// DELETE /api/sessions/:id/shares/:shareId
router.delete("/:id/shares/:shareId", function(req, res) {
  const session = getSessionById(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  const canRevoke = req.user.role === "admin"
    ? session.orgId === req.user.orgId
    : session.userId === req.user.id;
  if (!canRevoke) return res.status(403).json({ error: "Access denied" });
  deleteShare(req.params.shareId, session.orgId);
  res.json({ ok: true });
});

module.exports = router;
