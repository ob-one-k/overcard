const jwt     = require("jsonwebtoken");
const bcrypt  = require("bcrypt");
const { findUserById } = require("./db");

const JWT_SECRET  = process.env.JWT_SECRET  || "redcard-dev-secret-change-in-prod";
const JWT_EXPIRES = process.env.JWT_EXPIRES || "24h";
const COOKIE_NAME = "rc_token";
const BCRYPT_ROUNDS = 12;

function jwtSign(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function jwtVerify(token) {
  return jwt.verify(token, JWT_SECRET);
}

function hashPassword(plain) {
  return bcrypt.hashSync(plain, BCRYPT_ROUNDS);
}

function checkPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

function setCookie(res, token) {
  const isProd = process.env.NODE_ENV === "production";
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    secure:   isProd,
    maxAge:   24 * 60 * 60 * 1000,  // 24 hours in ms
  });
}

function clearCookie(res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: "strict" });
}

function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: "Not authenticated" });
  try {
    const payload = jwtVerify(token);
    const user    = findUserById(payload.sub);
    if (!user) return res.status(401).json({ error: "User not found" });
    req.user = {
      id:     user.id,
      orgId:  user.orgId,
      teamId: user.teamId,
      role:   user.role,
      email:  user.email,
      displayName: user.displayName,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, function() {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }
    next();
  });
}

module.exports = {
  jwtSign, jwtVerify, hashPassword, checkPassword,
  setCookie, clearCookie, requireAuth, requireAdmin, COOKIE_NAME,
};
