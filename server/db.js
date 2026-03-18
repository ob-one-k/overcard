const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

// Use OVERCARD_DATA env var, or fall back to ~/.overcard when the project
// lives on a Windows NTFS mount (WSL /mnt/…) where SQLite cannot create files.
var _defaultData = __dirname.startsWith("/mnt/")
  ? path.join(process.env.HOME || "/tmp", ".overcard")
  : path.join(__dirname, "..", "data");
const DATA_DIR = process.env.OVERCARD_DATA || _defaultData;
const DB_PATH  = path.join(DATA_DIR, "overcard.db");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ─── SCHEMA ───────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS orgs (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    createdAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS teams (
    id        TEXT PRIMARY KEY,
    orgId     TEXT NOT NULL REFERENCES orgs(id),
    name      TEXT NOT NULL,
    createdAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS team_admins (
    teamId TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    userId TEXT NOT NULL,
    PRIMARY KEY (teamId, userId)
  );

  CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    orgId        TEXT NOT NULL REFERENCES orgs(id),
    teamId       TEXT REFERENCES teams(id),
    email        TEXT NOT NULL UNIQUE,
    passwordHash TEXT NOT NULL,
    displayName  TEXT NOT NULL,
    role         TEXT NOT NULL CHECK(role IN ('admin','user')),
    createdAt    INTEGER NOT NULL,
    lastLoginAt  INTEGER
  );

  CREATE TABLE IF NOT EXISTS decks (
    id        TEXT PRIMARY KEY,
    orgId     TEXT NOT NULL REFERENCES orgs(id),
    createdBy TEXT NOT NULL REFERENCES users(id),
    name      TEXT NOT NULL,
    color     TEXT NOT NULL DEFAULT '#F5A623',
    icon      TEXT NOT NULL DEFAULT '💼',
    rootCard  TEXT,
    cards     TEXT NOT NULL DEFAULT '{}',
    objStacks TEXT NOT NULL DEFAULT '[]',
    updatedAt INTEGER NOT NULL,
    createdAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id            TEXT PRIMARY KEY,
    orgId         TEXT NOT NULL REFERENCES orgs(id),
    userId        TEXT NOT NULL REFERENCES users(id),
    deckId        TEXT NOT NULL,
    deckName      TEXT NOT NULL,
    deckColor     TEXT NOT NULL DEFAULT '#F5A623',
    deckIcon      TEXT NOT NULL DEFAULT '💼',
    name          TEXT NOT NULL,
    account       TEXT,
    contact       TEXT,
    mode          TEXT NOT NULL DEFAULT 'live',
    status        TEXT NOT NULL DEFAULT 'completed',
    outcome       TEXT NOT NULL DEFAULT 'completed',
    startTs       INTEGER NOT NULL,
    endTs         INTEGER,
    sold          INTEGER NOT NULL DEFAULT 0,
    soldCardId    TEXT,
    soldCardTitle TEXT,
    events        TEXT NOT NULL DEFAULT '[]',
    notes         TEXT NOT NULL DEFAULT '[]',
    metrics       TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_userId ON sessions(userId);
  CREATE INDEX IF NOT EXISTS idx_sessions_orgId  ON sessions(orgId);
  CREATE INDEX IF NOT EXISTS idx_sessions_deckId ON sessions(deckId);
  CREATE INDEX IF NOT EXISTS idx_decks_orgId     ON decks(orgId);
  CREATE INDEX IF NOT EXISTS idx_users_orgId     ON users(orgId);
  CREATE INDEX IF NOT EXISTS idx_users_teamId    ON users(teamId);

  CREATE TABLE IF NOT EXISTS session_feedback (
    id         TEXT PRIMARY KEY,
    sessionId  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    orgId      TEXT NOT NULL,
    authorId   TEXT NOT NULL REFERENCES users(id),
    authorName TEXT NOT NULL,
    cardId     TEXT,
    cardTitle  TEXT,
    text       TEXT NOT NULL,
    createdAt  INTEGER NOT NULL,
    updatedAt  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_feedback_sessionId ON session_feedback(sessionId);

  CREATE TABLE IF NOT EXISTS session_shares (
    id          TEXT PRIMARY KEY,
    sessionId   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    fromUserId  TEXT NOT NULL REFERENCES users(id),
    toUserId    TEXT NOT NULL REFERENCES users(id),
    context     TEXT,
    createdAt   INTEGER NOT NULL,
    UNIQUE(sessionId, toUserId)
  );
  CREATE INDEX IF NOT EXISTS idx_shares_toUserId  ON session_shares(toUserId);
  CREATE INDEX IF NOT EXISTS idx_shares_sessionId ON session_shares(sessionId);

  CREATE TABLE IF NOT EXISTS user_teams (
    userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    teamId TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    PRIMARY KEY (userId, teamId)
  );
  CREATE INDEX IF NOT EXISTS idx_user_teams_teamId ON user_teams(teamId);
  CREATE INDEX IF NOT EXISTS idx_user_teams_userId ON user_teams(userId);

  CREATE TABLE IF NOT EXISTS deck_access (
    deckId     TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    entityType TEXT NOT NULL CHECK(entityType IN ('team','user')),
    entityId   TEXT NOT NULL,
    PRIMARY KEY (deckId, entityType, entityId)
  );
  CREATE INDEX IF NOT EXISTS idx_deck_access_deckId ON deck_access(deckId);
`);

// ─── MIGRATIONS ───────────────────────────────────────────────────────────────
try { db.prepare("ALTER TABLE decks ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'").run(); } catch(e) {}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function uid(prefix) {
  return (prefix || "") + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function parseDeck(row) {
  if (!row) return null;
  return Object.assign({}, row, {
    cards:      JSON.parse(row.cards     || "{}"),
    objStacks:  JSON.parse(row.objStacks || "[]"),
    visibility: row.visibility || "public",
  });
}

function parseSession(row) {
  if (!row) return null;
  return Object.assign({}, row, {
    sold:    row.sold === 1,
    events:  JSON.parse(row.events  || "[]"),
    notes:   JSON.parse(row.notes   || "[]"),
    metrics: row.metrics ? JSON.parse(row.metrics) : null,
  });
}

// ─── USERS ────────────────────────────────────────────────────────────────────

function findUserByEmail(email) {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email);
}

function findUserById(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

function updateLastLogin(userId) {
  db.prepare("UPDATE users SET lastLoginAt = ? WHERE id = ?").run(Date.now(), userId);
}

function getUserTeams(userId) {
  return db.prepare("SELECT teamId FROM user_teams WHERE userId = ?").all(userId).map(function(r){ return r.teamId; });
}

function setUserTeams(userId, teamIds) {
  const del = db.prepare("DELETE FROM user_teams WHERE userId = ?");
  const ins = db.prepare("INSERT OR IGNORE INTO user_teams (userId, teamId) VALUES (?, ?)");
  db.transaction(function() {
    del.run(userId);
    (teamIds || []).forEach(function(tid) { ins.run(userId, tid); });
  })();
}

function getOrgUsers(orgId) {
  const users = db.prepare("SELECT id,orgId,teamId,email,displayName,role,createdAt,lastLoginAt FROM users WHERE orgId = ? ORDER BY displayName").all(orgId);
  return users.map(function(u) {
    return Object.assign({}, u, { teamIds: getUserTeams(u.id) });
  });
}

function createUser({ id, orgId, teamId, email, passwordHash, displayName, role }) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO users (id,orgId,teamId,email,passwordHash,displayName,role,createdAt)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(id || uid("u"), orgId, teamId || null, email, passwordHash, displayName, role, now);
  return findUserByEmail(email);
}

function updateUser(id, orgId, fields) {
  const allowed = ["teamId","displayName","role","passwordHash"];
  const sets = [], vals = [];
  allowed.forEach(function(k) {
    if (fields[k] !== undefined) { sets.push(k + " = ?"); vals.push(fields[k]); }
  });
  if (!sets.length) return findUserById(id);
  vals.push(id, orgId);
  db.prepare("UPDATE users SET " + sets.join(", ") + " WHERE id = ? AND orgId = ?").run(...vals);
  return findUserById(id);
}

function deleteUser(id, orgId) {
  db.prepare("DELETE FROM users WHERE id = ? AND orgId = ?").run(id, orgId);
}

// ─── ORGS ─────────────────────────────────────────────────────────────────────
function findOrgById(id) {
  return db.prepare("SELECT * FROM orgs WHERE id = ?").get(id);
}

function createOrg({ id, name }) {
  const oid = id || uid("org_");
  db.prepare("INSERT INTO orgs (id,name,createdAt) VALUES (?,?,?)").run(oid, name, Date.now());
  return findOrgById(oid);
}

// ─── TEAMS ────────────────────────────────────────────────────────────────────
function getTeamAdmins(teamId) {
  return db.prepare("SELECT userId FROM team_admins WHERE teamId = ?").all(teamId).map(function(r){ return r.userId; });
}

function setTeamAdmins(teamId, adminIds) {
  const del = db.prepare("DELETE FROM team_admins WHERE teamId = ?");
  const ins = db.prepare("INSERT INTO team_admins (teamId,userId) VALUES (?,?)");
  db.transaction(function() {
    del.run(teamId);
    (adminIds || []).forEach(function(uid) { ins.run(teamId, uid); });
  })();
}

function getOrgTeams(orgId) {
  const teams = db.prepare("SELECT * FROM teams WHERE orgId = ? ORDER BY name").all(orgId);
  return teams.map(function(t) {
    const memberIds = db.prepare("SELECT userId FROM user_teams WHERE teamId = ?").all(t.id).map(function(r){ return r.userId; });
    return Object.assign({}, t, { adminIds: getTeamAdmins(t.id), memberIds: memberIds });
  });
}

function getTeamById(id) {
  const t = db.prepare("SELECT * FROM teams WHERE id = ?").get(id);
  if (!t) return null;
  const memberIds = db.prepare("SELECT userId FROM user_teams WHERE teamId = ?").all(id).map(function(r){ return r.userId; });
  return Object.assign({}, t, { adminIds: getTeamAdmins(id), memberIds: memberIds });
}

function createTeam({ orgId, name, adminIds }) {
  const id = uid("team_");
  db.prepare("INSERT INTO teams (id,orgId,name,createdAt) VALUES (?,?,?,?)").run(id, orgId, name, Date.now());
  setTeamAdmins(id, adminIds || []);
  return getTeamById(id);
}

function updateTeam(id, orgId, fields) {
  if (fields.name) {
    db.prepare("UPDATE teams SET name = ? WHERE id = ? AND orgId = ?").run(fields.name, id, orgId);
  }
  if (fields.adminIds !== undefined) {
    setTeamAdmins(id, fields.adminIds);
  }
  return getTeamById(id);
}

function deleteTeam(id, orgId) {
  db.prepare("DELETE FROM teams WHERE id = ? AND orgId = ?").run(id, orgId);
}

// ─── DECKS ────────────────────────────────────────────────────────────────────
function getDeckAccess(deckId) {
  return db.prepare("SELECT entityType, entityId FROM deck_access WHERE deckId = ?").all(deckId);
}

function setDeckAccess(deckId, accessList) {
  const del = db.prepare("DELETE FROM deck_access WHERE deckId = ?");
  const ins = db.prepare("INSERT OR IGNORE INTO deck_access (deckId, entityType, entityId) VALUES (?, ?, ?)");
  db.transaction(function() {
    del.run(deckId);
    (accessList || []).forEach(function(a) { ins.run(deckId, a.entityType, a.entityId); });
  })();
}

function getOrgDecks(orgId, userId, userTeamIds) {
  var rows = db.prepare("SELECT * FROM decks WHERE orgId = ? ORDER BY name").all(orgId);
  var decks = rows.map(function(row) {
    var deck = parseDeck(row);
    deck.accessList = getDeckAccess(row.id);
    return deck;
  });
  // Admins (no userId filter) see all decks
  if (!userId) return decks;
  return decks.filter(function(d) {
    if (d.visibility === "public") return true;
    // Private: check explicit user or team access
    return d.accessList.some(function(a) {
      if (a.entityType === "user" && a.entityId === userId) return true;
      if (a.entityType === "team" && (userTeamIds||[]).includes(a.entityId)) return true;
      return false;
    });
  });
}

function getDeckById(id) {
  var deck = parseDeck(db.prepare("SELECT * FROM decks WHERE id = ?").get(id));
  if (deck) deck.accessList = getDeckAccess(id);
  return deck;
}

function createDeck({ orgId, createdBy, name, color, icon, visibility }) {
  const id  = uid("d");
  const now = Date.now();
  db.prepare(`
    INSERT INTO decks (id,orgId,createdBy,name,color,icon,rootCard,cards,objStacks,visibility,updatedAt,createdAt)
    VALUES (?,?,?,?,?,?,NULL,'{}','[]',?,?,?)
  `).run(id, orgId, createdBy, name, color || "#F5A623", icon || "💼", visibility || "public", now, now);
  return getDeckById(id);
}

function updateDeck(id, orgId, deck) {
  const now = Date.now();
  db.prepare(`
    UPDATE decks SET name=?,color=?,icon=?,rootCard=?,cards=?,objStacks=?,visibility=?,updatedAt=?
    WHERE id=? AND orgId=?
  `).run(
    deck.name, deck.color, deck.icon,
    deck.rootCard || null,
    JSON.stringify(deck.cards   || {}),
    JSON.stringify(deck.objStacks || []),
    deck.visibility || "public",
    now, id, orgId
  );
  return getDeckById(id);
}

function deleteDeck(id, orgId) {
  db.prepare("DELETE FROM decks WHERE id = ? AND orgId = ?").run(id, orgId);
}

// ─── SESSIONS ─────────────────────────────────────────────────────────────────
function buildSessionWhere(scope, orgId, userId, filters) {
  const conds = [];
  const vals  = [];

  if (scope === "self" || !scope) {
    conds.push("userId = ?"); vals.push(userId);
  } else if (scope.type === "user") {
    conds.push("userId = ?"); vals.push(scope.userId);
    conds.push("orgId = ?");  vals.push(orgId);
  } else if (scope.type === "users" && scope.userIds && scope.userIds.length) {
    const ph = scope.userIds.map(function(){ return "?"; }).join(",");
    conds.push("userId IN (" + ph + ")");
    scope.userIds.forEach(function(id){ vals.push(id); });
    conds.push("orgId = ?"); vals.push(orgId);
  } else if (scope.type === "team") {
    conds.push("userId IN (SELECT id FROM users WHERE teamId = ?)"); vals.push(scope.teamId);
    conds.push("orgId = ?"); vals.push(orgId);
  } else if (scope.type === "org") {
    conds.push("orgId = ?"); vals.push(orgId);
  } else {
    conds.push("userId = ?"); vals.push(userId);
  }

  if (filters.deckId) { conds.push("deckId = ?"); vals.push(filters.deckId); }
  if (filters.mode)   { conds.push("mode = ?");   vals.push(filters.mode);   }
  if (filters.outcome){ conds.push("outcome = ?");vals.push(filters.outcome); }
  if (filters.from)   {
    const d = new Date(filters.from); d.setHours(0,0,0,0);
    conds.push("startTs >= ?"); vals.push(d.getTime());
  }
  if (filters.to) {
    const d = new Date(filters.to); d.setHours(23,59,59,999);
    conds.push("startTs <= ?"); vals.push(d.getTime());
  }

  return { where: conds.length ? " WHERE " + conds.join(" AND ") : "", vals };
}

function getSessions(scope, orgId, userId, filters) {
  const { where, vals } = buildSessionWhere(scope, orgId, userId, filters || {});
  const rows = db.prepare("SELECT * FROM sessions" + where + " ORDER BY startTs DESC").all(...vals);
  const result = rows.map(parseSession);

  // For self-scope, also include sessions shared with this user
  if (!scope || scope === "self") {
    const f = filters || {};
    const sharedConds = ["ss.toUserId = ?"];
    const sharedVals  = [userId];
    if (f.deckId)  { sharedConds.push("s.deckId = ?");  sharedVals.push(f.deckId); }
    if (f.mode)    { sharedConds.push("s.mode = ?");     sharedVals.push(f.mode); }
    if (f.outcome) { sharedConds.push("s.outcome = ?");  sharedVals.push(f.outcome); }
    if (f.from) {
      const d = new Date(f.from); d.setHours(0,0,0,0);
      sharedConds.push("s.startTs >= ?"); sharedVals.push(d.getTime());
    }
    if (f.to) {
      const d = new Date(f.to); d.setHours(23,59,59,999);
      sharedConds.push("s.startTs <= ?"); sharedVals.push(d.getTime());
    }
    const sharedSql = `SELECT s.*, ss.context as _shareContext, ss.fromUserId as _shareFromUserId,
        (SELECT displayName FROM users WHERE id = ss.fromUserId) as _shareFromName
      FROM sessions s JOIN session_shares ss ON ss.sessionId = s.id
      WHERE ${sharedConds.join(" AND ")}`;
    const sharedRows = db.prepare(sharedSql).all(...sharedVals);
    const ownIds = new Set(result.map(function(s){ return s.id; }));
    sharedRows.forEach(function(row) {
      if (!ownIds.has(row.id)) {
        const parsed = parseSession(row);
        parsed._shared = true;
        parsed._shareContext = row._shareContext || null;
        parsed._shareFromUserId = row._shareFromUserId || null;
        parsed._shareFromName = row._shareFromName || null;
        result.push(parsed);
      }
    });
    result.sort(function(a, b) { return b.startTs - a.startTs; });
  }

  if (result.length > 0) {
    var fbIds = result.map(function(s){ return s.id; });
    var fbPh = fbIds.map(function(){ return "?"; }).join(",");
    var fbRows = db.prepare(
      "SELECT sessionId, COUNT(*) as feedbackCount, MAX(updatedAt) as latestFeedbackAt " +
      "FROM session_feedback WHERE sessionId IN (" + fbPh + ") GROUP BY sessionId"
    ).all(...fbIds);
    var fbMap = {};
    fbRows.forEach(function(r){ fbMap[r.sessionId] = r; });
    result.forEach(function(s) {
      s.feedbackCount = fbMap[s.id] ? fbMap[s.id].feedbackCount : 0;
      s.latestFeedbackAt = fbMap[s.id] ? fbMap[s.id].latestFeedbackAt : null;
    });

    // Attach shareCount to owned sessions (not to sessions shared-with-me)
    var ownIds = result.filter(function(s){ return !s._shared; }).map(function(s){ return s.id; });
    if (ownIds.length > 0) {
      var shrPh = ownIds.map(function(){ return "?"; }).join(",");
      var shrRows = db.prepare(
        "SELECT sessionId, COUNT(*) as shareCount FROM session_shares WHERE sessionId IN (" + shrPh + ") GROUP BY sessionId"
      ).all(...ownIds);
      var shrMap = {};
      shrRows.forEach(function(r){ shrMap[r.sessionId] = r; });
      result.forEach(function(s) {
        if (!s._shared) s.shareCount = shrMap[s.id] ? shrMap[s.id].shareCount : 0;
      });
    }
  }

  return result;
}

function getSessionById(id) {
  return parseSession(db.prepare("SELECT * FROM sessions WHERE id = ?").get(id));
}

function upsertSession(session, userId, orgId) {
  const existing = getSessionById(session.id);
  if (existing) {
    db.prepare(`
      UPDATE sessions SET deckId=?,deckName=?,deckColor=?,deckIcon=?,name=?,account=?,contact=?,
        mode=?,status=?,outcome=?,startTs=?,endTs=?,sold=?,soldCardId=?,soldCardTitle=?,
        events=?,notes=?,metrics=? WHERE id=? AND userId=?
    `).run(
      session.deckId, session.deckName, session.deckColor || "#F5A623", session.deckIcon || "💼",
      session.name, session.account || null, session.contact || null,
      session.mode || "live", session.status || "completed", session.outcome || "completed",
      session.startTs, session.endTs || null, session.sold ? 1 : 0,
      session.soldCardId || null, session.soldCardTitle || null,
      JSON.stringify(session.events || []),
      JSON.stringify(session.notes  || []),
      session.metrics ? JSON.stringify(session.metrics) : null,
      session.id, userId
    );
  } else {
    db.prepare(`
      INSERT INTO sessions (id,orgId,userId,deckId,deckName,deckColor,deckIcon,name,account,contact,
        mode,status,outcome,startTs,endTs,sold,soldCardId,soldCardTitle,events,notes,metrics)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      session.id, orgId, userId,
      session.deckId, session.deckName, session.deckColor || "#F5A623", session.deckIcon || "💼",
      session.name, session.account || null, session.contact || null,
      session.mode || "live", session.status || "completed", session.outcome || "completed",
      session.startTs, session.endTs || null, session.sold ? 1 : 0,
      session.soldCardId || null, session.soldCardTitle || null,
      JSON.stringify(session.events || []),
      JSON.stringify(session.notes  || []),
      session.metrics ? JSON.stringify(session.metrics) : null
    );
  }
  return getSessionById(session.id);
}

