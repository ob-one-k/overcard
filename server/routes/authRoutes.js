const express   = require("express");
const { randomUUID, createHash, timingSafeEqual } = require("crypto");
const router    = express.Router();
const {
  findUserByEmail, updateLastLogin, findUserById, getTeamNames, getUserTeams, getAdminTeamIds,
  setActiveToken, clearActiveTokenIfMatches, findOrgById,
  checkInvite, signupWithInvite, createOrgWithOwner,
  findPasswordReset, usePasswordReset, setPasswordHash, isSeedUser,
} = require("../db");
const { DEMO_MODE } = require("../config");
const realtime = require("../realtime");
const { jwtSign, checkPassword, hashPassword, setCookie, clearCookie, requireAuth, isAdminRole } = require("../auth");
const { limiter } = require("../limits");
const { validateNewUser, cleanNewUser, validateOrg, cleanOrg, validatePassword } = require("../validate");

var loginLimiter  = limiter(15 * 60 * 1000, 10, "Too many login attempts, please try again later");
// Signup endpoints share one limiter — share codes and the master code must not be brute-forceable
var signupLimiter = limiter(15 * 60 * 1000, 10);
// The signup form previews a code as it's typed — looser than signup itself so typos
// don't use up the attempts the real signup needs
var invitePreviewLimiter = limiter(15 * 60 * 1000, 30);
// Reset links: tokens are 256-bit, so this only stops hammering
var resetLimiter = limiter(15 * 60 * 1000, 20);
// Changing your password re-checks the current one — limit guesses per account, not just per IP
var changePwLimiter = limiter(15 * 60 * 1000, 10, "Too many attempts, please try again later",
  function(req) { return "pw:" + req.user.id; });

// Hash both sides so timingSafeEqual gets equal-length buffers and the code length doesn't leak
function masterCodeMatches(input) {
  var expected = process.env.MASTER_CODE;
  if (!expected || typeof input !== "string" || !input) return false;
  var a = createHash("sha256").update(input).digest();
  var b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// Issue a fresh single-session token and the auth cookie; returns the login response body.
// One device at a time: any other device signed in to this account is signed out now —
// its in-progress run is saved as abandoned and its live stream told why.
//   opts.rotating — the same device is changing its own session (password change): no kick
async function startSession(res, user, opts) {
  const sessionToken = randomUUID();
  if (user.activeToken && !(opts && opts.rotating)) await realtime.signOutDevices(user.id, "replaced");
  await setActiveToken(user.id, sessionToken);
  await updateLastLogin(user.id);
  const token = jwtSign({ sub: user.id, role: user.role, orgId: user.orgId, sid: sessionToken });
  setCookie(res, token);
  // Include _token in response body for mobile/Safari ITP fallback (stored in localStorage)
  return Object.assign(await buildUserResponse(user), { _token: token });
}

// Short fingerprint of the logo data URL — lets /auth/me skip re-sending an unchanged logo
function logoVersion(logo) {
  return logo ? createHash("sha1").update(logo).digest("hex").slice(0, 16) : null;
}

// opts.logoVer — the client's cached logo version; when it matches, orgLogo is omitted
async function buildUserResponse(user, opts) {
  // Independent lookups run in parallel; team names come from one query
  const [teamIds, adminTeamIds, org] = await Promise.all([
    getUserTeams(user.id),
    isAdminRole(user.role) ? getAdminTeamIds(user.id) : Promise.resolve([]),
    findOrgById(user.orgId),
  ]);
  // For admin users: also include teams they administer so sub-tabs are immediate
  adminTeamIds.forEach(function(tid) {
    if (teamIds.indexOf(tid) === -1) teamIds.push(tid);
  });
  const lookupIds = user.teamId && teamIds.indexOf(user.teamId) === -1 ? teamIds.concat([user.teamId]) : teamIds;
  const named = await getTeamNames(lookupIds);
  const team  = user.teamId ? named.find(function(t) { return t.id === user.teamId; }) || null : null;
  const teams = named.filter(function(t) { return teamIds.indexOf(t.id) !== -1; });
  const body = {
    id:          user.id,
    email:       user.email,
    displayName: user.displayName,
    firstName:   user.firstName || null,
    lastName:    user.lastName  || null,
    phone:       user.phone     || null,
    orgName:     org ? org.name : null,
    orgLogo:     org ? org.logo || null : null,
    orgLogoVer:  org ? logoVersion(org.logo) : null,
    orgAccent:   org ? org.accentColor || null : null,
    role:        user.role,
    orgId:       user.orgId,
    teamId:      user.teamId,
    teamName:    team ? team.name : null,
    teams:       teams,
  };
  if (opts && opts.logoVer && body.orgLogoVer && opts.logoVer === body.orgLogoVer) {
    body.orgLogo = null;
    body.orgLogoCached = true;
  }
  return body;
}

// POST /api/auth/login
router.post("/login", loginLimiter, async function(req, res, next) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await findUserByEmail(String(email).toLowerCase().trim());
    // Always run bcrypt (against a dummy hash for unknown emails) to keep timing uniform
    const passwordOk = await checkPassword(String(password), user ? user.passwordHash : null);
    if (!user || !passwordOk) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Single-session enforcement: block if already active (unless force=true)
    if (user.activeToken && !req.query.force) {
      return res.status(409).json({ error: "already_logged_in" });
    }

    // A new session token invalidates any existing session on other devices
    res.json(await startSession(res, user));
  } catch (err) { next(err); }
});

