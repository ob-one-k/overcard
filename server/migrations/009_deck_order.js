// Decks get an owner-defined order. Existing decks keep today's (alphabetical) order;
// new decks are appended at the end (createDeck).
module.exports = {
  name: "009_deck_order",
  up: async function(client) {
    await client.query(`ALTER TABLE decks ADD COLUMN IF NOT EXISTS "sortIndex" INTEGER`);
    await client.query(`UPDATE decks d SET "sortIndex" = r.rn FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY "orgId" ORDER BY name, id) - 1 AS rn FROM decks
    ) r WHERE d.id = r.id`);
  },
};
