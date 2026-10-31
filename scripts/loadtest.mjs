// ─── LOAD TEST ────────────────────────────────────────────────────────────────
// 100 people using OverCard at once, each doing something different, in a throwaway org:
//   60 reps    run sessions: start → heartbeat every 2–5 s while moving card to card → finish
//   20 reps    browse: session lists, decks, notifications, team scopes
//   10 reps    share their finished sessions with teammates
//   10 reps    open reviews (feedback + shares) of sessions shared with them
//    5 admins  watch the live monitor, leave feedback, edit the deck
// Everyone holds a live event stream open the whole time.
//
// Never run it against production. Start a server with sign-in limits off and a master code:
//   RATE_LIMITS=off MASTER_CODE=lt-secret NODE_ENV=development DATABASE_URL=... node server/index.js
//   MASTER_CODE=lt-secret npm run loadtest
// Options (env): LT_API (default http://localhost:3001), LT_USERS (100), LT_SECONDS (60),
//   LT_SERVER_PID (sample server memory/CPU from /proc), DATABASE_URL (delete the test org after).

import { readFileSync } from "node:fs";

var API = (process.env.LT_API || "http://localhost:3001") + "/api";
var N_USERS = parseInt(process.env.LT_USERS, 10) || 100;
var SECONDS = parseInt(process.env.LT_SECONDS, 10) || 60;
var MASTER = process.env.MASTER_CODE;
var PW = "Loadtest1A";
if (!MASTER) { console.error("Set MASTER_CODE (the server's master code) to create the load-test org."); process.exit(1); }

// ── metrics ──
var stats = {};     // label → [ms]
var steady = {};    // label → [ms] for requests started after the opening burst
var BURST_MS = 5000;
var workloadStart = 0;
var errors = {};    // label → { status: count }
var lags = { started: [], progress: [], feedback: [] };
function record(label, ms, status, startedAt) {
  (stats[label] = stats[label] || []).push(ms);
  if (workloadStart && startedAt - workloadStart > BURST_MS) (steady[label] = steady[label] || []).push(ms);
  if (status >= 400 || status === 0) { var e = errors[label] = errors[label] || {}; e[status] = (e[status] || 0) + 1; }
}
function pct(arr, p) { if (!arr.length) return 0; var s = arr.slice().sort(function(a, b) { return a - b; }); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; }
var sleep = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };
var rand = function(a, b) { return a + Math.random() * (b - a); };
var uid = function(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 9); };

async function call(token, method, path, body, label) {
  var t0 = performance.now(), status = 0, json = null;
  try {
    var r = await fetch(API + path, {
      method: method,
      headers: Object.assign({ "Content-Type": "application/json" }, token ? { Authorization: "Bearer " + token } : {}),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    status = r.status;
    var text = await r.text();
    try { json = text ? JSON.parse(text) : null; } catch (_) {}
  } catch (_) { status = 0; }
  record(label || method + " " + path.replace(/[?].*$/, "").replace(/\/(t_|s_|lt|u|d|team_|inv_|sh|fb)[A-Za-z0-9_]+/g, "/:id"), performance.now() - t0, status, Date.now() - (performance.now() - t0));
  return { status: status, body: json };
}

function openStream(token, onEvent) {
  var ctrl = new AbortController();
  (async function() {
    try {
      var r = await fetch(API + "/events", { headers: { Authorization: "Bearer " + token }, signal: ctrl.signal });
      if (!r.ok) { record("STREAM connect", 0, r.status); return; }
      record("STREAM connect", 0, 200);
      var reader = r.body.getReader(), dec = new TextDecoder(), buf = "";
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
          if (type) onEvent(type, data);
        }
      }
    } catch (_) {}
  })();
  return function() { ctrl.abort(); };
}