// POST /api/auth/demo-login { email } — one-click sign-in to a seeded demo account.
// Only while DEMO_MODE is on, and only for accounts the demo seed created.
router.post("/demo-login", loginLimiter, async function(req, res, next) {
  try {
    if (!DEMO_MODE) return res.status(404).json({ error: "Not found" });
    const email = String((req.body || {}).email || "").toLowerCase().trim();
    const user = email ? await findUserByEmail(email) : null;
    if (!user || !(await isSeedUser(user.id))) return res.status(404).json({ error: "Not a demo account" });
    if (user.activeToken && !req.query.force) return res.status(409).json({ error: "already_logged_in" });
    res.json(await startSession(res, user));
  } catch (err) { next(err); }
});

// GET /api/auth/invite/:code — preview which org a share code joins (signup form)
var INVITE_ERRORS = {
  unknown: "That share code doesn't exist. Check it with your admin.",
  revoked: "This share code was turned off. Ask your admin for a new one.",
  expired: "This share code has expired. Ask your admin for a new one.",
  used_up: "This share code has been used the maximum number of times. Ask your admin for a new one.",
};
function inviteError(res, reason) {
  return res.status(reason === "unknown" ? 404 : 410).json({ error: INVITE_ERRORS[reason] || INVITE_ERRORS.unknown, reason: reason });
}

router.get("/invite/:code", invitePreviewLimiter, async function(req, res, next) {
  try {
    const r = await checkInvite(req.params.code);
    if (!r.ok) return inviteError(res, r.reason);
    res.json({ orgName: r.orgName, teamName: r.teamName });
  } catch (err) { next(err); }
});

// POST /api/auth/signup — join an existing org with an admin-issued share code (role: user)
router.post("/signup", signupLimiter, async function(req, res, next) {
  try {
    const body = req.body || {};
    if (!body.code || typeof body.code !== "string") return res.status(400).json({ error: "Share code is required" });
    const vErr = validateNewUser(body);
    if (vErr) return res.status(400).json({ error: vErr });

    const fields = Object.assign(cleanNewUser(body), { passwordHash: await hashPassword(body.password) });
    var user;
    try {
      user = await signupWithInvite(body.code, fields);
    } catch (err) {
      if (err.code === "23505") return res.status(409).json({ error: "An account with this email already exists" });
      throw err;
    }
    if (!user) return inviteError(res, (await checkInvite(body.code)).reason || "unknown");
    // Admins' people lists and share-code counts update live
    realtime.publish({ orgAdmins: user.orgId }, "users.changed", { joined: user.id });
    res.status(201).json(await startSession(res, user));
  } catch (err) { next(err); }
});

// POST /api/auth/create-org — create a new organization (requires MASTER_CODE); creator becomes owner
router.post("/create-org", signupLimiter, async function(req, res, next) {
  try {
    if (!process.env.MASTER_CODE) {
      return res.status(503).json({ error: "Organization sign-up is not enabled on this server" });
    }
    const body = req.body || {};
    if (!masterCodeMatches(body.masterCode)) return res.status(403).json({ error: "Invalid master code" });
    const org  = body.org || {};
    const oErr = validateOrg(org, true);
    if (oErr) return res.status(400).json({ error: oErr });
    const vErr = validateNewUser(body);
    if (vErr) return res.status(400).json({ error: vErr });

    const owner = Object.assign(cleanNewUser(body), { passwordHash: await hashPassword(body.password) });
    var result;
    try {
      result = await createOrgWithOwner(cleanOrg(org), owner);
    } catch (err) {
      if (err.code === "23505") return res.status(409).json({ error: "An account with this email already exists" });
      throw err;
    }
    res.status(201).json(await startSession(res, result.user));
  } catch (err) { next(err); }
});

