// Admins the owner or a deck's creator allowed to edit that deck. The owner edits every
// deck and the creator their own; everyone else edits only decks listed here for them.
module.exports = {
  name: "010_deck_editors",
  up: async function(client) {
    await client.query(`CREATE TABLE IF NOT EXISTS deck_editors (
      "deckId" TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY ("deckId", "userId")
    )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_deck_editors_user ON deck_editors("userId")`);
  },
};
