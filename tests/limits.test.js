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

test("deck names are capped at 21 characters", async function() {
  var owner = await login("apexOwner");
  var r = await owner.post("/decks", { name: "x".repeat(22), cards: {}, objStacks: [] });
  assert.equal(r.status, 400, "a 22-character name is refused");
  r = await owner.post("/decks", { name: "y".repeat(21), cards: {}, objStacks: [] });
  assert.equal(r.status, 201, r.text);
  var d = r.body;
  assert.equal((await owner.put("/decks/" + d.id, fullDeck(d, { name: "z".repeat(22) }))).status, 400, "renaming past the limit is refused");
  await owner.del("/decks/" + d.id);
});

test("card titles, bullets and stack labels are cut; long scripts are refused", async function() {
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

    // 180 visible characters: markup doesn't count, {{NAME}} counts as 6
    var ok = "**" + "a".repeat(170) + "** {{NAME}}";   // 170 + 1 + 6 = 177
    r = await owner.put("/decks/" + d.id, fullDeck(r.body, { cards: { c1: card("c1", { prompt: ok }) } }));
    assert.equal(r.status, 200, r.text);
    r = await owner.put("/decks/" + d.id, fullDeck(r.body, { cards: { c1: card("c1", { prompt: "a".repeat(181) }) } }));
    assert.equal(r.status, 400, "a 181-character script is refused");
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
