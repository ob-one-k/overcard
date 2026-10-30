const express = require("express");
const router  = express.Router();
const {
  getSessions, getSessionById, upsertSession, deleteSession,
  getFeedback, createFeedback, updateFeedback, deleteFeedback, getFeedbackById,
  createShare, getSharesForSession, deleteShare, getShareRecord,
  getOrgUsers, getUserTeams, findUserById,
  saveSessionAudio, getSessionAudioMeta, getSessionAudioRange, getReferenceOptions,
  createNotification,
} = require("../db");
const { requireAuth, isAdminRole } = require("../auth");

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
    const { scope, deckId, mode, outcome, from, to, limit } = req.query;
    const filters = { deckId, mode, outcome, from, to, limit };

    let parsedScope = null;
    if (scope) {
      if (isAdminRole(req.user.role)) {
        parsedScope = parseScope(scope);
      } else if (scope.startsWith("team:")) {
        // Regular users can scope to a team they belong to
        const requestedTeamId = scope.slice(5);
        const userTeamIds = await getUserTeams(req.user.id);
        if (userTeamIds.indexOf(requestedTeamId) > -1) {
          parsedScope = { type: "team", teamId: requestedTeamId };
        }
      }
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
    // null means the id belongs to another user's session — never return it
    if (!session) return res.status(403).json({ error: "Access denied" });
    res.json({ ok: true, session });
  } catch (err) { next(err); }
});

