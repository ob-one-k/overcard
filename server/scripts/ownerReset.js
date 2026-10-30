// Owner account recovery — nobody in the app can reset the owner's password, so a locked-out
// owner gets a one-time reset link from the server instead (Render → Shell):
//   npm run owner-reset -- owner@company.com
// Prints a link valid for 1 hour. APP_URL sets its origin (e.g. https://app.overcard.com).
const { pool, findUserByEmail, createPasswordReset } = require("../db");

(async function() {
  var email = String(process.argv[2] || "").trim().toLowerCase();
  if (!email) { console.error("Usage: npm run owner-reset -- <owner email>"); process.exit(1); }
  try {
    const user = await findUserByEmail(email);
    if (!user || user.role !== "owner") {
      console.error("No organization owner has that email. (Admins and users can be reset by their owner/admins in the app.)");
      process.exit(1);
    }
    const r = await createPasswordReset(user.id, null);
    var base = (process.env.APP_URL || "").replace(/\/+$/, "") || "<your app URL>";
    console.log("Reset link for " + user.displayName + " (valid until " + new Date(r.expiresAt).toISOString() + "):");
    console.log(base + "/?reset=" + r.token);
  } catch (err) {
    console.error("Failed:", err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
