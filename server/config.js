// ─── SERVER CONFIG ────────────────────────────────────────────────────────────
// Environment switches read in one place. See .env.example for every variable.

// Demo accounts (server/seed.js): seeded on boot and offered on the sign-in screen while
// on. Default on so the existing demo keeps working; set DEMO_MODE=off for a production
// launch — nothing is deleted, the demo orgs just stop being re-seeded and offered.
// A production server never enables it by accident: there it must be set explicitly
// (render.yaml does, while the demo deployment is live).
var DEMO_MODE = process.env.DEMO_MODE
  ? String(process.env.DEMO_MODE).toLowerCase() !== "off"
  : process.env.NODE_ENV !== "production";

module.exports = { DEMO_MODE };
