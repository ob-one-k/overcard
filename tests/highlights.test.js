// Highlighted sessions: who may set them, who sees them, and what a viewer may do.
//   Meridian: merAdmin administers North + South, merUser is in North, merUserSouth in South.
//   Apex: apexAdmin administers team Alpha; apexAdmin2 belongs to no team.
const test = require("node:test");
const assert = require("node:assert/strict");
const { login, tid, fixtures } = require("./helpers");

var F;
test.before(async function() { F = await fixtures(); });

async function finishedSession(c, deckId, name) {
  var id = tid("hl");
  var r = await c.post("/sessions", { id: id, deckId: deckId, name: name, mode: "live", startTs: Date.now() - 3000, endTs: Date.now(), events: [] });
  assert.equal(r.status, 200, "save session → " + r.status + " " + r.text);
  return id;
}
function listed(r, id) { assert.equal(r.status, 200); return r.body.some(function(s) { return s.id === id; }); }

test("team highlights reach that team (and the owner) only; viewers are read-only", async function() {
  var admin = await login("merAdmin"), owner = await login("merOwner");
  var north = await login("merUser"), south = await login("merUserSouth");
  var sid = await finishedSession(north, F.merDeck, "North example");
  await admin.post("/sessions/" + sid + "/feedback", { text: "Nice recovery" });
  try {
    var r = await admin.put("/sessions/" + sid + "/highlight", { scope: "team", teamId: F.merNorth, note: "Listen to the pricing part" });
    assert.equal(r.status, 200, r.text);

    // North member, owner and the admin see it (list, deck filter, badge on the session)
    assert.ok(listed(await north.get("/sessions/highlights"), sid), "north sees it");
    assert.ok(listed(await north.get("/sessions/highlights?deckId=" + F.merDeck), sid), "deck filter");
    assert.ok(listed(await owner.get("/sessions/highlights"), sid), "owner sees it");
    assert.ok(listed(await admin.get("/sessions/highlights"), sid), "admin of the team sees it");
    var h = (await north.get("/sessions/highlights")).body.find(function(s) { return s.id === sid; });
    assert.equal(h.highlight.scope, "team");
    assert.equal(h.highlight.teamId, F.merNorth);
    assert.equal(h.highlight.note, "Listen to the pricing part");
    var own = (await north.get("/sessions?deckId=" + F.merDeck)).body.find(function(s) { return s.id === sid; });
    assert.ok(own && own.highlight && own.highlight.scope === "team", "badge on the owner's own list");

    // South member doesn't: not listed, no feedback/audio access, no badge leak via org scope lists
    assert.ok(!listed(await south.get("/sessions/highlights"), sid), "south doesn't see it");
    assert.equal((await south.get("/sessions/" + sid + "/feedback")).status, 403, "south GET feedback");
    assert.equal((await south.get("/sessions/" + sid + "/audio/meta")).status, 403, "south GET audio meta");

    // A viewer may read feedback (and would reach the recording) but never write feedback
    var fbr = await (await login("merUser")).get("/sessions/" + sid + "/feedback");
    assert.equal(fbr.status, 200);
    var viewer = await login("merUserSouth");
    // make South a viewer through an org-wide highlight, then check it's read-only
    assert.equal((await admin.put("/sessions/" + sid + "/highlight", { scope: "org" })).status, 200);
    assert.ok(listed(await viewer.get("/sessions/highlights"), sid), "org highlight reaches south");
    assert.equal((await viewer.get("/sessions/" + sid + "/feedback")).status, 200, "viewer reads feedback");
    assert.notEqual((await viewer.get("/sessions/" + sid + "/audio/meta")).status, 403, "viewer may reach the recording");
    assert.equal((await viewer.post("/sessions/" + sid + "/feedback", { text: "x" })).status, 403, "viewer can't write feedback");
    assert.equal((await viewer.put("/sessions/" + sid + "/highlight", { scope: "org" })).status, 403, "users can't highlight");
    assert.equal((await viewer.del("/sessions/" + sid + "/highlight")).status, 403, "users can't remove highlights");

    // Removing it takes it away from everyone
    assert.equal((await admin.del("/sessions/" + sid + "/highlight")).status, 200);
    assert.ok(!listed(await viewer.get("/sessions/highlights"), sid), "gone after DELETE");
    assert.equal((await viewer.get("/sessions/" + sid + "/feedback")).status, 403, "access goes with it");
  } finally {
    await north.del("/sessions/" + sid);
  }
});

