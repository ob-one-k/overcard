// Sessions are stored from the moment they start (status 'active') so admins can watch
// them live; a heartbeat keeps "lastBeatTs" fresh and "live" holds the rep's current card.
module.exports = {
  name: "002_live_sessions",
  up: async function(client) {
    await client.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS "lastBeatTs" BIGINT`);
    await client.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS live JSONB`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions("orgId") WHERE status = 'active'`);
  },
};
