const { Pool, types } = require("pg");
const crypto = require("crypto");
const { runMigrations } = require("./migrations");

// Parse BIGINT (int8, oid 20) columns as JS numbers instead of strings
types.setTypeParser(20, function(val) { return parseInt(val, 10); });

if (process.env.NODE_ENV === "production" && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required in production");
}

// DATABASE_SSL: "verify" (TLS + verify the server certificate — managed DBs reached over the
// internet), "require" (TLS, unverified — the production default), "off" (no TLS — local
// dev, or Render's private internal connection string)
function sslConfig() {
  var mode = (process.env.DATABASE_SSL || (process.env.NODE_ENV === "production" ? "require" : "off")).toLowerCase();
  if (mode === "off") return false;
  if (mode === "verify") return { rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DATABASE_POOL_MAX, 10) || 20,
  ssl: sslConfig(),
  // Fail fast instead of hanging requests forever when the database is unreachable
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis:       30000,
  query_timeout:           30000,
  // Enforced by PostgreSQL too, so a runaway query or a stuck transaction can't hold
  // locks or a connection after the client gave up
  statement_timeout:                   30000,
  idle_in_transaction_session_timeout: 60000,
});

// An idle client erroring (e.g. DB restart) must not crash the process
pool.on("error", function(err) {
  console.error("PostgreSQL pool error:", err.message);
});

