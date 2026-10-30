const express = require("express");
const router  = express.Router();
const { getOrgDecks, getDeckById, createDeck, updateDeck, deleteDeck, uid, getDeckAccess, setDeckAccess, getUserTeams } = require("../db");
const { requireAuth, isAdminRole } = require("../auth");

router.use(requireAuth);

// GET /api/decks
router.get("/", async function(req, res, next) {
  try {
    if (isAdminRole(req.user.role)) {
      return res.json(await getOrgDecks(req.user.orgId));
    }
    // Regular users: filter by visibility/access
    const userTeamIds = await getUserTeams(req.user.id);
    res.json(await getOrgDecks(req.user.orgId, req.user.id, userTeamIds));
  } catch (err) { next(err); }
});

// POST /api/decks  (admin-only)
router.post("/", async function(req, res, next) {
  try {
    if (!isAdminRole(req.user.role)) {
      return res.status(403).json({ error: "Only admins can create decks" });
    }
    const { name, color, icon, visibility, accessList } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Deck name is required" });
    }
    const deck = await createDeck({
      orgId:      req.user.orgId,
      createdBy:  req.user.id,
      name:       name.trim(),
      color:      color || "#F5A623",
      icon:       icon  || "💼",
      visibility: visibility || "public",
    });
    if (accessList && accessList.length > 0) {
      await setDeckAccess(deck.id, accessList);
      deck.accessList = accessList;
    }
    res.status(201).json(deck);
  } catch (err) { next(err); }
});

// PUT /api/decks/:id  (admin-only)
router.put("/:id", async function(req, res, next) {
  try {
    if (!isAdminRole(req.user.role)) {
      return res.status(403).json({ error: "Only admins can edit decks" });
    }
    const existing = await getDeckById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Deck not found" });
    if (existing.orgId !== req.user.orgId) return res.status(403).json({ error: "Access denied" });

    const body = req.body || {};
    // updateDeck replaces the whole row — reject partial payloads that would wipe cards
    if (!body.name || typeof body.cards !== "object" || body.cards === null) {
      return res.status(400).json({ error: "Full deck (name, cards) is required" });
    }
    const deck = await updateDeck(req.params.id, req.user.orgId, body);
    if (body.accessList !== undefined) {
      await setDeckAccess(req.params.id, body.accessList);
    }
    res.json(deck);
  } catch (err) { next(err); }
});

// GET /api/decks/:id/access  (admin-only)
router.get("/:id/access", async function(req, res, next) {
  try {
    if (!isAdminRole(req.user.role)) return res.status(403).json({ error: "Admin only" });
    var deck = await getDeckById(req.params.id);
    if (!deck) return res.status(404).json({ error: "Deck not found" });
    if (deck.orgId !== req.user.orgId) return res.status(403).json({ error: "Access denied" });
    res.json(await getDeckAccess(req.params.id));
  } catch (err) { next(err); }
});

// PUT /api/decks/:id/access  (admin-only)
router.put("/:id/access", async function(req, res, next) {
  try {
    if (!isAdminRole(req.user.role)) return res.status(403).json({ error: "Admin only" });
    var deck = await getDeckById(req.params.id);
    if (!deck) return res.status(404).json({ error: "Deck not found" });
    if (deck.orgId !== req.user.orgId) return res.status(403).json({ error: "Access denied" });
    await setDeckAccess(req.params.id, (req.body && req.body.accessList) || []);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// DELETE /api/decks/:id  (admin-only)
router.delete("/:id", async function(req, res, next) {
  try {
    if (!isAdminRole(req.user.role)) {
      return res.status(403).json({ error: "Only admins can delete decks" });
    }
    const existing = await getDeckById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Deck not found" });
    if (existing.orgId !== req.user.orgId) return res.status(403).json({ error: "Access denied" });

    await deleteDeck(req.params.id, req.user.orgId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
