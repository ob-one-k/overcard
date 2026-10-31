// Deck order: the owner sets it, every deck list (any role) follows it, new decks go
// last, and nobody can reorder another org's decks.
const test = require("node:test");
const assert = require("node:assert/strict");
const { login, tid, fixtures } = require("./helpers");

var F;
test.before(async function() { F = await fixtures(); });

function ids(list) { return list.map(function(d) { return d.id; }); }

test("owner reorders decks; everyone sees the new order; others can't reorder", async function() {
  var owner = await login("merOwner"), admin = await login("merAdmin"), rep = await login("merUser");
  var made = [];
  try {
    for (var i = 0; i < 2; i++) {
      var r = await owner.post("/decks", { name: "Z" + tid(), cards: {}, objStacks: [] });
      assert.equal(r.status, 201, r.text);
      made.push(r.body.id);
    }
    var before = ids((await owner.get("/decks")).body);
    assert.deepEqual(before.slice(-2), made, "new decks are appended in creation order");

    var wanted = before.slice().reverse();
    assert.equal((await owner.put("/decks/order", { ids: wanted })).status, 200);
    assert.deepEqual(ids((await owner.get("/decks")).body), wanted, "owner sees the new order");
    // A rep sees their (filtered) decks in the same relative order
    var repIds = ids((await rep.get("/decks")).body);
    assert.deepEqual(repIds, wanted.filter(function(id) { return repIds.indexOf(id) > -1; }), "rep follows the order");

    // Partial lists and unknown ids: listed first, the rest keep their place after
    var partial = [made[1], "d_does_not_exist", F.apexDeck];
    assert.equal((await owner.put("/decks/order", { ids: partial })).status, 200);
    var after = ids((await owner.get("/decks")).body);
    assert.equal(after[0], made[1], "listed deck first");
    assert.deepEqual(after.slice(1), wanted.filter(function(id) { return id !== made[1]; }), "unlisted keep relative order");

    assert.equal((await admin.put("/decks/order", { ids: wanted })).status, 403, "admins can't reorder");
    assert.equal((await rep.put("/decks/order", { ids: wanted })).status, 403, "users can't reorder");
    assert.equal((await owner.put("/decks/order", { ids: "nope" })).status, 400, "ids must be a list");

    // Another org's owner can't move Meridian's decks
    var apexOwner = await login("apexOwner");
    var merBefore = ids((await owner.get("/decks")).body);
    assert.equal((await apexOwner.put("/decks/order", { ids: merBefore.slice().reverse() })).status, 200);
    assert.deepEqual(ids((await owner.get("/decks")).body), merBefore, "cross-org ids are ignored");
  } finally {
    for (var id of made) await owner.del("/decks/" + id);
    // Leave the fixture decks in a stable order for other runs
    await owner.put("/decks/order", { ids: [F.merDeck, F.merPartnerDeck] });
  }
});
