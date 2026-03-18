const express = require("express");
const router  = express.Router();
const {
  getOrgUsers, createUser, updateUser, deleteUser, findUserById,
  getOrgTeams, getTeamById, createTeam, updateTeam, deleteTeam, uid,
  setUserTeams, getUserTeams,
} = require("../db");
const { requireAdmin, hashPassword } = require("../auth");

function validatePassword(pw) {
  if (!pw || pw.length < 8) return "Password must be at least 8 characters";
  if (!/[A-Z]/.test(pw)) return "Password must contain at least one uppercase letter";
  if (!/[0-9]/.test(pw)) return "Password must contain at least one digit";
  return null;
}

router.use(requireAdmin);

// ─── USERS ────────────────────────────────────────────────────────────────────

// GET /api/admin/users
router.get("/users", function(req, res) {
  res.json(getOrgUsers(req.user.orgId));
});

// POST /api/admin/users
router.post("/users", function(req, res) {
  const { email, displayName, role, teamId, teamIds, password } = req.body || {};
  if (!email || !displayName || !password) {
    return res.status(400).json({ error: "email, displayName, and password are required" });
  }
  if (!["admin","user"].includes(role)) {
    return res.status(400).json({ error: "role must be 'admin' or 'user'" });
  }
  var pwErr = validatePassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: "Invalid email format" });
  }
  if (displayName.length > 100) {
    return res.status(400).json({ error: "Display name must be 100 characters or less" });
  }
  try {
    const user = createUser({
      orgId:        req.user.orgId,
      teamId:       teamId || null,
      email:        email.toLowerCase().trim(),
      passwordHash: hashPassword(password),
      displayName:  displayName.trim(),
      role:         role,
    });
    if (teamIds !== undefined) {
      setUserTeams(user.id, teamIds);
    }
    const { passwordHash: _, ...safe } = user;
    res.status(201).json(safe);
  } catch (err) {
    if (err.message && err.message.includes("UNIQUE")) {
      return res.status(409).json({ error: "Email already in use" });
    }
    throw err;
  }
});

// PUT /api/admin/users/:id
router.put("/users/:id", function(req, res) {
  const target = findUserById(req.params.id);
  if (!target || target.orgId !== req.user.orgId) {
    return res.status(404).json({ error: "User not found" });
  }
  const { displayName, role, teamId, teamIds } = req.body || {};
  const fields = {};
  if (displayName !== undefined) fields.displayName = displayName.trim();
  if (role !== undefined) {
    if (!["admin","user"].includes(role)) return res.status(400).json({ error: "Invalid role" });
    fields.role = role;
  }
  if (teamId !== undefined) fields.teamId = teamId || null;
  const updated = updateUser(req.params.id, req.user.orgId, fields);
  if (teamIds !== undefined) {
    setUserTeams(req.params.id, teamIds);
  }
  const { passwordHash: _, ...safe } = updated;
  res.json(safe);
});

// POST /api/admin/users/:id/reset-password
router.post("/users/:id/reset-password", function(req, res) {
  const target = findUserById(req.params.id);
  if (!target || target.orgId !== req.user.orgId) {
    return res.status(404).json({ error: "User not found" });
  }
  const { password } = req.body || {};
  var pwErr = validatePassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });
  updateUser(req.params.id, req.user.orgId, { passwordHash: hashPassword(password) });
  res.json({ ok: true });
});

// DELETE /api/admin/users/:id
router.delete("/users/:id", function(req, res) {
  const target = findUserById(req.params.id);
  if (!target || target.orgId !== req.user.orgId) {
    return res.status(404).json({ error: "User not found" });
  }
  if (target.id === req.user.id) {
    return res.status(400).json({ error: "Cannot delete your own account" });
  }
  deleteUser(req.params.id, req.user.orgId);
  res.json({ ok: true });
});

// ─── TEAMS ────────────────────────────────────────────────────────────────────

// GET /api/admin/teams
router.get("/teams", function(req, res) {
  res.json(getOrgTeams(req.user.orgId));
});

// POST /api/admin/teams
router.post("/teams", function(req, res) {
  const { name, adminIds, memberIds } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Team name is required" });
  }
  if (!adminIds || !adminIds.length) {
    return res.status(400).json({ error: "At least one admin must be assigned to a team" });
  }
  const team = createTeam({ orgId: req.user.orgId, name: name.trim(), adminIds });
  if (memberIds !== undefined) {
    const newMemberIds = memberIds || [];
    newMemberIds.forEach(function(uid) {
      const current = getUserTeams(uid);
      if (!current.includes(team.id)) setUserTeams(uid, current.concat([team.id]));
    });
  }
  res.status(201).json(getTeamById(team.id));
});

// PUT /api/admin/teams/:id
router.put("/teams/:id", function(req, res) {
  const team = getTeamById(req.params.id);
  if (!team || team.orgId !== req.user.orgId) {
    return res.status(404).json({ error: "Team not found" });
  }
  const { name, adminIds, memberIds } = req.body || {};
  if (adminIds !== undefined && (!adminIds || !adminIds.length)) {
    return res.status(400).json({ error: "At least one admin must be assigned to a team" });
  }
  const updated = updateTeam(req.params.id, req.user.orgId, { name, adminIds });
  if (memberIds !== undefined) {
    const newMemberIds = memberIds || [];
    const oldMembers = updated.memberIds || [];
    const toAdd    = newMemberIds.filter(function(id) { return !oldMembers.includes(id); });
    const toRemove = oldMembers.filter(function(id) { return !newMemberIds.includes(id); });
    toAdd.forEach(function(uid) {
      const current = getUserTeams(uid);
      if (!current.includes(req.params.id)) setUserTeams(uid, current.concat([req.params.id]));
    });
    toRemove.forEach(function(uid) {
      const current = getUserTeams(uid);
      setUserTeams(uid, current.filter(function(t) { return t !== req.params.id; }));
    });
  }
  res.json(getTeamById(req.params.id));
});

// DELETE /api/admin/teams/:id
router.delete("/teams/:id", function(req, res) {
  const team = getTeamById(req.params.id);
  if (!team || team.orgId !== req.user.orgId) {
    return res.status(404).json({ error: "Team not found" });
  }
  deleteTeam(req.params.id, req.user.orgId);
  res.json({ ok: true });
});

module.exports = router;
