// Text limits: deck names, card titles/scripts/bullets, stack labels and session titles.
// New or changed text is held to the limits; content saved before them keeps saving.
const test = require("node:test");
const assert = require("node:assert/strict");
const { login, tid, fixtures } = require("./helpers");

var F;
test.before(async function() { F = await fixtures(); });

function card(id, changes) {
  return Object.assign({ id: id, title: "Open", type: "pitch", prompt: "Hi {{NAME}} here", overview: [], answers: [], intendedPath: true }, changes || {});
}
function fullDeck(d, changes) { return Object.assign({ name: d.name, color: d.color, icon: d.icon, cards: d.cards, rootCard: d.rootCard, objStacks: d.objStacks, visibility: d.visibility }, changes || {}); }

test("deck names are cut to 21 characters", async function() {
  var owner = await login("apexOwner");
  var r = await owner.post("/decks", { name: "x".repeat(30), cards: {}, objStacks: [] });
  assert.equal(r.status, 201, r.text);
  var d = r.body;
  try {
    assert.equal(d.name, "x".repeat(21));
    r = await owner.put("/decks/" + d.id, fullDeck(d, { name: "z".repeat(30) }));
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.name, "z".repeat(21), "a rename is cut too");
  } finally {
    await owner.del("/decks/" + d.id);
  }
});

test("titles, bullets and labels are cut; scripts are cleaned but never block a save", async function() {
  var owner = await login("apexOwner");
  var r = await owner.post("/decks", { name: tid("L"), cards: { c1: card("c1") }, rootCard: "c1", objStacks: [] });
  assert.equal(r.status, 201, r.text);
  var d = r.body;
  try {
    var cards = { c1: card("c1", { title: "T".repeat(30), overview: ["b".repeat(50), "ok"] }) };
    var stacks = [{ id: "os_" + tid(), label: "S".repeat(30), icon: "💸", rootCard: "o1", cards: { o1: card("o1", { type: "objection", title: "O".repeat(25) }) } }];
    r = await owner.put("/decks/" + d.id, fullDeck(d, { cards: cards, objStacks: stacks }));
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.cards.c1.title.length, 21, "card title cut to 21");
    assert.equal(r.body.cards.c1.overview[0].length, 36, "bullet cut to 36");
    assert.equal(r.body.cards.c1.overview[1], "ok");
    assert.equal(r.body.objStacks[0].label.length, 21, "stack label cut to 21");
    assert.equal(r.body.objStacks[0].cards.o1.title.length, 21, "objection card title cut to 21");

    // Only the editor's delivery cues survive; an injected label is dropped
    var hostile = '*hi*[" onmouseover="alert(1)" x="] and *calm*[Pause] {{NAME}}';
    r = await owner.put("/decks/" + d.id, fullDeck(r.body, { cards: { c1: card("c1", { prompt: hostile }) } }));
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.cards.c1.prompt, "*hi* and *calm*[Pause] {{NAME}}");

    // A huge or pathological script is capped before any markup parsing — and answered fast
    var t0 = Date.now();
    r = await owner.put("/decks/" + d.id, fullDeck(r.body, { cards: { c1: card("c1", { prompt: "*a".repeat(200000) }) } }));
    assert.equal(r.status, 200, r.text);
    assert.ok(r.body.cards.c1.prompt.length <= 2000, "raw script capped");
    assert.ok(Date.now() - t0 < 2000, "no regex blow-up (" + (Date.now() - t0) + " ms)");

    // An unchanged older long script (saved before the limits) keeps saving
    r = await owner.put("/decks/" + d.id, fullDeck(r.body));
    assert.equal(r.status, 200, r.text);
  } finally {
    await owner.del("/decks/" + d.id);
  }
});

test("session titles are cut to 50 characters", async function() {
  var rep = await login("apexUser");
  var id = tid("s");
  var r = await rep.post("/sessions/" + id + "/start", { deckId: F.apexDeck, name: "n".repeat(80), mode: "practice", startTs: Date.now() });
  assert.equal(r.status, 200, r.text);
  r = await rep.post("/sessions", { id: id, deckId: F.apexDeck, name: "m".repeat(80), mode: "practice", startTs: Date.now(), events: [], notes: [] });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.session.name.length, 50);
  await rep.del("/sessions/" + id);
});
