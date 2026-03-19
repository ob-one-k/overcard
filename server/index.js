const express      = require("express");
const cors         = require("cors");
const helmet       = require("helmet");
const cookieParser = require("cookie-parser");
const path         = require("path");
const fs           = require("fs");

const { pool, initSchema } = require("./db");
const { runSeed }          = require("./seed");
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

var corsOrigin = isDev
  ? ["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173", "http://127.0.0.1:3000"]
  : process.env.CORS_ORIGIN || false;

app.use(cors({
  origin: corsOrigin,
  credentials: true,
}));

app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

// ─── API ROUTES ───────────────────────────────────────────────────────────────
app.use("/api/auth",     authRoutes);
app.use("/api/decks",    deckRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/admin",    adminRoutes);

app.get("/api/health", async function(req, res, next) {
  try {
    const [u, d, s] = await Promise.all([
      pool.query("SELECT COUNT(*) AS n FROM users"),
      pool.query("SELECT COUNT(*) AS n FROM decks"),
      pool.query("SELECT COUNT(*) AS n FROM sessions"),
    ]);
    res.json({
      ok:       true,
      ts:       Date.now(),
      users:    parseInt(u.rows[0].n, 10),
      decks:    parseInt(d.rows[0].n, 10),
      sessions: parseInt(s.rows[0].n, 10),
    });
  } catch (err) { next(err); }
});

// ─── FRONTEND ─────────────────────────────────────────────────────────────────
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get("*", function(req, res, next) {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(DIST_DIR, "index.html"));
  });
}

// ─── CENTRAL ERROR HANDLER ───────────────────────────────────────────────────
app.use(function(err, req, res, next) {
  console.error(err);
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── START ────────────────────────────────────────────────────────────────────
async function start() {
  await initSchema();

  // Start listening first so Render's health check passes immediately
  app.listen(PORT, function() {
    console.log("OverCard server listening on http://localhost:" + PORT);
    console.log("Mode: " + (process.env.NODE_ENV || "development"));

    // Seed after server is up — runs in background, won't block requests
    runSeed().catch(function(err) {
      console.error("Seed error:", err.message);
    });
  });
}

start().catch(function(err) {
  console.error("Failed to start:", err);
  process.exit(1);
});
