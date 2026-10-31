// ─── REALTIME (Server-Sent Events) ────────────────────────────────────────────
// In-process pub/sub for live updates. Render runs a single instance, so a Map of
// open streams is enough; swapping this module for Postgres LISTEN/NOTIFY is the
// path to more instances (every caller goes through publish*/closeUser only).
//
// Channels are derived from the authenticated user on the server — clients never
// name a channel — so an event can only reach users of the org it was published to:
//   user:<userId>         one person's devices/tabs
//   orgAdmins:<orgId>     admins + owner of one org
//   org:<orgId>           every member of one org (only for id-only "go refetch" events)
// Payloads are small (ids + kind); clients refetch through their normal org-scoped
// endpoints. The only exception is live-session progress, which carries its state.

const { isAdminRole } = require("./auth");

var clients = new Map();       // client id → { res, userId, orgId, admin, sid }
var byUser = new Map();        // userId → Set<client id>
var byOrgAdmins = new Map();   // orgId → Set<client id>
var byOrg = new Map();         // orgId → Set<client id> (everyone)
var nextId = 1;
var MAX_PER_USER = 5;
var PING_MS = 25000;

function addTo(map, key, id) {
  var set = map.get(key);
  if (!set) { set = new Set(); map.set(key, set); }
  set.add(id);
}
function removeFrom(map, key, id) {
  var set = map.get(key);
  if (!set) return;
  set.delete(id);
  if (!set.size) map.delete(key);
}

function frame(type, data) { return "event: " + type + "\ndata: " + JSON.stringify(data || {}) + "\n\n"; }
function writeRaw(c, text) { try { c.res.write(text); } catch (_) {} }
function write(c, type, data) { writeRaw(c, frame(type, data)); }

function drop(id) {
  var c = clients.get(id);
  if (!c) return;
  clients.delete(id);
  removeFrom(byUser, c.userId, id);
  removeFrom(byOrg, c.orgId, id);
  if (c.admin) removeFrom(byOrgAdmins, c.orgId, id);
}

// GET /api/events — the route runs requireAuth first, so req.user is trusted
function streamHandler(req, res) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  // no-transform keeps the compression middleware (and proxies) from buffering the stream
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (res.flushHeaders) res.flushHeaders();
  req.socket.setTimeout(0);

  var u = req.user;
  var id = nextId++;
  var c = { res: res, userId: u.id, orgId: u.orgId, admin: isAdminRole(u.role), sid: req.authSid || null };
  clients.set(id, c);
  addTo(byUser, u.id, id);
  addTo(byOrg, u.orgId, id);
  if (c.admin) addTo(byOrgAdmins, u.orgId, id);

  // Bound reconnect storms: keep only the newest streams per user
  var mine = Array.from(byUser.get(u.id) || []);
  while (mine.length > MAX_PER_USER) {
    var oldest = mine.shift();
    var oc = clients.get(oldest);
    drop(oldest);
    if (oc) { try { oc.res.end(); } catch (_) {} }
  }

  res.write("retry: 3000\n\n");
  write(c, "hello", { ts: Date.now() });
  var ping = setInterval(function() { try { res.write(": ping\n\n"); } catch (_) {} }, PING_MS);
  // A stream is authorised once; end it when its token expires so the client must
  // reconnect (and be re-checked) — sign-outs end streams sooner via closeUser
  var expTimer = null;
  if (req.authExp) {
    var ms = req.authExp * 1000 - Date.now();
    expTimer = setTimeout(function() { write(c, "auth.expiring", {}); drop(id); try { res.end(); } catch (_) {} }, Math.max(1000, Math.min(ms, 2147000000)));
  }
  req.on("close", function() { clearInterval(ping); if (expTimer) clearTimeout(expTimer); drop(id); });
}

// Serialised once, however many streams receive it
function sendTo(ids, type, data) {
  if (!ids || !ids.size) return;
  var text = frame(type, data);
  ids.forEach(function(id) { var c = clients.get(id); if (c) writeRaw(c, text); });
}

