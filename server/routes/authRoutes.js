const express = require("express");
const router  = express.Router();
const { findUserByEmail, updateLastLogin, findUserById, getTeamById } = require("../db");
const { jwtSign, checkPassword, setCookie, clearCookie, requireAuth } = require("../auth");

// POST /api/auth/login
router.post("/login", function(req, res) {
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

  const team = user.teamId ? getTeamById(user.teamId) : null;
  res.json({
    id:          user.id,
    email:       user.email,
    displayName: user.displayName,
    role:        user.role,
    orgId:       user.orgId,
    teamId:      user.teamId,
    teamName:    team ? team.name : null,
  });
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
  const team = user.teamId ? getTeamById(user.teamId) : null;
  res.json({
    id:          user.id,
    email:       user.email,
    displayName: user.displayName,
    role:        user.role,
    orgId:       user.orgId,
    teamId:      user.teamId,
    teamName:    team ? team.name : null,
  });
});

module.exports = router;
