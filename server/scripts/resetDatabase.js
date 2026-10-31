// Empty the database for a clean production start — every org, user, deck, session, recording
// and demo record is deleted. The schema and the applied-migrations record are kept, so the
// next boot needs no migrations. Run from Render → Shell with DEMO_MODE=off already set:
//   npm run db-reset -- --confirm=<database name>
// The database name must be typed out, so this can't be run against the wrong database by habit.
// Take a backup first (docs/PRODUCTION.md §4) — there is no undo.
const { pool } = require("../db");
const { DEMO_MODE } = require("../config");

(async function() {
  var arg = process.argv.slice(2).find(function(a) { return a.indexOf("--confirm=") === 0; });
  var confirm = arg ? arg.slice("--confirm=".length) : "";
  try {
    const dbName = (await pool.query("SELECT current_database() AS name")).rows[0].name;
    const { rows: tables } = await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> 'migrations' ORDER BY tablename"
    );
    const counts = await pool.query(
      "SELECT (SELECT count(*) FROM orgs)::int AS orgs, (SELECT count(*) FROM users)::int AS users, (SELECT count(*) FROM sessions)::int AS sessions"
    );
    var c = counts.rows[0];
    console.log("Database: " + dbName + " — " + c.orgs + " orgs, " + c.users + " users, " + c.sessions + " sessions");

    if (DEMO_MODE) {
      console.error("DEMO_MODE is on, so the next boot would re-seed the demo orgs. Set DEMO_MODE=off, redeploy, then run this again.");
      process.exitCode = 1;
      return;
    }
    if (confirm !== dbName) {
      console.error("Nothing deleted. To delete ALL data in this database, run:\n  npm run db-reset -- --confirm=" + dbName);
      process.exitCode = 1;
      return;
    }

    var list = tables.map(function(t) { return '"' + t.tablename + '"'; }).join(", ");
    await pool.query("TRUNCATE " + list + " RESTART IDENTITY CASCADE");
    console.log("Emptied " + tables.length + " tables. Restart the web service so no signed-in device keeps a stale connection.");
  } catch (err) {
    console.error("Failed:", err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
