const express = require("express");
const router  = express.Router();
const { getOrgDecks, getDeckById, createDeck, updateDeck, deleteDeck, setDeckArchived, setDeckOrder, uid, getDeckAccess, setDeckAccess, idsInOrg,
  deckPermissions, setDeckEditors, getOrgUsers } = require("../db");
const { requireAuth, isAdminRole } = require("../auth");

function isPlainObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
// Every objection stack must be an object with a string id — a null/garbage entry would crash Play for the org
function validStacks(list) {
  return Array.isArray(list) && list.every(function(st) { return isPlainObject(st) && typeof st.id === "string" && st.id; });
}

// A private deck's access list may only name this org's users and teams. Returns the
// cleaned list (entries for anyone not in this org — another org's ids, or people/teams
// since deleted — are dropped, so a stale entry can never make autosave fail), or null
// when the list is malformed.
async function cleanAccessList(list, orgId) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list) || list.length > 1000) return null;
  var out = [], users = [], teams = [], seen = {};
  for (var i = 0; i < list.length; i++) {
    var a = list[i];
    if (!isPlainObject(a) || (a.entityType !== "user" && a.entityType !== "team") || typeof a.entityId !== "string" || !a.entityId) return null;
    var key = a.entityType + ":" + a.entityId;
    if (seen[key]) continue;
    seen[key] = true;
    out.push({ entityType: a.entityType, entityId: a.entityId });
    (a.entityType === "user" ? users : teams).push(a.entityId);
  }
  var okUsers = new Set(await idsInOrg("users", users, orgId));
  var okTeams = new Set(await idsInOrg("teams", teams, orgId));
  return out.filter(function(a) { return (a.entityType === "user" ? okUsers : okTeams).has(a.entityId); });
}
var VISIBILITY = ["public", "private"];

router.use(requireAuth);

// Permission rules (db.js "DECK PERMISSIONS"): everyone but the owner sees only decks that are
// org-wide, assigned to their teams/them, or theirs to edit; editing needs the owner, the
// creator or an editor grant; teams / visibility / editors are managed by owner + creator.
async function permsOr404(req, res) {
  const p = await deckPermissions(req.params.id, req.user);
  if (!p || !p.see) { res.status(404).json({ error: "Deck not found" }); return null; }
  return p;
}

// GET /api/decks — the decks this user may see, each with canEdit / canManage
router.get("/", async function(req, res, next) {
  try {
    res.json(await getOrgDecks(req.user.orgId, req.user));
  } catch (err) { next(err); }
});

// POST /api/decks  (admin-only)
router.post("/", async function(req, res, next) {
  try {
    if (!isAdminRole(req.user.role)) {
      return res.status(403).json({ error: "Only admins can create decks" });
    }
    const { name, color, icon, visibility, accessList, rootCard, cards, objStacks } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Deck name is required" });
    }
    // Starting content (template cards or a duplicated deck) is optional
    if (cards !== undefined && cards !== null && !isPlainObject(cards)) {
      return res.status(400).json({ error: "cards must be an object" });
    }
    if (objStacks !== undefined && objStacks !== null && !validStacks(objStacks)) {
      return res.status(400).json({ error: "objStacks must be an array of stacks" });
    }
    if (visibility !== undefined && VISIBILITY.indexOf(visibility) === -1) return res.status(400).json({ error: "visibility must be public or private" });
    // Validated before anything is written, so a bad list can't leave a half-created deck
    const access = await cleanAccessList(accessList, req.user.orgId);
    if (!access) return res.status(400).json({ error: "Invalid access list" });
    var startCards = cards || {};
    const deck = await createDeck({
      orgId:      req.user.orgId,
      createdBy:  req.user.id,
      name:       name.trim(),
      color:      color || "#F5A623",
      icon:       icon  || "💼",
      visibility: visibility || "public",
      rootCard:   typeof rootCard === "string" && Object.prototype.hasOwnProperty.call(startCards, rootCard) ? rootCard : null,
      cards:      startCards,
      objStacks:  objStacks || [],
    });
    if (access.length > 0) {
      await setDeckAccess(deck.id, access);
      deck.accessList = access;
    }
    // The creator edits and manages their deck
    deck.editorIds = [];
    deck.canEdit = true;
    deck.canManage = true;
    res.status(201).json(deck);
  } catch (err) { next(err); }
});

