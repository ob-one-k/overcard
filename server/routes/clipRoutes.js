const express = require("express");
const router  = express.Router();
const os = require("os");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const {
  getSessionById, canReadSession, getSessionAudioData, findUserById, getDeckById, getHighlight, getOrgUsers,
  createClip, getClip, getMyClips, getClipsSharedWith, renameClip, deleteClip, canPlayClip, getClipAudioRange,
  createClipShare, getClipShares, deleteClipShare, getClipRecipientIds, createNotification, deleteClipNotifications,
} = require("../db");
const { requireAuth, isAdminRole } = require("../auth");
const { publish } = require("../realtime");
const { limiter } = require("../limits");
const { LIMITS } = require("../validate");

// ─── SAVED CLIPS ──────────────────────────────────────────────────────────────
// Anyone who can open a session's recording (db.canReadSession: owner for the whole org,
// admins, the rep, share recipients, highlight viewers) can save part of it as a titled clip.
// The clip is cut into its own small file, so playing or sharing it never hands out the rest
// of the call, and it survives the session being deleted. Its session details are snapshotted
// into meta when it's saved.
//   play / see: the clip's owner, people it's shared with, the org owner
//   rename:     the clip's owner      delete / share: the clip's owner or the org owner

router.use(requireAuth);

var MIN_CLIP_MS = 1000;
var MAX_CLIP_MS = 10 * 60 * 1000;
var MAX_CUTS = 2;            // ffmpeg jobs at once on this instance
var running = 0;
var saveLimiter = limiter(15 * 60 * 1000, 30, "You've saved a lot of clips — try again in a few minutes",
  function(req) { return "clip:" + req.user.id; });

var ffmpegPath = null;
try { ffmpegPath = require("ffmpeg-static"); } catch (e) { ffmpegPath = null; }

function secs(ms) { return (ms / 1000).toFixed(3); }

// Cut [startMs, endMs) out of a recording. MP4/AAC recordings (Safari) stay MP4/AAC, everything
// else becomes WebM/Opus — the same formats the app already plays. The seek happens after the
// input is opened so it is exact even for WebM files without cues.
// The recording is whatever bytes its owner uploaded, so ffmpeg never probes for a format
// (playlist demuxers like hls/concat could otherwise read other files or URLs): the container
// is forced from the stored mime type and only the local file protocol is allowed.
async function cutClip(buf, mimeType, startMs, endMs) {
  if (!ffmpegPath) throw Object.assign(new Error("Clip saving isn't available on this server"), { status: 503 });
  var mp4 = /mp4|aac|m4a/i.test(mimeType || "");
  var inFormat = mp4 ? "mov" : /ogg/i.test(mimeType || "") ? "ogg" : "matroska";
  var dir = await fs.mkdtemp(path.join(os.tmpdir(), "oc-clip-"));
  var inPath = path.join(dir, "in" + (mp4 ? ".m4a" : ".webm"));
  var outPath = path.join(dir, "out" + (mp4 ? ".m4a" : ".webm"));
  try {
    await fs.writeFile(inPath, buf);
    var args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-protocol_whitelist", "file", "-f", inFormat, "-i", inPath, "-ss", secs(startMs), "-to", secs(endMs), "-vn", "-ac", "1"]
      .concat(mp4 ? ["-c:a", "aac", "-b:a", "48k", "-f", "mp4"] : ["-c:a", "libopus", "-b:a", "32k", "-f", "webm"])
      .concat(["-y", outPath]);
    await new Promise(function(resolve, reject) {
      execFile(ffmpegPath, args, { timeout: 60000, maxBuffer: 1024 * 1024 }, function(err, stdout, stderr) {
        if (err) return reject(Object.assign(new Error("Couldn't cut that part of the recording"), { status: 422, detail: String(stderr || err.message).slice(0, 300) }));
        resolve();
      });
    });
    var out = await fs.readFile(outPath);
    if (out.length < 200) throw Object.assign(new Error("That part of the recording is empty"), { status: 422 });
    return { data: out, mimeType: mp4 ? "audio/mp4" : "audio/webm" };
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(function() {});
  }
}

// The audio segment (card visit) a clip comes from: the one asked for, else the one the
// clip starts in
function segmentFor(session, segId, startMs) {
  var segs = Array.isArray(session.audioSegments) ? session.audioSegments : [];
  if (segId != null) {
    var hit = segs.find(function(s) { return String(s.segId) === String(segId); });
    if (hit) return hit;
  }
  return segs.find(function(s) { return startMs >= s.startMs && startMs < s.endMs; }) || null;
}

