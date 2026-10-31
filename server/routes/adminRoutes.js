const express = require("express");
const router  = express.Router();
const {
  getOrgUsers, createUser, updateUser, deleteUser, findUserById,
  getOrgTeams, getTeamById, createTeam, updateTeam, deleteTeam, uid,
  setUserTeams, getUserTeams, setActiveToken,
  transferOwnership, removeTeamAdminEverywhere, removeDeckEditorEverywhere, allInOrg,
  createInvite, getOrgInvites, getInvite, updateInvite, getInviteMembers, revokeInvite, createPasswordReset, expirePasswordResets,
} = require("../db");
const { requireAdmin, hashPassword } = require("../auth");
const realtime = require("../realtime");
const { validatePassword, validateName, validatePhone, validateNewUser, cleanNewUser } = require("../validate");

router.use(requireAdmin);

// Any change to people or teams can change who may watch whose live runs
router.use(function(req, res, next) {
  if (req.method !== "GET") res.on("finish", function() { if (res.statusCode < 400) realtime.resetLiveAudience(); });
  next();
});

// Role hierarchy: owner > admin > user. Admins manage users; only the owner manages admins.
// Everyone may edit their own profile, but nobody changes their own role.
function canManage(actor, target) {
  if (actor.id === target.id) return true;
  if (actor.role === "owner") return true;
  return target.role === "user";
}

// Every user/team id in a request body must belong to the caller's org
async function checkOrgIds(orgId, userIds, teamIds) {
  return (await allInOrg("users", userIds, orgId)) && (await allInOrg("teams", teamIds, orgId));
}
function asArray(v) { return Array.isArray(v) ? v : (v ? [v] : []); }

function stripSecrets(user) {
  const { passwordHash: _p, activeToken: _t, ...safe } = user;
  return safe;
}

// ─── USERS ────────────────────────────────────────────────────────────────────

// GET /api/admin/users
router.get("/users", async function(req, res, next) {
  try {
    res.json(await getOrgUsers(req.user.orgId));
  } catch (err) { next(err); }
});

// POST /api/admin/users  { firstName, lastName, email, phone, password, role, teamId, teamIds }
router.post("/users", async function(req, res, next) {
  const body = req.body || {};
  const { role, teamId, teamIds } = body;
  // The owner role is only ever assigned at org creation or by ownership transfer
  if (!["admin", "user"].includes(role)) {
    return res.status(400).json({ error: "role must be 'admin' or 'user'" });
  }
  const vErr = validateNewUser(body);
  if (vErr) return res.status(400).json({ error: vErr });
  if (teamIds !== undefined && !Array.isArray(teamIds)) return res.status(400).json({ error: "teamIds must be an array" });
  try {
    if (!(await checkOrgIds(req.user.orgId, [], asArray(teamId).concat(teamIds || [])))) {
      return res.status(400).json({ error: "Unknown team" });
    }
    const user = await createUser(Object.assign(cleanNewUser(body), {
      orgId:        req.user.orgId,
      teamId:       teamId || null,
      passwordHash: await hashPassword(body.password),
      role:         role,
    }));
    if (teamIds !== undefined) {
      await setUserTeams(user.id, teamIds);
    }
    realtime.publish({ orgAdmins: req.user.orgId }, "users.changed", {});
    res.status(201).json(stripSecrets(user));
  } catch (err) {
    // PostgreSQL unique violation code
    if (err.code === "23505") {
      return res.status(409).json({ error: "Email already in use" });
    }
    next(err);
  }
});