// ── server sampling (local runs) ──
var serverSamples = [];
function sampleServer() {
  var pid = process.env.LT_SERVER_PID;
  if (!pid) return;
  try {
    var st = readFileSync("/proc/" + pid + "/status", "utf8");
    var rss = parseInt(/VmRSS:\s+(\d+)/.exec(st)[1], 10) / 1024;
    var cpu = readFileSync("/proc/" + pid + "/stat", "utf8").split(" ");
    serverSamples.push({ t: Date.now(), rss: rss, ticks: parseInt(cpu[13], 10) + parseInt(cpu[14], 10) });
  } catch (_) {}
}

// ── setup ──
var CARDS = {};
var ORDER = ["c_open", "c_disc", "c_pain", "c_value", "c_demo", "c_close"];
ORDER.forEach(function(id, i) {
  CARDS[id] = { id: id, title: "Card " + (i + 1), type: i < 2 ? "pitch" : i < 4 ? "discovery" : "close", prompt: "Say the thing.", overview: [], intendedPath: true,
    answers: i < ORDER.length - 1 ? [{ id: "a" + i, label: "Next", next: ORDER[i + 1] }] : [] };
});

async function setup() {
  var tag = Date.now().toString(36);
  console.log("Setting up a load-test org…");
  var r = await call(null, "POST", "/auth/create-org", { masterCode: MASTER, org: { name: "Load test " + tag },
    firstName: "Load", lastName: "Owner", email: "owner-" + tag + "@loadtest.local", phone: "555 010 0000", password: PW }, "setup");
  if (r.status !== 201) throw new Error("create-org failed: " + r.status + " " + JSON.stringify(r.body));
  var owner = { token: r.body._token, id: r.body.id, orgId: r.body.orgId };
  var deck = await call(owner.token, "POST", "/decks", { name: "Load deck", rootCard: "c_open", cards: CARDS }, "setup");
  var people = [];
  var admins = 5;
  for (var i = 0; i < N_USERS + admins; i++) {
    var email = "u" + i + "-" + tag + "@loadtest.local";
    var u = await call(owner.token, "POST", "/admin/users", { firstName: "User", lastName: String(i), email: email, phone: "555 010 " + String(1000 + i).slice(-4), password: PW, role: i < admins ? "admin" : "user" }, "setup");
    if (u.status !== 201) throw new Error("create user failed: " + u.status + " " + JSON.stringify(u.body));
    people.push({ id: u.body.id, email: email, admin: i < admins });
  }
  // The owner's deck: the load-test admins edit it, so they need an editor grant (deck permissions)
  var ed = await call(owner.token, "PUT", "/decks/" + deck.body.id + "/editors", { userIds: people.filter(function(p) { return p.admin; }).map(function(p) { return p.id; }) }, "setup");
  if (ed.status !== 200) throw new Error("grant editors failed: " + ed.status + " " + JSON.stringify(ed.body));
  var team = await call(owner.token, "POST", "/admin/teams", { name: "Load team", adminIds: people.filter(function(p) { return p.admin; }).map(function(p) { return p.id; }),
    memberIds: people.filter(function(p) { return !p.admin; }).map(function(p) { return p.id; }) }, "setup");
  return { owner: owner, deckId: deck.body.id, people: people, teamId: team.body && team.body.id, orgId: owner.orgId };
}

// ── behaviours ──
var stopAt = 0;
var running = function() { return Date.now() < stopAt; };
var startedAt = {};      // sessionId → ts the rep called /start
var beatAt = {};         // sessionId → ts of last beat
var feedbackAt = {};     // sessionId → ts feedback posted
var finished = [];       // { id, userId, token }
var sharedWith = {};     // userId → [sessionId]

