// ─── TEST HELPERS ─────────────────────────────────────────────────────────────
// The suite runs against a live server seeded with the demo data (two orgs: Apex and
// Meridian). Start one with RATE_LIMITS=off, then `npm test`:
//   RATE_LIMITS=off PORT=3001 DATABASE_URL=... node server/index.js
//   TEST_API=http://localhost:3001 npm test
// Tests only create their own records (ids prefixed "t_") and never touch other data.

var BASE = (process.env.TEST_API || "http://localhost:3001") + "/api";
// The suite signs demo accounts in with force (signing out whoever uses them) and creates
// records — never point it at a deployed server by accident
if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/api$/.test(BASE) && process.env.TEST_ALLOW_REMOTE !== "1") {
  throw new Error("Refusing to run tests against " + BASE + " (set TEST_ALLOW_REMOTE=1 for a disposable staging server)");
}
var PASSWORD = process.env.TEST_PASSWORD || "Overcard2025!"; // demo seed password (server/seed.js)

var ACCOUNTS = {
  apexOwner: "alex@apexsales.com", apexAdmin: "jordan@apexsales.com", apexUser: "marcus@apexsales.com",
  apexUser2: "priya@apexsales.com", apexUser3: "dani@apexsales.com",
  merOwner: "casey@meridiangroup.com", merAdmin: "riley@meridiangroup.com", merUser: "fox@meridiangroup.com",
};

function tid(prefix) { return "t_" + (prefix || "") + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

// A signed-in client. Uses the Bearer token (same path as the Safari fallback).
async function login(who, opts) {
  var email = ACCOUNTS[who] || who;
  var r = await fetch(BASE + "/auth/login?force=1", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email, password: (opts && opts.password) || PASSWORD }),
  });
  var body = await r.json();
  if (!r.ok) throw new Error("login " + email + " → " + r.status + " " + JSON.stringify(body));
  return client(body._token, body);
}

function client(token, user) {
  async function req(method, path, body) {
    var headers = {};
    if (token) headers.Authorization = "Bearer " + token;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    var r = await fetch(BASE + path, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) });
    var text = await r.text();
    var json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) {}
    return { status: r.status, body: json, text: text };
  }
  return {
    user: user, token: token,
    get:  function(p)    { return req("GET", p); },
    post: function(p, b) { return req("POST", p, b === undefined ? {} : b); },
    put:  function(p, b) { return req("PUT", p, b === undefined ? {} : b); },
    del:  function(p)    { return req("DELETE", p); },
    stream: function() { return openStream(token); },
  };
}

// Open GET /events and collect events. waitFor(type, pred, ms) resolves with the data.
async function openStream(token) {
  var ctrl = new AbortController();
  var r = await fetch(BASE + "/events", { headers: { Authorization: "Bearer " + token, Accept: "text/event-stream" }, signal: ctrl.signal });
  var events = [];
  var claimed = new Set();   // each event satisfies at most one waitFor
  var waiters = [];
  var ended = false;
  var status = r.status;
  function check() {
    waiters.slice().forEach(function(w) {
      var hit = events.find(function(e, i) { return i >= w.since && e.type === w.type && !claimed.has(e) && (!w.pred || w.pred(e.data)); });
      if (hit) { claimed.add(hit); waiters.splice(waiters.indexOf(w), 1); clearTimeout(w.timer); w.resolve(hit.data); }
    });
  }
  if (r.ok && r.body) {
    (async function() {
      var reader = r.body.getReader(), dec = new TextDecoder(), buf = "";
      try {
        for (;;) {
          var c = await reader.read();
          if (c.done) break;
          buf += dec.decode(c.value, { stream: true });
          var i;
          while ((i = buf.indexOf("\n\n")) !== -1) {
            var block = buf.slice(0, i); buf = buf.slice(i + 2);
            var type = null, data = null;
            block.split("\n").forEach(function(l) {
              if (l.indexOf("event: ") === 0) type = l.slice(7);
              else if (l.indexOf("data: ") === 0) { try { data = JSON.parse(l.slice(6)); } catch (_) {} }
            });
            if (type) { events.push({ type: type, data: data }); check(); }
          }
        }
      } catch (_) {}
      ended = true;
      check();
    })();
  }
  return {
    status: status,
    events: events,
    isEnded: function() { return ended; },
    // Index to pass as waitFor's `since`: only events after this point count
    mark: function() { return events.length; },
    close: function() { ctrl.abort(); },
    // Resolves with the event's data, or null after ms (tests assert on null for "never arrived")
    waitFor: function(type, pred, ms, since) {
      return new Promise(function(resolve) {
        var w = { type: type, pred: pred, resolve: resolve, since: since || 0 };
        w.timer = setTimeout(function() { waiters.splice(waiters.indexOf(w), 1); resolve(null); }, ms || 5000);
        waiters.push(w);
        check();
      });
    },
  };
}

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

module.exports = { BASE, ACCOUNTS, login, client, openStream, tid, sleep };
