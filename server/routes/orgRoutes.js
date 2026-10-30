const express = require("express");
const router  = express.Router();
const { findOrgById, updateOrg, getOrgOwner } = require("../db");
const { requireAuth, requireOwner } = require("../auth");
const { validateOrg, cleanOrg } = require("../validate");

// GET /api/org — the caller's organization profile (any member)
router.get("/", requireAuth, async function(req, res, next) {
  try {
    const org = await findOrgById(req.user.orgId);
    if (!org) return res.status(404).json({ error: "Organization not found" });
    res.json(Object.assign({}, org, { owner: await getOrgOwner(req.user.orgId) }));
  } catch (err) { next(err); }
});

// PUT /api/org — update organization profile (owner only)
router.put("/", requireOwner, async function(req, res, next) {
  try {
    const body = req.body || {};
    const err  = validateOrg(body, false);
    if (err) return res.status(400).json({ error: err });
    const org = await updateOrg(req.user.orgId, cleanOrg(body));
    res.json(Object.assign({}, org, { owner: await getOrgOwner(req.user.orgId) }));
  } catch (err) { next(err); }
});

module.exports = router;