// Publish to one or more users (duplicates collapse), an org's admins and/or a whole org
//   publish({ users:[...], orgAdmins: orgId }, "session.changed", { id })
//   publish({ org: orgId }, "highlight.changed", { sessionId })
function publish(target, type, data) {
  var seen = new Set();
  function add(set) { if (set) set.forEach(function(id) { seen.add(id); }); }
  (target.users || []).forEach(function(uid) { if (uid) add(byUser.get(uid)); });
  if (target.orgAdmins) add(byOrgAdmins.get(target.orgAdmins));
  if (target.org) add(byOrg.get(target.org));
  sendTo(seen, type, data);
}

// Tell a user's streams why their session ended, then close them.
//   opts.keepSid — streams of this session id stay open (the device that changed its password)
//   opts.onlySid — only close streams of this session id (logging out one device)
function closeUser(userId, reason, opts) {
  var o = opts || {};
  var set = byUser.get(userId);
  if (!set) return;
  Array.from(set).forEach(function(id) {
    var c = clients.get(id);
    if (!c) return;
    if (o.keepSid && c.sid === o.keepSid) return;
    if (o.onlySid && c.sid !== o.onlySid) return;
    write(c, "auth.ended", { reason: reason });
    drop(id);
    try { c.res.end(); } catch (_) {}
  });
}

// Role/team membership changed: tell the user's apps to re-read their profile, then end
// the streams so they reconnect into the channels that match the new role
function refreshUser(userId) {
  var set = byUser.get(userId);
  if (!set) return;
  Array.from(set).forEach(function(id) {
    var c = clients.get(id);
    if (!c) return;
    write(c, "auth.changed", {});
    drop(id);
    try { c.res.end(); } catch (_) {}
  });
}

// Live progress goes to org admins (the monitor). At most one event per run every
// PROGRESS_MS; the latest state is sent when the window closes, so watchers never lag behind.
var PROGRESS_MS = 2000;
var progressState = new Map(); // sessionId → { last, timer, pending }
var endedAt = new Map();       // sessionId → ts it finished: a heartbeat racing the save is dropped
function publishProgress(live) {
  var e = endedAt.get(live.id);
  if (e && Date.now() - e < 60000) return;
  var st = progressState.get(live.id) || { last: 0, timer: null, pending: null };
  progressState.set(live.id, st);
  var now = Date.now();
  if (now - st.last >= PROGRESS_MS && !st.timer) {
    st.last = now;
    publish({ orgAdmins: live.orgId }, "session.progress", live);
    return;
  }
  st.pending = live;
  if (!st.timer) {
    st.timer = setTimeout(function() {
      st.timer = null; st.last = Date.now();
      if (st.pending) { publish({ orgAdmins: st.pending.orgId }, "session.progress", st.pending); st.pending = null; }
    }, Math.max(0, PROGRESS_MS - (now - st.last)));
  }
}
function endProgress(id) {
  var st = progressState.get(id);
  if (st && st.timer) clearTimeout(st.timer);
  progressState.delete(id);
  endedAt.set(id, Date.now());
  if (endedAt.size > 5000) endedAt.delete(endedAt.keys().next().value);
}
// A run (re)started — its progress is published again
function startProgress(id) { endedAt.delete(id); }

// A run ended without the normal save (device signed out, heartbeat stopped)
function publishAbandoned(rows) {
  rows.forEach(function(r) {
    endProgress(r.id);
    publish({ users: [r.userId], orgAdmins: r.orgId }, "session.finished", { id: r.id, userId: r.userId, abandoned: true });
  });
}

// Sign a user's other devices out right now: runs they had in progress are saved as
// abandoned (path kept — the server already holds every heartbeat) and the org's live
// monitor is told, then their streams receive auth.ended {reason} and close.
async function signOutDevices(userId, reason, opts) {
  const { closeActiveSessions } = require("./db");
  publishAbandoned(await closeActiveSessions({ userId: userId }));
  closeUser(userId, reason, opts);
}

function stats() { return { streams: clients.size, users: byUser.size }; }

module.exports = { streamHandler, publish, publishProgress, endProgress, startProgress, publishAbandoned, closeUser, refreshUser, signOutDevices, stats };
