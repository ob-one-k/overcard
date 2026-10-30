const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

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

// Whole-API ceiling per signed-in account (falls back to the client IP), so one runaway
// client can't starve the server — and 100 reps behind one office IP don't share a limit.
// The token is only decoded to pick a bucket; requireAuth still verifies it on every route.
function apiLimiter() {
  const jwt = require("jsonwebtoken");
  return limiter(60 * 1000, 600, "Too many requests — slow down and try again in a minute", function(req) {
    var token = (req.cookies && req.cookies.rc_token) || null;
    var h = req.headers.authorization || "";
    if (!token && h.indexOf("Bearer ") === 0) token = h.slice(7);
    var p = token ? jwt.decode(token) : null;
    return p && typeof p.sub === "string" ? "u:" + p.sub : "ip:" + ipKeyGenerator(req.ip || "");
  });
}

module.exports = { limiter, apiLimiter };