// POST /api/auth/logout
router.post("/logout", async function(req, res, next) {
  try {
    // Try to clear activeToken if we can identify the user from cookie or header
    var token = (req.cookies && req.cookies["rc_token"]) || null;
    var authHeader = req.headers["authorization"] || "";
    if (!token && authHeader.startsWith("Bearer ")) token = authHeader.slice(7);
    if (token) {
      try {
        const { jwtVerify } = require("../auth");
        const payload = jwtVerify(token);
        // Only end the session this token belongs to — a stale token from a replaced
        // device must not sign out the user's current active session
        if (payload && payload.sub && payload.sid) {
          // Other tabs on this device share the token — end their streams too
          if (await clearActiveTokenIfMatches(payload.sub, payload.sid)) realtime.closeUser(payload.sub, "logout", { onlySid: payload.sid });
        }
      } catch (_) { /* ignore invalid token on logout */ }
    }
    clearCookie(res);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/auth/refresh — extend session while still valid
router.post("/refresh", requireAuth, async function(req, res, next) {
  try {
    // Re-use the session id so refreshing the JWT doesn't replace the session
    // (requireAuth already verified the JWT's sid matches the user's active session)
    const token = jwtSign({ sub: req.user.id, role: req.user.role, orgId: req.user.orgId, sid: req.authSid });
    setCookie(res, token);
    res.json({ ok: true, _token: token });
  } catch (err) { next(err); }
});

// ─── PASSWORDS ────────────────────────────────────────────────────────────────

// POST /api/auth/change-password { currentPassword, newPassword } — signed-in user.
// This device stays signed in (new session id); anything else using the account is signed out.
router.post("/change-password", requireAuth, changePwLimiter, async function(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== "string" || !currentPassword) return res.status(400).json({ error: "Enter your current password" });
    const user = await findUserById(req.user.id);
    if (!user || !(await checkPassword(currentPassword, user.passwordHash))) {
      return res.status(403).json({ error: "Your current password is incorrect" });
    }
    var pwErr = validatePassword(newPassword);
    if (pwErr) return res.status(400).json({ error: pwErr });
    if (await checkPassword(newPassword, user.passwordHash)) return res.status(400).json({ error: "Choose a password you haven't used here" });
    await setPasswordHash(user.id, await hashPassword(newPassword));
    const body = await startSession(res, user, { rotating: true });
    realtime.closeUser(user.id, "password", { keepSid: req.authSid });
    res.json({ ok: true, _token: body._token });
  } catch (err) { next(err); }
});

// GET /api/auth/reset/:token — preview a reset link (whose account it is for)
router.get("/reset/:token", resetLimiter, async function(req, res, next) {
  try {
    const r = await findPasswordReset(req.params.token);
    if (!r) return res.status(404).json({ error: "This reset link is invalid, has expired or was already used. Ask your admin for a new one." });
    res.json({ firstName: r.firstName, email: r.email, orgName: r.orgName, expiresAt: r.expiresAt });
  } catch (err) { next(err); }
});

// POST /api/auth/reset { token, password } — set a new password with a one-time link.
// Every device signed in to the account is signed out; the user then signs in normally.
router.post("/reset", resetLimiter, async function(req, res, next) {
  try {
    const { token, password } = req.body || {};
    var pwErr = validatePassword(password);
    if (pwErr) return res.status(400).json({ error: pwErr });
    const userId = await usePasswordReset(String(token || ""), await hashPassword(password));
    if (!userId) return res.status(404).json({ error: "This reset link is invalid, has expired or was already used. Ask your admin for a new one." });
    await realtime.signOutDevices(userId, "password");
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/auth/me
router.get("/me", requireAuth, async function(req, res, next) {
  try {
    const user = await findUserById(req.user.id);
    if (!user) return res.status(401).json({ error: "User not found" });
    var logoVer = typeof req.query.logoVer === "string" ? req.query.logoVer.slice(0, 32) : null;
    res.json(await buildUserResponse(user, { logoVer: logoVer }));
  } catch (err) { next(err); }
});

module.exports = router;
