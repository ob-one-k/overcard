// ─── MIGRATIONS ───────────────────────────────────────────────────────────────
// Numbered, run-once schema changes. initSchema() creates the baseline (idempotent
// CREATE/ALTER IF NOT EXISTS, safe on the existing database) and then calls
// runMigrations(), which applies every file listed below that isn't yet recorded in
// the `migrations` table — each in its own transaction, under an advisory lock so two
// instances booting together can't race.
//
// Adding a change: create NNN_name.js exporting { name, up(client) } and append it here.
// Never edit or reorder a migration that has shipped.

var MIGRATIONS = [
  require("./002_live_sessions"),
  require("./003_hash_session_ids"),
  require("./004_password_resets"),
  require("./005_invite_details"),
  require("./006_integrity"),
  require("./007_remove_demo"),
  require("./008_session_highlights"),
  require("./009_deck_order"),
  require("./010_deck_editors"),
];

var LOCK_KEY = 72017301; // arbitrary constant shared by every instance

async function runMigrations(pool) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    const { rows } = await client.query("SELECT name FROM migrations");
    var done = new Set(rows.map(function(r) { return r.name; }));
    for (var i = 0; i < MIGRATIONS.length; i++) {
      var m = MIGRATIONS[i];
      if (done.has(m.name)) continue;
      try {
        await client.query("BEGIN");
        await m.up(client);
        await client.query("INSERT INTO migrations (name, applied_at) VALUES ($1, $2)", [m.name, Date.now()]);
        await client.query("COMMIT");
        console.log("Migration applied: " + m.name);
      } catch (err) {
        await client.query("ROLLBACK");
        err.message = "Migration " + m.name + " failed: " + err.message;
        throw err;
      }
    }
  } finally {
    try { await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]); } catch (_) {}
    client.release();
  }
}

module.exports = { runMigrations, MIGRATIONS };
