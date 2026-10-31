// Objection stacks get deck-style permissions (db.js "OBJECTION STACK PERMISSIONS"). Existing
// stacks are credited to their deck's creator, stay org-wide, and take the deck's current
// editors as their editors — so everyone who could edit a stack before can still edit it.
module.exports = {
  name: "011_stack_perms",
  up: async function(client) {
    const { rows } = await client.query('SELECT id, "createdBy", "objStacks" FROM decks');
    const ed = await client.query('SELECT "deckId", "userId" FROM deck_editors');
    var editors = {};
    ed.rows.forEach(function(r) { (editors[r.deckId] = editors[r.deckId] || []).push(r.userId); });
    for (const d of rows) {
      var stacks = Array.isArray(d.objStacks) ? d.objStacks : [];
      if (!stacks.length) continue;
      var changed = false;
      var next = stacks.map(function(st) {
        if (!st || typeof st !== "object" || st.visibility) return st;
        changed = true;
        var createdBy = st.createdBy || d.createdBy || null;
        return Object.assign({}, st, {
          createdBy: createdBy,
          visibility: "public",
          accessList: [],
          editorIds: (editors[d.id] || []).filter(function(id) { return id !== createdBy; }),
        });
      });
      if (changed) await client.query('UPDATE decks SET "objStacks" = $1 WHERE id = $2', [JSON.stringify(next), d.id]);
    }
  },
};