async function rep(p, ctx) {
  while (running()) {
    var id = uid("lt");
    startedAt[id] = Date.now();
    await call(p.token, "POST", "/sessions/" + id + "/start", { deckId: ctx.deckId, name: "Call " + id.slice(-4), mode: Math.random() < 0.5 ? "live" : "practice", startTs: Date.now(), live: { cardId: "c_open", cardTitle: "Card 1", cardType: "pitch" } }, "POST /sessions/:id/start");
    var events = [];
    var steps = 3 + Math.floor(Math.random() * (ORDER.length - 3));   // 3..5 — the last step still has a next card
    for (var s = 0; s < steps && running(); s++) {
      await sleep(rand(2000, 5000));
      events.push({ type: "visit", cardId: ORDER[s], cardTitle: CARDS[ORDER[s]].title, cardType: CARDS[ORDER[s]].type, isObjCard: false, intendedPath: true, ts: Date.now(), durationMs: 3000 });
      if (Math.random() < 0.2) events.push({ type: "note", cardId: ORDER[s], cardTitle: CARDS[ORDER[s]].title, text: "Prospect mentioned budget", ts: Date.now() });
      beatAt[id] = Date.now();
      await call(p.token, "POST", "/sessions/" + id + "/beat", { events: events, live: { cardId: ORDER[s + 1], cardTitle: CARDS[ORDER[s + 1]].title, cardType: CARDS[ORDER[s + 1]].type } }, "POST /sessions/:id/beat");
    }
    var r = await call(p.token, "POST", "/sessions", { id: id, deckId: ctx.deckId, name: "Call " + id.slice(-4), mode: "live", status: "completed",
      outcome: Math.random() < 0.3 ? "sold" : "completed", sold: false, startTs: startedAt[id], endTs: Date.now(), events: events }, "POST /sessions (finish)");
    if (r.status === 200) finished.push({ id: id, userId: p.id, token: p.token });
    await sleep(rand(500, 2000));
  }
}

async function browser(p) {
  var paths = ["/sessions", "/decks", "/notifications", "/sessions?limit=200", "/sessions/org-users"];
  while (running()) {
    var path = paths[Math.floor(Math.random() * paths.length)];
    await call(p.token, "GET", path, undefined, "GET " + path.replace(/\?.*$/, "") + (path.indexOf("limit") !== -1 ? "?limit" : ""));
    if (Math.random() < 0.3) await call(p.token, "GET", "/sessions?scope=team:" + p.teamId, undefined, "GET /sessions?scope=team");
    await sleep(rand(1500, 4000));
  }
}

async function sharer(p, ctx) {
  // Share their own finished runs (they also run short sessions to have something to share)
  while (running()) {
    var mine = finished.filter(function(f) { return f.userId === p.id; });
    if (!mine.length) {
      var id = uid("lt");
      var r = await call(p.token, "POST", "/sessions", { id: id, deckId: ctx.deckId, name: "Practice " + id.slice(-4), mode: "practice", startTs: Date.now() - 60000, endTs: Date.now(), events: [] }, "POST /sessions (finish)");
      if (r.status === 200) finished.push({ id: id, userId: p.id, token: p.token });
    } else {
      var s = mine[Math.floor(Math.random() * mine.length)];
      var to = ctx.users[Math.floor(Math.random() * ctx.users.length)];
      if (to.id !== p.id) {
        await call(p.token, "POST", "/sessions/" + s.id + "/share", { toUserId: to.id, context: "Have a listen" }, "POST /sessions/:id/share");
        (sharedWith[to.id] = sharedWith[to.id] || []).push(s.id);
      }
    }
    await sleep(rand(3000, 6000));
  }
}

async function reviewer(p) {
  while (running()) {
    var list = await call(p.token, "GET", "/sessions", undefined, "GET /sessions");
    var shared = (list.body || []).filter(function(s) { return s._shared; });
    if (shared.length) {
      var s = shared[Math.floor(Math.random() * shared.length)];
      await call(p.token, "GET", "/sessions/" + s.id + "/feedback", undefined, "GET /sessions/:id/feedback");
      if (Math.random() < 0.4) await call(p.token, "POST", "/sessions/" + s.id + "/feedback", { text: "Nice handling of the objection" }, "POST /sessions/:id/feedback");
    }
    await sleep(rand(3000, 6000));
  }
}

