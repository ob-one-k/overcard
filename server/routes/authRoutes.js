const express = require("express");
const rateLimit = require("express-rate-limit");
const router  = express.Router();
const { findUserByEmail, updateLastLogin, findUserById, getTeamById, getUserTeams } = require("../db");
const { jwtSign, checkPassword, setCookie, clearCookie, requireAuth } = require("../auth");

var loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Too many login attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

function buildUserResponse(user) {
  const team = user.teamId ? getTeamById(user.teamId) : null;
  const teamIds = getUserTeams(user.id);
  const teams = teamIds.map(function(tid) {
    var t = getTeamById(tid);
    return t ? { id: t.id, name: t.name } : null;
  }).filter(Boolean);
  return {
    id:          user.id,
    email:       user.email,
    displayName: user.displayName,
    role:        user.role,
    orgId:       user.orgId,
    teamId:      user.teamId,
    teamName:    team ? team.name : null,
    teams:       teams,
  };
}

// POST /api/auth/login
router.post("/login", loginLimiter, function(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const user = findUserByEmail(email.toLowerCase().trim());
  if (!user) return res.status(401).json({ error: "Invalid email or password" });

  if (!checkPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  updateLastLogin(user.id);

  const token = jwtSign({ sub: user.id, role: user.role, orgId: user.orgId });
  setCookie(res, token);

  res.json(buildUserResponse(user));
});

// POST /api/auth/logout
router.post("/logout", function(req, res) {
  clearCookie(res);
  res.json({ ok: true });
});

// POST /api/auth/refresh — extend session while still valid
router.post("/refresh", requireAuth, function(req, res) {
  const token = jwtSign({ sub: req.user.id, role: req.user.role, orgId: req.user.orgId });
  setCookie(res, token);
  res.json({ ok: true });
});

// GET /api/auth/me
router.get("/me", requireAuth, function(req, res) {
  const user = findUserById(req.user.id);
  if (!user) return res.status(401).json({ error: "User not found" });
  res.json(buildUserResponse(user));
});

module.exports = router;
