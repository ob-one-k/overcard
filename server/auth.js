const jwt    = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { findUserById } = require("./db");

if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required in production");
}
const JWT_SECRET  = process.env.JWT_SECRET  || "overcard-dev-secret-change-in-prod";
const JWT_EXPIRES = process.env.JWT_EXPIRES || "24h";
const COOKIE_NAME = "rc_token";
const BCRYPT_ROUNDS = 12;

function jwtSign(payload) {
  return jwt.sign(payload, JWT_SECRET, { algorithm: "HS256", expiresIn: JWT_EXPIRES });
}

function jwtVerify(token) {
  return jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
}

// Async bcrypt runs on libuv's thread pool so logins don't block the event loop
function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

// Precomputed cost-12 hash of a random string — compared against when the email is
// unknown so response timing doesn't reveal which accounts exist (no sync hashing at boot)
const DUMMY_HASH = "$2b$12$TvFgtTANQOidxk7rxBmapORERu7NYvZsk8EE42Qcg8a.a4NQw/OBO";

function checkPassword(plain, hash) {
  return bcrypt.compare(plain, hash || DUMMY_HASH);
}

function setCookie(res, token) {
  const isProd    = process.env.NODE_ENV === "production";
  const crossSite = isProd && !!process.env.CORS_ORIGIN;
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: crossSite ? "none" : "strict",
    secure:   isProd,
    maxAge:   24 * 60 * 60 * 1000,  // 24 hours in ms
  });
}

function clearCookie(res) {
  const isProd    = process.env.NODE_ENV === "production";
  const crossSite = isProd && !!process.env.CORS_ORIGIN;
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: crossSite ? "none" : "strict",
    secure:   isProd,
  });
}

// requireAuth is async because findUserById is now an async DB call
async function requireAuth(req, res, next) {
  // Accept token from cookie first, then Authorization: Bearer header (for mobile/Safari ITP)
  var token = (req.cookies && req.cookies[COOKIE_NAME]) || null;
  var authHeader = req.headers["authorization"] || "";
  if (!token && authHeader.startsWith("Bearer ")) token = authHeader.slice(7);
  if (!token) return res.status(401).json({ error: "Not authenticated" });
  try {
    const payload = jwtVerify(token);           // still synchronous
    const user    = await findUserById(payload.sub);
    if (!user) return res.status(401).json({ error: "User not found" });
    // Single-session check: the JWT's sid must match the user's active session.
    // A null activeToken (after logout or password reset) revokes every outstanding token.
    if (!payload.sid || !user.activeToken) {
      return res.status(401).json({ error: "Session ended" });
    }
    if (user.activeToken !== payload.sid) {
      return res.status(401).json({ error: "session_replaced", message: "Signed in on another device." });
    }
    req.user = {
      id:          user.id,
      orgId:       user.orgId,
      teamId:      user.teamId,
      role:        user.role,
      email:       user.email,
      displayName: user.displayName,
    };
    next();
  } catch (err) {
    if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    next(err);
  }
}

// The owner is an admin with extra powers (org settings, demoting admins, ownership transfer)
function isAdminRole(role) {
  return role === "admin" || role === "owner";
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, function(err) {
    if (err) return next(err);
    if (!isAdminRole(req.user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    next();
  });
}

function requireOwner(req, res, next) {
  requireAuth(req, res, function(err) {
    if (err) return next(err);
    if (req.user.role !== "owner") {
      return res.status(403).json({ error: "Only the organization owner can do this" });
    }
    next();
  });
}

module.exports = {
  jwtSign, jwtVerify, hashPassword, checkPassword,
  setCookie, clearCookie, requireAuth, requireAdmin, requireOwner, isAdminRole, COOKIE_NAME,
};
