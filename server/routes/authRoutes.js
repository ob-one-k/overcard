const express   = require("express");
const rateLimit = require("express-rate-limit");
const { randomUUID } = require("crypto");
const router    = express.Router();
const { findUserByEmail, updateLastLogin, findUserById, getTeamById, getUserTeams, getAdminTeamIds, setActiveToken } = require("../db");
const { jwtSign, checkPassword, setCookie, clearCookie, requireAuth } = require("../auth");

var loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Too many login attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

async function buildUserResponse(user) {
  const team    = user.teamId ? await getTeamById(user.teamId) : null;
  const teamIds = await getUserTeams(user.id);
  // For admin users: also include teams they administer so sub-tabs are immediate
  if (user.role === "admin") {
    const adminTeamIds = await getAdminTeamIds(user.id);
    adminTeamIds.forEach(function(tid) {
      if (teamIds.indexOf(tid) === -1) teamIds.push(tid);
    });
  }
  const teams   = (await Promise.all(
    teamIds.map(function(tid) { return getTeamById(tid); })
  )).filter(Boolean).map(function(t) { return { id: t.id, name: t.name }; });
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
router.post("/login", loginLimiter, async function(req, res, next) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await findUserByEmail(email.toLowerCase().trim());
    if (!user) return res.status(401).json({ error: "Invalid email or password" });

    if (!checkPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Single-session enforcement: block if already active (unless force=true)
    if (user.activeToken && !req.query.force) {
      return res.status(409).json({ error: "already_logged_in" });
    }

    // Generate a new session token — invalidates any existing session on other devices
    const sessionToken = randomUUID();
    await setActiveToken(user.id, sessionToken);
    await updateLastLogin(user.id);

    const token = jwtSign({ sub: user.id, role: user.role, orgId: user.orgId, sid: sessionToken });
    setCookie(res, token);

    // Include _token in response body for mobile/Safari ITP fallback (stored in localStorage)
    res.json(Object.assign(await buildUserResponse(user), { _token: token }));
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
        if (payload && payload.sub) await setActiveToken(payload.sub, null);
      } catch (_) { /* ignore invalid token on logout */ }
    }
    clearCookie(res);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/auth/refresh — extend session while still valid
router.post("/refresh", requireAuth, async function(req, res, next) {
  try {
    // Re-use existing session token so sid stays the same — refreshing the JWT doesn't replace the session
    const user = await findUserById(req.user.id);
    const sid  = user && user.activeToken ? user.activeToken : randomUUID();
    if (!user.activeToken) await setActiveToken(req.user.id, sid);
    const token = jwtSign({ sub: req.user.id, role: req.user.role, orgId: req.user.orgId, sid: sid });
    setCookie(res, token);
    res.json({ ok: true, _token: token });
  } catch (err) { next(err); }
});

// GET /api/auth/me
router.get("/me", requireAuth, async function(req, res, next) {
  try {
    const user = await findUserById(req.user.id);
    if (!user) return res.status(401).json({ error: "User not found" });
    res.json(await buildUserResponse(user));
  } catch (err) { next(err); }
});

module.exports = router;
