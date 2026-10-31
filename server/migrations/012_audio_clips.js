// Saved clips: a titled piece of a session recording, cut into its own audio on the server,
// with a snapshot of the session's details (meta). A clip outlives its session ("sessionId"
// goes NULL) and goes with the person who saved it. Clips can be shared with teammates;
// a share notifies the recipient (notifications."clipId").
module.exports = {
  name: "012_audio_clips",
  up: async function(client) {
    await client.query(`CREATE TABLE IF NOT EXISTS audio_clips (
      id           TEXT PRIMARY KEY,
      "orgId"      TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      "userId"     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "sessionId"  TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      title        TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 50),
      kind         TEXT NOT NULL CHECK (kind IN ('segment','range')),
      "segId"      TEXT,
      "cardId"     TEXT,
      "startMs"    INTEGER NOT NULL CHECK ("startMs" >= 0),
      "endMs"      INTEGER NOT NULL,
      "durationMs" INTEGER NOT NULL,
      meta         JSONB NOT NULL DEFAULT '{}',
      "mimeType"   TEXT NOT NULL,
      "sizeBytes"  INTEGER NOT NULL,
      data         BYTEA NOT NULL,
      "createdAt"  BIGINT NOT NULL,
      CHECK ("endMs" > "startMs")
    )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_clips_user ON audio_clips("userId","createdAt" DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_clips_session ON audio_clips("sessionId")`);
    await client.query(`CREATE TABLE IF NOT EXISTS clip_shares (
      id           TEXT PRIMARY KEY,
      "clipId"     TEXT NOT NULL REFERENCES audio_clips(id) ON DELETE CASCADE,
      "orgId"      TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      "fromUserId" TEXT REFERENCES users(id) ON DELETE SET NULL,
      "toUserId"   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      note         TEXT CHECK (note IS NULL OR char_length(note) <= 1000),
      "createdAt"  BIGINT NOT NULL,
      UNIQUE ("clipId","toUserId")
    )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_clip_shares_to ON clip_shares("toUserId","createdAt" DESC)`);
    await client.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS "clipId" TEXT REFERENCES audio_clips(id) ON DELETE CASCADE`);
  },
};
