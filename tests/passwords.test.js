// Password management: change your own password, admin-issued one-time reset links.
const test = require("node:test");
const assert = require("node:assert/strict");
const { login, tid } = require("./helpers");

var PW1 = "Startpass1A", PW2 = "Newpass22B", PW3 = "Thirdpass3C";

async function makeUser(admin) {
  var email = tid("pw") + "@example.com";
  var r = await admin.post("/admin/users", { firstName: "Reset", lastName: "Tester", email: email, phone: "555 010 0199", password: PW1, role: "user" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { id: r.body.id, email: email };
}

test("admin reset link: one use, signs the user out, old password stops working", async function() {
  var admin = await login("apexAdmin");
  var u = await makeUser(admin);
  try {
    var user = await login(u.email, { password: PW1 });
    var stream = await user.stream();

    var r = await admin.post("/admin/users/" + u.id + "/reset-link");
    assert.equal(r.status, 200);
    var token = r.body.token;
    assert.ok(token && token.length >= 40);
    assert.ok(r.body.expiresAt > Date.now());

    var preview = await admin.get("/auth/reset/" + token);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.email, u.email);
    assert.equal(preview.body.orgName, "Apex Test Co");
    assert.equal(preview.body.passwordHash, undefined);

    assert.equal((await admin.post("/auth/reset", { token: token, password: "weak" })).status, 400, "password policy applies");
    r = await admin.post("/auth/reset", { token: token, password: PW2 });
    assert.equal(r.status, 200, JSON.stringify(r.body));

    var ended = await stream.waitFor("auth.ended");
    assert.equal(ended && ended.reason, "password", "open app signed out live");
    assert.equal((await user.get("/sessions")).status, 401, "old session revoked");
    assert.equal((await admin.post("/auth/reset", { token: token, password: PW3 })).status, 404, "link works once");
    assert.equal((await admin.get("/auth/reset/" + token)).status, 404);
    await assert.rejects(login(u.email, { password: PW1 }), "old password rejected");
    await login(u.email, { password: PW2 });

    // A new link cancels the previous one
    var a = (await admin.post("/admin/users/" + u.id + "/reset-link")).body.token;
    var b = (await admin.post("/admin/users/" + u.id + "/reset-link")).body.token;
    assert.equal((await admin.get("/auth/reset/" + a)).status, 404);
    assert.equal((await admin.get("/auth/reset/" + b)).status, 200);
    stream.close();
  } finally {
    await admin.del("/admin/users/" + u.id);
  }
});

test("reset links follow the admin rules and never cross orgs", async function() {
  var admin = await login("apexAdmin");
  var merAdmin = await login("merAdmin");
  var owner = await login("apexOwner");
  var u = await makeUser(admin);
  try {
    assert.equal((await merAdmin.post("/admin/users/" + u.id + "/reset-link")).status, 404, "other org's admin");
    assert.equal((await admin.post("/admin/users/" + owner.user.id + "/reset-link")).status, 403, "nobody resets the owner");
    var otherAdmin = (await admin.get("/admin/users")).body.find(function(x) { return x.role === "admin" && x.id !== admin.user.id; });
    assert.equal((await admin.post("/admin/users/" + otherAdmin.id + "/reset-link")).status, 403, "admins can't reset admins");
    assert.equal((await admin.post("/admin/users/" + admin.user.id + "/reset-link")).status, 400, "not yourself");
    var user = await login("apexUser");
    assert.equal((await user.post("/admin/users/" + u.id + "/reset-link")).status, 403, "users can't");
    assert.equal((await admin.get("/auth/reset/not-a-real-token-at-all-xxxxxxxx")).status, 404);
  } finally {
    await admin.del("/admin/users/" + u.id);
  }
});

test("change password: needs the current one, keeps this device, ends the old session id", async function() {
  var admin = await login("apexAdmin");
  var u = await makeUser(admin);
  try {
    var user = await login(u.email, { password: PW1 });
    assert.equal((await user.post("/auth/change-password", { currentPassword: "Wrong123A", newPassword: PW2 })).status, 403);
    assert.equal((await user.post("/auth/change-password", { currentPassword: PW1, newPassword: "short" })).status, 400);
    assert.equal((await user.post("/auth/change-password", { currentPassword: PW1, newPassword: PW1 })).status, 400, "must differ");
    var r = await user.post("/auth/change-password", { currentPassword: PW1, newPassword: PW2 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body._token);
    assert.equal((await user.get("/sessions")).status, 401, "previous token retired");
    var fresh = require("./helpers").client(r.body._token);
    assert.equal((await fresh.get("/sessions")).status, 200, "this device continues with the new token");
    await login(u.email, { password: PW2 });
  } finally {
    await admin.del("/admin/users/" + u.id);
  }
});