// Everything about the session a clip should keep, read from the server's own records
async function clipMeta(session, seg) {
  var loaded = await Promise.all([
    session.userId ? findUserById(session.userId) : null,
    session.deckId ? getDeckById(session.deckId) : null,
    getHighlight(session.id),
  ]);
  var rep = loaded[0], deck = loaded[1], hl = loaded[2];
  var cardId = seg ? seg.cardId : null;
  var notes = (session.notes || []).filter(function(n) { return n && cardId && n.cardId === cardId && n.text; })
    .slice(0, 5).map(function(n) { return { text: String(n.text).slice(0, 500), ts: n.ts || null }; });
  return {
    sessionName: session.name || null,
    account: session.account || null,
    contact: session.contact || null,
    repId: session.userId || null,
    repName: rep ? rep.displayName : "Former member",
    deckId: session.deckId || null,
    deckName: (deck && deck.name) || session.deckName || null,
    deckColor: session.deckColor || (deck && deck.color) || null,
    deckIcon: session.deckIcon || (deck && deck.icon) || null,
    mode: session.mode || null,
    outcome: session.outcome || null,
    sold: !!session.sold,
    soldCardTitle: session.soldCardTitle || null,
    startTs: session.startTs || null,
    endTs: session.endTs || null,
    callMs: session.audioDurationMs || (session.endTs && session.startTs ? session.endTs - session.startTs : null),
    cardId: cardId,
    cardTitle: seg ? seg.cardTitle || null : null,
    cardType: seg ? seg.cardType || null : null,
    isObjCard: seg ? !!seg.isObjCard : false,
    stackLabel: seg ? seg.stackLabel || null : null,
    notes: notes,
    highlight: hl ? { scope: hl.scope, note: hl.note || null } : null,
  };
}

function cleanTitle(t) {
  if (typeof t !== "string") return null;
  t = t.trim().replace(/\s+/g, " ");
  if (!t || t.length > LIMITS.clipTitle) return null;
  return t;
}

async function clipOr404(req, res) {
  const clip = await getClip(req.params.id);
  if (!clip || !(await canPlayClip(clip, req.user))) { res.status(404).json({ error: "Clip not found" }); return null; }
  return clip;
}
function mayManage(clip, user) { return clip.userId === user.id || user.role === "owner"; }

function notifyClip(clip, type, extraUsers) {
  getClipRecipientIds(clip.id).then(function(ids) {
    publish({ users: [clip.userId].concat(ids, extraUsers || []) }, type, { clipId: clip.id });
  }).catch(function(err) { console.error("publish failed:", err.message); });
}

// GET /api/clips?view=mine|shared
router.get("/", async function(req, res, next) {
  try {
    var view = req.query.view === "shared" ? "shared" : "mine";
    res.json(view === "shared" ? await getClipsSharedWith(req.user.id, req.user.orgId) : await getMyClips(req.user.id, req.user.orgId));
  } catch (err) { next(err); }
});