// PUT /api/decks/order  { ids: [deckId, …] } — owner only. The order every deck list
// shows (switcher, Home, pickers). Registered before /:id so "order" isn't read as an id.
router.put("/order", async function(req, res, next) {
  try {
    if (req.user.role !== "owner") return res.status(403).json({ error: "Only the organization owner can reorder decks" });
    var ids = req.body && req.body.ids;
    if (!Array.isArray(ids) || ids.length > 1000 || !ids.every(function(x) { return typeof x === "string" && x.length <= 100; })) {
      return res.status(400).json({ error: "ids must be a list of deck ids" });
    }
    await setDeckOrder(req.user.orgId, ids);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PUT /api/decks/:id — owner, creator or an editor. Teams/visibility change only for the
// owner and the creator; an editor's save keeps them as they are.
router.put("/:id", async function(req, res, next) {
  try {
    if (!isAdminRole(req.user.role)) {
      return res.status(403).json({ error: "Only admins can edit decks" });
    }
    const perms = await permsOr404(req, res);
    if (!perms) return;
    if (!perms.edit) return res.status(403).json({ error: "You don't have permission to edit this deck" });
    const existing = perms.deck;

    var body = req.body || {};
    // updateDeck replaces the whole row — reject partial payloads that would wipe cards
    if (!body.name || typeof body.cards !== "object" || body.cards === null) {
      return res.status(400).json({ error: "Full deck (name, cards) is required" });
    }
    if (body.objStacks !== undefined && !validStacks(body.objStacks)) {
      return res.status(400).json({ error: "objStacks must be an array of stacks" });
    }
    if (body.visibility !== undefined && VISIBILITY.indexOf(body.visibility) === -1) return res.status(400).json({ error: "visibility must be public or private" });
    var access = null;
    if (!perms.manage) {
      body = Object.assign({}, body, { visibility: existing.visibility });
    } else if (body.accessList !== undefined) {
      access = await cleanAccessList(body.accessList, req.user.orgId);
      if (!access) return res.status(400).json({ error: "Invalid access list" });
    }
    // Only the owner may delete objection stacks — admins archive them instead. A stored stack
    // missing from a non-owner's save is kept (appended back) rather than rejected: the usual
    // cause is a stale copy from before another admin added it, and a 403 there would make
    // autosave fail forever and lose that admin's edits.
    if (req.user.role !== "owner") {
      var incoming = {};
      (body.objStacks || []).forEach(function(st) { incoming[st.id] = true; });
      var kept = (existing.objStacks || []).filter(function(st) { return st && st.id && !incoming[st.id]; });
      if (kept.length) body = Object.assign({}, body, { objStacks: (body.objStacks || []).concat(kept) });
    }
    const deck = await updateDeck(req.params.id, req.user.orgId, body);
    if (access) await setDeckAccess(req.params.id, access);
    res.json(deck);
  } catch (err) { next(err); }
});

// GET /api/decks/:id/access — owner or the deck's creator
router.get("/:id/access", async function(req, res, next) {
  try {
    if (!isAdminRole(req.user.role)) return res.status(403).json({ error: "Admin only" });
    const perms = await permsOr404(req, res);
    if (!perms) return;
    if (!perms.manage) return res.status(403).json({ error: "Only the owner or the deck's creator can see its access" });
    res.json(await getDeckAccess(req.params.id));
  } catch (err) { next(err); }
});

// PUT /api/decks/:id/access — owner or the deck's creator (any team in the org)
router.put("/:id/access", async function(req, res, next) {
  try {
    if (!isAdminRole(req.user.role)) return res.status(403).json({ error: "Admin only" });
    const perms = await permsOr404(req, res);
    if (!perms) return;
    if (!perms.manage) return res.status(403).json({ error: "Only the owner or the deck's creator can change who sees it" });
    const access = await cleanAccessList(req.body && req.body.accessList, req.user.orgId);
    if (!access) return res.status(400).json({ error: "Invalid access list" });
    await setDeckAccess(req.params.id, access);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PUT /api/decks/:id/editors  { userIds } — owner or the deck's creator grants other admins
// edit rights. Only this org's admins can be listed (the owner and creator need no grant).
router.put("/:id/editors", async function(req, res, next) {
  try {
    if (!isAdminRole(req.user.role)) return res.status(403).json({ error: "Admin only" });
    const perms = await permsOr404(req, res);
    if (!perms) return;
    if (!perms.manage) return res.status(403).json({ error: "Only the owner or the deck's creator can choose its editors" });
    var ids = req.body && req.body.userIds;
    if (!Array.isArray(ids) || ids.length > 500 || !ids.every(function(x) { return typeof x === "string"; })) {
      return res.status(400).json({ error: "userIds must be a list of user ids" });
    }
    var admins = new Set((await getOrgUsers(req.user.orgId)).filter(function(u) { return u.role === "admin"; }).map(function(u) { return u.id; }));
    var clean = ids.filter(function(id, i) { return admins.has(id) && id !== perms.deck.createdBy && ids.indexOf(id) === i; });
    await setDeckEditors(req.params.id, clean);
    res.json({ ok: true, editorIds: clean });
  } catch (err) { next(err); }
});

// POST /api/decks/:id/archive  /  /restore — anyone who may edit the deck
async function setArchived(req, res, next, archived) {
  try {
    if (!isAdminRole(req.user.role)) return res.status(403).json({ error: "Only admins can archive decks" });
    const perms = await permsOr404(req, res);
    if (!perms) return;
    if (!perms.edit) return res.status(403).json({ error: "You don't have permission to archive this deck" });
    res.json(await setDeckArchived(req.params.id, req.user.orgId, archived ? Date.now() : null));
  } catch (err) { next(err); }
}
router.post("/:id/archive", function(req, res, next) { setArchived(req, res, next, true); });
router.post("/:id/restore", function(req, res, next) { setArchived(req, res, next, false); });

// DELETE /api/decks/:id  (owner-only — sessions keep their deck snapshot)
router.delete("/:id", async function(req, res, next) {
  try {
    if (req.user.role !== "owner") {
      return res.status(403).json({ error: "Only the organization owner can delete decks" });
    }
    const existing = await getDeckById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Deck not found" });
    if (existing.orgId !== req.user.orgId) return res.status(403).json({ error: "Access denied" });

    await deleteDeck(req.params.id, req.user.orgId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
