const rateLimit = require("express-rate-limit");

// ─── RATE LIMITS ──────────────────────────────────────────────────────────────
// One factory so every limiter behaves the same. RATE_LIMITS=off disables them for the
// automated test suite and load test — never in production, where it is ignored.
var disabled = process.env.RATE_LIMITS === "off" && process.env.NODE_ENV !== "production";

function limiter(windowMs, max, message, keyGenerator) {
  var opts = {
    windowMs: windowMs,
    max: max,
    message: { error: message || "Too many attempts, please try again later" },
    standardHeaders: true,
    legacyHeaders: false,
    skip: function() { return disabled; },
  };
  if (keyGenerator) opts.keyGenerator = keyGenerator;
  return rateLimit(opts);
}

module.exports = { limiter };
