// Share codes carry a label and an optional team (people who join with the code are
// added to it), and every account records which code it joined with.
module.exports = {
  name: "005_invite_details",
  up: async function(client) {
    await client.query(`ALTER TABLE org_invites ADD COLUMN IF NOT EXISTS label TEXT`);
    await client.query(`ALTER TABLE org_invites ADD COLUMN IF NOT EXISTS "teamId" TEXT REFERENCES teams(id) ON DELETE SET NULL`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "inviteId" TEXT REFERENCES org_invites(id) ON DELETE SET NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_inviteId ON users("inviteId")`);
  },
};
