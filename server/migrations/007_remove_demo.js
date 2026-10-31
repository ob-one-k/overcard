// Demo mode is gone. Accounts the old demo seed created shared a password that is published
// in the repository's history, so they are locked (unguessable password, signed out) before
// the seed's bookkeeping table is dropped. Their data stays; `npm run db-reset` removes it.
const crypto = require("crypto");
const bcrypt = require("bcrypt");   // not ../auth: it requires db.js, which loads this file

module.exports = {
  name: "007_remove_demo",
  up: async function(client) {
    const { rows } = await client.query("SELECT to_regclass('seed_manifest') AS t");
    if (rows[0].t) {
      const hash = await bcrypt.hash(crypto.randomBytes(32).toString("base64url"), 12);
      const r = await client.query(
        'UPDATE users SET "passwordHash"=$1, "activeToken"=NULL WHERE id IN (SELECT record_id FROM seed_manifest WHERE table_name = \'users\')',
        [hash]
      );
      if (r.rowCount) console.log("Locked " + r.rowCount + " former demo account(s)");
    }
    await client.query("DROP TABLE IF EXISTS seed_manifest");
  },
};
