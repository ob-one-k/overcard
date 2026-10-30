// Referential integrity for deletes, and case-insensitive unique emails.
// Before this, deleting a user who had sessions/feedback/shares/decks (or a team that was
// someone's primary team) failed with a database error. Now:
//   user deleted → their sessions stay for the team's history (owner cleared — shown as a
//                  former member), feedback they wrote keeps its author name, shares to or
//                  from them disappear, decks they created stay
//   team deleted → it is cleared from its members' primary team
async function refk(client, table, column, ref, action) {
  // Default-named constraints (<table>_<column>_fkey) from CREATE TABLE
  await client.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS "${table}_${column}_fkey"`);
  await client.query(`ALTER TABLE ${table} ADD CONSTRAINT "${table}_${column}_fkey" FOREIGN KEY ("${column}") REFERENCES ${ref}(id) ON DELETE ${action}`);
}

module.exports = {
  name: "006_integrity",
  up: async function(client) {
    await client.query(`ALTER TABLE sessions ALTER COLUMN "userId" DROP NOT NULL`);
    await refk(client, "sessions", "userId", "users", "SET NULL");
    await client.query(`ALTER TABLE session_feedback ALTER COLUMN "authorId" DROP NOT NULL`);
    await refk(client, "session_feedback", "authorId", "users", "SET NULL");
    await refk(client, "session_shares", "fromUserId", "users", "CASCADE");
    await refk(client, "session_shares", "toUserId", "users", "CASCADE");
    await client.query(`ALTER TABLE decks ALTER COLUMN "createdBy" DROP NOT NULL`);
    await refk(client, "decks", "createdBy", "users", "SET NULL");
    await refk(client, "users", "teamId", "teams", "SET NULL");
    // team_admins had no user FK: clear orphans, then enforce it
    await client.query(`DELETE FROM team_admins WHERE "userId" NOT IN (SELECT id FROM users)`);
    await refk(client, "team_admins", "userId", "users", "CASCADE");
    // deck_access is polymorphic (no FK): drop rows for people/teams that no longer exist
    await client.query(`DELETE FROM deck_access WHERE ("entityType" = 'user' AND "entityId" NOT IN (SELECT id FROM users))
      OR ("entityType" = 'team' AND "entityId" NOT IN (SELECT id FROM teams))`);

    // One account per email regardless of case (login lower-cases input)
    const dup = await client.query(`SELECT LOWER(email) AS e, COUNT(*) AS n FROM users GROUP BY LOWER(email) HAVING COUNT(*) > 1`);
    if (dup.rows.length) {
      throw new Error("Emails differing only by case must be merged first: " + dup.rows.map(function(r) { return r.e; }).join(", "));
    }
    await client.query(`UPDATE users SET email = LOWER(email) WHERE email <> LOWER(email)`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_email_lower ON users (LOWER(email))`);
  },
};
