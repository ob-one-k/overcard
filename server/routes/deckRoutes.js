const express = require("express");
const router  = express.Router();
const { getOrgDecks, getDeckById, createDeck, updateDeck, deleteDeck, uid, getDeckAccess, setDeckAccess, getUserTeams } = require("../db");
const { requireAuth } = require("../auth");

router.use(requireAuth);

// GET /api/decks
router.get("/", function(req, res) {
  if (req.user.role === "admin") {
    return res.json(getOrgDecks(req.user.orgId));
  }
  // Regular users: filter by visibility/access
  const userTeamIds = getUserTeams(req.user.id);
  res.json(getOrgDecks(req.user.orgId, req.user.id, userTeamIds));
});

// POST /api/decks  (admin-only)
router.post("/", function(req, res) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Only admins can create decks" });
  }
  const { name, color, icon, visibility, accessList } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Deck name is required" });
  }
  const deck = createDeck({
    orgId:     req.user.orgId,
    createdBy: req.user.id,
    name:      name.trim(),
    color:     color || "#F5A623",
    icon:      icon  || "💼",
    visibility: visibility || "public",
  });
  if (accessList && accessList.length > 0) {
    setDeckAccess(deck.id, accessList);
    deck.accessList = accessList;
  }
  res.status(201).json(deck);
});

// PUT /api/decks/:id  (admin-only)
router.put("/:id", function(req, res) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Only admins can edit decks" });
  }
  const existing = getDeckById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Deck not found" });
  if (existing.orgId !== req.user.orgId) return res.status(403).json({ error: "Access denied" });

  const deck = updateDeck(req.params.id, req.user.orgId, req.body);
  if (req.body.accessList !== undefined) {
    setDeckAccess(req.params.id, req.body.accessList);
  }
  res.json(deck);
});

// GET /api/decks/:id/access  (admin-only)
router.get("/:id/access", function(req, res) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin only" });
  var deck = getDeckById(req.params.id);
  if (!deck) return res.status(404).json({ error: "Deck not found" });
  if (deck.orgId !== req.user.orgId) return res.status(403).json({ error: "Access denied" });
  res.json(getDeckAccess(req.params.id));
});

// PUT /api/decks/:id/access  (admin-only)
router.put("/:id/access", function(req, res) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin only" });
  var deck = getDeckById(req.params.id);
  if (!deck) return res.status(404).json({ error: "Deck not found" });
  if (deck.orgId !== req.user.orgId) return res.status(403).json({ error: "Access denied" });
  setDeckAccess(req.params.id, req.body.accessList || []);
  res.json({ ok: true });
});

// DELETE /api/decks/:id  (admin-only)
router.delete("/:id", function(req, res) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Only admins can delete decks" });
  }
  const existing = getDeckById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Deck not found" });
  if (existing.orgId !== req.user.orgId) return res.status(403).json({ error: "Access denied" });

  deleteDeck(req.params.id, req.user.orgId);
  res.json({ ok: true });
});

module.exports = router;