// ─── SCHEMA ───────────────────────────────────────────────────────────────────
async function initSchema() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`CREATE TABLE IF NOT EXISTS orgs (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      "createdAt" BIGINT NOT NULL
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS teams (
      id          TEXT PRIMARY KEY,
      "orgId"     TEXT NOT NULL REFERENCES orgs(id),
      name        TEXT NOT NULL,
      "createdAt" BIGINT NOT NULL
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS team_admins (
      "teamId" TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      "userId" TEXT NOT NULL,
      PRIMARY KEY ("teamId", "userId")
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS users (
      id             TEXT PRIMARY KEY,
      "orgId"        TEXT NOT NULL REFERENCES orgs(id),
      "teamId"       TEXT REFERENCES teams(id),
      email          TEXT NOT NULL UNIQUE,
      "passwordHash" TEXT NOT NULL,
      "displayName"  TEXT NOT NULL,
      role           TEXT NOT NULL CHECK(role IN ('admin','user')),
      "createdAt"    BIGINT NOT NULL,
      "lastLoginAt"  BIGINT
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS decks (
      id           TEXT PRIMARY KEY,
      "orgId"      TEXT NOT NULL REFERENCES orgs(id),
      "createdBy"  TEXT NOT NULL REFERENCES users(id),
      name         TEXT NOT NULL,
      color        TEXT NOT NULL DEFAULT '#F5A623',
      icon         TEXT NOT NULL DEFAULT '💼',
      "rootCard"   TEXT,
      cards        JSONB NOT NULL DEFAULT '{}',
      "objStacks"  JSONB NOT NULL DEFAULT '[]',
      "updatedAt"  BIGINT NOT NULL,
      "createdAt"  BIGINT NOT NULL
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS sessions (
      id              TEXT PRIMARY KEY,
      "orgId"         TEXT NOT NULL REFERENCES orgs(id),
      "userId"        TEXT NOT NULL REFERENCES users(id),
      "deckId"        TEXT NOT NULL,
      "deckName"      TEXT NOT NULL,
      "deckColor"     TEXT NOT NULL DEFAULT '#F5A623',
      "deckIcon"      TEXT NOT NULL DEFAULT '💼',
      name            TEXT NOT NULL,
      account         TEXT,
      contact         TEXT,
      mode            TEXT NOT NULL DEFAULT 'live',
      status          TEXT NOT NULL DEFAULT 'completed',
      outcome         TEXT NOT NULL DEFAULT 'completed',
      "startTs"       BIGINT NOT NULL,
      "endTs"         BIGINT,
      sold            BOOLEAN NOT NULL DEFAULT false,
      "soldCardId"    TEXT,
      "soldCardTitle" TEXT,
      events          JSONB NOT NULL DEFAULT '[]',
      notes           JSONB NOT NULL DEFAULT '[]',
      metrics         JSONB
    )`);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_sessions_userId ON sessions("userId")`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sessions_orgId  ON sessions("orgId")`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sessions_deckId ON sessions("deckId")`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_decks_orgId     ON decks("orgId")`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_orgId     ON users("orgId")`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_teamId    ON users("teamId")`);

    await client.query(`CREATE TABLE IF NOT EXISTS session_feedback (
      id           TEXT PRIMARY KEY,
      "sessionId"  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      "orgId"      TEXT NOT NULL,
      "authorId"   TEXT NOT NULL REFERENCES users(id),
      "authorName" TEXT NOT NULL,
      "cardId"     TEXT,
      "cardTitle"  TEXT,
      text         TEXT NOT NULL,
      "createdAt"  BIGINT NOT NULL,
      "updatedAt"  BIGINT NOT NULL
    )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_feedback_sessionId ON session_feedback("sessionId")`);

    await client.query(`CREATE TABLE IF NOT EXISTS session_shares (
      id           TEXT PRIMARY KEY,
      "sessionId"  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      "fromUserId" TEXT NOT NULL REFERENCES users(id),
      "toUserId"   TEXT NOT NULL REFERENCES users(id),
      context      TEXT,
      "createdAt"  BIGINT NOT NULL,
      UNIQUE("sessionId", "toUserId")
    )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_shares_toUserId  ON session_shares("toUserId")`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_shares_sessionId ON session_shares("sessionId")`);

    await client.query(`CREATE TABLE IF NOT EXISTS user_teams (
      "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "teamId" TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      PRIMARY KEY ("userId", "teamId")
    )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_user_teams_teamId ON user_teams("teamId")`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_user_teams_userId ON user_teams("userId")`);

    await client.query(`CREATE TABLE IF NOT EXISTS deck_access (
      "deckId"     TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      "entityType" TEXT NOT NULL CHECK("entityType" IN ('team','user')),
      "entityId"   TEXT NOT NULL,
      PRIMARY KEY ("deckId", "entityType", "entityId")
    )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_deck_access_deckId ON deck_access("deckId")`);

    // Migration: add visibility column if it doesn't exist yet
    await client.query(`ALTER TABLE decks ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public'`);
    // Migration: archived decks are hidden from users but kept (with their sessions) until the owner deletes them
    await client.query(`ALTER TABLE decks ADD COLUMN IF NOT EXISTS "archivedAt" BIGINT`);
    // Session lists filter by org/user (and often deck) and always sort newest first
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sessions_org_start      ON sessions("orgId", "startTs" DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sessions_org_deck_start ON sessions("orgId", "deckId", "startTs" DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sessions_user_start     ON sessions("userId", "startTs" DESC)`);
    // Migration: add activeToken for single-session enforcement
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "activeToken" TEXT`);
    // Migration: add audioSegments for per-card audio recording metadata
    await client.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS "audioSegments" JSONB`);

    // Migration: user profile fields (signup collects first/last name + phone; displayName stays the
    // canonical "First Last" string used everywhere else)
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "firstName" TEXT`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "lastName"  TEXT`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone       TEXT`);
    await client.query(`UPDATE users SET
      "firstName" = split_part("displayName", ' ', 1),
      "lastName"  = CASE WHEN position(' ' in "displayName") > 0
                         THEN substring("displayName" from position(' ' in "displayName") + 1) ELSE '' END
      WHERE "firstName" IS NULL`);

    // Migration: owner role — exactly one owner per org, enforced by a partial unique index
    // Only swap the CHECK when it predates 'owner' — re-adding it every boot would take an
    // ACCESS EXCLUSIVE lock on users and rescan the table on each deploy
    const roleCheck = await client.query(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'users_role_check' AND conrelid = 'users'::regclass"
    );
    if (!roleCheck.rows[0] || roleCheck.rows[0].def.indexOf("owner") === -1) {
      await client.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
      await client.query(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('owner','admin','user'))`);
    }
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_org_owner ON users("orgId") WHERE role = 'owner'`);
    // Orgs created before the owner role existed: promote their earliest admin
    const promoted = await client.query(`UPDATE users SET role = 'owner' WHERE id IN (
      SELECT DISTINCT ON ("orgId") id FROM users
      WHERE role = 'admin' AND "orgId" NOT IN (SELECT "orgId" FROM users WHERE role = 'owner')
      ORDER BY "orgId", "createdAt", id
    ) RETURNING id, "orgId"`);
    promoted.rows.forEach(function(r) { console.log("Owner migration: promoted " + r.id + " to owner of " + r.orgId); });

    // Migration: organization profile fields (editable by the owner)
    await client.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS industry    TEXT`);
    await client.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS website     TEXT`);
    await client.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS phone       TEXT`);
    await client.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS address     TEXT`);
    await client.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS "updatedAt" BIGINT`);
    // Branding: logo as a small data: URL (client downsizes to ≤256px) + accent colour (#rrggbb)
    await client.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS logo          TEXT`);
    await client.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS "accentColor" TEXT`);

    // Share codes — admins hand these to employees so they can sign up into the org
    await client.query(`CREATE TABLE IF NOT EXISTS org_invites (
      id          TEXT PRIMARY KEY,
      "orgId"     TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      code        TEXT NOT NULL UNIQUE,
      "createdBy" TEXT REFERENCES users(id) ON DELETE SET NULL,
      "createdAt" BIGINT NOT NULL,
      "expiresAt" BIGINT,
      "maxUses"   INTEGER,
      uses        INTEGER NOT NULL DEFAULT 0,
      "revokedAt" BIGINT
    )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_org_invites_orgId ON org_invites("orgId")`);

    // Session audio — stored apart from sessions so list queries (SELECT *) never pull blobs
    await client.query(`CREATE TABLE IF NOT EXISTS session_audio (
      "sessionId"  TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      "orgId"      TEXT NOT NULL,
      "mimeType"   TEXT NOT NULL,
      "durationMs" BIGINT,
      "sizeBytes"  INTEGER NOT NULL,
      data         BYTEA NOT NULL,
      "createdAt"  BIGINT NOT NULL
    )`);
    await client.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS "hasAudio"        BOOLEAN NOT NULL DEFAULT false`);
    await client.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS "audioDurationMs" BIGINT`);
    // Per-card chapter markers stored with the recording itself (copy of the session's segments)
    await client.query(`ALTER TABLE session_audio ADD COLUMN IF NOT EXISTS chapters JSONB`);
    // A live session can name another completed session as its reference
    await client.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS "referenceSessionId" TEXT`);

    // In-app notifications (currently: feedback left on one of your sessions)
    await client.query(`CREATE TABLE IF NOT EXISTS notifications (
      id          TEXT PRIMARY KEY,
      "userId"    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "orgId"     TEXT NOT NULL,
      type        TEXT NOT NULL,
      "sessionId" TEXT REFERENCES sessions(id) ON DELETE CASCADE,
      "actorId"   TEXT,
      "actorName" TEXT,
      text        TEXT,
      "createdAt" BIGINT NOT NULL,
      "readAt"    BIGINT
    )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications("userId", "createdAt" DESC)`);

    // Migrations table — tracks named one-time migrations so they run exactly once
    await client.query(`CREATE TABLE IF NOT EXISTS migrations (
      name       TEXT PRIMARY KEY,
      applied_at BIGINT NOT NULL
    )`);

    await client.query("COMMIT");

    // deck_dedup_v1 (a one-time cleanup that deleted every non-seed deck) is retired:
    // record it as applied so it can never run against a database holding real decks
    await pool.query("INSERT INTO migrations (name, applied_at) VALUES ('deck_dedup_v1', $1) ON CONFLICT DO NOTHING", [Date.now()]);

    // Numbered, run-once migrations (server/migrations/) — every schema change from here on
    await runMigrations(pool);
    return; // already committed above
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// ─── TRANSACTION HELPER ───────────────────────────────────────────────────────
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function uid(prefix) {
  return (prefix || "") + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function parseJsonField(val, fallback) {
  if (val === null || val === undefined) return fallback;
  if (typeof val === "string") { try { return JSON.parse(val); } catch(e) { return fallback; } }
  return val;
}

function parseDeck(row) {
  if (!row) return null;
  return Object.assign({}, row, {
    cards:      parseJsonField(row.cards,     {}),
    objStacks:  parseJsonField(row.objStacks, []),
    visibility: row.visibility || "public",
  });
}

function parseSession(row) {
  if (!row) return null;
  return Object.assign({}, row, {
    sold:          !!row.sold,
    events:        parseJsonField(row.events,        []),
    notes:         parseJsonField(row.notes,         []),
    metrics:       parseJsonField(row.metrics,       null),
    audioSegments: parseJsonField(row.audioSegments, null),
  });
}

// ─── USERS ────────────────────────────────────────────────────────────────────
async function findUserByEmail(email) {
  const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
  return rows[0] || null;
}

async function findUserById(id) {
  const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  return rows[0] || null;
}

async function updateLastLogin(userId) {
  await pool.query('UPDATE users SET "lastLoginAt" = $1 WHERE id = $2', [Date.now(), userId]);
}

async function getUserTeams(userId) {
  const { rows } = await pool.query('SELECT "teamId" FROM user_teams WHERE "userId" = $1', [userId]);
  return rows.map(function(r) { return r.teamId; });
}

async function getAdminTeamIds(userId) {
  const { rows } = await pool.query('SELECT "teamId" FROM team_admins WHERE "userId" = $1', [userId]);
  return rows.map(function(r) { return r.teamId; });
}

// The active session id (JWT "sid") is stored only as a SHA-256 hash, so a database
// read never yields a usable session identifier. null signs the user out everywhere.
function hashSid(sid) {
  return crypto.createHash("sha256").update(String(sid)).digest("hex");
}

async function setActiveToken(userId, sid) {
  await pool.query('UPDATE users SET "activeToken"=$1 WHERE id=$2', [sid ? hashSid(sid) : null, userId]);
}

async function clearActiveTokenIfMatches(userId, sid) {
  const r = await pool.query('UPDATE users SET "activeToken"=NULL WHERE id=$1 AND "activeToken"=$2', [userId, hashSid(sid)]);
  return r.rowCount > 0;
}

async function setUserTeams(userId, teamIds) {
  await withTransaction(async function(client) {
    await client.query('DELETE FROM user_teams WHERE "userId" = $1', [userId]);
    for (var i = 0; i < (teamIds || []).length; i++) {
      await client.query(
        'INSERT INTO user_teams ("userId","teamId") VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [userId, teamIds[i]]
      );
    }
  });
}

// One query: each user's team memberships come back as an array (was one query per user)
async function getOrgUsers(orgId) {
  const { rows } = await pool.query(
    'SELECT u.id,u."orgId",u."teamId",u.email,u."displayName",u."firstName",u."lastName",u.phone,u.role,u."createdAt",u."lastLoginAt",' +
    ' COALESCE((SELECT array_agg(ut."teamId" ORDER BY ut."teamId") FROM user_teams ut WHERE ut."userId" = u.id), \'{}\') AS "teamIds"' +
    ' FROM users u WHERE u."orgId" = $1 ORDER BY u."displayName"',
    [orgId]
  );
  return rows;
}

// db is the pool or a transaction client, so signup can create the user atomically with the org/invite
async function createUser({ id, orgId, teamId, email, passwordHash, firstName, lastName, phone, role, inviteId }, db) {
  const now   = Date.now();
  const newId = id || uid("u");
  await (db || pool).query(
    'INSERT INTO users (id,"orgId","teamId",email,"passwordHash","displayName","firstName","lastName",phone,role,"createdAt","inviteId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
    [newId, orgId, teamId || null, email, passwordHash, fullName(firstName, lastName), firstName, lastName, phone || null, role, now, inviteId || null]
  );
  const { rows } = await (db || pool).query("SELECT * FROM users WHERE id = $1", [newId]);
  return rows[0];
}

function fullName(firstName, lastName) {
  return [firstName, lastName].filter(Boolean).join(" ");
}

async function updateUser(id, orgId, fields) {
  const allowed = ["teamId", "displayName", "firstName", "lastName", "phone", "role", "passwordHash"];
  if (fields.firstName !== undefined || fields.lastName !== undefined) {
    // Keep displayName in sync with the name parts
    const cur = await findUserById(id);
    if (cur) {
      fields = Object.assign({}, fields, {
        displayName: fullName(
          fields.firstName !== undefined ? fields.firstName : cur.firstName,
          fields.lastName  !== undefined ? fields.lastName  : cur.lastName
        ),
      });
    }
  }
  const sets = [], vals = [];
  var p = 1;
  allowed.forEach(function(k) {
    if (fields[k] !== undefined) {
      sets.push('"' + k + '" = $' + p);
      vals.push(fields[k]);
      p++;
    }
  });
  if (!sets.length) return findUserById(id);
  vals.push(id, orgId);
  await pool.query(
    'UPDATE users SET ' + sets.join(", ") + ' WHERE id = $' + p + ' AND "orgId" = $' + (p + 1),
    vals
  );
  return findUserById(id);
}

// Their sessions stay (owner cleared), shares to/from them go — see migration 006
async function deleteUser(id, orgId) {
  await withTransaction(async function(client) {
    const r = await client.query('DELETE FROM users WHERE id = $1 AND "orgId" = $2', [id, orgId]);
    if (r.rowCount) await client.query('DELETE FROM deck_access WHERE "entityType" = \'user\' AND "entityId" = $1', [id]);
  });
}

// ─── ORGS ─────────────────────────────────────────────────────────────────────
async function findOrgById(id) {
  const { rows } = await pool.query("SELECT * FROM orgs WHERE id = $1", [id]);
  return rows[0] || null;
}

var ORG_FIELDS = ["name", "industry", "website", "phone", "address", "logo", "accentColor"];

async function createOrg(fields, db) {
  const oid = fields.id || uid("org_");
  const now = Date.now();
  await (db || pool).query(
    'INSERT INTO orgs (id,name,industry,website,phone,address,logo,"accentColor","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)',
    [oid, fields.name, fields.industry || null, fields.website || null, fields.phone || null, fields.address || null,
     fields.logo || null, fields.accentColor || null, now]
  );
  const { rows } = await (db || pool).query("SELECT * FROM orgs WHERE id = $1", [oid]);
  return rows[0];
}

async function updateOrg(id, fields) {
  const sets = [], vals = [];
  var p = 1;
  ORG_FIELDS.forEach(function(k) {
    if (fields[k] !== undefined) {
      sets.push('"' + k + '" = $' + p);   // k comes from the fixed ORG_FIELDS list
      vals.push(fields[k]);
      p++;
    }
  });
  if (!sets.length) return findOrgById(id);
  sets.push('"updatedAt" = $' + p); vals.push(Date.now()); p++;
  vals.push(id);
  await pool.query("UPDATE orgs SET " + sets.join(", ") + " WHERE id = $" + p, vals);
  return findOrgById(id);
}

async function getOrgOwner(orgId) {
  const { rows } = await pool.query(
    'SELECT id,"displayName",email FROM users WHERE "orgId" = $1 AND role = \'owner\'', [orgId]
  );
  return rows[0] || null;
}

// Swap ownership atomically: the old owner becomes an admin first so the
// one-owner-per-org unique index is never violated mid-transaction
async function transferOwnership(orgId, fromUserId, toUserId) {
  await withTransaction(async function(client) {
    const demoted = await client.query('UPDATE users SET role = \'admin\' WHERE id = $1 AND "orgId" = $2 AND role = \'owner\'', [fromUserId, orgId]);
    if (demoted.rowCount !== 1) { var e = new Error("Caller is no longer the owner"); e.code = "NOT_OWNER"; throw e; }
    const r = await client.query('UPDATE users SET role = \'owner\' WHERE id = $1 AND "orgId" = $2', [toUserId, orgId]);
    if (r.rowCount !== 1) throw new Error("Transfer target not found");
  });
}

// True when every id (users or teams) belongs to orgId — guards team/membership writes
// against cross-org ids. table is from a fixed whitelist, never user input.
// The subset of ids that belong to orgId (users or teams)
async function idsInOrg(table, ids, orgId) {
  if (["users", "teams"].indexOf(table) === -1) throw new Error("idsInOrg: bad table");
  var list = (ids || []).filter(function(id) { return typeof id === "string" && id; });
  if (!list.length) return [];
  const { rows } = await pool.query("SELECT id FROM " + table + ' WHERE id = ANY($1::text[]) AND "orgId" = $2', [list, orgId]);
  return rows.map(function(r) { return r.id; });
}

async function allInOrg(table, ids, orgId) {
  if (["users", "teams"].indexOf(table) === -1) throw new Error("allInOrg: bad table");
  var list = (ids || []).filter(Boolean);
  if (!list.length) return true;
  if (!list.every(function(id) { return typeof id === "string"; })) return false;
  const { rows } = await pool.query(
    "SELECT COUNT(DISTINCT id) AS n FROM " + table + ' WHERE id = ANY($1::text[]) AND "orgId" = $2',
    [list, orgId]
  );
  return parseInt(rows[0].n, 10) === new Set(list).size;
}

// Removes a demoted admin from every team they administered
async function removeTeamAdminEverywhere(userId) {
  await pool.query('DELETE FROM team_admins WHERE "userId" = $1', [userId]);
}

// ─── SHARE CODES (org invites) ────────────────────────────────────────────────
// Unambiguous alphabet (no 0/O/1/I/L) — 8 chars ≈ 40 bits, stored without the display dash
var INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateInviteCode() {
  var out = "";
  for (var i = 0; i < 8; i++) out += INVITE_ALPHABET[crypto.randomInt(INVITE_ALPHABET.length)];
  return out;
}

function normalizeInviteCode(code) {
  return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function createInvite({ orgId, createdBy, expiresAt, maxUses, label, teamId }) {
  // Retry on the (astronomically unlikely) unique collision
  for (var attempt = 0; attempt < 5; attempt++) {
    const id = uid("inv_");
    const code = generateInviteCode();
    try {
      await pool.query(
        'INSERT INTO org_invites (id,"orgId",code,"createdBy","createdAt","expiresAt","maxUses",label,"teamId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [id, orgId, code, createdBy, Date.now(), expiresAt || null, maxUses || null, label || null, teamId || null]
      );
      return getInvite(id, orgId);
    } catch (err) {
      if (err.code !== "23505") throw err;
    }
  }
  throw new Error("Could not generate a unique share code");
}

var INVITE_SELECT = 'SELECT i.*, (SELECT "displayName" FROM users WHERE id = i."createdBy") AS "createdByName",' +
  ' (SELECT name FROM teams WHERE id = i."teamId") AS "teamName",' +
  ' (SELECT COUNT(*)::int FROM users WHERE "inviteId" = i.id) AS "joinedCount"' +
  ' FROM org_invites i';

async function getOrgInvites(orgId) {
  const { rows } = await pool.query(INVITE_SELECT + ' WHERE i."orgId" = $1 ORDER BY i."createdAt" DESC', [orgId]);
  return rows;
}

async function getInvite(id, orgId) {
  const { rows } = await pool.query(INVITE_SELECT + ' WHERE i.id = $1 AND i."orgId" = $2', [id, orgId]);
  return rows[0] || null;
}

// Edit a code: label, team, expiry, max uses; reactivate clears a revoke
async function updateInvite(id, orgId, f) {
  var sets = [], vals = [], p = 1;
  function set(col, v) { sets.push(col + " = $" + (p++)); vals.push(v); }
  if (f.label !== undefined)     set("label", f.label || null);
  if (f.teamId !== undefined)    set('"teamId"', f.teamId || null);
  if (f.expiresAt !== undefined) set('"expiresAt"', f.expiresAt);
  if (f.maxUses !== undefined)   set('"maxUses"', f.maxUses);
  if (f.reactivate)              sets.push('"revokedAt" = NULL');
  if (sets.length) {
    vals.push(id, orgId);
    await pool.query('UPDATE org_invites SET ' + sets.join(", ") + ' WHERE id = $' + (p++) + ' AND "orgId" = $' + p, vals);
  }
  return getInvite(id, orgId);
}

// Who joined with this code
async function getInviteMembers(id, orgId) {
  const { rows } = await pool.query(
    'SELECT id, "displayName", email, role, "createdAt", "lastLoginAt" FROM users WHERE "inviteId" = $1 AND "orgId" = $2 ORDER BY "createdAt" DESC',
    [id, orgId]
  );
  return rows;
}

async function revokeInvite(id, orgId) {
  const r = await pool.query(
    'UPDATE org_invites SET "revokedAt" = $1 WHERE id = $2 AND "orgId" = $3 AND "revokedAt" IS NULL',
    [Date.now(), id, orgId]
  );
  return r.rowCount > 0;
}

var INVITE_USABLE_SQL = '"revokedAt" IS NULL AND ("expiresAt" IS NULL OR "expiresAt" > $2) AND ("maxUses" IS NULL OR uses < "maxUses")';

// Read-only lookup for the signup form ("You're joining Apex Sales"). Returns
// { ok:true, orgName, teamName } or { ok:false, reason: "unknown"|"revoked"|"expired"|"used_up" }
async function checkInvite(code) {
  const { rows } = await pool.query(
    'SELECT i.id, i."orgId", i."revokedAt", i."expiresAt", i."maxUses", i.uses, o.name AS "orgName",' +
    ' (SELECT name FROM teams WHERE id = i."teamId") AS "teamName"' +
    ' FROM org_invites i JOIN orgs o ON o.id = i."orgId" WHERE i.code = $1',
    [normalizeInviteCode(code)]
  );
  var i = rows[0];
  if (!i) return { ok: false, reason: "unknown" };
  if (i.revokedAt) return { ok: false, reason: "revoked" };
  if (i.expiresAt && i.expiresAt <= Date.now()) return { ok: false, reason: "expired" };
  if (i.maxUses != null && i.uses >= i.maxUses) return { ok: false, reason: "used_up" };
  return { ok: true, orgName: i.orgName, teamName: i.teamName || null };
}

// Signup with a share code: claim one use of the code and create the user in one transaction,
// so a failed insert (e.g. duplicate email) never burns a use. Returns null if the code is unusable.
async function signupWithInvite(code, userFields) {
  return withTransaction(async function(client) {
    const claimed = await client.query(
      'UPDATE org_invites SET uses = uses + 1 WHERE code = $1 AND ' + INVITE_USABLE_SQL + ' RETURNING id, "orgId", "teamId"',
      [normalizeInviteCode(code), Date.now()]
    );
    var inv = claimed.rows[0];
    if (!inv) return null;
    const user = await createUser(Object.assign({}, userFields, { orgId: inv.orgId, role: "user", teamId: inv.teamId, inviteId: inv.id }), client);
    // The code's team (if it still exists) — membership as well as the primary team
    if (inv.teamId) await client.query('INSERT INTO user_teams ("userId","teamId") VALUES ($1,$2) ON CONFLICT DO NOTHING', [user.id, inv.teamId]);
    return user;
  });
}

// Org creation (master code already verified): org + its owner in one transaction
async function createOrgWithOwner(orgFields, ownerFields) {
  return withTransaction(async function(client) {
    const org  = await createOrg(orgFields, client);
    const user = await createUser(Object.assign({}, ownerFields, { orgId: org.id, role: "owner" }), client);
    return { org: org, user: user };
  });
}

// ─── TEAMS ────────────────────────────────────────────────────────────────────
async function getTeamAdmins(teamId) {
  const { rows } = await pool.query('SELECT "userId" FROM team_admins WHERE "teamId" = $1', [teamId]);
  return rows.map(function(r) { return r.userId; });
}

async function setTeamAdmins(teamId, adminIds) {
  await withTransaction(async function(client) {
    await client.query('DELETE FROM team_admins WHERE "teamId" = $1', [teamId]);
    for (var i = 0; i < (adminIds || []).length; i++) {
      await client.query(
        'INSERT INTO team_admins ("teamId","userId") VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [teamId, adminIds[i]]
      );
    }
  });
}

// One query for the whole org: member and admin ids are aggregated per team
async function getOrgTeams(orgId) {
  const { rows } = await pool.query(
    'SELECT t.*,' +
    ' COALESCE((SELECT array_agg(ut."userId") FROM user_teams ut WHERE ut."teamId" = t.id), \'{}\') AS "memberIds",' +
    ' COALESCE((SELECT array_agg(ta."userId") FROM team_admins ta WHERE ta."teamId" = t.id), \'{}\') AS "adminIds"' +
    ' FROM teams t WHERE t."orgId" = $1 ORDER BY t.name', [orgId]);
  return rows;
}
// Just {id, name} for a set of team ids (auth responses don't need membership)
async function getTeamNames(ids) {
  if (!ids || !ids.length) return [];
  const { rows } = await pool.query('SELECT id, name FROM teams WHERE id = ANY($1) ORDER BY name', [ids]);
  return rows;
}

async function getTeamById(id) {
  const { rows } = await pool.query("SELECT * FROM teams WHERE id = $1", [id]);
  if (!rows[0]) return null;
  var t          = rows[0];
  var memberRows = await pool.query('SELECT "userId" FROM user_teams WHERE "teamId" = $1', [id]);
  var memberIds  = memberRows.rows.map(function(r) { return r.userId; });
  var adminIds   = await getTeamAdmins(id);
  return Object.assign({}, t, { adminIds: adminIds, memberIds: memberIds });
}

async function createTeam({ orgId, name, adminIds }) {
  const id = uid("team_");
  await pool.query(
    'INSERT INTO teams (id,"orgId",name,"createdAt") VALUES ($1,$2,$3,$4)',
    [id, orgId, name, Date.now()]
  );
  await setTeamAdmins(id, adminIds || []);
  return getTeamById(id);
}

async function updateTeam(id, orgId, fields) {
  if (fields.name) {
    await pool.query('UPDATE teams SET name = $1 WHERE id = $2 AND "orgId" = $3', [fields.name, id, orgId]);
  }
  if (fields.adminIds !== undefined) {
    await setTeamAdmins(id, fields.adminIds);
  }
  return getTeamById(id);
}

async function deleteTeam(id, orgId) {
  await withTransaction(async function(client) {
    const r = await client.query('DELETE FROM teams WHERE id = $1 AND "orgId" = $2', [id, orgId]);
    if (r.rowCount) await client.query('DELETE FROM deck_access WHERE "entityType" = \'team\' AND "entityId" = $1', [id]);
  });
}

// ─── DECKS ────────────────────────────────────────────────────────────────────
// Access lists for many decks in one query → { deckId: [{entityType, entityId}] }
async function getDeckAccessMap(deckIds) {
  var map = {};
  deckIds.forEach(function(id) { map[id] = []; });
  if (!deckIds.length) return map;
  const { rows } = await pool.query(
    'SELECT "deckId","entityType","entityId" FROM deck_access WHERE "deckId" = ANY($1)', [deckIds]
  );
  rows.forEach(function(r) { map[r.deckId].push({ entityType:r.entityType, entityId:r.entityId }); });
  return map;
}
async function getDeckAccess(deckId) {
  const { rows } = await pool.query(
    'SELECT "entityType","entityId" FROM deck_access WHERE "deckId" = $1', [deckId]
  );
  return rows;
}

async function setDeckAccess(deckId, accessList) {
  await withTransaction(async function(client) {
    await client.query('DELETE FROM deck_access WHERE "deckId" = $1', [deckId]);
    for (var i = 0; i < (accessList || []).length; i++) {
      var a = accessList[i];
      await client.query(
        'INSERT INTO deck_access ("deckId","entityType","entityId") VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [deckId, a.entityType, a.entityId]
      );
    }
  });
}

// ─── DECK PERMISSIONS ─────────────────────────────────────────────────────────
// See:    the owner every deck. Anyone else: decks they created or may edit, plus active
//         decks that are org-wide (public) or assigned (private) to one of their teams or
//         to them. "Their teams" = member of, plus (admins) teams they administer.
//         Archived decks are seen only by those who may edit them (to restore them).
// Edit:   the owner; an admin who created the deck; admins listed in deck_editors.
// Manage: (teams / visibility / editors) the owner and the deck's creator.
async function getDeckEditorsMap(deckIds) {
  var map = {};
  deckIds.forEach(function(id) { map[id] = []; });
  if (!deckIds.length) return map;
  const { rows } = await pool.query('SELECT "deckId","userId" FROM deck_editors WHERE "deckId" = ANY($1::text[])', [deckIds]);
  rows.forEach(function(r) { if (map[r.deckId]) map[r.deckId].push(r.userId); });
  return map;
}

async function viewerTeamIds(user) {
  return isAdminRoleName(user.role) ? getMemberOrAdminTeamIds(user.id) : getUserTeams(user.id);
}
function isAdminRoleName(role) { return role === "admin" || role === "owner"; }

// deck needs createdBy, visibility, archivedAt, accessList, editorIds
function deckPermsFor(deck, user, teamIds) {
  if (user.role === "owner") return { see: true, edit: true, manage: true };
  var admin = isAdminRoleName(user.role);
  var creator = deck.createdBy === user.id;
  var edit = admin && (creator || (deck.editorIds || []).indexOf(user.id) > -1);
  var assigned = deck.visibility !== "private" || (deck.accessList || []).some(function(a) {
    return (a.entityType === "user" && a.entityId === user.id) || (a.entityType === "team" && teamIds.indexOf(a.entityId) > -1);
  });
  var see = edit || (!deck.archivedAt && (assigned || (admin && creator)));
  return { see: see, edit: edit, manage: admin && creator };
}

// ─── OBJECTION STACK PERMISSIONS ─────────────────────────────────────────────
// Stacks follow the deck rules one level down. Each stack (JSON inside decks."objStacks")
// carries createdBy, visibility ("public"|"private"), accessList and editorIds.
//   See:    whoever sees the deck, when the stack is org-wide or assigned to them/their team
//           (archived stacks only for those who may edit them).
//   Edit:   the owner; an admin who created the stack or is one of its editors. Deck editors
//           don't edit other people's stacks — they may add new stacks of their own.
//   Manage: (visibility / assignees / editors) the owner and the stack's creator.
function stackPermsFor(stack, deckPerms, user, teamIds) {
  if (user.role === "owner") return { see: true, edit: true, manage: true };
  if (!deckPerms || !deckPerms.see) return { see: false, edit: false, manage: false };
  var admin = isAdminRoleName(user.role);
  var creator = !!stack.createdBy && stack.createdBy === user.id;
  var edit = admin && (creator || (stack.editorIds || []).indexOf(user.id) > -1);
  var assigned = stack.visibility !== "private" || (stack.accessList || []).some(function(a) {
    return (a.entityType === "user" && a.entityId === user.id) || (a.entityType === "team" && teamIds.indexOf(a.entityId) > -1);
  });
  return { see: edit || (!stack.archivedAt && assigned), edit: edit, manage: admin && creator };
}

// The stacks of a deck as this user receives them: hidden ones dropped, canEdit/canManage
// attached, assignees and editors only for the stack's managers
function viewStacks(stacks, deckPerms, user, teamIds) {
  var out = [];
  (stacks || []).forEach(function(st) {
    if (!st || typeof st !== "object") return;
    var p = stackPermsFor(st, deckPerms, user, teamIds);
    if (!p.see) return;
    var v = Object.assign({}, st, { canEdit: p.edit, canManage: p.manage });
    if (!p.manage) { delete v.accessList; delete v.editorIds; }
    out.push(v);
  });
  return out;
}

// A deck shaped for this user (stack filtering + flags; deck access lists for managers only)
function viewDeck(deck, perms, user, teamIds) {
  var d = Object.assign({}, deck);
  d.canEdit = perms.edit;
  d.canManage = perms.manage;
  d.objStacks = viewStacks(deck.objStacks, perms, user, teamIds);
  if (!perms.manage) { delete d.accessList; delete d.editorIds; }
  return d;
}

// The decks this user may see, in the org's order, each with canEdit / canManage
async function getOrgDecks(orgId, user) {
  // The owner's order (Deck switcher / Home drag-to-reorder); name breaks ties
  const { rows } = await pool.query('SELECT * FROM decks WHERE "orgId" = $1 ORDER BY "sortIndex" NULLS LAST, name, id', [orgId]);
  var ids = rows.map(function(r) { return r.id; });
  var loaded = await Promise.all([
    getDeckAccessMap(ids), getDeckEditorsMap(ids),
    user && user.role !== "owner" ? viewerTeamIds(user) : Promise.resolve([]),
  ]);
  var access = loaded[0], editors = loaded[1], teamIds = loaded[2];
  var out = [];
  rows.forEach(function(r) {
    var deck = parseDeck(r);
    deck.accessList = access[r.id];
    deck.editorIds = editors[r.id];
    if (!user) { out.push(deck); return; }
    var p = deckPermsFor(deck, user, teamIds);
    if (!p.see) return;
    // Who a deck is assigned to and who may edit it is for its managers (same rule as
    // GET /decks/:id/access); stacks are filtered the same way one level down
    out.push(viewDeck(deck, p, user, teamIds));
  });
  return out;
}

// { see, edit, manage } for one deck (null when the deck isn't in the user's org)
async function deckPermissions(deckId, user) {
  const deck = await getDeckById(deckId);
  if (!deck || deck.orgId !== user.orgId) return null;
  var loaded = await Promise.all([getDeckEditorsMap([deck.id]), user.role === "owner" ? Promise.resolve([]) : viewerTeamIds(user)]);
  deck.editorIds = loaded[0][deck.id];
  var teamIds = loaded[1];
  return Object.assign({ deck: deck, teamIds: teamIds }, deckPermsFor(deck, user, teamIds));
}

// May this user run a session on this deck? The same "see" rule (archived decks only with
// opts.allowArchived — a run saved after its deck was archived mid-call).
async function deckUsableBy(deckId, user, opts) {
  if (typeof deckId !== "string" || !deckId) return null;
  const { rows } = await pool.query(
    'SELECT id,"orgId",name,color,icon,visibility,"archivedAt","createdBy" FROM decks WHERE id = $1 AND "orgId" = $2', [deckId, user.orgId]
  );
  const deck = rows[0];
  if (!deck) return null;
  if (user.role === "owner") return deck;
  // Hot path (every session start/save): an active org-wide deck needs no more lookups
  if (deck.visibility !== "private" && (!deck.archivedAt || (opts && opts.allowArchived))) return deck;
  var loaded = await Promise.all([getDeckAccess(deck.id), getDeckEditorsMap([deck.id]), viewerTeamIds(user)]);
  deck.accessList = loaded[0];
  deck.editorIds = loaded[1][deck.id];
  var teamIds = loaded[2];
  var p = deckPermsFor(Object.assign({}, deck, { archivedAt: opts && opts.allowArchived ? null : deck.archivedAt }), user, teamIds);
  return p.see ? deck : null;
}

// Replace a deck's editor list (admins of the deck's org only; the creator and the owner
// need no entry)
// An admin demoted to user loses every edit grant (they'd come back on re-promotion otherwise)
async function removeDeckEditorEverywhere(userId) {
  await pool.query('DELETE FROM deck_editors WHERE "userId" = $1', [userId]);
}

async function setDeckEditors(deckId, userIds) {
  await withTransaction(async function(client) {
    await client.query('DELETE FROM deck_editors WHERE "deckId" = $1', [deckId]);
    if (userIds.length) {
      await client.query('INSERT INTO deck_editors ("deckId","userId") SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING', [deckId, userIds]);
    }
  });
}

async function getDeckById(id) {
  const { rows } = await pool.query("SELECT * FROM decks WHERE id = $1", [id]);
  var deck = parseDeck(rows[0] || null);
  if (deck) deck.accessList = await getDeckAccess(id);
  return deck;
}

async function createDeck({ orgId, createdBy, name, color, icon, visibility, rootCard, cards, objStacks }) {
  const id  = uid("d");
  const now = Date.now();
  await pool.query(
    // New decks go to the end of the org's order
    "INSERT INTO decks (id,\"orgId\",\"createdBy\",name,color,icon,\"rootCard\",cards,\"objStacks\",visibility,\"updatedAt\",\"createdAt\",\"sortIndex\")" +
    " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,(SELECT COALESCE(MAX(\"sortIndex\"), -1) + 1 FROM decks WHERE \"orgId\" = $2))",
    [id, orgId, createdBy, name, color || "#F5A623", icon || "💼", rootCard || null,
     JSON.stringify(cards || {}), JSON.stringify(objStacks || []), visibility || "public", now, now]
  );
  return getDeckById(id);
}

// Store the owner's deck order. ids lists decks in their new order; unknown ids are
// ignored and any org deck not listed keeps its relative place after the listed ones.
async function setDeckOrder(orgId, ids) {
  await withTransaction(async function(client) {
    const { rows } = await client.query('SELECT id FROM decks WHERE "orgId" = $1 ORDER BY "sortIndex" NULLS LAST, name, id FOR UPDATE', [orgId]);
    var all = rows.map(function(r) { return r.id; });
    var known = new Set(all), seen = new Set(), order = [];
    ids.forEach(function(id) { if (known.has(id) && !seen.has(id)) { seen.add(id); order.push(id); } });
    all.forEach(function(id) { if (!seen.has(id)) order.push(id); });
    await client.query(
      'UPDATE decks d SET "sortIndex" = o.pos - 1 FROM unnest($1::text[]) WITH ORDINALITY AS o(id, pos) WHERE d.id = o.id AND d."orgId" = $2',
      [order, orgId]
    );
  });
}

async function setDeckArchived(id, orgId, ts) {
  await pool.query('UPDATE decks SET "archivedAt"=$1 WHERE id=$2 AND "orgId"=$3', [ts, id, orgId]);
  return getDeckById(id);
}

async function updateDeck(id, orgId, deck) {
  const now = Date.now();
  await pool.query(
    'UPDATE decks SET name=$1,color=$2,icon=$3,"rootCard"=$4,cards=$5,"objStacks"=$6,visibility=$7,"updatedAt"=$8 WHERE id=$9 AND "orgId"=$10',
    [
      deck.name, deck.color, deck.icon,
      deck.rootCard || null,
      JSON.stringify(deck.cards    || {}),
      JSON.stringify(deck.objStacks || []),
      deck.visibility || "public",
      now, id, orgId,
    ]
  );
  return getDeckById(id);
}

async function deleteDeck(id, orgId) {
  await pool.query('DELETE FROM decks WHERE id = $1 AND "orgId" = $2', [id, orgId]);
}

// ─── PASSWORD RESETS ──────────────────────────────────────────────────────────
var RESET_TTL_MS = 60 * 60 * 1000;   // 1 hour

function hashResetToken(token) { return crypto.createHash("sha256").update(String(token)).digest("hex"); }

// Issue a one-time reset token for userId (createdBy: the admin, or null for the owner
// recovery command). Earlier unused tokens for the user stop working. Returns the raw token
// — it is never stored and can't be recovered later.
async function createPasswordReset(userId, createdBy) {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  await withTransaction(async function(client) {
    await client.query('UPDATE password_resets SET "usedAt"=$1 WHERE "userId"=$2 AND "usedAt" IS NULL', [now, userId]);
    await client.query(
      'INSERT INTO password_resets (id,"userId","tokenHash","createdBy","createdAt","expiresAt") VALUES ($1,$2,$3,$4,$5,$6)',
      [uid("pr"), userId, hashResetToken(token), createdBy || null, now, now + RESET_TTL_MS]
    );
  });
  return { token: token, expiresAt: now + RESET_TTL_MS };
}

// The usable reset for a raw token, with who it is for — or null (unknown, used, expired)
async function findPasswordReset(token) {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
  const { rows } = await pool.query(
    'SELECT r.id, r."userId", r."expiresAt", u."firstName", u.email, o.name AS "orgName"' +
    ' FROM password_resets r JOIN users u ON u.id = r."userId" JOIN orgs o ON o.id = u."orgId"' +
    ' WHERE r."tokenHash" = $1 AND r."usedAt" IS NULL AND r."expiresAt" > $2',
    [hashResetToken(token), Date.now()]
  );
  return rows[0] || null;
}

// Spend the token and set the new password in one transaction. Signs the user out
// everywhere (activeToken cleared). false when the token was already used / expired.
async function usePasswordReset(token, passwordHash) {
  return withTransaction(async function(client) {
    const r = await client.query(
      'UPDATE password_resets SET "usedAt"=$1 WHERE "tokenHash"=$2 AND "usedAt" IS NULL AND "expiresAt" > $1 RETURNING "userId"',
      [Date.now(), hashResetToken(token)]
    );
    if (!r.rows[0]) return null;
    const userId = r.rows[0].userId;
    await client.query('UPDATE users SET "passwordHash"=$1, "activeToken"=NULL WHERE id=$2', [passwordHash, userId]);
    return userId;
  });
}

// Cancel a user's outstanding reset links (their role changed — a link issued under the old
// rules must not outlive them)
async function expirePasswordResets(userId) {
  await pool.query('UPDATE password_resets SET "usedAt"=$1 WHERE "userId"=$2 AND "usedAt" IS NULL', [Date.now(), userId]);
}

async function setPasswordHash(userId, passwordHash) {
  await pool.query('UPDATE users SET "passwordHash"=$1 WHERE id=$2', [passwordHash, userId]);
}

// ─── SESSIONS ─────────────────────────────────────────────────────────────────
function buildSessionWhere(scope, orgId, userId, filters) {
  const conds = [];
  const vals  = [];
  var p = 1;
  function push(val) { vals.push(val); return "$" + (p++); }

  if (scope === "self" || !scope) {
    conds.push('"userId" = ' + push(userId));
  } else if (scope.type === "user") {
    conds.push('"userId" = ' + push(scope.userId));
    conds.push('"orgId" = '  + push(orgId));
  } else if (scope.type === "users" && scope.userIds && scope.userIds.length) {
    var phs = scope.userIds.map(function(id) { return push(id); });
    conds.push('"userId" IN (' + phs.join(",") + ')');
    conds.push('"orgId" = ' + push(orgId));
  } else if (scope.type === "team") {
    conds.push('"userId" IN (SELECT "userId" FROM user_teams WHERE "teamId" = ' + push(scope.teamId) + ')');
    conds.push('"orgId" = ' + push(orgId));
  } else if (scope.type === "org") {
    conds.push('"orgId" = ' + push(orgId));
  } else {
    conds.push('"userId" = ' + push(userId));
  }

  // In-progress runs are only shown in the live monitor (GET /sessions/live)
  conds.push("status <> 'active'");
  if (filters.deckId)  { conds.push('"deckId" = ' + push(filters.deckId)); }
  if (filters.mode)    { conds.push('mode = '      + push(filters.mode));   }
  if (filters.outcome) { conds.push('outcome = '   + push(filters.outcome)); }
  // Invalid dates are ignored rather than sending NaN to a BIGINT column
  if (filters.from) {
    const d = new Date(filters.from); d.setHours(0, 0, 0, 0);
    if (!isNaN(d.getTime())) conds.push('"startTs" >= ' + push(d.getTime()));
  }
  if (filters.to) {
    const d = new Date(filters.to); d.setHours(23, 59, 59, 999);
    if (!isNaN(d.getTime())) conds.push('"startTs" <= ' + push(d.getTime()));
  }

  return { where: conds.length ? " WHERE " + conds.join(" AND ") : "", vals };
}

// Feedback/share counts are joined per row (indexed on "sessionId") so a list is one query
function sessionCountsSql(tbl) {
  return ' LEFT JOIN LATERAL (SELECT COUNT(*) AS "feedbackCount", MAX(f."updatedAt") AS "latestFeedbackAt"' +
    ' FROM session_feedback f WHERE f."sessionId" = ' + tbl + '.id) fb ON true';
}

// viewer = { id, role } of the caller — decides which highlights are attached
async function getSessions(scope, orgId, userId, filters, viewer) {
  const f = filters || {};
  var isOwner = !!(viewer && viewer.role === "owner");
  // sessions stays unaliased: buildSessionWhere's bare column names resolve to it
  // (the lateral joins only expose their own columns)
  const { where, vals } = buildSessionWhere(scope, orgId, userId, f);
  vals.push(userId);
  var viewerRef = "$" + vals.length;
  var limit = parseInt(f.limit, 10);
  var limitSql = limit > 0 ? " LIMIT " + Math.min(limit, 1000) : "";
  const ownQuery = pool.query(
    'SELECT sessions.*, COALESCE((SELECT "displayName" FROM users WHERE users.id = sessions."userId"), \'Former member\') AS "userName",' +
    ' fb."feedbackCount", fb."latestFeedbackAt", sh."shareCount", hl.*' +
    ' FROM sessions' + sessionCountsSql("sessions") +
    ' LEFT JOIN LATERAL (SELECT COUNT(*) AS "shareCount" FROM session_shares x WHERE x."sessionId" = sessions.id) sh ON true' +
    highlightJoinSql("sessions", viewerRef, isOwner) +
    where + ' ORDER BY sessions."startTs" DESC' + limitSql, vals
  );
  const sharedQuery = (!scope || scope === "self") ? getSharedWithUser(userId, orgId, f, limitSql, isOwner) : Promise.resolve([]);
  const [ownRes, sharedRows] = await Promise.all([ownQuery, sharedQuery]);
  const result = ownRes.rows.map(function(row) {
    var sess = withHighlight(parseSession(row), row);
    sess.feedbackCount = row.feedbackCount || 0;
    sess.shareCount    = row.shareCount || 0;
    return sess;
  });

  // For self-scope, also include sessions shared with this user
  if (sharedRows.length) {
    const ownIds = new Set(result.map(function(s) { return s.id; }));
    sharedRows.forEach(function(row) {
      if (ownIds.has(row.id)) return;
      const parsed = withHighlight(parseSession(row), row);
      parsed.feedbackCount     = row.feedbackCount || 0;
      delete parsed.shareCount;
      parsed._shared           = true;
      parsed._shareContext     = row._shareContext     || null;
      parsed._shareFromUserId  = row._shareFromUserId  || null;
      parsed._shareFromName    = row._shareFromName    || null;
      result.push(parsed);
    });
    result.sort(function(a, b) { return b.startTs - a.startTs; });
    if (limit > 0 && result.length > limit) result.length = limit;
  }
  return result;
}

// Sessions other users shared with userId (same filters as the caller's own list)
// Shares are only ever created inside one org; the orgId filter makes that a guarantee
async function getSharedWithUser(userId, orgId, f, limitSql, isOwner) {
  const sharedConds = ['ss."toUserId" = $1', 's."orgId" = $2', "s.status <> 'active'"];
  const sharedVals  = [userId, orgId];
  var sp = 3;
  function spush(val) { sharedVals.push(val); return "$" + (sp++); }
  if (f.deckId)  { sharedConds.push('s."deckId" = '  + spush(f.deckId)); }
  if (f.mode)    { sharedConds.push('s.mode = '      + spush(f.mode)); }
  if (f.outcome) { sharedConds.push('s.outcome = '   + spush(f.outcome)); }
  if (f.from) {
    const d = new Date(f.from); d.setHours(0, 0, 0, 0);
    if (!isNaN(d.getTime())) sharedConds.push('s."startTs" >= ' + spush(d.getTime()));
  }
  if (f.to) {
    const d = new Date(f.to); d.setHours(23, 59, 59, 999);
    if (!isNaN(d.getTime())) sharedConds.push('s."startTs" <= ' + spush(d.getTime()));
  }
  const sharedSql =
    'SELECT s.*, ss.context AS "_shareContext", ss."fromUserId" AS "_shareFromUserId",' +
    ' (SELECT "displayName" FROM users WHERE id = ss."fromUserId") AS "_shareFromName",' +
    ' COALESCE((SELECT "displayName" FROM users WHERE id = s."userId"), \'Former member\') AS "userName",' +
    ' fb."feedbackCount", fb."latestFeedbackAt", hl.*' +
    ' FROM sessions s JOIN session_shares ss ON ss."sessionId" = s.id' + sessionCountsSql("s") +
    highlightJoinSql("s", "$1", isOwner) +
    ' WHERE ' + sharedConds.join(" AND ");
  const { rows } = await pool.query(sharedSql + ' ORDER BY s."startTs" DESC' + limitSql, sharedVals);
  return rows;
}

// ─── SESSION HIGHLIGHTS ───────────────────────────────────────────────────────
// Who sees a highlight: the org's owner sees every one; everyone else (admins too)
// sees org-wide highlights plus those of teams they belong to or administer.
// `h` is the session_highlights alias, `userRef` the SQL parameter holding the user id.
function highlightVisibleSql(h, userRef, isOwner) {
  // Always true, but still references the parameter — Postgres rejects unused bind values
  if (isOwner) return "(" + userRef + "::text IS NOT NULL)";
  return "(" + h + ".scope = 'org' OR " + h + '."teamId" IN (SELECT "teamId" FROM user_teams WHERE "userId" = ' + userRef +
    ' UNION SELECT "teamId" FROM team_admins WHERE "userId" = ' + userRef + "))";
}

// LEFT JOIN that adds hl* columns for the session's highlight — only when the caller can see it
function highlightJoinSql(tbl, userRef, isOwner) {
  return ' LEFT JOIN LATERAL (SELECT h.scope AS "hlScope", h."teamId" AS "hlTeamId", h.note AS "hlNote", h."createdAt" AS "hlAt",' +
    ' (SELECT name FROM teams t WHERE t.id = h."teamId") AS "hlTeamName",' +
    ' (SELECT "displayName" FROM users u WHERE u.id = h."createdBy") AS "hlByName"' +
    ' FROM session_highlights h WHERE h."sessionId" = ' + tbl + '.id AND h."orgId" = ' + tbl + '."orgId"' +
    ' AND ' + highlightVisibleSql("h", userRef, isOwner) + ') hl ON true';
}

// Moves the hl* columns into session.highlight ({ scope, teamId, teamName, note, createdAt, createdByName } | null)
function withHighlight(sess, row) {
  if (!sess) return sess;
  sess.highlight = row.hlScope ? {
    scope: row.hlScope, teamId: row.hlTeamId || null, teamName: row.hlTeamName || null,
    note: row.hlNote || null, createdAt: row.hlAt, createdByName: row.hlByName || null,
  } : null;
  ["hlScope", "hlTeamId", "hlNote", "hlAt", "hlTeamName", "hlByName"].forEach(function(k) { delete sess[k]; });
  return sess;
}

// Highlighted sessions the viewer may see, newest highlight first
async function getHighlights(viewer, opts) {
  var o = opts || {};
  var isOwner = viewer.role === "owner";
  var vals = [viewer.orgId, viewer.id];
  var conds = ['s."orgId" = $1', "s.status <> 'active'"];
  if (o.deckId) { vals.push(o.deckId); conds.push('s."deckId" = $' + vals.length); }
  var limit = parseInt(o.limit, 10);
  var limitSql = " LIMIT " + (limit > 0 ? Math.min(limit, 200) : 200);
  const { rows } = await pool.query(
    'SELECT s.*, COALESCE((SELECT "displayName" FROM users WHERE users.id = s."userId"), \'Former member\') AS "userName",' +
    ' fb."feedbackCount", fb."latestFeedbackAt", hl.*' +
    ' FROM sessions s' + sessionCountsSql("s") + highlightJoinSql("s", "$2", isOwner) +
    ' WHERE hl."hlScope" IS NOT NULL AND ' + conds.join(" AND ") +
    ' ORDER BY hl."hlAt" DESC' + limitSql, vals
  );
  return rows.map(function(row) {
    var sess = withHighlight(parseSession(row), row);
    sess.feedbackCount = row.feedbackCount || 0;
    sess._highlight = true;
    return sess;
  });
}

async function getHighlight(sessionId) {
  const { rows } = await pool.query('SELECT * FROM session_highlights WHERE "sessionId" = $1', [sessionId]);
  return rows[0] || null;
}

async function isHighlightVisibleTo(sessionId, user) {
  const { rows } = await pool.query(
    'SELECT 1 FROM session_highlights h WHERE h."sessionId" = $1 AND h."orgId" = $2 AND ' +
    highlightVisibleSql("h", "$3", user.role === "owner") + " LIMIT 1",
    [sessionId, user.orgId, user.id]
  );
  return rows.length > 0;
}

// Teams a user belongs to or administers (the teams an admin may highlight for)
async function getMemberOrAdminTeamIds(userId) {
  const { rows } = await pool.query(
    'SELECT "teamId" FROM user_teams WHERE "userId" = $1 UNION SELECT "teamId" FROM team_admins WHERE "userId" = $1', [userId]);
  return rows.map(function(r) { return r.teamId; });
}

// Create or change a session's highlight (keeps the original highlight time on edits)
async function setHighlight(h) {
  await pool.query(
    'INSERT INTO session_highlights ("sessionId","orgId",scope,"teamId",note,"createdBy","createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7)' +
    ' ON CONFLICT ("sessionId") DO UPDATE SET scope = $3, "teamId" = $4, note = $5, "createdBy" = $6',
    [h.sessionId, h.orgId, h.scope, h.teamId || null, h.note || null, h.createdBy, Date.now()]
  );
}

async function clearHighlight(sessionId, orgId) {
  await pool.query('DELETE FROM session_highlights WHERE "sessionId" = $1 AND "orgId" = $2', [sessionId, orgId]);
}

async function getSessionById(id) {
  const { rows } = await pool.query("SELECT * FROM sessions WHERE id = $1", [id]);
  return parseSession(rows[0] || null);
}

async function upsertSession(session, userId, orgId) {
  const { rows } = await pool.query(`
    INSERT INTO sessions (id,"orgId","userId","deckId","deckName","deckColor","deckIcon",
      name,account,contact,mode,status,outcome,"startTs","endTs",sold,"soldCardId","soldCardTitle",
      events,notes,metrics,"audioSegments","audioDurationMs","referenceSessionId")
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
    ON CONFLICT (id) DO UPDATE SET
      "deckId"=$4,"deckName"=$5,"deckColor"=$6,"deckIcon"=$7,
      name=$8,account=$9,contact=$10,mode=$11,status=$12,outcome=$13,
      "startTs"=$14,"endTs"=$15,sold=$16,"soldCardId"=$17,"soldCardTitle"=$18,
      events=$19,notes=$20,metrics=$21,"audioSegments"=$22,
      "audioDurationMs"=COALESCE($23, sessions."audioDurationMs"),
      "referenceSessionId"=COALESCE($24, sessions."referenceSessionId")
    WHERE sessions."userId"=$3
    RETURNING *
  `, [
    session.id, orgId, userId,
    session.deckId, session.deckName, session.deckColor || "#F5A623", session.deckIcon || "💼",
    session.name, session.account || null, session.contact || null,
    session.mode || "live", session.status || "completed", session.outcome || "completed",
    session.startTs, session.endTs || null, session.sold ? true : false,
    session.soldCardId || null, session.soldCardTitle || null,
    JSON.stringify(session.events || []), JSON.stringify(session.notes || []), JSON.stringify(session.metrics || null),
    JSON.stringify(session.audioSegments || null),
    Number.isFinite(session.audioDurationMs) ? Math.round(session.audioDurationMs) : null,
    typeof session.referenceSessionId === "string" && session.referenceSessionId ? session.referenceSessionId : null,
  ]);
  return rows[0] ? parseSession(rows[0]) : null;
}

// ─── LIVE SESSIONS ────────────────────────────────────────────────────────────
// A run is stored when it starts (status 'active', outcome 'in_progress'), refreshed by
// heartbeats, and completed by the normal upsert when the rep finishes. Runs whose
// heartbeat stops are closed as 'abandoned' by closeActiveSessions (events kept).
var LIVE_COLS = 's.id, s."orgId", s."userId", s."deckId", s."deckName", s."deckColor", s."deckIcon", s.name, s.account,' +
  ' s.mode, s."startTs", s."lastBeatTs", s.live, s.events, s."referenceSessionId"';
// The same row shape straight from an INSERT/UPDATE … RETURNING (saves a re-read per heartbeat)
var LIVE_RETURNING = 'RETURNING id, "orgId", "userId", "deckId", "deckName", "deckColor", "deckIcon", name, account,' +
  ' mode, "startTs", "lastBeatTs", live, events, "referenceSessionId",' +
  ' (SELECT "displayName" FROM users WHERE users.id = sessions."userId") AS "userName"';

async function startLiveSession(session, userId, orgId) {
  const now = Date.now();
  const { rows } = await pool.query(`
    INSERT INTO sessions (id,"orgId","userId","deckId","deckName","deckColor","deckIcon",
      name,account,contact,mode,status,outcome,"startTs",sold,events,notes,"referenceSessionId","lastBeatTs",live)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active','in_progress',$12,false,$13,'[]',$14,$15,$16)
    ON CONFLICT (id) DO UPDATE SET status='active', outcome='in_progress', "endTs"=NULL, "lastBeatTs"=$15, live=$16
    WHERE sessions."userId"=$3 AND (sessions.status='active'
      -- the owner's own run closed as abandoned in the last 6 hours (phone slept past the
      -- sweep, start retried) is reopened; finished runs never are
      OR (sessions.outcome='abandoned' AND COALESCE(sessions."endTs", 0) > $15 - 21600000))
    ` + LIVE_RETURNING, [
    session.id, orgId, userId,
    session.deckId, session.deckName || null, session.deckColor || "#F5A623", session.deckIcon || "💼",
    session.name || null, session.account || null, session.contact || null,
    session.mode === "practice" ? "practice" : "live",
    Number.isFinite(session.startTs) ? session.startTs : now,
    JSON.stringify(Array.isArray(session.events) ? session.events : []),
    typeof session.referenceSessionId === "string" && session.referenceSessionId ? session.referenceSessionId : null,
    now, JSON.stringify(session.live || null),
  ]);
  return rows[0] ? parseSession(rows[0]) : null;
}

// Heartbeat: only the owner, only while the run is still active
// events null = keep the stored path (a tab-closing keepalive beat may be too small for it)
async function beatLiveSession(id, userId, events, live) {
  const now = Date.now();
  const { rows } = await pool.query(
    'UPDATE sessions SET events=COALESCE($1::jsonb, events), live=$2, "lastBeatTs"=$3 WHERE id=$4 AND "userId"=$5 AND status=\'active\' ' + LIVE_RETURNING,
    [events ? JSON.stringify(events) : null, JSON.stringify(live || null), now, id, userId]
  );
  return rows[0] ? parseSession(rows[0]) : null;
}

async function getLiveSession(id, orgId) {
  const { rows } = await pool.query(
    'SELECT ' + LIVE_COLS + ', u."displayName" AS "userName" FROM sessions s LEFT JOIN users u ON u.id = s."userId"' +
    ' WHERE s.id = $1 AND s."orgId" = $2 AND s.status = \'active\'', [id, orgId]
  );
  return rows[0] ? parseSession(rows[0]) : null;
}

// A user's other runs still in progress (excluding exceptId)
async function countActiveRuns(userId, exceptId) {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM sessions WHERE "userId" = $1 AND status = \'active\' AND id <> $2', [userId, exceptId]);
  return rows[0].n;
}

// ─── WHO MAY WATCH A LIVE RUN ─────────────────────────────────────────────────
// The owner watches every run. Admins watch every run only while the org has no teams;
// once it has teams, an admin watches runs by reps who share a team with them (the
// admin's teams = member of or administering; same for the rep).
function teamsOfSql(userExpr) {
  return '(SELECT "teamId" FROM user_teams WHERE "userId" = ' + userExpr + ' UNION SELECT "teamId" FROM team_admins WHERE "userId" = ' + userExpr + ')';
}
function adminMayWatchSql(orgExpr, adminExpr, repExpr) {
  return '(NOT EXISTS (SELECT 1 FROM teams t WHERE t."orgId" = ' + orgExpr + ')' +
    ' OR EXISTS (SELECT 1 FROM ' + teamsOfSql(adminExpr) + ' mine JOIN ' + teamsOfSql(repExpr) + ' theirs ON theirs."teamId" = mine."teamId"))';
}

// Runs in progress this viewer may watch (an admin always sees their own)
async function getLiveSessions(viewer) {
  var isOwner = viewer.role === "owner";
  const { rows } = await pool.query(
    'SELECT ' + LIVE_COLS + ', u."displayName" AS "userName" FROM sessions s LEFT JOIN users u ON u.id = s."userId"' +
    ' WHERE s."orgId" = $1 AND s.status = \'active\'' +
    ' AND ($3::boolean OR s."userId" = $2 OR ' + adminMayWatchSql("$1", "$2", 's."userId"') + ')' +
    ' ORDER BY s."startTs" DESC', [viewer.orgId, viewer.id, isOwner]
  );
  return rows.map(parseSession);
}

// User ids that receive a rep's live run (start + progress): owner + admins allowed above
async function getLiveWatcherIds(orgId, repId) {
  const { rows } = await pool.query(
    'SELECT u.id FROM users u WHERE u."orgId" = $1 AND (u.role = \'owner\'' +
    ' OR (u.role = \'admin\' AND (u.id = $2 OR ' + adminMayWatchSql("$1", "u.id", "$2") + ')))', [orgId, repId]
  );
  return rows.map(function(r) { return r.id; });
}

// Close active runs as abandoned (keeping their path): one user's (signed in elsewhere)
// or every run whose heartbeat is older than staleBefore. Returns the closed rows.
async function closeActiveSessions(opts) {
  var where, vals;
  if (opts.userId) { where = '"userId" = $1'; vals = [opts.userId]; }
  else { where = 'COALESCE("lastBeatTs", "startTs") < $1'; vals = [opts.staleBefore]; }
  const { rows } = await pool.query(
    'UPDATE sessions SET status=\'completed\', outcome=\'abandoned\', "endTs"=COALESCE("lastBeatTs", "startTs"), live=NULL' +
    ' WHERE status=\'active\' AND ' + where + ' RETURNING id, "orgId", "userId"', vals
  );
  return rows;
}

// ─── SESSION AUDIO ────────────────────────────────────────────────────────────
async function saveSessionAudio(sessionId, orgId, mimeType, durationMs, buf) {
  await withTransaction(async function(client) {
    await client.query(
      'INSERT INTO session_audio ("sessionId","orgId","mimeType","durationMs","sizeBytes",data,"createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7)' +
      ' ON CONFLICT ("sessionId") DO UPDATE SET "mimeType"=$3,"durationMs"=$4,"sizeBytes"=$5,data=$6,"createdAt"=$7',
      [sessionId, orgId, mimeType, durationMs, buf.length, buf, Date.now()]
    );
    await client.query(
      'UPDATE sessions SET "hasAudio" = true, "audioDurationMs" = COALESCE($2, "audioDurationMs") WHERE id = $1',
      [sessionId, durationMs]
    );
    // Stamp the recording with its per-card chapter markers so the audio carries its own index
    await client.query(
      'UPDATE session_audio a SET chapters = s."audioSegments" FROM sessions s WHERE a."sessionId" = $1 AND s.id = $1',
      [sessionId]
    );
  });
}

// Audio and feedback reads take the caller's orgId so they can never return another org's rows
async function getSessionAudioMeta(sessionId, orgId) {
  const { rows } = await pool.query(
    'SELECT "mimeType","durationMs","sizeBytes",chapters FROM session_audio WHERE "sessionId" = $1 AND "orgId" = $2', [sessionId, orgId]
  );
  return rows[0] || null;
}

// start is 0-based; bytea substring is 1-based
async function getSessionAudioRange(sessionId, orgId, start, length) {
  const { rows } = await pool.query(
    'SELECT substring(data from $3 for $4) AS chunk FROM session_audio WHERE "sessionId" = $1 AND "orgId" = $2',
    [sessionId, orgId, start + 1, length]
  );
  return rows[0] ? rows[0].chunk : null;
}

// Whole recording (clip cutting reads it into a temp file)
async function getSessionAudioData(sessionId, orgId) {
  const { rows } = await pool.query(
    'SELECT "mimeType","durationMs",data FROM session_audio WHERE "sessionId" = $1 AND "orgId" = $2', [sessionId, orgId]
  );
  return rows[0] || null;
}

// Read access to a session's review, recording and feedback: an admin/owner of its org, its
// rep, a share recipient, or anyone a highlight of it is visible to
async function canReadSession(session, user) {
  if (!session || !user) return false;
  if (session.orgId !== user.orgId) return false;
  if (isAdminRoleName(user.role)) return true;
  if (session.userId === user.id) return true;
  if (await getShareRecord(session.id, user.id)) return true;
  return isHighlightVisibleTo(session.id, user);
}

// ─── SAVED CLIPS ──────────────────────────────────────────────────────────────
// A clip is cut from a recording into its own audio (clipRoutes). Who may play one: the
// person who saved it, people it was shared with, and the org owner.
var CLIP_COLS = 'c.id,c."orgId",c."userId",c."sessionId",c.title,c.kind,c."segId",c."cardId",c."startMs",c."endMs",c."durationMs",c.meta,c."mimeType",c."sizeBytes",c."createdAt"';

async function createClip(c) {
  var id = uid("clip_");
  await pool.query(
    'INSERT INTO audio_clips (id,"orgId","userId","sessionId",title,kind,"segId","cardId","startMs","endMs","durationMs",meta,"mimeType","sizeBytes",data,"createdAt")' +
    ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
    [id, c.orgId, c.userId, c.sessionId, c.title, c.kind, c.segId || null, c.cardId || null, c.startMs, c.endMs, c.durationMs,
      JSON.stringify(c.meta || {}), c.mimeType, c.data.length, c.data, Date.now()]
  );
  return getClip(id);
}

// Without the audio; ownerName + shareCount for lists
async function getClip(id) {
  const { rows } = await pool.query(
    'SELECT ' + CLIP_COLS + ', u."displayName" AS "ownerName",' +
    ' (SELECT COUNT(*)::int FROM clip_shares s WHERE s."clipId" = c.id) AS "shareCount"' +
    ' FROM audio_clips c LEFT JOIN users u ON u.id = c."userId" WHERE c.id = $1', [id]
  );
  return rows[0] || null;
}

// The clips this person saved, newest first
async function getMyClips(userId, orgId) {
  const { rows } = await pool.query(
    'SELECT ' + CLIP_COLS + ', u."displayName" AS "ownerName",' +
    ' (SELECT COUNT(*)::int FROM clip_shares s WHERE s."clipId" = c.id) AS "shareCount"' +
    ' FROM audio_clips c LEFT JOIN users u ON u.id = c."userId"' +
    ' WHERE c."userId" = $1 AND c."orgId" = $2 ORDER BY c."createdAt" DESC LIMIT 500', [userId, orgId]
  );
  return rows;
}

// Clips shared with this person, newest share first
async function getClipsSharedWith(userId, orgId) {
  const { rows } = await pool.query(
    'SELECT ' + CLIP_COLS + ', u."displayName" AS "ownerName", s.id AS "shareId", s.note AS "shareNote", s."createdAt" AS "sharedAt",' +
    ' f."displayName" AS "sharedByName"' +
    ' FROM clip_shares s JOIN audio_clips c ON c.id = s."clipId" LEFT JOIN users u ON u.id = c."userId" LEFT JOIN users f ON f.id = s."fromUserId"' +
    ' WHERE s."toUserId" = $1 AND c."orgId" = $2 ORDER BY s."createdAt" DESC LIMIT 500', [userId, orgId]
  );
  return rows;
}

async function renameClip(id, title) {
  await pool.query('UPDATE audio_clips SET title = $2 WHERE id = $1', [id, title]);
  return getClip(id);
}
async function deleteClip(id) {
  await pool.query('DELETE FROM audio_clips WHERE id = $1', [id]);
}

async function getClipShareRecord(clipId, userId) {
  const { rows } = await pool.query('SELECT * FROM clip_shares WHERE "clipId" = $1 AND "toUserId" = $2', [clipId, userId]);
  return rows[0] || null;
}
async function canPlayClip(clip, user) {
  if (!clip || !user || clip.orgId !== user.orgId) return false;
  if (clip.userId === user.id || user.role === "owner") return true;
  return !!(await getClipShareRecord(clip.id, user.id));
}

async function getClipAudioRange(clipId, start, length) {
  const { rows } = await pool.query('SELECT substring(data from $2 for $3) AS chunk FROM audio_clips WHERE id = $1', [clipId, start + 1, length]);
  return rows[0] ? rows[0].chunk : null;
}

// { share, created } — sharing again with the same person changes nothing
async function createClipShare(sh) {
  const { rows } = await pool.query(
    'INSERT INTO clip_shares (id,"clipId","orgId","fromUserId","toUserId",note,"createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7)' +
    ' ON CONFLICT ("clipId","toUserId") DO NOTHING RETURNING *',
    [uid("csh_"), sh.clipId, sh.orgId, sh.fromUserId, sh.toUserId, sh.note || null, Date.now()]
  );
  if (rows[0]) return { share: rows[0], created: true };
  return { share: await getClipShareRecord(sh.clipId, sh.toUserId), created: false };
}
async function getClipShares(clipId) {
  const { rows } = await pool.query(
    'SELECT s.id, s."toUserId", s."fromUserId", s.note, s."createdAt", u."displayName" AS "toName"' +
    ' FROM clip_shares s LEFT JOIN users u ON u.id = s."toUserId" WHERE s."clipId" = $1 ORDER BY s."createdAt" ASC', [clipId]
  );
  return rows;
}
// Returns the removed share (its recipient is told), or null
async function deleteClipShare(shareId, clipId) {
  const { rows } = await pool.query('DELETE FROM clip_shares WHERE id = $1 AND "clipId" = $2 RETURNING *', [shareId, clipId]);
  return rows[0] || null;
}
async function getClipRecipientIds(clipId) {
  const { rows } = await pool.query('SELECT "toUserId" FROM clip_shares WHERE "clipId" = $1', [clipId]);
  return rows.map(function(r) { return r.toUserId; });
}

// ─── REFERENCE SESSIONS ───────────────────────────────────────────────────────
// Completed sessions any org member may pick as a reference for a live call
async function getReferenceOptions(orgId, deckId, q) {
  const vals = [orgId];
  var where = 's."orgId" = $1 AND s.status = \'completed\' AND s."endTs" IS NOT NULL';
  if (deckId) { vals.push(deckId); where += ' AND s."deckId" = $' + vals.length; }
  if (q) {
    vals.push("%" + String(q).toLowerCase().slice(0, 100) + "%");
    where += ' AND (lower(s.name) LIKE $' + vals.length + ' OR lower(u."displayName") LIKE $' + vals.length + ')';
  }
  const { rows } = await pool.query(
    'SELECT s.id, s.name, s."userId", u."displayName" AS "userName", s.mode, s.outcome, s.sold, s."startTs", s."endTs", s."deckId", s."deckName"' +
    ' FROM sessions s LEFT JOIN users u ON u.id = s."userId" WHERE ' + where + ' ORDER BY s."startTs" DESC LIMIT 50',
    vals
  );
  return rows.map(function(r) { return Object.assign({}, r, { sold: !!r.sold }); });
}

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
async function createNotification(n) {
  await pool.query(
    'INSERT INTO notifications (id,"userId","orgId",type,"sessionId","actorId","actorName",text,"createdAt","clipId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [uid("ntf_"), n.userId, n.orgId, n.type, n.sessionId || null, n.actorId || null, n.actorName || null, n.text || null, Date.now(), n.clipId || null]
  );
}

async function getNotifications(userId, limit) {
  const { rows } = await pool.query(
    'SELECT n.*, s.name AS "sessionName", s."deckId" AS "deckId", c.title AS "clipTitle" FROM notifications n' +
    ' LEFT JOIN sessions s ON s.id = n."sessionId" LEFT JOIN audio_clips c ON c.id = n."clipId"' +
    ' WHERE n."userId" = $1 ORDER BY n."createdAt" DESC LIMIT $2',
    [userId, limit || 30]
  );
  const unread = await pool.query('SELECT COUNT(*) AS n FROM notifications WHERE "userId" = $1 AND "readAt" IS NULL', [userId]);
  return { items: rows, unreadCount: parseInt(unread.rows[0].n, 10) };
}

// ids = array → mark those; otherwise mark everything (optionally only one session's)
async function markNotificationsRead(userId, ids, sessionId) {
  if (Array.isArray(ids) && ids.length) {
    await pool.query('UPDATE notifications SET "readAt" = $1 WHERE "userId" = $2 AND id = ANY($3::text[]) AND "readAt" IS NULL', [Date.now(), userId, ids.map(String)]);
  } else if (sessionId) {
    await pool.query('UPDATE notifications SET "readAt" = $1 WHERE "userId" = $2 AND "sessionId" = $3 AND "readAt" IS NULL', [Date.now(), userId, sessionId]);
  } else {
    await pool.query('UPDATE notifications SET "readAt" = $1 WHERE "userId" = $2 AND "readAt" IS NULL', [Date.now(), userId]);
  }
}

// The route has already authorised the caller (owner, or an admin of the org)
async function deleteSession(id, orgId) {
  await pool.query('DELETE FROM sessions WHERE id = $1 AND "orgId" = $2', [id, orgId]);
}

// ─── SESSION FEEDBACK ─────────────────────────────────────────────────────────
async function getFeedback(sessionId, orgId) {
  const { rows } = await pool.query(
    'SELECT * FROM session_feedback WHERE "sessionId" = $1 AND "orgId" = $2 ORDER BY "createdAt" ASC', [sessionId, orgId]
  );
  return rows;
}

async function createFeedback(data) {
  const id  = uid("fb");
  const now = Date.now();
  await pool.query(
    'INSERT INTO session_feedback (id,"sessionId","orgId","authorId","authorName","cardId","cardTitle",text,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [id, data.sessionId, data.orgId, data.authorId, data.authorName, data.cardId || null, data.cardTitle || null, data.text, now, now]
  );
  return getFeedbackById(id);
}

async function updateFeedback(id, text, cardId, cardTitle, authorId) {
  const now = Date.now();
  await pool.query(
    'UPDATE session_feedback SET text=$1,"cardId"=$2,"cardTitle"=$3,"updatedAt"=$4 WHERE id=$5 AND "authorId"=$6',
    [text, cardId || null, cardTitle || null, now, id, authorId]
  );
  return getFeedbackById(id);
}

async function deleteFeedback(id, orgId) {
  await pool.query('DELETE FROM session_feedback WHERE id = $1 AND "orgId" = $2', [id, orgId]);
}

async function getFeedbackById(id) {
  const { rows } = await pool.query("SELECT * FROM session_feedback WHERE id = $1", [id]);
  return rows[0] || null;
}

// ─── SESSION SHARES ───────────────────────────────────────────────────────────
async function createShare(data) {
  const id  = uid("sh");
  const now = Date.now();
  const ins = await pool.query(
    'INSERT INTO session_shares (id,"sessionId","fromUserId","toUserId",context,"createdAt") VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT ("sessionId","toUserId") DO NOTHING',
    [id, data.sessionId, data.fromUserId, data.toUserId, data.context || null, now]
  );
  const rec = await getShareRecord(data.sessionId, data.toUserId);
  // created=false: already shared with this person (no second notification)
  return rec ? Object.assign({}, rec, { created: ins.rowCount > 0 }) : rec;
}

async function getSharesForSession(sessionId) {
  const { rows } = await pool.query(
    'SELECT ss.*,u."displayName" AS "toUserName",u.email AS "toUserEmail" FROM session_shares ss JOIN users u ON u.id = ss."toUserId" WHERE ss."sessionId" = $1',
    [sessionId]
  );
  return rows;
}

// Scoped to the session the caller was authorized against, not just the org
async function deleteShare(shareId, sessionId) {
  await pool.query(
    'DELETE FROM session_shares WHERE id = $1 AND "sessionId" = $2',
    [shareId, sessionId]
  );
}

async function getShareRecipientIds(sessionId) {
  const { rows } = await pool.query('SELECT "toUserId" FROM session_shares WHERE "sessionId" = $1', [sessionId]);
  return rows.map(function(r) { return r.toUserId; });
}

async function getShareRecord(sessionId, userId) {
  const { rows } = await pool.query(
    'SELECT * FROM session_shares WHERE "sessionId" = $1 AND "toUserId" = $2',
    [sessionId, userId]
  );
  return rows[0] || null;
}

module.exports = {
  pool, uid, initSchema,
  // users
  findUserByEmail, findUserById, updateLastLogin, getOrgUsers, createUser, updateUser, deleteUser,
  // orgs
  findOrgById, createOrg, updateOrg, getOrgOwner, transferOwnership, removeTeamAdminEverywhere, allInOrg, idsInOrg, ORG_FIELDS,
  // share codes + signup
  createInvite, getOrgInvites, getInvite, updateInvite, getInviteMembers, revokeInvite, checkInvite, signupWithInvite, createOrgWithOwner, normalizeInviteCode,
  // teams
  getOrgTeams, getTeamById, createTeam, updateTeam, deleteTeam, setTeamAdmins, getTeamAdmins,
  getUserTeams, setUserTeams, getAdminTeamIds, setActiveToken, clearActiveTokenIfMatches, hashSid,
  // decks
  getTeamNames,
  getOrgDecks, getDeckById, deckUsableBy, deckPermissions, stackPermsFor, viewDeck,
  getSessionAudioData, canReadSession,
  createClip, getClip, getMyClips, getClipsSharedWith, renameClip, deleteClip, canPlayClip, getClipAudioRange,
  createClipShare, getClipShares, deleteClipShare, getClipRecipientIds, getClipShareRecord, setDeckEditors, removeDeckEditorEverywhere, createDeck, updateDeck, deleteDeck, setDeckArchived, setDeckOrder,
  getDeckAccess, setDeckAccess,
  // passwords
  createPasswordReset, findPasswordReset, usePasswordReset, setPasswordHash, expirePasswordResets,
  // sessions
  getSessions, getSessionById, upsertSession,
  getHighlights, getHighlight, isHighlightVisibleTo, getMemberOrAdminTeamIds, setHighlight, clearHighlight,
  startLiveSession, beatLiveSession, getLiveSession, getLiveSessions, getLiveWatcherIds, closeActiveSessions, countActiveRuns, deleteSession,
  saveSessionAudio, getSessionAudioMeta, getSessionAudioRange, getReferenceOptions,
  // notifications
  createNotification, getNotifications, markNotificationsRead,
  // feedback
  getFeedback, createFeedback, updateFeedback, deleteFeedback, getFeedbackById,
  // shares
  createShare, getSharesForSession, deleteShare, getShareRecord, getShareRecipientIds,
};
