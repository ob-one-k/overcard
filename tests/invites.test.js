// Share codes: labels, team assignment, who joined, editing/reactivating, specific errors.
const test = require("node:test");
const assert = require("node:assert/strict");
const { login, client, tid, BASE } = require("./helpers");

async function signup(code, extra) {
  var email = tid("join") + "@example.com";
  var r = await fetch(BASE + "/auth/signup", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.assign({ code: code, firstName: "New", lastName: "Hire", email: email, phone: "555 010 0123", password: "Joinpass1A" }, extra || {})),
  });
  var body = await r.json();
  return { status: r.status, body: body, email: email };
}

test("a labelled team code adds people to the team and records who joined", async function() {
  var admin = await login("apexAdmin");
  var stream = await admin.stream();
  var created = [];
  var r = await admin.post("/admin/invites", { label: "Spring hires", teamId: "team_alpha", maxUses: 2, expiresInDays: 7 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  var inv = r.body;
  try {
    assert.equal(inv.label, "Spring hires");
    assert.equal(inv.teamName, "Team Alpha");

    var preview = await admin.get("/auth/invite/" + inv.code.toLowerCase());
    assert.equal(preview.status, 200);
    assert.equal(preview.body.orgName, "Apex Sales");
    assert.equal(preview.body.teamName, "Team Alpha");

    var s1 = await signup(inv.code.slice(0, 4) + "-" + inv.code.slice(4));
    assert.equal(s1.status, 201, JSON.stringify(s1.body));
    created.push(s1.body.id);
    assert.equal(s1.body.teamId, "team_alpha");
    assert.ok(s1.body.teams.some(function(t) { return t.id === "team_alpha"; }), "member of the code's team");
    assert.ok(await stream.waitFor("users.changed", function(d) { return d.joined === s1.body.id; }), "admins told live");

    var list = (await admin.get("/admin/invites")).body;
    var mine = list.find(function(x) { return x.id === inv.id; });
    assert.equal(mine.uses, 1);
    assert.equal(mine.joinedCount, 1);
    var members = await admin.get("/admin/invites/" + inv.id + "/members");
    assert.deepEqual(members.body.map(function(m) { return m.id; }), [s1.body.id]);
    assert.equal(members.body[0].passwordHash, undefined);

    var s2 = await signup(inv.code);
    assert.equal(s2.status, 201);
    created.push(s2.body.id);
    var s3 = await signup(inv.code);
    assert.equal(s3.status, 410);
    assert.equal(s3.body.reason, "used_up");
    assert.equal((await admin.get("/auth/invite/" + inv.code)).body.reason, "used_up");

    // More uses reactivate it
    r = await admin.put("/admin/invites/" + inv.id, { maxUses: 5 });
    assert.equal(r.status, 200);
    assert.equal((await admin.get("/auth/invite/" + inv.code)).status, 200);
    assert.equal((await admin.put("/admin/invites/" + inv.id, { maxUses: 1 })).status, 400, "can't go below uses so far");

    // Revoke → specific reason → reactivate
    await admin.del("/admin/invites/" + inv.id);
    var pr = await admin.get("/auth/invite/" + inv.code);
    assert.equal(pr.status, 410);
    assert.equal(pr.body.reason, "revoked");
    r = await admin.put("/admin/invites/" + inv.id, { reactivate: true, label: "Spring hires (2)" });
    assert.equal(r.body.revokedAt, null);
    assert.equal(r.body.label, "Spring hires (2)");
    assert.equal((await admin.get("/auth/invite/" + inv.code)).status, 200);

    assert.equal((await admin.get("/auth/invite/ZZZZZZZZ")).body.reason, "unknown");
  } finally {
    await admin.del("/admin/invites/" + inv.id);
    for (var i = 0; i < created.length; i++) await admin.del("/admin/users/" + created[i]);
    stream.close();
  }
});

test("share codes stay inside their org", async function() {
  var admin = await login("apexAdmin");
  var merAdmin = await login("merAdmin");
  var inv = (await admin.post("/admin/invites", {})).body;
  try {
    assert.equal((await merAdmin.put("/admin/invites/" + inv.id, { label: "x" })).status, 404);
    assert.equal((await merAdmin.get("/admin/invites/" + inv.id + "/members")).status, 404);
    assert.equal((await merAdmin.del("/admin/invites/" + inv.id)).status, 404);
    assert.ok(!(await merAdmin.get("/admin/invites")).body.some(function(x) { return x.id === inv.id; }));
    assert.equal((await admin.post("/admin/invites", { teamId: "team_north" })).status, 400, "another org's team");
    assert.equal((await admin.put("/admin/invites/" + inv.id, { teamId: "team_north" })).status, 400);
    var user = await login("apexUser");
    assert.equal((await user.post("/admin/invites", {})).status, 403);
    assert.equal((await admin.post("/admin/invites", { label: "x".repeat(61) })).status, 400);
    assert.equal((await admin.post("/admin/invites", { maxUses: 0 })).status, 400);
    assert.equal((await admin.post("/admin/invites", { expiresInDays: 0 })).status, 400);
  } finally {
    await admin.del("/admin/invites/" + inv.id);
  }
});
