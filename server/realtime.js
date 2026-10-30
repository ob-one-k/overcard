// ─── REALTIME (Server-Sent Events) ────────────────────────────────────────────
// In-process pub/sub for live updates. Render runs a single instance, so a Map of
// open streams is enough; swapping this module for Postgres LISTEN/NOTIFY is the
// path to more instances (every caller goes through publish*/closeUser only).
//
// Channels are derived from the authenticated user on the server — clients never
// name a channel — so an event can only reach users of the org it was published to:
//   user:<userId>         one person's devices/tabs
//   orgAdmins:<orgId>     admins + owner of one org
// Payloads are small (ids + kind); clients refetch through their normal org-scoped
// endpoints. The only exception is live-session progress, which carries its state.

const { isAdminRole } = require("./auth");

var clients = new Map();       // client id → { res, userId, orgId, admin, sid }
var byUser = new Map();        // userId → Set<client id>
var byOrgAdmins = new Map();   // orgId → Set<client id>
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

function write(c, type, data) {
  try { c.res.write("event: " + type + "\ndata: " + JSON.stringify(data || {}) + "\n\n"); } catch (_) {}
}

function drop(id) {
  var c = clients.get(id);
  if (!c) return;
  clients.delete(id);
  removeFrom(byUser, c.userId, id);
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
  req.on("close", function() { clearInterval(ping); drop(id); });
}

function sendTo(ids, type, data) {
  if (!ids) return;
  ids.forEach(function(id) { var c = clients.get(id); if (c) write(c, type, data); });
}

// Publish to one or more users (duplicates collapse) and/or an org's admins
//   publish({ users:[...], orgAdmins: orgId }, "session.changed", { id })
function publish(target, type, data) {
  var seen = new Set();
  function add(set) { if (set) set.forEach(function(id) { seen.add(id); }); }
  (target.users || []).forEach(function(uid) { if (uid) add(byUser.get(uid)); });
  if (target.orgAdmins) add(byOrgAdmins.get(target.orgAdmins));
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

// Sign a user's other devices out right now: runs they had in progress are saved as
// abandoned (path kept — the server already holds every heartbeat) and the org's live
// monitor is told, then their streams receive auth.ended {reason} and close.
async function signOutDevices(userId, reason, opts) {
  const { closeActiveSessions } = require("./db");
  const closed = await closeActiveSessions({ userId: userId });
  closed.forEach(function(r) {
    publish({ users: [r.userId], orgAdmins: r.orgId }, "session.finished", { id: r.id, userId: r.userId, abandoned: true });
  });
  closeUser(userId, reason, opts);
}

function stats() { return { streams: clients.size, users: byUser.size }; }

module.exports = { streamHandler, publish, closeUser, refreshUser, signOutDevices, stats };