// POST /api/clips  { sessionId, startMs, endMs, title, segId? }
router.post("/", saveLimiter, async function(req, res, next) {
  try {
    var b = req.body || {};
    var title = cleanTitle(b.title);
    if (!title) return res.status(400).json({ error: "Give the clip a title (up to " + LIMITS.clipTitle + " characters)" });
    var startMs = Math.round(Number(b.startMs)), endMs = Math.round(Number(b.endMs));
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs) {
      return res.status(400).json({ error: "Pick a start and an end for the clip" });
    }
    if (endMs - startMs < MIN_CLIP_MS) return res.status(400).json({ error: "Clips must be at least 1 second long" });
    if (endMs - startMs > MAX_CLIP_MS) return res.status(400).json({ error: "Clips can be up to 10 minutes long" });
    const session = typeof b.sessionId === "string" ? await getSessionById(b.sessionId) : null;
    if (!session || !(await canReadSession(session, req.user))) return res.status(404).json({ error: "Session not found" });
    // Take a cutting slot before the recording (up to 60 MB) is read into memory
    if (running >= MAX_CUTS) return res.status(503).json({ error: "Busy saving other clips — try again in a moment" });
    running++;
    var cut;
    try {
      const audio = await getSessionAudioData(session.id, session.orgId);
      if (!audio) return res.status(400).json({ error: "This session has no recording" });
      var known = audio.durationMs || session.audioDurationMs;
      if (known && startMs >= known) return res.status(400).json({ error: "That's past the end of the recording" });
      if (known && endMs > known) endMs = known;
      if (endMs - startMs < MIN_CLIP_MS) return res.status(400).json({ error: "Clips must be at least 1 second long" });
      cut = await cutClip(audio.data, audio.mimeType, startMs, endMs);
    } finally { running--; }

    var seg = segmentFor(session, b.segId, startMs);
    var isSegment = b.segId != null && seg && String(seg.segId) === String(b.segId);
    const clip = await createClip({
      orgId: req.user.orgId, userId: req.user.id, sessionId: session.id, title: title,
      kind: isSegment ? "segment" : "range", segId: isSegment ? String(seg.segId) : null, cardId: seg ? seg.cardId : null,
      startMs: startMs, endMs: endMs, durationMs: endMs - startMs,
      meta: await clipMeta(session, seg), mimeType: cut.mimeType, data: cut.data,
    });
    publish({ users: [req.user.id] }, "clip.changed", { clipId: clip.id });
    res.status(201).json(clip);
  } catch (err) {
    if (err && err.status) {
      if (err.detail) console.error("clip cut failed:", err.detail);
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

// GET /api/clips/:id — the clip and its session details
router.get("/:id", async function(req, res, next) {
  try {
    const clip = await clipOr404(req, res);
    if (!clip) return;
    res.json(clip);
  } catch (err) { next(err); }
});

// GET /api/clips/:id/audio — the clip's own audio; honours Range
router.get("/:id/audio", async function(req, res, next) {
  try {
    const clip = await clipOr404(req, res);
    if (!clip) return;
    var size = clip.sizeBytes, start = 0, end = size - 1, partial = false;
    var m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ""));
    if (m && (m[1] || m[2])) {
      if (m[1]) { start = parseInt(m[1], 10); end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1; }
      else      { start = Math.max(0, size - parseInt(m[2], 10)); }
      if (start > end || start >= size) {
        res.set("Content-Range", "bytes */" + size);
        return res.status(416).end();
      }
      partial = true;
    }
    const chunk = await getClipAudioRange(clip.id, start, end - start + 1);
    res.set({
      "Content-Type": clip.mimeType, "Accept-Ranges": "bytes", "Content-Length": String(chunk.length),
      "Cache-Control": "private, max-age=3600", "X-Audio-Duration-Ms": String(clip.durationMs),
    });
    if (partial) { res.set("Content-Range", "bytes " + start + "-" + end + "/" + size); res.status(206); }
    res.end(chunk);
  } catch (err) { next(err); }
});

// PUT /api/clips/:id  { title } — the clip's owner
router.put("/:id", async function(req, res, next) {
  try {
    const clip = await clipOr404(req, res);
    if (!clip) return;
    if (clip.userId !== req.user.id) return res.status(403).json({ error: "Only the person who saved this clip can rename it" });
    var title = cleanTitle(req.body && req.body.title);
    if (!title) return res.status(400).json({ error: "Titles are 1–" + LIMITS.clipTitle + " characters" });
    const out = await renameClip(clip.id, title);
    notifyClip(clip, "clip.changed");
    res.json(out);
  } catch (err) { next(err); }
});

// DELETE /api/clips/:id — the clip's owner or the org owner
router.delete("/:id", async function(req, res, next) {
  try {
    const clip = await clipOr404(req, res);
    if (!clip) return;
    if (!mayManage(clip, req.user)) return res.status(403).json({ error: "Only the person who saved this clip can delete it" });
    var recipients = await getClipRecipientIds(clip.id);
    await deleteClip(clip.id);
    publish({ users: [clip.userId].concat(recipients) }, "clip.changed", { clipId: clip.id, deleted: true });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/clips/:id/share  { toUserId, note? } — the clip's owner or the org owner
router.post("/:id/share", async function(req, res, next) {
  try {
    const clip = await clipOr404(req, res);
    if (!clip) return;
    if (!mayManage(clip, req.user)) return res.status(403).json({ error: "Only the person who saved this clip can share it" });
    var b = req.body || {};
    if (typeof b.toUserId !== "string" || !b.toUserId) return res.status(400).json({ error: "toUserId is required" });
    if (b.note != null && (typeof b.note !== "string" || b.note.length > 1000)) return res.status(400).json({ error: "Message must be 1000 characters or less" });
    const target = (await getOrgUsers(req.user.orgId)).find(function(u) { return u.id === b.toUserId; });
    if (!target) return res.status(400).json({ error: "User not found in org" });
    if (target.id === req.user.id || target.id === clip.userId) return res.status(400).json({ error: "They already have this clip" });
    var note = typeof b.note === "string" && b.note.trim() ? b.note.trim() : null;
    const r = await createClipShare({ clipId: clip.id, orgId: clip.orgId, fromUserId: req.user.id, toUserId: target.id, note: note });
    if (r.created) {
      await createNotification({
        userId: target.id, orgId: clip.orgId, type: "clip_share", clipId: clip.id,
        actorId: req.user.id, actorName: req.user.displayName, text: note ? note.slice(0, 160) : null,
      });
      publish({ users: [target.id] }, "notification.new", { type: "clip_share", clipId: clip.id });
    }
    notifyClip(clip, "clip.changed");
    res.json(Object.assign({ created: r.created }, r.share));
  } catch (err) { next(err); }
});

// GET /api/clips/:id/shares — the clip's owner or the org owner
router.get("/:id/shares", async function(req, res, next) {
  try {
    const clip = await clipOr404(req, res);
    if (!clip) return;
    if (!mayManage(clip, req.user)) return res.status(403).json({ error: "Access denied" });
    res.json(await getClipShares(clip.id));
  } catch (err) { next(err); }
});

// DELETE /api/clips/:id/shares/:shareId — the clip's owner or the org owner
router.delete("/:id/shares/:shareId", async function(req, res, next) {
  try {
    const clip = await clipOr404(req, res);
    if (!clip) return;
    if (!mayManage(clip, req.user)) return res.status(403).json({ error: "Access denied" });
    const removed = await deleteClipShare(req.params.shareId, clip.id);
    if (!removed) return res.status(404).json({ error: "Share not found" });
    // Their "shared a clip with you" notification goes with the share
    await deleteClipNotifications(clip.id, removed.toUserId);
    publish({ users: [removed.toUserId] }, "notification.read", { clipId: clip.id });
    notifyClip(clip, "clip.changed", [removed.toUserId]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
