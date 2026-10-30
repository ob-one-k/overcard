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
// The token's signature is verified (one HMAC) before its account is used as the bucket, so
// forged tokens can neither dodge the limit nor fill someone else's bucket.
function accountKey(req) {
  const { jwtVerify } = require("./auth");
  var token = (req.cookies && req.cookies.rc_token) || null;
  var h = req.headers.authorization || "";
  if (!token && h.indexOf("Bearer ") === 0) token = h.slice(7);
  if (token) {
    try { var p = jwtVerify(token); if (p && typeof p.sub === "string") return "u:" + p.sub; } catch (_) {}
  }
  return "ip:" + ipKeyGenerator(req.ip || "");
}
function apiLimiter() {
  return limiter(60 * 1000, 600, "Too many requests — slow down and try again in a minute", accountKey);
}
// Live stream (re)connections: a client reconnects with backoff, so 30 a minute is plenty
function streamLimiter() {
  return limiter(60 * 1000, 30, "Too many connections", accountKey);
}

module.exports = { limiter, apiLimiter, streamLimiter };
