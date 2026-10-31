// ─── TEST HELPERS ─────────────────────────────────────────────────────────────
// The suite runs against a live local server started with RATE_LIMITS=off and a MASTER_CODE:
//   RATE_LIMITS=off MASTER_CODE=local-test-code npm run server
//   TEST_API=http://localhost:3001 MASTER_CODE=local-test-code npm test
// On first use it builds its own fixture data through the API (fixtures() below): two orgs,
// Apex and Meridian, with fixed test accounts, teams and decks. Later runs reuse them.
// Tests otherwise only create their own records (ids prefixed "t_").

var BASE = (process.env.TEST_API || "http://localhost:3001") + "/api";
// The suite signs test accounts in with force and creates records — never point it at a
// deployed server by accident
if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/api$/.test(BASE) && process.env.TEST_ALLOW_REMOTE !== "1") {
  throw new Error("Refusing to run tests against " + BASE + " (set TEST_ALLOW_REMOTE=1 for a disposable staging server)");
}
var PASSWORD = process.env.TEST_PASSWORD || "Fixture2026A";   // every fixture account
var MASTER_CODE = process.env.TEST_MASTER_CODE || process.env.MASTER_CODE || "";

var ACCOUNTS = {
  apexOwner: "owner@apex-test.com", apexAdmin: "admin@apex-test.com", apexAdmin2: "admin2@apex-test.com",
  apexUser: "user@apex-test.com", apexUser2: "user2@apex-test.com", apexUser3: "user3@apex-test.com",
  merOwner: "owner@meridian-test.com", merAdmin: "admin@meridian-test.com",
  merUser: "user@meridian-test.com", merUserSouth: "south@meridian-test.com",
};

// ─── FIXTURES ─────────────────────────────────────────────────────────────────
// Each org: owner + people (role, team) + teams (admin + members) + decks (private ones are
// limited to a team). Built idempotently by name/email, so every test file can call it.
var FIXTURE_ORGS = [
  { key: "apex", name: "Apex Test Co", owner: "apexOwner",
    people: [["apexAdmin", "admin"], ["apexAdmin2", "admin"], ["apexUser", "user"], ["apexUser2", "user"], ["apexUser3", "user"]],
    teams: [{ key: "apexTeam", name: "Alpha", admin: "apexAdmin", members: ["apexUser", "apexUser2", "apexUser3"] }],
    decks: [{ key: "apexDeck", name: "Apex Enterprise" }] },
  { key: "mer", name: "Meridian Test Group", owner: "merOwner",
    people: [["merAdmin", "admin"], ["merUser", "user"], ["merUserSouth", "user"]],
    teams: [{ key: "merNorth", name: "North", admin: "merAdmin", members: ["merUser"] },
            { key: "merSouth", name: "South", admin: "merAdmin", members: ["merUserSouth"] }],
    decks: [{ key: "merDeck", name: "Meridian Outbound" },
            { key: "merPartnerDeck", name: "Meridian Partner", privateTo: "merNorth" }] },
];

function starterCards() {
  return { c_open: { id: "c_open", title: "Opening", type: "pitch", prompt: "Hi", overview: [], answers: [], intendedPath: true } };
}

async function rawLogin(email, password) {
  var r = await fetch(BASE + "/auth/login?force=1", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email, password: password }),
  });
  return { status: r.status, body: await r.json() };
}

async function ensureOrg(spec, ids) {
  var ownerEmail = ACCOUNTS[spec.owner];
  var r = await rawLogin(ownerEmail, PASSWORD);
  if (r.status === 401) {
    if (!MASTER_CODE) throw new Error("Test fixtures don't exist yet — run the server and the tests with the same MASTER_CODE");
    var c = await fetch(BASE + "/auth/create-org", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ masterCode: MASTER_CODE, org: { name: spec.name }, firstName: "Test", lastName: "Owner",
        email: ownerEmail, phone: "5555550100", password: PASSWORD }),
    });
    if (c.status !== 201) throw new Error("create-org " + spec.name + " → " + c.status + " " + (await c.text()));
    r = await rawLogin(ownerEmail, PASSWORD);
  }
  if (r.status !== 200) throw new Error("fixture owner login → " + r.status + " " + JSON.stringify(r.body));
  var owner = client(r.body._token, r.body);
  ids[spec.key + "Org"] = r.body.orgId;

  var users = (await owner.get("/admin/users")).body;
  var userId = {};
  userId[spec.owner] = r.body.id;
  for (var p of spec.people) {
    var u = users.find(function(x) { return x.email === ACCOUNTS[p[0]]; });
    if (!u) {
      var made = await owner.post("/admin/users", { firstName: "Test", lastName: p[0], email: ACCOUNTS[p[0]], phone: "5555550100", password: PASSWORD, role: p[1] });
      if (made.status !== 201) throw new Error("fixture user " + p[0] + " → " + made.status + " " + made.text);
      u = made.body;
    }
    userId[p[0]] = u.id;
  }

  var teams = (await owner.get("/admin/teams")).body;
  for (var t of spec.teams) {
    var team = teams.find(function(x) { return x.name === t.name; });
    if (!team) {
      var tr = await owner.post("/admin/teams", { name: t.name, adminIds: [userId[t.admin]], memberIds: t.members.map(function(m) { return userId[m]; }) });
      if (tr.status !== 201) throw new Error("fixture team " + t.name + " → " + tr.status + " " + tr.text);
      team = tr.body;
    }
    ids[t.key] = team.id;
  }

  var decks = (await owner.get("/decks")).body;
  for (var d of spec.decks) {
    var deck = decks.find(function(x) { return x.name === d.name; });
    if (!deck) {
      var body = { name: d.name, cards: starterCards(), rootCard: "c_open", visibility: d.privateTo ? "private" : "public" };
      if (d.privateTo) body.accessList = [{ entityType: "team", entityId: ids[d.privateTo] }];
      var dr = await owner.post("/decks", body);
      if (dr.status !== 201 && dr.status !== 200) throw new Error("fixture deck " + d.name + " → " + dr.status + " " + dr.text);
      deck = dr.body;
    }
    ids[d.key] = deck.id;
  }
}

// { apexOrg, apexTeam, apexDeck, merOrg, merNorth, merSouth, merDeck, merPartnerDeck }
var fixturePromise = null;
function fixtures() {
  if (!fixturePromise) {
    fixturePromise = (async function() {
      var ids = {};
      for (var spec of FIXTURE_ORGS) await ensureOrg(spec, ids);
      return ids;
    })();
  }
  return fixturePromise;
}

// A signed-in client. Uses the Bearer token (same path as the Safari fallback).
async function login(who, opts) {
  await fixtures();
  var email = ACCOUNTS[who] || who;
  var r = await rawLogin(email, (opts && opts.password) || PASSWORD);
  if (r.status !== 200) throw new Error("login " + email + " → " + r.status + " " + JSON.stringify(r.body));
  return client(r.body._token, r.body);
}

function tid(prefix) { return "t_" + (prefix || "") + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

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

module.exports = { BASE, ACCOUNTS, PASSWORD, fixtures, login, client, openStream, tid, sleep };
