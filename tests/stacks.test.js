// Objection stack permissions and order (db.js "OBJECTION STACK PERMISSIONS").
//   Apex: team Alpha (admin apexAdmin; members apexUser, apexUser2, apexUser3); apexAdmin2 on no team.
const test = require("node:test");
const assert = require("node:assert/strict");
const { login, tid, fixtures } = require("./helpers");

test.before(async function() { await fixtures(); });

function find(r, id) { assert.equal(r.status, 200, r.text); return r.body.find(function(d) { return d.id === id; }) || null; }
function full(d, changes) { return Object.assign({ name: d.name, color: d.color, icon: d.icon, cards: d.cards, rootCard: d.rootCard, objStacks: d.objStacks, visibility: d.visibility }, changes || {}); }
function stack(id, label) {
  return { id: id, label: label, icon: "💸", rootCard: "o_" + id, cards: { ["o_" + id]: { id: "o_" + id, title: "Answer", type: "objection", prompt: "Sure", overview: [], answers: [] } } };
}
function st(deck, id) { return (deck.objStacks || []).find(function(s) { return s.id === id; }) || null; }
function ids(deck) { return deck.objStacks.map(function(s) { return s.id; }); }

test("stacks: creator manages, editors edit, others read or don't see; only the owner orders", async function() {
  var owner = await login("apexOwner"), editor = await login("apexAdmin"), other = await login("apexAdmin2");
  var rep = await login("apexUser"), rep2 = await login("apexUser2");
  var r = await owner.post("/decks", { name: tid("st"), cards: {}, objStacks: [] });
  assert.equal(r.status, 201, r.text);
  var deckId = r.body.id, s0 = "os_" + tid(), s1 = "os_" + tid();
  try {
    // The owner adds a stack and makes apexAdmin a deck editor
    r = await owner.put("/decks/" + deckId, full(r.body, { objStacks: [stack(s0, "Owner stack")] }));
    assert.equal(r.status, 200, r.text);
    assert.equal(st(r.body, s0).createdBy, owner.user.id);
    assert.equal((await owner.put("/decks/" + deckId + "/editors", { userIds: [editor.user.id] })).status, 200);

    // A deck editor adds their own stack and can't change the owner's
    var asEd = find(await editor.get("/decks"), deckId);
    assert.equal(st(asEd, s0).canEdit, false, "deck editors don't edit other people's stacks");
    var renamed = asEd.objStacks.map(function(s) { return Object.assign({}, s, { label: "Hijacked" }); });
    r = await editor.put("/decks/" + deckId, full(asEd, { objStacks: renamed.concat([stack(s1, "Editor stack"), stack(s1, "Editor stack")]) }));
    assert.equal(r.body.objStacks.filter(function(s) { return s.id === s1; }).length, 1, "a repeated new id is added once");
    assert.equal(r.status, 200, r.text);
    var ownerView = find(await owner.get("/decks"), deckId);
    assert.equal(st(ownerView, s0).label, "Owner stack", "the owner's stack is unchanged");
    assert.equal(st(ownerView, s1).createdBy, editor.user.id, "the new stack is the editor's");
    asEd = find(await editor.get("/decks"), deckId);
    assert.equal(st(asEd, s1).canEdit, true);
    assert.equal(st(asEd, s1).canManage, true);
    assert.equal(st(asEd, s0).accessList, undefined, "assignees are for managers only");

    // The creator assigns the stack to apexUser and adds apexAdmin2 as an editor
    var mine = asEd.objStacks.map(function(s) { return s.id === s1 ? Object.assign({}, s, { visibility: "private", accessList: [{ entityType: "user", entityId: rep.user.id }], editorIds: [other.user.id] }) : s; });
    assert.equal((await editor.put("/decks/" + deckId, full(asEd, { objStacks: mine }))).status, 200);
    assert.ok(st(find(await rep.get("/decks"), deckId), s1), "the assigned rep sees it");
    assert.equal(st(find(await rep2.get("/decks"), deckId), s1), null, "another rep doesn't");
    assert.ok(st(find(await rep2.get("/decks"), deckId), s0), "…but still sees the org-wide stack");

    // A stack editor without deck rights changes only that stack (not the deck, not its access)
    var asOther = find(await other.get("/decks"), deckId);
    assert.equal(asOther.canEdit, false);
    assert.equal(st(asOther, s1).canEdit, true);
    assert.equal(st(asOther, s1).canManage, false);
    var edited = asOther.objStacks.map(function(s) { return s.id === s1 ? Object.assign({}, s, { label: "Edited", visibility: "public" }) : s; });
    r = await other.put("/decks/" + deckId, full(asOther, { name: "Renamed", objStacks: edited }));
    assert.equal(r.status, 200, r.text);
    ownerView = find(await owner.get("/decks"), deckId);
    assert.notEqual(ownerView.name, "Renamed", "deck fields need deck rights");
    assert.equal(st(ownerView, s1).label, "Edited");
    assert.equal(st(ownerView, s1).visibility, "private", "only the creator or owner changes who uses it");
    assert.deepEqual(st(ownerView, s1).editorIds, [other.user.id]);

    // An admin with no rights at all can't save
    var none = await login("apexAdmin2");
    await owner.put("/decks/" + deckId, full(ownerView, { objStacks: ownerView.objStacks.map(function(s) { return s.id === s1 ? Object.assign({}, s, { editorIds: [] }) : s; }) }));
    var asNone = find(await none.get("/decks"), deckId);
    assert.equal((await none.put("/decks/" + deckId, full(asNone))).status, 403);

    // Archive/restore answer with the same per-person view: a deck editor who can't see the
    // private stack doesn't get it (or the deck's access list) back from archiving
    await owner.put("/decks/" + deckId + "/editors", { userIds: [editor.user.id, none.user.id] });
    var ar = await none.post("/decks/" + deckId + "/archive");
    assert.equal(ar.status, 200, ar.text);
    assert.equal(st(ar.body, s1), null, "archive response hides the private stack");
    assert.equal(ar.body.accessList, undefined, "…and the deck's access list");
    var rr = await none.post("/decks/" + deckId + "/restore");
    assert.equal(rr.status, 200, rr.text);
    assert.equal(st(rr.body, s1), null, "restore response too");
    await owner.put("/decks/" + deckId + "/editors", { userIds: [editor.user.id] });

    // Order: an editor's reorder (and dropped stacks) are ignored; the owner's counts
    ownerView = find(await owner.get("/decks"), deckId);
    var order = ids(ownerView);
    asEd = find(await editor.get("/decks"), deckId);
    assert.equal((await editor.put("/decks/" + deckId, full(asEd, { objStacks: asEd.objStacks.slice().reverse().slice(0, 1) }))).status, 200);
    assert.deepEqual(ids(find(await owner.get("/decks"), deckId)), order, "editor can't reorder or drop stacks");
    assert.equal((await owner.put("/decks/" + deckId, full(ownerView, { objStacks: ownerView.objStacks.slice().reverse() }))).status, 200);
    assert.deepEqual(ids(find(await owner.get("/decks"), deckId)), order.slice().reverse(), "the owner reorders");
  } finally {
    await owner.del("/decks/" + deckId);
  }
});
