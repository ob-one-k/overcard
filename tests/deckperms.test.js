// Deck permissions: who sees, uses, edits and manages a deck.
//   Apex: team Alpha (admin apexAdmin; members apexUser, apexUser2, apexUser3); apexAdmin2 on no team.
const test = require("node:test");
const assert = require("node:assert/strict");
const { login, tid, fixtures } = require("./helpers");

var F;
test.before(async function() { F = await fixtures(); });

function find(r, id) { assert.equal(r.status, 200, r.text); return r.body.find(function(d) { return d.id === id; }) || null; }
function fullDeck(d, changes) { return Object.assign({ name: d.name, color: d.color, icon: d.icon, cards: d.cards, rootCard: d.rootCard, objStacks: d.objStacks, visibility: d.visibility }, changes || {}); }

test("team-assigned decks: creator manages, editors edit, others don't see", async function() {
  var creator = await login("apexAdmin"), other = await login("apexAdmin2"), owner = await login("apexOwner");
  var member = await login("apexUser");
  var r = await creator.post("/decks", { name: tid("td"), visibility: "private", accessList: [{ entityType: "team", entityId: F.apexTeam }], cards: {}, objStacks: [] });
  assert.equal(r.status, 201, r.text);
  var deckId = r.body.id;
  try {
    var mine = find(await creator.get("/decks"), deckId);
    assert.ok(mine && mine.canEdit && mine.canManage, "creator edits + manages");
    assert.ok(find(await member.get("/decks"), deckId), "team member sees it");
    assert.equal(find(await other.get("/decks"), deckId), null, "admin outside the team doesn't see it");
    assert.equal((await other.put("/decks/" + deckId, fullDeck(mine, { name: "hijack" }))).status, 404, "…or edit it");
    assert.equal((await other.post("/sessions/" + tid("s") + "/start", { deckId: deckId, name: "x" })).status, 400, "…or run it");
    var ownerView = find(await owner.get("/decks"), deckId);
    assert.ok(ownerView && ownerView.canEdit && ownerView.canManage, "owner sees and manages every deck");

    // Grant the other admin edit rights: they see and edit, but can't change teams or editors
    var g = await creator.put("/decks/" + deckId + "/editors", { userIds: [other.user.id, member.user.id] });
    assert.equal(g.status, 200, g.text);
    assert.deepEqual(g.body.editorIds, [other.user.id], "only admins become editors");
    var asEditor = find(await other.get("/decks"), deckId);
    assert.ok(asEditor && asEditor.canEdit && !asEditor.canManage, "editor: edit, not manage");
    assert.equal((await other.put("/decks/" + deckId, fullDeck(asEditor, { name: "Edited by editor", visibility: "public" }))).status, 200);
    var after = find(await owner.get("/decks"), deckId);
    assert.equal(after.name, "Edited by editor", "editor's edit saved");
    assert.equal(after.visibility, "private", "editor can't change who sees it");
    assert.equal((await other.put("/decks/" + deckId + "/access", { accessList: [] })).status, 403, "editor can't change teams");
    assert.equal((await other.put("/decks/" + deckId + "/editors", { userIds: [] })).status, 403, "editor can't change editors");
    assert.equal(asEditor.accessList, undefined, "non-managers don't receive who the deck is assigned to");
    assert.equal(asEditor.editorIds, undefined, "…or who may edit it");
    var memberView = find(await member.get("/decks"), deckId);
    assert.ok(memberView && memberView.accessList === undefined && memberView.editorIds === undefined, "users don't either");
    assert.ok(Array.isArray(find(await creator.get("/decks"), deckId).editorIds), "the creator does");

    // Demoting an editor to user revokes their grants (they don't come back on re-promotion)
    assert.equal((await owner.put("/admin/users/" + other.user.id, { role: "user" })).status, 200);
    assert.equal((await owner.put("/admin/users/" + other.user.id, { role: "admin" })).status, 200);
    other = await login("apexAdmin2");
    var regranted = find(await other.get("/decks"), deckId);
    assert.ok(!regranted || !regranted.canEdit, "grant removed by the demotion");
    await creator.put("/decks/" + deckId + "/editors", { userIds: [other.user.id] });

    // Archived: only those who may edit still see it
    assert.equal((await other.post("/decks/" + deckId + "/archive")).status, 200, "editors may archive");
    assert.equal(find(await member.get("/decks"), deckId), null, "members don't see archived decks");
    assert.ok(find(await other.get("/decks"), deckId), "editor sees it to restore it");
    await creator.put("/decks/" + deckId + "/editors", { userIds: [] });
    assert.equal(find(await other.get("/decks"), deckId), null, "edit rights removed → gone");

    // Owner can assign the deck to any team, and edit it without being listed
    assert.equal((await owner.put("/decks/" + deckId + "/access", { accessList: [] })).status, 200);
    assert.equal((await owner.post("/decks/" + deckId + "/restore")).status, 200);
  } finally {
    await owner.del("/decks/" + deckId);
  }
});

test("org-wide decks: every admin uses them, only owner/creator/editors edit", async function() {
  var other = await login("apexAdmin2"), owner = await login("apexOwner"), rep = await login("apexUser");
  var fixture = find(await other.get("/decks"), F.apexDeck);   // created by the owner, org-wide
  assert.ok(fixture, "org-wide deck is visible to any admin");
  assert.equal(fixture.canEdit, false, "…but not editable without a grant");
  assert.equal((await other.put("/decks/" + F.apexDeck, fullDeck(fixture, { name: "nope" }))).status, 403, "edit refused");
  assert.equal((await other.post("/decks/" + F.apexDeck + "/archive")).status, 403, "archive refused");
  var userView = find(await rep.get("/decks"), F.apexDeck);
  assert.ok(userView && !userView.canEdit, "users see it read-only");
  var sid = tid("s");
  var r = await other.post("/sessions/" + sid + "/start", { deckId: F.apexDeck, name: "Run" });
  assert.equal(r.status, 200, "admins can run org-wide decks");
  await other.del("/sessions/" + sid);
  assert.ok(find(await owner.get("/decks"), F.apexDeck).canEdit, "owner edits everything");
});
