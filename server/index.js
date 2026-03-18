const express      = require("express");
const cors         = require("cors");
const helmet       = require("helmet");
const cookieParser = require("cookie-parser");
const path         = require("path");
const fs           = require("fs");

const authRoutes    = require("./routes/authRoutes");
const deckRoutes    = require("./routes/deckRoutes");
const sessionRoutes = require("./routes/sessionRoutes");
const adminRoutes   = require("./routes/adminRoutes");

const app      = express();
const PORT     = process.env.PORT || 3000;
const DIST_DIR = path.join(__dirname, "..", "dist");

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
const isDev = process.env.NODE_ENV !== "production";

app.use(helmet({ contentSecurityPolicy: isDev ? false : undefined }));

app.use(cors({
  origin: isDev ? ["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173", "http://127.0.0.1:3000"] : false,
  credentials: true,
}));

app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

// ─── API ROUTES ───────────────────────────────────────────────────────────────
app.use("/api/auth",     authRoutes);
app.use("/api/decks",    deckRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/admin",    adminRoutes);

app.get("/api/health", function(req, res) {
  const { db } = require("./db");
  const userCount = db.prepare("SELECT COUNT(*) as n FROM users").get().n;
  const deckCount = db.prepare("SELECT COUNT(*) as n FROM decks").get().n;
  const sessCount = db.prepare("SELECT COUNT(*) as n FROM sessions").get().n;
  res.json({
    ok: true,
    ts: Date.now(),
    users: userCount,
    decks: deckCount,
    sessions: sessCount,
  });
});

// ─── FRONTEND ─────────────────────────────────────────────────────────────────
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get("*", function(req, res, next) {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(DIST_DIR, "index.html"));
  });
}

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, function() {
  console.log("OverCard server listening on http://localhost:" + PORT);
  console.log("Mode: " + (process.env.NODE_ENV || "development"));
});
