// Objection stacks get deck-style permissions (db.js "OBJECTION STACK PERMISSIONS"). Existing
// stacks are credited to their deck's creator and stay org-wide with no extra editors, so
// nobody loses access: the owner and the deck's creator keep editing them.
module.exports = {
  name: "011_stack_perms",
  up: async function(client) {
    const { rows } = await client.query('SELECT id, "createdBy", "objStacks" FROM decks');
    for (const d of rows) {
      var stacks = Array.isArray(d.objStacks) ? d.objStacks : [];
      if (!stacks.length) continue;
      var changed = false;
      var next = stacks.map(function(st) {
        if (!st || typeof st !== "object" || st.visibility) return st;
        changed = true;
        return Object.assign({}, st, {
          createdBy: st.createdBy || d.createdBy || null,
          visibility: "public",
          accessList: [],
          editorIds: [],
        });
      });
      if (changed) await client.query('UPDATE decks SET "objStacks" = $1 WHERE id = $2', [JSON.stringify(next), d.id]);
    }
  },
};