// DELETE /api/sessions/:id
router.delete("/:id", async function(req, res, next) {
  try {
    const existing = await getSessionById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Session not found" });

    // Admins in the same org can delete any session; users can only delete their own
    const canDelete = isAdminRole(req.user.role)
      ? existing.orgId === req.user.orgId
      : existing.userId === req.user.id;

    if (!canDelete) return res.status(403).json({ error: "Access denied" });

    await deleteSession(req.params.id, existing.userId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── REFERENCE SESSIONS ───────────────────────────────────────────────────────
// Any org member may browse completed sessions to use as a reference for a live call.
// Only the call outline (path, timing, outcome, notes) is exposed — not feedback, shares or audio.

// GET /api/sessions/reference-options?deckId=&q=
router.get("/reference-options", async function(req, res, next) {
  try {
    res.json(await getReferenceOptions(req.user.orgId, req.query.deckId || null, req.query.q || null));
  } catch (err) { next(err); }
});

// GET /api/sessions/:id/reference
router.get("/:id/reference", async function(req, res, next) {
  try {
    const s = await getSessionById(req.params.id);
    if (!s || s.orgId !== req.user.orgId || s.status !== "completed" || !s.endTs) {
      return res.status(404).json({ error: "Reference session not found" });
    }
    const owner = await findUserById(s.userId);
    var events = s.events || [];
    res.json({
      id: s.id, name: s.name, userName: owner ? owner.displayName : null,
      mode: s.mode, outcome: s.outcome, sold: !!s.sold, soldCardTitle: s.soldCardTitle || null,
      startTs: s.startTs, endTs: s.endTs, deckName: s.deckName,
      visits: events.filter(function(e) { return e.type === "visit"; }).map(function(e) {
        return { cardId: e.cardId, cardTitle: e.cardTitle, cardType: e.cardType, isObjCard: !!e.isObjCard,
                 stackLabel: e.stackLabel || null, intendedPath: !!e.intendedPath, durationMs: e.durationMs || 0 };
      }),
      notes: events.filter(function(e) { return e.type === "note"; }).concat(s.notes || []).map(function(n) {
        return { cardId: n.cardId, cardTitle: n.cardTitle, text: n.text };
      }),
    });
  } catch (err) { next(err); }
});

// ─── AUDIO ────────────────────────────────────────────────────────────────────
// ~4 hours at the client's 32 kbps; body-parser answers larger uploads with 413
var AUDIO_LIMIT = "60mb";
var AUDIO_MIME  = /^audio\/[a-z0-9.+-]+(;\s*codecs=[a-z0-9.,"' -]+)?$/i;

// PUT /api/sessions/:id/audio — raw audio body; owner only. ?durationMs= measured client-side
router.put("/:id/audio",
  express.raw({ type: ["audio/*", "application/octet-stream"], limit: AUDIO_LIMIT }),
  async function(req, res, next) {
    try {
      const session = await getSessionById(req.params.id);
      if (!session || session.orgId !== req.user.orgId) return res.status(404).json({ error: "Session not found" });
      if (session.userId !== req.user.id) return res.status(403).json({ error: "Only the session owner can upload its recording" });
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: "Audio body is required" });
      var mime = String(req.headers["content-type"] || "");
      if (!AUDIO_MIME.test(mime)) mime = "audio/webm";
      var dur = parseInt(req.query.durationMs, 10);
      await saveSessionAudio(session.id, session.orgId, mime, Number.isFinite(dur) && dur > 0 ? dur : null, req.body);
      res.json({ ok: true, sizeBytes: req.body.length });
    } catch (err) { next(err); }
  }
);

// GET /api/sessions/:id/audio/meta — recording info + per-card chapter markers
router.get("/:id/audio/meta", async function(req, res, next) {
  try {
    const session = await getSessionById(req.params.id);
    if (!await canAccessFeedback(session, req.user)) return res.status(403).json({ error: "Access denied" });
    const meta = await getSessionAudioMeta(session.id);
    if (!meta) return res.status(404).json({ error: "No recording for this session" });
    res.json({ mimeType: meta.mimeType, durationMs: meta.durationMs, sizeBytes: meta.sizeBytes, chapters: meta.chapters || session.audioSegments || [] });
  } catch (err) { next(err); }
});

// GET /api/sessions/:id/audio — same access as feedback (owner, org admin, share recipient).
// Honours Range requests so <audio> elements can seek without downloading everything.
router.get("/:id/audio", async function(req, res, next) {
  try {
    const session = await getSessionById(req.params.id);
    if (!await canAccessFeedback(session, req.user)) return res.status(403).json({ error: "Access denied" });
    const meta = await getSessionAudioMeta(session.id);
    if (!meta) return res.status(404).json({ error: "No recording for this session" });

    var size  = meta.sizeBytes;
    var start = 0, end = size - 1, partial = false;
    var m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ""));
    if (m && (m[1] || m[2])) {
      if (m[1]) { start = parseInt(m[1], 10); end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1; }
      else      { start = Math.max(0, size - parseInt(m[2], 10)); }  // suffix range: last N bytes
      if (start > end || start >= size) {
        res.set("Content-Range", "bytes */" + size);
        return res.status(416).end();
      }
      partial = true;
    }
    const chunk = await getSessionAudioRange(session.id, start, end - start + 1);
    res.set({
      "Content-Type":   meta.mimeType,
      "Accept-Ranges":  "bytes",
      "Content-Length": String(chunk.length),
      "Cache-Control":  "private, max-age=3600",
    });
    if (meta.durationMs) res.set("X-Audio-Duration-Ms", String(meta.durationMs));
    if (partial) {
      res.set("Content-Range", "bytes " + start + "-" + end + "/" + size);
      res.status(206);
    }
    res.end(chunk);
  } catch (err) { next(err); }
});

// ─── FEEDBACK ─────────────────────────────────────────────────────────────────
async function canAccessFeedback(session, user) {
  if (!session) return false;
  if (isAdminRole(user.role) && session.orgId === user.orgId) return true;
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
    const isAdmin         = isAdminRole(req.user.role);
    const isShareRecipient = !!(await getShareRecord(session.id, req.user.id));
    if (!isAdmin && !isShareRecipient) return res.status(403).json({ error: "Access denied" });

    const { text, cardId, cardTitle } = req.body || {};
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
    // Tell the session owner (never notify yourself)
    if (session.userId !== req.user.id) {
      await createNotification({
        userId: session.userId, orgId: session.orgId, type: "feedback", sessionId: session.id,
        actorId: req.user.id, actorName: req.user.displayName,
        text: text.trim().slice(0, 160),
      });
    }
    res.json(fb);
  } catch (err) { next(err); }
});

// PUT /api/sessions/:id/feedback/:fid
router.put("/:id/feedback/:fid", async function(req, res, next) {
  try {
    const fb = await getFeedbackById(req.params.fid);
    if (!fb || fb.sessionId !== req.params.id) return res.status(404).json({ error: "Not found" });
    if (fb.authorId !== req.user.id) return res.status(403).json({ error: "Access denied" });
    const { text, cardId, cardTitle } = req.body || {};
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
    const canDelete = isAdminRole(req.user.role)
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
      (isAdminRole(req.user.role) && session.orgId === req.user.orgId);
    if (!canShare) return res.status(403).json({ error: "Access denied" });

    const { toUserId, context } = req.body || {};
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
    const canView = isAdminRole(req.user.role)
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
    const canRevoke = isAdminRole(req.user.role)
      ? session.orgId === req.user.orgId
      : session.userId === req.user.id;
    if (!canRevoke) return res.status(403).json({ error: "Access denied" });
    await deleteShare(req.params.shareId, session.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