// PUT /api/admin/users/:id  { firstName, lastName, phone, role, teamId, teamIds }
router.put("/users/:id", async function(req, res, next) {
  try {
    const target = await findUserById(req.params.id);
    if (!target || target.orgId !== req.user.orgId) {
      return res.status(404).json({ error: "User not found" });
    }
    if (!canManage(req.user, target)) {
      return res.status(403).json({ error: "Only the owner can modify admins" });
    }
    const { firstName, lastName, phone, role, teamId, teamIds } = req.body || {};
    const fields = {};
    if (firstName !== undefined) {
      var fErr = validateName(firstName, "First name");
      if (fErr) return res.status(400).json({ error: fErr });
      fields.firstName = firstName.trim();
    }
    if (lastName !== undefined) {
      var lErr = validateName(lastName, "Last name");
      if (lErr) return res.status(400).json({ error: lErr });
      fields.lastName = lastName.trim();
    }
    if (phone !== undefined) {
      var pErr = validatePhone(phone, false);
      if (pErr) return res.status(400).json({ error: pErr });
      fields.phone = phone ? phone.trim() : null;
    }
    if (role !== undefined && role !== target.role) {
      if (!["admin", "user"].includes(role)) {
        return res.status(400).json({ error: "Role must be 'admin' or 'user' (use transfer ownership to change the owner)" });
      }
      if (target.id === req.user.id) return res.status(400).json({ error: "You can't change your own role" });
      if (target.role === "owner")   return res.status(403).json({ error: "The owner's role can only change by transferring ownership" });
      // Promotion is open to any admin; demotion of an admin is owner-only (canManage already
      // blocks non-owners from touching admins, this keeps the rule explicit)
      if (target.role === "admin" && role === "user" && req.user.role !== "owner") {
        return res.status(403).json({ error: "Only the owner can demote admins" });
      }
      fields.role = role;
    }
    if (teamIds !== undefined && !Array.isArray(teamIds)) return res.status(400).json({ error: "teamIds must be an array" });
    if (!(await checkOrgIds(req.user.orgId, [], asArray(teamId).concat(teamIds || [])))) {
      return res.status(400).json({ error: "Unknown team" });
    }
    if (teamId !== undefined) fields.teamId = teamId || null;
    const updated = await updateUser(req.params.id, req.user.orgId, fields);
    if (fields.role === "user") {
      // A demoted admin no longer administers any team or edits decks by grant
      await removeTeamAdminEverywhere(req.params.id);
      await removeDeckEditorEverywhere(req.params.id);
    }
    if (teamIds !== undefined) {
      await setUserTeams(req.params.id, teamIds);
    }
    if (fields.role) await expirePasswordResets(req.params.id);
    // Their open app re-reads its profile (role/teams) and rejoins the right live channels
    realtime.refreshUser(req.params.id);
    realtime.publish({ orgAdmins: req.user.orgId }, "users.changed", {});
    res.json(stripSecrets(updated));
  } catch (err) { next(err); }
});

// POST /api/admin/users/:id/reset-link — one-time link (1 hour) the user opens to choose a
// new password. Same rules as resetting it directly. The raw token is returned once only.
router.post("/users/:id/reset-link", async function(req, res, next) {
  try {
    const target = await findUserById(req.params.id);
    if (!target || target.orgId !== req.user.orgId) return res.status(404).json({ error: "User not found" });
    if (target.id === req.user.id) return res.status(400).json({ error: "Change your own password from your profile" });
    if (target.role === "owner") return res.status(403).json({ error: "The owner resets their password from their profile" });
    if (!canManage(req.user, target)) return res.status(403).json({ error: "Only the owner can reset an admin's password" });
    res.json(await createPasswordReset(target.id, req.user.id));
  } catch (err) { next(err); }
});