async function admin(p, ctx, i) {
  var deck = null;
  while (running()) {
    await call(p.token, "GET", "/sessions/live", undefined, "GET /sessions/live");
    if (finished.length && Math.random() < 0.6) {
      var s = finished[Math.floor(Math.random() * finished.length)];
      feedbackAt[s.id] = Date.now();
      await call(p.token, "POST", "/sessions/" + s.id + "/feedback", { text: "Coach note " + Math.floor(Math.random() * 1000) }, "POST /sessions/:id/feedback");
    }
    if (i === 0) {
      // One admin edits the deck (autosave-sized writes)
      if (!deck) { var ds = await call(p.token, "GET", "/decks", undefined, "GET /decks"); deck = (ds.body || []).find(function(d) { return d.id === ctx.deckId; }); }
      if (deck) {
        deck.cards.c_open.prompt = "Updated " + Date.now();
        await call(p.token, "PUT", "/decks/" + deck.id, deck, "PUT /decks/:id");
      }
    }
    await call(p.token, "GET", "/sessions?scope=org&limit=200", undefined, "GET /sessions?scope=org");
    await sleep(rand(3000, 5000));
  }
}

// ── main ──
async function main() {
  var ctx = await setup();
  var all = ctx.people;

  console.log("Signing in " + all.length + " people at once…");
  var t0 = performance.now();
  var logins = await Promise.all(all.map(function(p) {
    return call(null, "POST", "/auth/login", { email: p.email, password: PW }, "POST /auth/login (burst)").then(function(r) { p.token = r.body && r.body._token; return r.status; });
  }));
  console.log("  " + logins.filter(function(s) { return s === 200; }).length + "/" + all.length + " signed in in " + Math.round(performance.now() - t0) + " ms");
  all.forEach(function(p) { p.teamId = ctx.teamId; });

  var admins = all.filter(function(p) { return p.admin; });
  var users = all.filter(function(p) { return !p.admin; });
  ctx.users = users;

  // Every person keeps a live stream open; admins measure how fast events reach them
  var closers = all.map(function(p) {
    return openStream(p.token, function(type, data) {
      if (!data) return;
      if (p.admin && type === "session.started" && startedAt[data.id]) lags.started.push(Date.now() - startedAt[data.id]);
      if (p.admin && type === "session.progress" && beatAt[data.id] && p === admins[0]) lags.progress.push(Date.now() - beatAt[data.id]);
      if (!p.admin && type === "feedback.changed" && feedbackAt[data.sessionId]) { lags.feedback.push(Date.now() - feedbackAt[data.sessionId]); delete feedbackAt[data.sessionId]; }
    });
  });
  await sleep(1500);

  console.log("Running the mixed workload for " + SECONDS + " s…");
  workloadStart = Date.now();
  stopAt = Date.now() + SECONDS * 1000;
  var sampler = setInterval(sampleServer, 1000);
  sampleServer();
  var nRep = Math.round(users.length * 0.6), nBrowse = Math.round(users.length * 0.2), nShare = Math.round(users.length * 0.1);
  var jobs = [];
  users.forEach(function(p, i) {
    if (i < nRep) jobs.push(rep(p, ctx));
    else if (i < nRep + nBrowse) jobs.push(browser(p));
    else if (i < nRep + nBrowse + nShare) jobs.push(sharer(p, ctx));
    else jobs.push(reviewer(p));
  });
  admins.forEach(function(p, i) { jobs.push(admin(p, ctx, i)); });
  await Promise.all(jobs);
  clearInterval(sampler);
  sampleServer();
  closers.forEach(function(c) { c(); });

  report(all.length);
  await cleanup(ctx);
}

