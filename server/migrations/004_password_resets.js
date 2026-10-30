// One-time password reset links. Only a SHA-256 of the token is stored; a link is valid
// for one use, for a short time, and issuing a new one cancels the previous.
module.exports = {
  name: "004_password_resets",
  up: async function(client) {
    await client.query(`CREATE TABLE IF NOT EXISTS password_resets (
      id          TEXT PRIMARY KEY,
      "userId"    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "tokenHash" TEXT NOT NULL UNIQUE,
      "createdBy" TEXT REFERENCES users(id) ON DELETE SET NULL,
      "createdAt" BIGINT NOT NULL,
      "expiresAt" BIGINT NOT NULL,
      "usedAt"    BIGINT
    )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets("userId")`);
  },
};
