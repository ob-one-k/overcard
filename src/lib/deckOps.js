import { uid, aid, osid, LIMITS } from "./constants.js";

// ─── DECK OPERATIONS ──────────────────────────────────────────────────────────
// Pure helpers for templates, copying and archiving. Every card id that is
// copied gets a fresh id, and answer links are rewritten through an
// old→new map; links that point at cards that weren't copied are cleared.

function card(id, type, title, prompt, overview, answers, sortIndex) {
  return { id:id, title:title, type:type, prompt:prompt, overview:overview, intendedPath:true, answers:answers, sortIndex:sortIndex };
}

// Starter structure for a new deck: Opening → Discovery → Close, all on the intended path
export function newDeckTemplate() {
  var open = uid(), disc = uid(), close = uid();
  var cards = {};
  cards[open] = card(open, "pitch", "Opening",
    "*Hi [Name]*[Warm] — I'm [Your Name] with [Company]. **Do you have a quick minute?**",
    ["Introduce yourself and why you're calling", "Keep it under 20 seconds"],
    [{ id:aid(), label:"Sure, go ahead", next:disc }], 0);
  cards[disc] = card(disc, "discovery", "Discovery",
    "*Quick question*[Question] — how are you handling [problem] today?",
    ["Ask open-ended questions", "Listen for the pain you solve"],
    [{ id:aid(), label:"Shares a need", next:close }], 0);
  cards[close] = card(close, "close", "Close",
    "Based on what you've told me, **[Product] is a great fit.** *Can we get you started today?*[Confident]",
    ["Summarise their need", "Ask for the commitment"],
    [{ id:aid(), label:"Yes", next:null }], 0);
  return { rootCard:open, cards:cards };
}

// Every card reachable from startId (inclusive), breadth-first over answer links
export function collectBranch(cards, startId) {
  var seen = {}, out = [], queue = [startId];
  while (queue.length) {
    var id = queue.shift();
    if (!id || seen[id] || !cards[id]) continue;
    seen[id] = true; out.push(id);
    (cards[id].answers || []).forEach(function(a) { if (a.next) queue.push(a.next); });
  }
  return out;
}

// Copies the given cards with fresh ids. Returns { cards, idMap }.
// opts.clearIntended — copied cards join the target deck off the intended path
export function cloneCards(cards, ids, opts) {
  opts = opts || {};
  var idMap = {};
  ids.forEach(function(id) { if (cards[id]) idMap[id] = uid(); });
  var out = {};
  Object.keys(idMap).forEach(function(oldId) {
    var src = cards[oldId];
    var copy = Object.assign({}, src, {
      id: idMap[oldId],
      overview: (src.overview || []).slice(),
      answers: (src.answers || []).map(function(a) {
        return Object.assign({}, a, { id:aid(), next: a.next && idMap[a.next] ? idMap[a.next] : null });
      }),
    });
    if (opts.clearIntended) copy.intendedPath = false;
    out[copy.id] = copy;
  });
  return { cards:out, idMap:idMap };
}

// Copies an objection stack. deckIdMap remaps targetCard when the parent deck is copied too;
// otherwise targetCard is cleared (it pointed into another deck).
export function cloneStack(stack, deckIdMap) {
  var res = cloneCards(stack.cards || {}, Object.keys(stack.cards || {}));
  var copy = Object.assign({}, stack, {
    id: osid(),
    cards: res.cards,
    rootCard: stack.rootCard && res.idMap[stack.rootCard] ? res.idMap[stack.rootCard] : null,
    targetCard: stack.targetCard && deckIdMap && deckIdMap[stack.targetCard] ? deckIdMap[stack.targetCard] : null,
  });
  delete copy.archivedAt;
  return copy;
}

// Full independent copy of a deck's content (server assigns the new deck id)
export function duplicateDeck(deck) {
  var res = cloneCards(deck.cards || {}, Object.keys(deck.cards || {}));
  return {
    // "(copy)" is dropped when it wouldn't fit the deck-name limit
    name: (deck.name + " (copy)").length <= LIMITS.deckName ? deck.name + " (copy)" : (deck.name || "Deck").slice(0, LIMITS.deckName),
    color: deck.color, icon: deck.icon,
    visibility: deck.visibility || "public",
    accessList: (deck.accessList || []).slice(),
    rootCard: deck.rootCard && res.idMap[deck.rootCard] ? res.idMap[deck.rootCard] : null,
    cards: res.cards,
    objStacks: (deck.objStacks || []).map(function(st) {
      var c = cloneStack(st, res.idMap);
      if (st.archivedAt) c.archivedAt = st.archivedAt;
      return c;
    }),
  };
}

// ─── ARCHIVE FILTERS ──────────────────────────────────────────────────────────
export function activeDecks(decks)  { return (decks || []).filter(function(d) { return !d.archivedAt; }); }
export function liveStacks(deck)    { return ((deck && deck.objStacks) || []).filter(function(s) { return !s.archivedAt; }); }
export function archivedStacks(deck){ return ((deck && deck.objStacks) || []).filter(function(s) { return !!s.archivedAt; }); }

// Confirm for the owner-only permanent delete of an objection stack
export function confirmStackDelete(stack) {
  return window.confirm("Permanently delete the \"" + (stack.label || "Untitled") + "\" objection stack and its cards?\n\nAdmins can archive it instead, which can be undone.");
}

// ─── STACK CARD EDITS ─────────────────────────────────────────────────────────
export function upsertStackCard(stack, c) {
  var cards = Object.assign({}, stack.cards || {});
  cards[c.id] = c;
  return Object.assign({}, stack, { cards:cards, rootCard: stack.rootCard || c.id });
}

export function deleteStackCard(stack, cardId) {
  var cards = {};
  Object.keys(stack.cards || {}).forEach(function(id) {
    if (id === cardId) return;
    var c = stack.cards[id];
    var touches = (c.answers || []).some(function(a) { return a.next === cardId; });
    cards[id] = touches ? Object.assign({}, c, { answers: c.answers.map(function(a) {
      return a.next === cardId ? Object.assign({}, a, { next:null }) : a;
    }) }) : c;
  });
  var rootCard = stack.rootCard === cardId ? (Object.keys(cards)[0] || null) : stack.rootCard;
  return Object.assign({}, stack, { cards:cards, rootCard:rootCard });
}
