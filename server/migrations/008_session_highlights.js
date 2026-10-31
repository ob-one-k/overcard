// Highlighted sessions: an admin marks a finished session as an example for the whole
// org or for one team. One highlight per session; it goes when the session or the team
// does. Visibility rules live in db.js (highlightVisibleSql).
module.exports = {
  name: "008_session_highlights",
  up: async function(client) {
    await client.query(`CREATE TABLE IF NOT EXISTS session_highlights (
      "sessionId" TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      "orgId"     TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      scope       TEXT NOT NULL CHECK (scope IN ('org','team')),
      "teamId"    TEXT REFERENCES teams(id) ON DELETE CASCADE,
      note        TEXT,
      "createdBy" TEXT REFERENCES users(id) ON DELETE SET NULL,
      "createdAt" BIGINT NOT NULL,
      CHECK ((scope = 'team') = ("teamId" IS NOT NULL))
    )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_highlights_org ON session_highlights("orgId","createdAt" DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_highlights_team ON session_highlights("teamId")`);
  },
};
