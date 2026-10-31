// Org isolation: everything Apex accounts (owner, admin, user) try against Meridian's
// data must be refused or come back empty — and nothing Meridian does may reach Apex's
// live event streams.
const test = require("node:test");
const assert = require("node:assert/strict");
const { login, tid, sleep, BASE, fixtures } = require("./helpers");

var F;   // fixture ids (tests/helpers.js)
test.before(async function() { F = await fixtures(); });

function denied(r, label) {
  assert.ok([400, 403, 404, 409, 410].indexOf(r.status) !== -1, label + " → " + r.status + " " + r.text.slice(0, 120));
}

test("cross-org access is refused everywhere", async function() {
  var merAdmin = await login("merAdmin");
  var merUser  = await login("merUser");
  var aOwner = await login("apexOwner");
  var aAdmin = await login("apexAdmin");
  var aUser  = await login("apexUser");
  var aStream = await aAdmin.stream();
  var oStream = await aOwner.stream();

  // ── Meridian data to aim at ──
  var MER_DECK = F.merDeck, MER_TEAM = F.merNorth, MER_USER = merUser.user.id;
  var merSid = tid("ms");
  assert.equal((await merUser.post("/sessions", { id: merSid, deckId: MER_DECK, name: "Mer private", mode: "live", startTs: Date.now() - 2000, endTs: Date.now(), events: [] })).status, 200);
  var fb = (await merAdmin.post("/sessions/" + merSid + "/feedback", { text: "Meridian only" })).body;
  // An org-wide highlight: visible to every Meridian member, never to Apex
  assert.equal((await merAdmin.put("/sessions/" + merSid + "/highlight", { scope: "org", note: "Meridian example" })).status, 200);
  var merLive = tid("ml");
  assert.equal((await merUser.post("/sessions/" + merLive + "/start", { deckId: MER_DECK, name: "Mer live" })).status, 200);
  await merUser.post("/sessions/" + merLive + "/beat", { events: [], live: { cardId: "x" } });
  var merInvite = (await merAdmin.post("/admin/invites", { label: "mer" })).body;
  var merNotes = (await merUser.get("/notifications")).body.items.map(function(n) { return n.id; });
  var createdDeck = null;

  try {
    for (var who of [["owner", aOwner], ["admin", aAdmin], ["user", aUser]]) {
      var c = who[1], w = who[0] + ": ";
      // Decks
      var decks = (await c.get("/decks")).body;
      assert.ok(!decks.some(function(d) { return d.orgId !== c.user.orgId; }), w + "deck list is own org only");
      denied(await c.put("/decks/" + MER_DECK, { name: "x", cards: {} }), w + "PUT deck");
      denied(await c.get("/decks/" + MER_DECK + "/access"), w + "GET access");
      denied(await c.put("/decks/" + MER_DECK + "/access", { accessList: [] }), w + "PUT access");
      denied(await c.post("/decks/" + MER_DECK + "/archive"), w + "archive");
      denied(await c.post("/decks/" + MER_DECK + "/restore"), w + "restore");
      denied(await c.del("/decks/" + MER_DECK), w + "DELETE deck");

      // Sessions
      for (var scope of ["user:" + MER_USER, "team:" + MER_TEAM, "users:" + MER_USER, "org"]) {
        var list = (await c.get("/sessions?scope=" + encodeURIComponent(scope))).body;
        assert.ok(Array.isArray(list) && !list.some(function(s) { return s.orgId !== c.user.orgId; }), w + "scope " + scope);
      }
      assert.ok(!(await c.get("/sessions?deckId=" + MER_DECK)).body.some(function(s) { return s.id === merSid; }), w + "deck filter");
      denied(await c.del("/sessions/" + merSid), w + "DELETE session");
      denied(await c.post("/sessions", { id: merSid, deckId: MER_DECK, name: "hijack", startTs: 1 }), w + "overwrite session");
      denied(await c.get("/sessions/" + merSid + "/feedback"), w + "GET feedback");
      denied(await c.post("/sessions/" + merSid + "/feedback", { text: "x" }), w + "POST feedback");
      denied(await c.put("/sessions/" + merSid + "/feedback/" + fb.id, { text: "x" }), w + "PUT feedback");
      denied(await c.del("/sessions/" + merSid + "/feedback/" + fb.id), w + "DELETE feedback");
      denied(await c.post("/sessions/" + merSid + "/share", { toUserId: c.user.id }), w + "share theirs");
      denied(await c.get("/sessions/" + merSid + "/shares"), w + "GET shares");
      denied(await c.get("/sessions/" + merSid + "/audio"), w + "GET audio");
      denied(await c.get("/sessions/" + merSid + "/audio/meta"), w + "GET audio meta");
      denied(await c.get("/sessions/" + merSid + "/reference"), w + "GET reference");
      denied(await c.put("/sessions/" + merSid + "/highlight", { scope: "org" }), w + "PUT highlight");
      denied(await c.del("/sessions/" + merSid + "/highlight"), w + "DELETE highlight");
      assert.ok(!(await c.get("/sessions/highlights")).body.some(function(x) { return x.id === merSid || x.orgId !== c.user.orgId; }), w + "highlights list");
      assert.ok(!(await c.get("/sessions/highlights?deckId=" + MER_DECK)).body.some(function(x) { return x.id === merSid; }), w + "highlights by deck");
      assert.ok(!(await c.get("/sessions/reference-options")).body.some(function(o) { return o.id === merSid; }), w + "reference options");
      denied(await c.post("/sessions/" + merLive + "/beat", { events: [], live: {} }), w + "beat their run");
      denied(await c.post("/sessions/" + tid("s") + "/start", { deckId: MER_DECK }), w + "start on their deck");
      var users = (await c.get("/sessions/org-users")).body;
      assert.ok(!users.some(function(u) { return u.id === MER_USER; }), w + "org-users");

      // Notifications: their ids are ignored
      await c.post("/notifications/read", { ids: merNotes });
    }

    // Live monitor never shows another org's runs
    assert.ok(!(await aAdmin.get("/sessions/live")).body.some(function(s) { return s.id === merLive; }));

    // Sharing an own session with someone in another org
    var own = tid("s");
    await aUser.post("/sessions", { id: own, deckId: F.apexDeck, name: "own", startTs: Date.now() - 1000, endTs: Date.now(), events: [] });
    denied(await aUser.post("/sessions/" + own + "/share", { toUserId: MER_USER }), "share to other org");
    // A reference to another org's session is dropped
    var withRef = (await aUser.post("/sessions", { id: tid("s"), deckId: F.apexDeck, name: "ref", startTs: Date.now(), endTs: Date.now(), events: [], referenceSessionId: merSid })).body.session;
    assert.equal(withRef.referenceSessionId, null);
    await aUser.del("/sessions/" + withRef.id);
    await aUser.del("/sessions/" + own);

    // Admin endpoints
    for (var adm of [aOwner, aAdmin]) {
      denied(await adm.put("/admin/users/" + MER_USER, { firstName: "x" }), "edit their user");
      denied(await adm.del("/admin/users/" + MER_USER), "delete their user");
      denied(await adm.post("/admin/users/" + MER_USER + "/reset-password", { password: "Hijack123A" }), "reset their password");
      denied(await adm.post("/admin/users/" + MER_USER + "/reset-link"), "reset link for their user");
      denied(await adm.put("/admin/teams/" + MER_TEAM, { name: "x" }), "edit their team");
      denied(await adm.del("/admin/teams/" + MER_TEAM), "delete their team");
      denied(await adm.post("/admin/users", { firstName: "X", lastName: "Y", email: tid() + "@example.com", phone: "555 010 0100", password: "Abcdefg1", role: "user", teamId: MER_TEAM }), "user into their team");
      denied(await adm.post("/admin/teams", { name: tid("t"), adminIds: [adm.user.id], memberIds: [MER_USER] }), "team with their user");
      denied(await adm.post("/admin/teams", { name: tid("t"), adminIds: [MER_USER] }), "team run by their user");
      denied(await adm.put("/admin/invites/" + merInvite.id, { label: "x" }), "edit their invite");
      assert.ok(!(await adm.get("/admin/users")).body.some(function(u) { return u.id === MER_USER; }), "admin user list");
      assert.ok(!(await adm.get("/admin/teams")).body.some(function(t) { return t.id === MER_TEAM; }), "admin team list");
    }
    denied(await aOwner.post("/admin/transfer-ownership", { userId: MER_USER }), "transfer ownership to their user");

    // A deck's access list can't name another org's people or teams
    var r = await aAdmin.post("/decks", { name: tid("i"), visibility: "private",
      accessList: [{ entityType: "user", entityId: MER_USER }, { entityType: "team", entityId: MER_TEAM }, { entityType: "team", entityId: F.apexTeam }] });
    assert.equal(r.status, 201);
    createdDeck = r.body.id;
    assert.deepEqual(r.body.accessList, [{ entityType: "team", entityId: F.apexTeam }]);
    var acc = (await aAdmin.get("/decks/" + createdDeck + "/access")).body;
    assert.deepEqual(acc.map(function(a) { return a.entityId; }), [F.apexTeam]);
    assert.equal((await aAdmin.put("/decks/" + createdDeck + "/access", { accessList: "nope" })).status, 400);

    // Their notifications are untouched by our "mark read" attempts
    var still = (await merUser.get("/notifications")).body.items.filter(function(n) { return merNotes.indexOf(n.id) !== -1 && n.readAt; });
    assert.equal(still.length, 0, "other org's notifications unchanged");

    // Meridian activity produced no events for Apex
    await merAdmin.post("/sessions/" + merSid + "/feedback", { text: "again" });
    await sleep(500);
    var leak = aStream.events.concat(oStream.events).filter(function(e) {
      var d = JSON.stringify(e.data || {});
      return d.indexOf(merSid) !== -1 || d.indexOf(merLive) !== -1 || d.indexOf(MER_USER) !== -1;
    });
    assert.equal(leak.length, 0, "no Meridian events on Apex streams: " + JSON.stringify(leak));
    // Control: the Apex streams were alive and still receive their own org's events
    assert.ok(!aStream.isEnded() && !oStream.isEnded(), "Apex streams up");
    var ctl = tid("s"), m = aStream.mark();
    await aUser.post("/sessions", { id: ctl, deckId: F.apexDeck, name: "control", startTs: Date.now() - 1000, endTs: Date.now(), events: [] });
    assert.ok(await aStream.waitFor("session.finished", function(d) { return d.id === ctl; }, 5000, m), "control event arrived");
    await aUser.del("/sessions/" + ctl);

    // Health endpoint is public and reveals nothing
    var h = await (await fetch(BASE + "/health")).json();
    assert.deepEqual(Object.keys(h).sort(), ["ok", "ts"]);
  } finally {
    if (createdDeck) await aOwner.del("/decks/" + createdDeck);
    await merUser.post("/sessions", { id: merLive, deckId: MER_DECK, name: "Mer live", startTs: Date.now() - 1000, endTs: Date.now(), events: [] });
    await merUser.del("/sessions/" + merLive);
    await merUser.del("/sessions/" + merSid);
    await merAdmin.del("/admin/invites/" + merInvite.id);
    aStream.close(); oStream.close();
  }
});

test("users only see decks and sessions they are allowed to", async function() {
  var merUserSouth = await login("merUserSouth");   // Team South: not on the private Partner deck
  var decks = (await merUserSouth.get("/decks")).body;
  assert.ok(!decks.some(function(d) { return d.id === F.merPartnerDeck; }), "private deck hidden");
  assert.equal((await merUserSouth.post("/sessions/" + tid("s") + "/start", { deckId: F.merPartnerDeck, name: "x" })).status, 400, "can't run a hidden deck");
  // Users can't read other people's sessions or the org scope
  var orgList = (await merUserSouth.get("/sessions?scope=org")).body;
  assert.ok(orgList.every(function(s) { return s.userId === merUserSouth.user.id || s._shared; }), "org scope ignored for users");
  var north = (await merUserSouth.get("/sessions?scope=team:" + F.merNorth)).body;
  assert.ok(north.every(function(s) { return s.userId === merUserSouth.user.id || s._shared; }), "other team's scope ignored");
});
