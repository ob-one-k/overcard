const express      = require("express");
const cors         = require("cors");
const helmet       = require("helmet");
const cookieParser = require("cookie-parser");
const compression  = require("compression");
const path         = require("path");
const fs           = require("fs");

const { pool, initSchema, closeActiveSessions } = require("./db");
const authRoutes    = require("./routes/authRoutes");
const deckRoutes    = require("./routes/deckRoutes");
const sessionRoutes = require("./routes/sessionRoutes");
const adminRoutes   = require("./routes/adminRoutes");
const orgRoutes     = require("./routes/orgRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const clipRoutes = require("./routes/clipRoutes");
const { requireAuth } = require("./auth");
const realtime      = require("./realtime");
const { apiLimiter, streamLimiter } = require("./limits");

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

app.use(cookieParser());

// Live event stream — mounted before compression so events are never buffered
app.get("/api/events", streamLimiter(), requireAuth, realtime.streamHandler);
// Heartbeats are small — cap their bodies well below the general 10 MB JSON limit
app.use(/^\/api\/sessions\/[^/]+\/(start|beat)$/, express.json({ limit: "256kb" }));

// gzip JSON/HTML/JS (session lists are large and highly repetitive); audio/* is skipped by the default filter
app.use(compression({ threshold: 1024 }));
app.use(express.json({ limit: "10mb" }));
app.use("/api", apiLimiter());

// ─── API ROUTES ───────────────────────────────────────────────────────────────
app.use("/api/auth",     authRoutes);
app.use("/api/decks",    deckRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/admin",    adminRoutes);
app.use("/api/org",      orgRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/clips",    clipRoutes);

// Liveness only — no counts or other data (it is public)
app.get("/api/health", async function(req, res) {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, ts: Date.now() });
  } catch (err) {
    res.status(503).json({ ok: false, ts: Date.now() });
  }
});

// ─── FRONTEND ─────────────────────────────────────────────────────────────────
if (fs.existsSync(DIST_DIR)) {
  // Vite's /assets files are content-hashed — cache them for a year; index.html stays revalidated
  app.use(express.static(DIST_DIR, {
    setHeaders: function(res, filePath) {
      if (filePath.indexOf(path.sep + "assets" + path.sep) !== -1) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      else res.setHeader("Cache-Control", "no-cache");
    },
  }));
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
  // Production logs get the message, code and route only — full error objects (pg "detail"
  // can contain emails or other row values) are logged in development
  if (isDev) console.error(err);
  else console.error("Error " + (err && err.code ? "[" + err.code + "] " : "") + req.method + " " + req.path + ": " + (err && err.message));
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

// Runs whose heartbeat stopped (tab closed, phone died, network lost) are closed as
// abandoned after STALE_MS, keeping the path recorded so far
var STALE_MS = 10 * 60 * 1000;
function sweepStaleSessions() {
  closeActiveSessions({ staleBefore: Date.now() - STALE_MS }).then(realtime.publishAbandoned).catch(function(err) { console.error("Stale session sweep failed:", err.message); });
}

async function start() {
  await initSchemaWithRetry(5);

  // Start listening first so Render's health check passes immediately
  const server = app.listen(PORT, function(err) {
    // Express 5 passes bind errors (EADDRINUSE, EACCES) here instead of throwing
    if (err) {
      console.error("Failed to listen on port " + PORT + ":", err.message);
      process.exit(1);
    }
    console.log("OverCard server listening on http://localhost:" + PORT);
    console.log("Mode: " + (process.env.NODE_ENV || "development"));

    setInterval(sweepStaleSessions, 60 * 1000).unref();
    // Render's proxy reuses connections for up to 60s: keep ours open longer than that so it
    // never sends a request down a socket Node just closed (sporadic 502s under load)
    server.keepAliveTimeout = 65 * 1000;
    server.headersTimeout   = 66 * 1000;
  });
}

start().catch(function(err) {
  console.error("Failed to start:", err);
  process.exit(1);
});
