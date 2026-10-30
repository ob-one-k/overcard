// Production data rules: deleting people/teams with history works and keeps that history,
// emails are unique regardless of case, demo sign-in is limited to demo accounts.
const test = require("node:test");
const assert = require("node:assert/strict");
const { login, tid, BASE } = require("./helpers");

test("deleting a user with sessions, feedback and shares keeps the history", async function() {
  var admin = await login("apexAdmin");
  var mate = await login("apexUser2");
  var email = tid("del") + "@example.com";
  var u = (await admin.post("/admin/users", { firstName: "Leaving", lastName: "Rep", email: email, phone: "555 010 0177", password: "Leaving1A", role: "user", teamIds: ["team_alpha"] })).body;
  var rep = await login(email, { password: "Leaving1A" });
  var sid = tid("s");
  var deckId = null;
  try {
    assert.equal((await rep.post("/sessions", { id: sid, deckId: "d_apex_ent", name: "Last call", startTs: Date.now() - 1000, endTs: Date.now(), events: [] })).status, 200);
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
    assert.equal((await admin.del("/sessions/" + sid)).status, 200, "admins can still delete it");
  } finally {
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
  var r = await admin.post("/admin/users", { firstName: "Dup", lastName: "Case", email: "MARCUS@ApexSales.com", phone: "555 010 0199", password: "Dupcase1A", role: "user" });
  assert.equal(r.status, 409);
  var ok = await login("Marcus@ApexSales.COM");
  assert.equal(ok.user.email, "marcus@apexsales.com");
});

test("demo sign-in only works for demo accounts", async function() {
  var cfg = await (await fetch(BASE + "/config")).json();
  assert.equal(typeof cfg.demo, "boolean");
  async function demo(email) {
    var r = await fetch(BASE + "/auth/demo-login?force=1", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email }) });
    return r.status;
  }
  if (!cfg.demo) { assert.equal(await demo("alex@apexsales.com"), 404); return; }
  assert.equal(await demo("alex@apexsales.com"), 200);
  var admin = await login("apexAdmin");
  var email = tid("nd") + "@example.com";
  var u = (await admin.post("/admin/users", { firstName: "Real", lastName: "Person", email: email, phone: "555 010 0111", password: "Realpers1A", role: "user" })).body;
  try {
    assert.equal(await demo(email), 404, "real accounts never sign in without a password");
    assert.equal(await demo("nobody@example.com"), 404);
  } finally {
    await admin.del("/admin/users/" + u.id);
  }
});