function report(n) {
  console.log("\n── Results: " + n + " concurrent people, " + SECONDS + " s ──");
  var rows = Object.keys(stats).filter(function(k) { return k !== "setup" && k !== "STREAM connect"; }).sort();
  var total = 0, errs = 0, worstP95 = 0, worstAll = 0;
  console.log("All latencies in ms. 'steady' excludes the first " + BURST_MS / 1000 + " s, when every simulated person fires at the same instant.");
  console.log(pad("endpoint", 34) + pad("count", 8) + pad("p50", 7) + pad("p95", 7) + pad("p99", 7) + pad("steady p95", 12) + "errors");
  rows.forEach(function(k) {
    var a = stats[k]; total += a.length;
    var e = errors[k] ? Object.keys(errors[k]).map(function(s) { return s + "×" + errors[k][s]; }).join(" ") : "";
    if (errors[k]) errs += Object.values(errors[k]).reduce(function(x, y) { return x + y; }, 0);
    var sp = pct(steady[k] || [], 95);
    if (k.indexOf("burst") === -1) { worstP95 = Math.max(worstP95, sp); worstAll = Math.max(worstAll, pct(a, 95)); }
    console.log(pad(k, 34) + pad(a.length, 8) + pad(Math.round(pct(a, 50)), 7) + pad(Math.round(pct(a, 95)), 7) + pad(Math.round(pct(a, 99)), 7) + pad(k.indexOf("burst") === -1 ? Math.round(sp) : "—", 12) + e);
  });
  var streams = (stats["STREAM connect"] || []).length, streamErr = errors["STREAM connect"] ? Object.values(errors["STREAM connect"]).reduce(function(x, y) { return x + y; }, 0) : 0;
  console.log("\nrequests: " + total + " (" + Math.round(total / SECONDS) + "/s)   errors: " + errs + "   live streams: " + (streams - streamErr) + "/" + streams);
  ["started", "progress", "feedback"].forEach(function(k) {
    var a = lags[k];
    console.log("live event lag (" + k + "): n=" + a.length + " p50=" + Math.round(pct(a, 50)) + "ms p95=" + Math.round(pct(a, 95)) + "ms max=" + Math.round(pct(a, 100)) + "ms");
  });
  if (serverSamples.length > 1) {
    var first = serverSamples[0], last = serverSamples[serverSamples.length - 1];
    var cpu = (last.ticks - first.ticks) / 100 / ((last.t - first.t) / 1000) * 100;
    console.log("server: peak RSS " + Math.round(Math.max.apply(null, serverSamples.map(function(s) { return s.rss; }))) + " MB, avg CPU " + Math.round(cpu) + "% of one core");
  }
  var lagP95 = Math.max(pct(lags.started, 95), pct(lags.feedback, 95));
  var pass = errs === 0 && worstP95 < 300 && lagP95 < 1000 && streamErr === 0;
  console.log("\nWorst p95 — steady: " + Math.round(worstP95) + " ms, including the opening burst: " + Math.round(worstAll) + " ms");
  console.log("Pass bar (0 errors, steady p95 < 300 ms on every endpoint, live lag p95 < 1 s, all streams up): " + (pass ? "PASS" : "FAIL"));
  process.exitCode = pass ? 0 : 1;
}
function pad(v, n) { v = String(v); return v.length >= n ? v + " " : v + " ".repeat(n - v.length); }

async function cleanup(ctx) {
  if (!process.env.DATABASE_URL) { console.log("\n(Load-test org " + ctx.orgId + " left in place — set DATABASE_URL to delete it automatically.)"); return; }
  const pg = (await import("pg")).default;
  var pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  var o = ctx.orgId;
  try {
    await pool.query("BEGIN");
    await pool.query('DELETE FROM sessions WHERE "orgId" = $1', [o]);
    await pool.query('DELETE FROM decks WHERE "orgId" = $1', [o]);
    await pool.query('DELETE FROM notifications WHERE "orgId" = $1', [o]);
    await pool.query('DELETE FROM users WHERE "orgId" = $1', [o]);
    await pool.query('DELETE FROM teams WHERE "orgId" = $1', [o]);
    await pool.query('DELETE FROM orgs WHERE id = $1', [o]);
    await pool.query("COMMIT");
    console.log("\nLoad-test org deleted.");
  } catch (err) {
    await pool.query("ROLLBACK");
    console.log("\nCleanup failed: " + err.message);
  } finally { await pool.end(); }
}

main().catch(function(err) { console.error(err); process.exit(1); });