// POST /api/admin/users/:id/reset-password
router.post("/users/:id/reset-password", async function(req, res, next) {
  try {
    const target = await findUserById(req.params.id);
    if (!target || target.orgId !== req.user.orgId) {
      return res.status(404).json({ error: "User not found" });
    }
    // Resetting your own password here would skip the current-password check — a stolen
    // session could lock the real owner out for good
    if (target.id === req.user.id) {
      return res.status(400).json({ error: "You can't reset your own password here" });
    }
    if (!canManage(req.user, target)) {
      return res.status(403).json({ error: "Only the owner can reset an admin's password" });
    }
    const { password } = req.body || {};
    var pwErr = validatePassword(password);
    if (pwErr) return res.status(400).json({ error: pwErr });
    await updateUser(req.params.id, req.user.orgId, { passwordHash: await hashPassword(password) });
    // Revoke the user's current session so the old password's tokens stop working
    await setActiveToken(req.params.id, null);
    await realtime.signOutDevices(req.params.id, "password");
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// DELETE /api/admin/users/:id
router.delete("/users/:id", async function(req, res, next) {
  try {
    const target = await findUserById(req.params.id);
    if (!target || target.orgId !== req.user.orgId) {
      return res.status(404).json({ error: "User not found" });
    }
    if (target.id === req.user.id) {
      return res.status(400).json({ error: "Cannot delete your own account" });
    }
    if (target.role === "owner") {
      return res.status(403).json({ error: "The owner can't be deleted" });
    }
    if (!canManage(req.user, target)) {
      return res.status(403).json({ error: "Only the owner can delete admins" });
    }
    await realtime.signOutDevices(req.params.id, "removed");
    await deleteUser(req.params.id, req.user.orgId);
    realtime.publish({ orgAdmins: req.user.orgId }, "users.changed", {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/admin/transfer-ownership  { userId } — owner only; the old owner becomes an admin
router.post("/transfer-ownership", async function(req, res, next) {
  try {
    if (req.user.role !== "owner") {
      return res.status(403).json({ error: "Only the owner can transfer ownership" });
    }
    const { userId } = req.body || {};
    const target = userId ? await findUserById(userId) : null;
    if (!target || target.orgId !== req.user.orgId) {
      return res.status(404).json({ error: "User not found" });
    }
    if (target.id === req.user.id) return res.status(400).json({ error: "You already own this organization" });
    try {
      await transferOwnership(req.user.orgId, req.user.id, target.id);
    } catch (err) {
      // Concurrent transfer: either we lost owner mid-request or the unique index caught a race
      if (err.code === "NOT_OWNER" || err.code === "23505") return res.status(409).json({ error: "Ownership changed — reload and try again" });
      throw err;
    }
    await expirePasswordResets(req.user.id);
    await expirePasswordResets(target.id);
    realtime.refreshUser(req.user.id);
    realtime.refreshUser(target.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── SHARE CODES ──────────────────────────────────────────────────────────────

// GET /api/admin/invites
router.get("/invites", async function(req, res, next) {
  try {
    res.json(await getOrgInvites(req.user.orgId));
  } catch (err) { next(err); }
});

// Shared checks for creating/editing a code. Returns an error message or null; fills out.
async function inviteFields(body, orgId, out, creating) {
  if (body.expiresInDays !== undefined || creating) {
    // Omitted on create = 7 days; a never-expiring code needs an explicit null
    var days = body.expiresInDays === undefined ? 7 : body.expiresInDays;
    if (days != null && !(Number.isInteger(days) && days >= 1 && days <= 365)) return "expiresInDays must be a whole number from 1 to 365";
    out.expiresAt = days == null ? null : Date.now() + days * 24 * 60 * 60 * 1000;
  }
  if (body.maxUses !== undefined) {
    if (body.maxUses != null && !(Number.isInteger(body.maxUses) && body.maxUses >= 1 && body.maxUses <= 1000)) return "maxUses must be a whole number from 1 to 1000";
    out.maxUses = body.maxUses == null ? null : body.maxUses;
  }
  if (body.label !== undefined) {
    if (body.label != null && (typeof body.label !== "string" || body.label.trim().length > 60)) return "Label must be 60 characters or less";
    out.label = body.label ? body.label.trim() : null;
  }
  if (body.teamId !== undefined) {
    if (body.teamId) {
      const team = typeof body.teamId === "string" ? await getTeamById(body.teamId) : null;
      if (!team || team.orgId !== orgId) return "Unknown team";
    }
    out.teamId = body.teamId || null;
  }
  return null;
}

// POST /api/admin/invites  { label?, teamId?, expiresInDays?: 1..365 | null, maxUses?: 1..1000 | null }
router.post("/invites", async function(req, res, next) {
  try {
    var f = {};
    var err = await inviteFields(req.body || {}, req.user.orgId, f, true);
    if (err) return res.status(400).json({ error: err });
    const invite = await createInvite(Object.assign(f, { orgId: req.user.orgId, createdBy: req.user.id }));
    res.status(201).json(invite);
  } catch (err) { next(err); }
});

// PUT /api/admin/invites/:id  { label?, teamId?, expiresInDays? (from now) | null, maxUses?, reactivate? }
router.put("/invites/:id", async function(req, res, next) {
  try {
    const existing = await getInvite(req.params.id, req.user.orgId);
    if (!existing) return res.status(404).json({ error: "Share code not found" });
    var f = {};
    var err = await inviteFields(req.body || {}, req.user.orgId, f, false);
    if (err) return res.status(400).json({ error: err });
    if (f.maxUses != null && f.maxUses < existing.uses) return res.status(400).json({ error: "This code has already been used " + existing.uses + " times" });
    f.reactivate = !!(req.body && req.body.reactivate);
    res.json(await updateInvite(existing.id, req.user.orgId, f));
  } catch (err) { next(err); }
});

// GET /api/admin/invites/:id/members — who joined with this code
router.get("/invites/:id/members", async function(req, res, next) {
  try {
    const existing = await getInvite(req.params.id, req.user.orgId);
    if (!existing) return res.status(404).json({ error: "Share code not found" });
    res.json(await getInviteMembers(existing.id, req.user.orgId));
  } catch (err) { next(err); }
});

// DELETE /api/admin/invites/:id — revoke (kept for the history list)
router.delete("/invites/:id", async function(req, res, next) {
  try {
    const ok = await revokeInvite(req.params.id, req.user.orgId);
    if (!ok) return res.status(404).json({ error: "Share code not found" });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── TEAMS ────────────────────────────────────────────────────────────────────

// GET /api/admin/teams
router.get("/teams", async function(req, res, next) {
  try {
    res.json(await getOrgTeams(req.user.orgId));
  } catch (err) { next(err); }
});

// POST /api/admin/teams
router.post("/teams", async function(req, res, next) {
  try {
    const { name, adminIds, memberIds } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Team name is required" });
    }
    if (!Array.isArray(adminIds) || !adminIds.length) {
      return res.status(400).json({ error: "At least one admin must be assigned to a team" });
    }
    if (memberIds != null && !Array.isArray(memberIds)) return res.status(400).json({ error: "memberIds must be an array" });
    if (!(await checkOrgIds(req.user.orgId, adminIds.concat(memberIds || []), []))) {
      return res.status(400).json({ error: "Unknown user" });
    }
    const team = await createTeam({ orgId: req.user.orgId, name: name.trim(), adminIds });
    if (memberIds !== undefined) {
      for (var i = 0; i < (memberIds || []).length; i++) {
        var mid     = memberIds[i];
        var current = await getUserTeams(mid);
        if (!current.includes(team.id)) await setUserTeams(mid, current.concat([team.id]));
      }
    }
    res.status(201).json(await getTeamById(team.id));
  } catch (err) { next(err); }
});

// PUT /api/admin/teams/:id
router.put("/teams/:id", async function(req, res, next) {
  try {
    const team = await getTeamById(req.params.id);
    if (!team || team.orgId !== req.user.orgId) {
      return res.status(404).json({ error: "Team not found" });
    }
    const { name, adminIds, memberIds } = req.body || {};
    if (adminIds !== undefined && (!Array.isArray(adminIds) || !adminIds.length)) {
      return res.status(400).json({ error: "At least one admin must be assigned to a team" });
    }
    if (memberIds != null && !Array.isArray(memberIds)) return res.status(400).json({ error: "memberIds must be an array" });
    if (!(await checkOrgIds(req.user.orgId, (adminIds || []).concat(memberIds || []), []))) {
      return res.status(400).json({ error: "Unknown user" });
    }
    const updated = await updateTeam(req.params.id, req.user.orgId, { name, adminIds });
    if (memberIds !== undefined) {
      const newMemberIds = memberIds || [];
      const oldMembers   = updated.memberIds || [];
      const toAdd        = newMemberIds.filter(function(id) { return !oldMembers.includes(id); });
      const toRemove     = oldMembers.filter(function(id)   { return !newMemberIds.includes(id); });
      for (var i = 0; i < toAdd.length; i++) {
        var current = await getUserTeams(toAdd[i]);
        if (!current.includes(req.params.id)) await setUserTeams(toAdd[i], current.concat([req.params.id]));
      }
      for (var j = 0; j < toRemove.length; j++) {
        var cur = await getUserTeams(toRemove[j]);
        await setUserTeams(toRemove[j], cur.filter(function(t) { return t !== req.params.id; }));
      }
    }
    res.json(await getTeamById(req.params.id));
  } catch (err) { next(err); }
});

// DELETE /api/admin/teams/:id
router.delete("/teams/:id", async function(req, res, next) {
  try {
    const team = await getTeamById(req.params.id);
    if (!team || team.orgId !== req.user.orgId) {
      return res.status(404).json({ error: "Team not found" });
    }
    await deleteTeam(req.params.id, req.user.orgId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
