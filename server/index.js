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
const orgRoutes     = require("./routes/orgRoutes");

const app      = express();
const PORT     = process.env.PORT || 3000;
const DIST_DIR = path.join(__dirname, "..", "dist");

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
const isDev = process.env.NODE_ENV !== "production";

// Render terminates TLS at its proxy — trust one hop so req.ip / rate limiting see the real client
if (!isDev) app.set("trust proxy", 1);

app.use(helmet({ contentSecurityPolicy: isDev ? false : undefined }));

var corsOrigin = isDev
  ? ["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173", "http://127.0.0.1:3000"]
  : process.env.CORS_ORIGIN || false;

app.use(cors({
  origin: corsOrigin,
  credentials: true,
  // Lets the cross-origin (Vercel) client read the stored recording length
  exposedHeaders: ["X-Audio-Duration-Ms", "Content-Range", "Accept-Ranges"],
}));

app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

// ─── API ROUTES ───────────────────────────────────────────────────────────────
app.use("/api/auth",     authRoutes);
app.use("/api/decks",    deckRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/admin",    adminRoutes);
app.use("/api/org",      orgRoutes);

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
  // Express 5 (path-to-regexp v8) requires a named wildcard; "{*splat}" also matches "/"
  app.get("/{*splat}", function(req, res, next) {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(DIST_DIR, "index.html"));
  });
}

// ─── CENTRAL ERROR HANDLER ───────────────────────────────────────────────────
app.use(function(err, req, res, next) {
  // body-parser errors (malformed JSON, payload too large) carry a 4xx status — pass it through
  if (err && err.status >= 400 && err.status < 500 && err.expose) {
    if (!res.headersSent) {
      res.status(err.status).json({ error: err.status === 413 ? "Upload is too large" : "Invalid request body" });
    }
    return;
  }
  console.error(err);
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── START ────────────────────────────────────────────────────────────────────
// Retry schema init so a database that is still waking up doesn't crash-loop the service
async function initSchemaWithRetry(attempts) {
  for (var i = 1; i <= attempts; i++) {
    try {
      return await initSchema();
    } catch (err) {
      console.error("Database init failed (attempt " + i + "/" + attempts + "):", err.message);
      if (i === attempts) throw err;
      await new Promise(function(r) { setTimeout(r, i * 3000); });
    }
  }
}

async function start() {
  await initSchemaWithRetry(5);

  // Start listening first so Render's health check passes immediately
  app.listen(PORT, function(err) {
    // Express 5 passes bind errors (EADDRINUSE, EACCES) here instead of throwing
    if (err) {
      console.error("Failed to listen on port " + PORT + ":", err.message);
      process.exit(1);
    }
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
