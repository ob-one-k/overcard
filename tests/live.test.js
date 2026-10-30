// Live updates: session monitor, finished sessions, feedback, shares, notifications,
// and one-device-at-a-time sign-in.
const test = require("node:test");
const assert = require("node:assert/strict");
const { login, tid, sleep } = require("./helpers");

var APEX_DECK = "d_apex_ent";
var MER_DECK  = "d_merd_out";

function visit(cardId, ts) {
  return { type: "visit", cardId: cardId, cardTitle: "Card " + cardId, cardType: "pitch", isObjCard: false, intendedPath: true, ts: ts, durationMs: 1000 };
}

test("live session: start → progress → finish reaches the org's admins only", async function() {
  var admin = await login("apexAdmin");
  var user  = await login("apexUser");
  var merAdmin = await login("merAdmin");
  var aStream = await admin.stream();
  var mStream = await merAdmin.stream();
  var uStream = await user.stream();
  assert.equal(aStream.status, 200);
  var id = tid("s");
  try {
    var r = await user.post("/sessions/" + id + "/start", { deckId: APEX_DECK, name: "Live test", mode: "live", startTs: Date.now(), live: { cardId: "c1", cardTitle: "Opening" } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    var started = await aStream.waitFor("session.started", function(d) { return d.id === id; });
    assert.ok(started, "admin sees the run start");
    assert.equal(started.userId, user.user.id);
    assert.equal(started.live.cardId, "c1");

    // In-progress runs appear only in the live list, never in normal lists
    var live = await admin.get("/sessions/live");
    assert.ok(live.body.some(function(s) { return s.id === id; }));
    var mine = await user.get("/sessions");
    assert.ok(!mine.body.some(function(s) { return s.id === id; }), "active run hidden from lists");
    assert.equal((await user.get("/sessions/live")).status, 403, "reps can't open the monitor");

    r = await user.post("/sessions/" + id + "/beat", { events: [visit("c1", Date.now())], live: { cardId: "c2", cardTitle: "Discovery" } });
    assert.equal(r.status, 200);
    var prog = await aStream.waitFor("session.progress", function(d) { return d.id === id && d.live && d.live.cardId === "c2"; });
    assert.ok(prog, "admin sees progress");
    assert.equal(prog.events.length, 1);

    // Another user can't write to this run
    var other = await login("apexUser2");
    assert.equal((await other.post("/sessions/" + id + "/beat", { events: [], live: {} })).status, 409);

    r = await user.post("/sessions", { id: id, deckId: APEX_DECK, deckName: "x", name: "Live test", mode: "live", status: "completed", outcome: "completed",
      startTs: Date.now() - 5000, endTs: Date.now(), events: [visit("c1", Date.now()), visit("c2", Date.now())] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(await aStream.waitFor("session.finished", function(d) { return d.id === id; }), "admin told it finished");
    assert.ok(await uStream.waitFor("session.finished", function(d) { return d.id === id; }), "rep's other tabs told it finished");
    mine = await user.get("/sessions");
    assert.ok(mine.body.some(function(s) { return s.id === id && s.status === "completed"; }), "finished run is listed immediately");
    live = await admin.get("/sessions/live");
    assert.ok(!live.body.some(function(s) { return s.id === id; }));

    // Nothing about Apex reached Meridian
    await sleep(300);
    assert.ok(!mStream.events.some(function(e) { return e.data && e.data.id === id; }), "no cross-org events");
  } finally {
    await user.del("/sessions/" + id);
    aStream.close(); mStream.close(); uStream.close();
  }
});

test("live session: deck must belong to the caller's org", async function() {
  var user = await login("apexUser");
  var r = await user.post("/sessions/" + tid("s") + "/start", { deckId: MER_DECK, name: "x" });
  assert.equal(r.status, 400);
  r = await user.post("/sessions", { id: tid("s"), deckId: MER_DECK, name: "x", startTs: Date.now() });
  assert.equal(r.status, 400);
});

test("feedback and shares update the rep, the recipient and admins live", async function() {
  var admin = await login("apexAdmin");
  var user  = await login("apexUser");
  var mate  = await login("apexUser2");
  var uStream = await user.stream();
  var mStream = await mate.stream();
  var id = tid("s");
  try {
    var r = await user.post("/sessions", { id: id, deckId: APEX_DECK, name: "Share test", mode: "practice", startTs: Date.now() - 1000, endTs: Date.now(), events: [] });
    assert.equal(r.status, 200);

    r = await admin.post("/sessions/" + id + "/feedback", { text: "Nice opener" });
    assert.equal(r.status, 200);
    assert.ok(await uStream.waitFor("notification.new", function(d) { return d.sessionId === id && d.type === "feedback"; }));
    assert.ok(await uStream.waitFor("feedback.changed", function(d) { return d.sessionId === id; }));
    var notes = await user.get("/notifications");
    assert.ok(notes.body.items.some(function(n) { return n.sessionId === id && n.type === "feedback"; }));

    r = await user.post("/sessions/" + id + "/share", { toUserId: mate.user.id, context: "Have a look" });
    assert.equal(r.status, 200);
    assert.ok(await mStream.waitFor("notification.new", function(d) { return d.sessionId === id && d.type === "share"; }), "recipient notified");
    assert.ok(await mStream.waitFor("share.changed", function(d) { return d.sessionId === id; }));
    var mateList = await mate.get("/sessions");
    assert.ok(mateList.body.some(function(s) { return s.id === id && s._shared; }), "shared session appears for the recipient");

    // Sharing again doesn't notify twice
    await user.post("/sessions/" + id + "/share", { toUserId: mate.user.id });
    var mateNotes = await mate.get("/notifications");
    assert.equal(mateNotes.body.items.filter(function(n) { return n.sessionId === id && n.type === "share"; }).length, 1);

    // The recipient leaves feedback → the rep hears about it
    r = await mate.post("/sessions/" + id + "/feedback", { text: "Agreed" });
    assert.equal(r.status, 200);
    assert.ok(await uStream.waitFor("feedback.changed", function(d) { return d.sessionId === id; }));

    // Revoking tells the recipient
    var shares = await user.get("/sessions/" + id + "/shares");
    var share = shares.body.find(function(x) { return x.toUserId === mate.user.id; });
    await user.del("/sessions/" + id + "/shares/" + share.id);
    assert.ok(await mStream.waitFor("share.changed", function(d) { return d.sessionId === id; }), "recipient told the share was revoked");
  } finally {
    await user.del("/sessions/" + id);
    uStream.close(); mStream.close();
  }
});

test("signing in on a second device signs the first out live and saves its run", async function() {
  var admin = await login("apexAdmin");
  var aStream = await admin.stream();
  var first = await login("apexUser3");
  var fStream = await first.stream();
  var id = tid("s");
  var r = await first.post("/sessions/" + id + "/start", { deckId: APEX_DECK, name: "Kicked run", startTs: Date.now() });
  assert.equal(r.status, 200);
  await first.post("/sessions/" + id + "/beat", { events: [visit("c1", Date.now())], live: { cardId: "c2" } });

  var second = await login("apexUser3");
  var ended = await fStream.waitFor("auth.ended");
  assert.ok(ended, "first device told immediately");
  assert.equal(ended.reason, "replaced");
  var stale = await first.get("/sessions");
  assert.equal(stale.status, 401);
  assert.equal(stale.body.error, "session_replaced");

  assert.ok(await aStream.waitFor("session.finished", function(d) { return d.id === id && d.abandoned; }), "monitor told the run ended");
  var list = await second.get("/sessions");
  var saved = list.body.find(function(s) { return s.id === id; });
  assert.ok(saved, "run saved");
  assert.equal(saved.outcome, "abandoned");
  assert.equal(saved.events.length, 1, "path kept");

  // Logging out the old token must not end the new device's session
  await first.post("/auth/logout");
  assert.equal((await second.get("/sessions")).status, 200);
  await second.del("/sessions/" + id);
  aStream.close(); fStream.close();
});

test("the live stream accepts the session cookie alone (same-origin browsers)", async function() {
  var user = await login("apexUser");
  var ctrl = new AbortController();
  var r = await fetch(require("./helpers").BASE + "/events", { headers: { Cookie: "rc_token=" + user.token }, signal: ctrl.signal });
  assert.equal(r.status, 200);
  ctrl.abort();
});
