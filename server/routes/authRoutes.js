const express   = require("express");
const { randomUUID, createHash, timingSafeEqual } = require("crypto");
const router    = express.Router();
const {
  findUserByEmail, updateLastLogin, findUserById, getTeamNames, getUserTeams, getAdminTeamIds,
  setActiveToken, clearActiveTokenIfMatches, findOrgById,
  findUsableInvite, signupWithInvite, createOrgWithOwner,
} = require("../db");
const realtime = require("../realtime");
const { jwtSign, checkPassword, hashPassword, setCookie, clearCookie, requireAuth, isAdminRole } = require("../auth");
const { limiter } = require("../limits");
const { validateNewUser, cleanNewUser, validateOrg, cleanOrg } = require("../validate");

var loginLimiter  = limiter(15 * 60 * 1000, 10, "Too many login attempts, please try again later");
// Signup endpoints share one limiter — share codes and the master code must not be brute-forceable
var signupLimiter = limiter(15 * 60 * 1000, 10);

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
async function startSession(res, user) {
  const sessionToken = randomUUID();
  if (user.activeToken) await realtime.signOutDevices(user.id, "replaced");
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

// GET /api/auth/invite/:code — preview which org a share code joins (signup form)
router.get("/invite/:code", signupLimiter, async function(req, res, next) {
  try {
    const invite = await findUsableInvite(req.params.code);
    if (!invite) return res.status(404).json({ error: "Invalid or expired share code" });
    res.json({ orgName: invite.orgName });
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
    if (!user) return res.status(404).json({ error: "Invalid or expired share code" });
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
