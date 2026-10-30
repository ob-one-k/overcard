// ─── CARD GRAPH HELPERS ───────────────────────────────────────────────────────
// Pure helpers over a deck's (or objection stack's) `cards` map. A card's
// "parents" are the cards that have an answer whose `next` points at it; its
// "children" are the distinct destinations of its own answers.

// Cards that link to `id`, with the answer labels that lead here.
// → [{ card, answerLabels:[string] }]   (self-links excluded, map order kept)
export function getParents(cards, id) {
  var out = [];
  if (!id) return out;
  Object.values(cards || {}).forEach(function(c) {
    if (!c || c.id === id) return;
    var labels = [];
    var links = false;
    (c.answers || []).forEach(function(a) {
      if (a && a.next === id) { links = true; if (a.label && a.label.trim()) labels.push(a.label.trim()); }
    });
    if (links) out.push({ card:c, answerLabels:labels });
  });
  return out;
}

// Order parents for display: the card you navigated from (if it is a parent)
// first, then an intended-path parent, then alphabetical by title.
export function orderParents(parents, fromId) {
  function title(p) { return (p.card.title || "").toLowerCase(); }
  return parents.slice().sort(function(a, b) {
    var af = a.card.id === fromId ? 0 : 1, bf = b.card.id === fromId ? 0 : 1;
    if (af !== bf) return af - bf;
    var ai = a.card.intendedPath ? 0 : 1, bi = b.card.intendedPath ? 0 : 1;
    if (ai !== bi) return ai - bi;
    var at = title(a), bt = title(b);
    return at < bt ? -1 : at > bt ? 1 : 0;
  });
}

// Distinct destinations of a list of answers. Answers that point to the same
// card are merged (labels combined). Answers without a valid destination are
// returned separately as dead ends.
// → { linked:[{ card, labels:[string] }], ends:[{ label, missing:boolean, self:boolean }] }
export function getChildren(cards, answers, selfId) {
  var linked = [], byId = {}, ends = [];
  (answers || []).forEach(function(a) {
    if (!a) return;
    var label = (a.label || "").trim();
    var dest = a.next && cards ? cards[a.next] : null;
    if (!dest || a.next === selfId) {
      if (label || a.next) ends.push({ label:label, missing:!!a.next && a.next !== selfId, self:!!a.next && a.next === selfId });
      return;
    }
    if (!byId[dest.id]) { byId[dest.id] = { card:dest, labels:[] }; linked.push(byId[dest.id]); }
    if (label && byId[dest.id].labels.indexOf(label) < 0) byId[dest.id].labels.push(label);
  });
  return { linked:linked, ends:ends };
}
