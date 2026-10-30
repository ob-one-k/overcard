// users."activeToken" now stores SHA-256(sid) instead of the raw session id. Hash the
// raw UUIDs already stored so signed-in users stay signed in across the deploy.
module.exports = {
  name: "003_hash_session_ids",
  up: async function(client) {
    await client.query(`UPDATE users SET "activeToken" = encode(sha256(convert_to("activeToken", 'UTF8')), 'hex')
      WHERE "activeToken" IS NOT NULL AND length("activeToken") = 36`);
  },
};
