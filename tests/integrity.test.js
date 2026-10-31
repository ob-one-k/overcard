// Production data rules: deleting people/teams with history works and keeps that history,
// emails are unique regardless of case, and there is no passwordless demo sign-in.
const test = require("node:test");
const assert = require("node:assert/strict");
const { login, tid, BASE, fixtures } = require("./helpers");

var F;   // fixture ids (tests/helpers.js)
test.before(async function() { F = await fixtures(); });

test("deleting a user with sessions, feedback and shares keeps the history", async function() {
  var admin = await login("apexAdmin");
  var mate = await login("apexUser2");
  var email = tid("del") + "@example.com";
  var u = (await admin.post("/admin/users", { firstName: "Leaving", lastName: "Rep", email: email, phone: "555 010 0177", password: "Leaving1A", role: "user", teamIds: [F.apexTeam] })).body;
  var rep = await login(email, { password: "Leaving1A" });
  var sid = tid("s");
  var deckId = null;
  try {
    assert.equal((await rep.post("/sessions", { id: sid, deckId: F.apexDeck, name: "Last call", startTs: Date.now() - 1000, endTs: Date.now(), events: [] })).status, 200);
    assert.equal((await rep.post("/sessions/" + sid + "/share", { toUserId: mate.user.id })).status, 200);
    assert.equal((await admin.post("/sessions/" + sid + "/feedback", { text: "Good" })).status, 200);
    // A private deck shared with them
    var d = await admin.post("/decks", { name: "t_del " + tid(), visibility: "private", accessList: [{ entityType: "user", entityId: u.id }] });
    deckId = d.body.id;

    var r = await admin.del("/admin/users/" + u.id);
    assert.equal(r.status, 200, r.text);

    var org = (await admin.get("/sessions?scope=org")).body;
    var kept = org.find(function(s) { return s.id === sid; });
    assert.ok(kept, "session kept for the team's history");
    assert.equal(kept.userId, null);
    assert.equal(kept.userName, "Former member");
    assert.equal((await admin.get("/sessions/" + sid + "/feedback")).body.length, 1, "feedback kept");
    assert.ok(!(await mate.get("/sessions")).body.some(function(s) { return s.id === sid; }), "shares from them removed");
    assert.deepEqual((await admin.get("/decks/" + deckId + "/access")).body, [], "deck access entry removed");
    assert.equal((await admin.post("/sessions/" + sid + "/feedback", { text: "After they left" })).status, 200, "feedback on a former member's session");
    assert.equal((await admin.del("/sessions/" + sid)).status, 200, "admins can still delete it");
    assert.ok(!(await admin.get("/sessions?scope=org")).body.some(function(s) { return s.id === sid; }), "and it is really gone");
  } finally {
    await admin.del("/sessions/" + sid);      // no-ops when the test got this far
    await admin.del("/admin/users/" + u.id);
    if (deckId) await (await login("apexOwner")).del("/decks/" + deckId);
  }
});

test("deleting a team that is someone's primary team works", async function() {
  var admin = await login("apexAdmin");
  var t = (await admin.post("/admin/teams", { name: "t_team " + tid(), adminIds: [admin.user.id] })).body;
  var email = tid("tm") + "@example.com";
  var u = (await admin.post("/admin/users", { firstName: "Team", lastName: "Member", email: email, phone: "555 010 0188", password: "Teammate1A", role: "user", teamId: t.id, teamIds: [t.id] })).body;
  try {
    var r = await admin.del("/admin/teams/" + t.id);
    assert.equal(r.status, 200, r.text);
    var after = (await admin.get("/admin/users")).body.find(function(x) { return x.id === u.id; });
    assert.equal(after.teamId, null);
  } finally {
    await admin.del("/admin/users/" + u.id);
  }
});

test("emails are unique regardless of case", async function() {
  var admin = await login("apexAdmin");
  var r = await admin.post("/admin/users", { firstName: "Dup", lastName: "Case", email: "USER@Apex-Test.com", phone: "555 010 0199", password: "Dupcase1A", role: "user" });
  assert.equal(r.status, 409);
  var ok = await login("User@APEX-test.COM");
  assert.equal(ok.user.email, "user@apex-test.com");
});

test("there is no demo sign-in", async function() {
  var r = await fetch(BASE + "/auth/demo-login?force=1", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "owner@apex-test.com" }) });
  assert.equal(r.status, 404);
});
