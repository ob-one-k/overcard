// ─── SERVER CONFIG ────────────────────────────────────────────────────────────
// Environment switches read in one place. See .env.example for every variable.

// Demo accounts (server/seed.js): seeded on boot and offered on the sign-in screen while
// on. Default on so the existing demo keeps working; set DEMO_MODE=off for a production
// launch — nothing is deleted, the demo orgs just stop being re-seeded and offered.
var DEMO_MODE = String(process.env.DEMO_MODE || "on").toLowerCase() !== "off";

module.exports = { DEMO_MODE };
