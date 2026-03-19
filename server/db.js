const { Pool, types } = require("pg");

// Parse BIGINT (int8, oid 20) columns as JS numbers instead of strings
types.setTypeParser(20, function(val) { return parseInt(val, 10); });

if (process.env.NODE_ENV === "production" && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required in production");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
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

    // Seed manifest — tracks which records were seeded and their last-seeded content hash
    // Enables smart re-seeding: refresh unmodified seed records, preserve user edits
    await client.query(`CREATE TABLE IF NOT EXISTS seed_manifest (
      table_name   TEXT   NOT NULL,
      record_id    TEXT   NOT NULL,
      content_hash TEXT   NOT NULL,
      seeded_at    BIGINT NOT NULL,
      PRIMARY KEY (table_name, record_id)
    )`);

    await client.query("COMMIT");
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
    sold:    !!row.sold,
    events:  parseJsonField(row.events,  []),
    notes:   parseJsonField(row.notes,   []),
    metrics: parseJsonField(row.metrics, null),
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

async function getOrgUsers(orgId) {
  const { rows } = await pool.query(
    'SELECT id,"orgId","teamId",email,"displayName",role,"createdAt","lastLoginAt" FROM users WHERE "orgId" = $1 ORDER BY "displayName"',
    [orgId]
  );
  var result = [];
  for (var i = 0; i < rows.length; i++) {
    var teamIds = await getUserTeams(rows[i].id);
    result.push(Object.assign({}, rows[i], { teamIds: teamIds }));
  }
  return result;
}

async function createUser({ id, orgId, teamId, email, passwordHash, displayName, role }) {
  const now   = Date.now();
  const newId = id || uid("u");
  await pool.query(
    'INSERT INTO users (id,"orgId","teamId",email,"passwordHash","displayName",role,"createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [newId, orgId, teamId || null, email, passwordHash, displayName, role, now]
  );
  return findUserByEmail(email);
}

async function updateUser(id, orgId, fields) {
  const allowed = ["teamId", "displayName", "role", "passwordHash"];
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

async function deleteUser(id, orgId) {
  await pool.query('DELETE FROM users WHERE id = $1 AND "orgId" = $2', [id, orgId]);
}

// ─── ORGS ─────────────────────────────────────────────────────────────────────
async function findOrgById(id) {
  const { rows } = await pool.query("SELECT * FROM orgs WHERE id = $1", [id]);
  return rows[0] || null;
}

async function createOrg({ id, name }) {
  const oid = id || uid("org_");
  await pool.query('INSERT INTO orgs (id,name,"createdAt") VALUES ($1,$2,$3)', [oid, name, Date.now()]);
  return findOrgById(oid);
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

async function getOrgTeams(orgId) {
  const { rows } = await pool.query('SELECT * FROM teams WHERE "orgId" = $1 ORDER BY name', [orgId]);
  var result = [];
  for (var i = 0; i < rows.length; i++) {
    var t = rows[i];
    var memberRows = await pool.query('SELECT "userId" FROM user_teams WHERE "teamId" = $1', [t.id]);
    var memberIds  = memberRows.rows.map(function(r) { return r.userId; });
    var adminIds   = await getTeamAdmins(t.id);
    result.push(Object.assign({}, t, { adminIds: adminIds, memberIds: memberIds }));
  }
  return result;
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
  await pool.query('DELETE FROM teams WHERE id = $1 AND "orgId" = $2', [id, orgId]);
}

// ─── DECKS ────────────────────────────────────────────────────────────────────
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

async function getOrgDecks(orgId, userId, userTeamIds) {
  const { rows } = await pool.query('SELECT * FROM decks WHERE "orgId" = $1 ORDER BY name', [orgId]);
  var decks = [];
  for (var i = 0; i < rows.length; i++) {
    var deck = parseDeck(rows[i]);
    deck.accessList = await getDeckAccess(rows[i].id);
    decks.push(deck);
  }
  // Admins (no userId filter) see all decks
  if (!userId) return decks;
  return decks.filter(function(d) {
    if (d.visibility === "public") return true;
    return d.accessList.some(function(a) {
      if (a.entityType === "user" && a.entityId === userId) return true;
      if (a.entityType === "team" && (userTeamIds || []).includes(a.entityId)) return true;
      return false;
    });
  });
}

async function getDeckById(id) {
  const { rows } = await pool.query("SELECT * FROM decks WHERE id = $1", [id]);
  var deck = parseDeck(rows[0] || null);
  if (deck) deck.accessList = await getDeckAccess(id);
  return deck;
}

async function createDeck({ orgId, createdBy, name, color, icon, visibility }) {
  const id  = uid("d");
  const now = Date.now();
  await pool.query(
    "INSERT INTO decks (id,\"orgId\",\"createdBy\",name,color,icon,\"rootCard\",cards,\"objStacks\",visibility,\"updatedAt\",\"createdAt\") VALUES ($1,$2,$3,$4,$5,$6,NULL,'{}','[]',$7,$8,$9)",
    [id, orgId, createdBy, name, color || "#F5A623", icon || "💼", visibility || "public", now, now]
  );
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
    conds.push('"userId" IN (SELECT id FROM users WHERE "teamId" = ' + push(scope.teamId) + ')');
    conds.push('"orgId" = ' + push(orgId));
  } else if (scope.type === "org") {
    conds.push('"orgId" = ' + push(orgId));
  } else {
    conds.push('"userId" = ' + push(userId));
  }

  if (filters.deckId)  { conds.push('"deckId" = ' + push(filters.deckId)); }
  if (filters.mode)    { conds.push('mode = '      + push(filters.mode));   }
  if (filters.outcome) { conds.push('outcome = '   + push(filters.outcome)); }
  if (filters.from) {
    const d = new Date(filters.from); d.setHours(0, 0, 0, 0);
    conds.push('"startTs" >= ' + push(d.getTime()));
  }
  if (filters.to) {
    const d = new Date(filters.to); d.setHours(23, 59, 59, 999);
    conds.push('"startTs" <= ' + push(d.getTime()));
  }

  return { where: conds.length ? " WHERE " + conds.join(" AND ") : "", vals };
}

async function getSessions(scope, orgId, userId, filters) {
  const { where, vals } = buildSessionWhere(scope, orgId, userId, filters || {});
  const { rows } = await pool.query(
    'SELECT * FROM sessions' + where + ' ORDER BY "startTs" DESC', vals
  );
  const result = rows.map(parseSession);

  // For self-scope, also include sessions shared with this user
  if (!scope || scope === "self") {
    const f = filters || {};
    const sharedConds = ['ss."toUserId" = $1'];
    const sharedVals  = [userId];
    var sp = 2;
    function spush(val) { sharedVals.push(val); return "$" + (sp++); }
    if (f.deckId)  { sharedConds.push('s."deckId" = '  + spush(f.deckId)); }
    if (f.mode)    { sharedConds.push('s.mode = '      + spush(f.mode)); }
    if (f.outcome) { sharedConds.push('s.outcome = '   + spush(f.outcome)); }
    if (f.from) {
      const d = new Date(f.from); d.setHours(0, 0, 0, 0);
      sharedConds.push('s."startTs" >= ' + spush(d.getTime()));
    }
    if (f.to) {
      const d = new Date(f.to); d.setHours(23, 59, 59, 999);
      sharedConds.push('s."startTs" <= ' + spush(d.getTime()));
    }
    const sharedSql =
      'SELECT s.*, ss.context AS "_shareContext", ss."fromUserId" AS "_shareFromUserId",' +
      ' (SELECT "displayName" FROM users WHERE id = ss."fromUserId") AS "_shareFromName"' +
      ' FROM sessions s JOIN session_shares ss ON ss."sessionId" = s.id' +
      ' WHERE ' + sharedConds.join(" AND ");
    const { rows: sharedRows } = await pool.query(sharedSql, sharedVals);
    const ownIds = new Set(result.map(function(s) { return s.id; }));
    sharedRows.forEach(function(row) {
      if (!ownIds.has(row.id)) {
        const parsed = parseSession(row);
        parsed._shared          = true;
        parsed._shareContext     = row._shareContext     || null;
        parsed._shareFromUserId  = row._shareFromUserId  || null;
        parsed._shareFromName    = row._shareFromName    || null;
        result.push(parsed);
      }
    });
    result.sort(function(a, b) { return b.startTs - a.startTs; });
  }

  if (result.length > 0) {
    var fbIds = result.map(function(s) { return s.id; });
    var fbPh  = fbIds.map(function(_, i) { return "$" + (i + 1); }).join(",");
    var { rows: fbRows } = await pool.query(
      'SELECT "sessionId", COUNT(*) AS "feedbackCount", MAX("updatedAt") AS "latestFeedbackAt"' +
      ' FROM session_feedback WHERE "sessionId" IN (' + fbPh + ') GROUP BY "sessionId"',
      fbIds
    );
    var fbMap = {};
    fbRows.forEach(function(r) { fbMap[r.sessionId] = r; });
    result.forEach(function(s) {
      s.feedbackCount    = fbMap[s.id] ? parseInt(fbMap[s.id].feedbackCount, 10) : 0;
      s.latestFeedbackAt = fbMap[s.id] ? fbMap[s.id].latestFeedbackAt : null;
    });

    // Attach shareCount to owned sessions only
    var ownedIds = result.filter(function(s) { return !s._shared; }).map(function(s) { return s.id; });
    if (ownedIds.length > 0) {
      var shrPh = ownedIds.map(function(_, i) { return "$" + (i + 1); }).join(",");
      var { rows: shrRows } = await pool.query(
        'SELECT "sessionId", COUNT(*) AS "shareCount" FROM session_shares WHERE "sessionId" IN (' + shrPh + ') GROUP BY "sessionId"',
        ownedIds
      );
      var shrMap = {};
      shrRows.forEach(function(r) { shrMap[r.sessionId] = r; });
      result.forEach(function(s) {
        if (!s._shared) s.shareCount = shrMap[s.id] ? parseInt(shrMap[s.id].shareCount, 10) : 0;
      });
    }
  }

  return result;
}

async function getSessionById(id) {
  const { rows } = await pool.query("SELECT * FROM sessions WHERE id = $1", [id]);
  return parseSession(rows[0] || null);
}

async function upsertSession(session, userId, orgId) {
  const { rows } = await pool.query(`
    INSERT INTO sessions (id,"orgId","userId","deckId","deckName","deckColor","deckIcon",
      name,account,contact,mode,status,outcome,"startTs","endTs",sold,"soldCardId","soldCardTitle",
      events,notes,metrics)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
    ON CONFLICT (id) DO UPDATE SET
      "deckId"=$4,"deckName"=$5,"deckColor"=$6,"deckIcon"=$7,
      name=$8,account=$9,contact=$10,mode=$11,status=$12,outcome=$13,
      "startTs"=$14,"endTs"=$15,sold=$16,"soldCardId"=$17,"soldCardTitle"=$18,
      events=$19,notes=$20,metrics=$21
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
  ]);
  return rows[0] ? parseSession(rows[0]) : getSessionById(session.id);
}

async function deleteSession(id, userId) {
  await pool.query('DELETE FROM sessions WHERE id = $1 AND "userId" = $2', [id, userId]);
}

// Direct insert for seed script (no userId guard)
async function insertSession(session) {
  await pool.query(`
    INSERT INTO sessions (id,"orgId","userId","deckId","deckName","deckColor","deckIcon",
      name,account,contact,mode,status,outcome,"startTs","endTs",sold,"soldCardId","soldCardTitle",
      events,notes,metrics)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
    ON CONFLICT (id) DO UPDATE SET
      "deckId"=EXCLUDED."deckId","deckName"=EXCLUDED."deckName","deckColor"=EXCLUDED."deckColor",
      "deckIcon"=EXCLUDED."deckIcon",name=EXCLUDED.name,account=EXCLUDED.account,contact=EXCLUDED.contact,
      mode=EXCLUDED.mode,status=EXCLUDED.status,outcome=EXCLUDED.outcome,
      "startTs"=EXCLUDED."startTs","endTs"=EXCLUDED."endTs",sold=EXCLUDED.sold,
      "soldCardId"=EXCLUDED."soldCardId","soldCardTitle"=EXCLUDED."soldCardTitle",
      events=EXCLUDED.events,notes=EXCLUDED.notes,metrics=EXCLUDED.metrics
  `, [
    session.id, session.orgId, session.userId,
    session.deckId, session.deckName, session.deckColor || "#F5A623", session.deckIcon || "💼",
    session.name, session.account || null, session.contact || null,
    session.mode || "live", session.status || "completed", session.outcome || "completed",
    session.startTs, session.endTs || null, session.sold ? true : false,
    session.soldCardId || null, session.soldCardTitle || null,
    JSON.stringify(session.events || []), JSON.stringify(session.notes || []), JSON.stringify(session.metrics || null),
  ]);
}

// ─── SESSION FEEDBACK ─────────────────────────────────────────────────────────
async function getFeedback(sessionId) {
  const { rows } = await pool.query(
    'SELECT * FROM session_feedback WHERE "sessionId" = $1 ORDER BY "createdAt" ASC', [sessionId]
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
  await pool.query(
    'INSERT INTO session_shares (id,"sessionId","fromUserId","toUserId",context,"createdAt") VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT ("sessionId","toUserId") DO NOTHING',
    [id, data.sessionId, data.fromUserId, data.toUserId, data.context || null, now]
  );
  return getShareRecord(data.sessionId, data.toUserId);
}

async function getSharesForSession(sessionId) {
  const { rows } = await pool.query(
    'SELECT ss.*,u."displayName" AS "toUserName",u.email AS "toUserEmail" FROM session_shares ss JOIN users u ON u.id = ss."toUserId" WHERE ss."sessionId" = $1',
    [sessionId]
  );
  return rows;
}

async function deleteShare(shareId, orgId) {
  await pool.query(
    'DELETE FROM session_shares WHERE id = $1 AND "sessionId" IN (SELECT id FROM sessions WHERE "orgId" = $2)',
    [shareId, orgId]
  );
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
  findOrgById, createOrg,
  // teams
  getOrgTeams, getTeamById, createTeam, updateTeam, deleteTeam, setTeamAdmins, getTeamAdmins,
  getUserTeams, setUserTeams, getAdminTeamIds,
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