function deleteSession(id, userId) {
  db.prepare("DELETE FROM sessions WHERE id = ? AND userId = ?").run(id, userId);
}

// Direct insert for seed script (no userId guard)
function insertSession(session) {
  db.prepare(`
    INSERT OR REPLACE INTO sessions (id,orgId,userId,deckId,deckName,deckColor,deckIcon,name,account,contact,
      mode,status,outcome,startTs,endTs,sold,soldCardId,soldCardTitle,events,notes,metrics)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    session.id, session.orgId, session.userId,
    session.deckId, session.deckName, session.deckColor || "#F5A623", session.deckIcon || "💼",
    session.name, session.account || null, session.contact || null,
    session.mode || "live", session.status || "completed", session.outcome || "completed",
    session.startTs, session.endTs || null, session.sold ? 1 : 0,
    session.soldCardId || null, session.soldCardTitle || null,
    JSON.stringify(session.events || []),
    JSON.stringify(session.notes  || []),
    session.metrics ? JSON.stringify(session.metrics) : null
  );
}

// ─── SESSION FEEDBACK ─────────────────────────────────────────────────────────
function getFeedback(sessionId) {
  return db.prepare("SELECT * FROM session_feedback WHERE sessionId = ? ORDER BY createdAt ASC").all(sessionId);
}

function createFeedback(data) {
  const id = uid("fb");
  const now = Date.now();
  db.prepare(`
    INSERT INTO session_feedback (id, sessionId, orgId, authorId, authorName, cardId, cardTitle, text, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, data.sessionId, data.orgId, data.authorId, data.authorName,
    data.cardId || null, data.cardTitle || null, data.text, now, now);
  return db.prepare("SELECT * FROM session_feedback WHERE id = ?").get(id);
}

function updateFeedback(id, text, cardId, cardTitle, authorId) {
  const now = Date.now();
  db.prepare(`UPDATE session_feedback SET text=?, cardId=?, cardTitle=?, updatedAt=? WHERE id=? AND authorId=?`)
    .run(text, cardId || null, cardTitle || null, now, id, authorId);
  return db.prepare("SELECT * FROM session_feedback WHERE id = ?").get(id);
}

function deleteFeedback(id, orgId) {
  db.prepare("DELETE FROM session_feedback WHERE id = ? AND orgId = ?").run(id, orgId);
}

function getFeedbackById(id) {
  return db.prepare("SELECT * FROM session_feedback WHERE id = ?").get(id);
}

// ─── SESSION SHARES ───────────────────────────────────────────────────────────
function createShare(data) {
  const id = uid("sh");
  const now = Date.now();
  db.prepare(`
    INSERT OR IGNORE INTO session_shares (id, sessionId, fromUserId, toUserId, context, createdAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, data.sessionId, data.fromUserId, data.toUserId, data.context || null, now);
  return db.prepare("SELECT * FROM session_shares WHERE sessionId=? AND toUserId=?").get(data.sessionId, data.toUserId);
}

function getSharesForSession(sessionId) {
  return db.prepare(`
    SELECT ss.*, u.displayName as toUserName, u.email as toUserEmail
    FROM session_shares ss JOIN users u ON u.id = ss.toUserId
    WHERE ss.sessionId = ?
  `).all(sessionId);
}

function deleteShare(shareId, orgId) {
  // Verify share belongs to this org via the session
  db.prepare(`
    DELETE FROM session_shares WHERE id = ?
    AND sessionId IN (SELECT id FROM sessions WHERE orgId = ?)
  `).run(shareId, orgId);
}

function getShareRecord(sessionId, userId) {
  return db.prepare("SELECT * FROM session_shares WHERE sessionId=? AND toUserId=?").get(sessionId, userId);
}

module.exports = {
  db, uid,
  // users
  findUserByEmail, findUserById, updateLastLogin, getOrgUsers, createUser, updateUser, deleteUser,
  // orgs
  findOrgById, createOrg,
  // teams
  getOrgTeams, getTeamById, createTeam, updateTeam, deleteTeam, setTeamAdmins, getTeamAdmins,
  getUserTeams, setUserTeams,
  // decks
  getOrgDecks, getDeckById, createDeck, updateDeck, deleteDeck,
  getDeckAccess, setDeckAccess,
  // sessions
  getSessions, getSessionById, upsertSession, deleteSession, insertSession,
  // feedback
  getFeedback, createFeedback, updateFeedback, deleteFeedback, getFeedbackById,
  // shares
  createShare, getSharesForSession, deleteShare, getShareRecord,
};