test("admins highlight only for teams they belong to or administer; admins see only their teams' highlights", async function() {
  var owner = await login("apexOwner"), alphaAdmin = await login("apexAdmin"), loneAdmin = await login("apexAdmin2");
  var rep = await login("apexUser");
  var sid = await finishedSession(rep, F.apexDeck, "Alpha example");
  try {
    assert.equal((await loneAdmin.put("/sessions/" + sid + "/highlight", { scope: "team", teamId: F.apexTeam })).status, 403, "not their team");
    assert.equal((await loneAdmin.put("/sessions/" + sid + "/highlight", { scope: "team" })).status, 400, "team scope needs a team");
    assert.equal((await loneAdmin.put("/sessions/" + sid + "/highlight", { scope: "everyone" })).status, 400, "bad scope");
    assert.equal((await loneAdmin.put("/sessions/" + sid + "/highlight", { scope: "org", note: "x".repeat(281) })).status, 400, "note too long");
    assert.equal((await loneAdmin.put("/sessions/" + sid + "/highlight", { scope: "team", teamId: F.merNorth })).status, 400, "other org's team");

    assert.equal((await alphaAdmin.put("/sessions/" + sid + "/highlight", { scope: "team", teamId: F.apexTeam })).status, 200, "own team");
    assert.ok(!listed(await loneAdmin.get("/sessions/highlights"), sid), "admin outside the team doesn't see it");
    var orgList = (await loneAdmin.get("/sessions?scope=org&deckId=" + F.apexDeck)).body.find(function(s) { return s.id === sid; });
    assert.ok(orgList && !orgList.highlight, "no badge leak in the admin's org list");
    assert.equal((await loneAdmin.del("/sessions/" + sid + "/highlight")).status, 403, "can't remove another team's highlight");
    assert.equal((await loneAdmin.put("/sessions/" + sid + "/highlight", { scope: "org" })).status, 403, "can't re-scope another team's highlight");
    assert.ok(listed(await owner.get("/sessions/highlights"), sid), "owner sees every team's highlights");

    // The owner may change it to org-wide; then every admin sees it
    assert.equal((await owner.put("/sessions/" + sid + "/highlight", { scope: "org", note: "For everyone" })).status, 200);
    assert.ok(listed(await loneAdmin.get("/sessions/highlights"), sid), "org-wide reaches every admin");
    assert.ok(listed(await (await login("apexUser2")).get("/sessions/highlights?limit=3"), sid), "and every user");
  } finally {
    await rep.del("/sessions/" + sid);
  }
  // Deleting the session removes its highlight
  assert.ok(!listed(await owner.get("/sessions/highlights"), sid), "highlight goes with the session");
});

test("only finished sessions can be highlighted, and a highlight change is published live", async function() {
  var admin = await login("merAdmin"), rep = await login("merUser");
  var live = tid("hlv");
  assert.equal((await rep.post("/sessions/" + live + "/start", { deckId: F.merDeck, name: "In progress" })).status, 200);
  assert.equal((await admin.put("/sessions/" + live + "/highlight", { scope: "org" })).status, 400, "active run");
  await rep.post("/sessions", { id: live, deckId: F.merDeck, name: "In progress", mode: "live", startTs: Date.now() - 1000, endTs: Date.now(), events: [] });

  var stream = await rep.stream();
  try {
    var m = stream.mark();
    assert.equal((await admin.put("/sessions/" + live + "/highlight", { scope: "org" })).status, 200);
    assert.ok(await stream.waitFor("highlight.changed", function(d) { return d.sessionId === live; }, 5000, m), "members get highlight.changed");
  } finally {
    stream.close();
    await rep.del("/sessions/" + live);
  }
});
