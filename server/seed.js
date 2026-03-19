// node server/seed.js  — smart seeding: preserves user-modified records
const {
  pool, uid, initSchema,
  setTeamAdmins,
  setUserTeams,
  setDeckAccess,
  insertSession,
} = require("./db");
const { hashPassword } = require("./auth");
const crypto = require("crypto");

async function runSeed() {

// Ensure schema exists before seeding
await initSchema();

// ─── ONE-TIME MIGRATION ───────────────────────────────────────────────────────
// If seed_manifest is empty but seed users already exist, the DB was seeded with
// the old TRUNCATE system. Purge all sessions so smart-seed starts clean.
// Runs exactly once: after this, manifest has entries and the condition is never true again.
var manifestCount = await pool.query("SELECT COUNT(*) AS n FROM seed_manifest");
if (parseInt(manifestCount.rows[0].n, 10) === 0) {
  var seedUserCheck = await pool.query("SELECT 1 FROM users WHERE id='u_alex' LIMIT 1");
  if (seedUserCheck.rows.length > 0) {
    console.log("First smart-seed run: purging old seed sessions...");
    await pool.query("TRUNCATE sessions, session_feedback, session_shares CASCADE");
  }
}

console.log("Smart seeding — preserving user data...");

const PW_HASH = hashPassword("Overcard2025!");

// ─── UTILITIES ───────────────────────────────────────────────────────────────
var DAY = 24 * 60 * 60 * 1000;

function rnd(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function jitter(base, spread) { return base + Math.floor(Math.random() * spread); }

/** Timestamp for a session ~daysBack ago, within business hours */
function sessionTs(daysBack) {
  var base      = Date.now() - daysBack * DAY;
  var hourOfDay = (8 + Math.floor(Math.random() * 9)) * 3600 * 1000;  // 8am–5pm
  var minJitter = Math.floor(Math.random() * 59) * 60 * 1000;
  return base + hourOfDay + minJitter;
}

/**
 * Build events array from a segment list.
 * segments: Array of { cardIds[], isObjCard, stackLabel, stackId }
 * deckCards: { [id]: card }
 * objCardMaps: { [stackId]: { [cardId]: card } }
 */
function makeEvents(segments, deckCards, objCardMaps, durationMod) {
  var t      = Date.now() - 8 * 60 * 1000;
  var mod    = durationMod || 1;
  var events = [];
  segments.forEach(function(seg) {
    var cardMap = seg.isObjCard ? (objCardMaps && objCardMaps[seg.stackId] ? objCardMaps[seg.stackId] : {}) : deckCards;
    seg.cardIds.forEach(function(cid) {
      var card = cardMap[cid];
      var dur  = Math.round(jitter(7000, 38000) * mod);
      events.push({
        type:         "visit",
        cardId:       cid,
        cardTitle:    card ? card.title : cid,
        cardType:     card ? card.type  : "pitch",
        isObjCard:    !!seg.isObjCard,
        stackLabel:   seg.stackLabel || null,
        intendedPath: card ? !!card.intendedPath : false,
        ts:           t,
        durationMs:   dur,
      });
      t += dur + 500;
    });
  });
  return events;
}

/** Compute session analytics metrics from events + notes */
function computeMetrics(events, notes) {
  var visits       = events.filter(function(e){ return e.type === "visit"; });
  var totalMs      = visits.reduce(function(a, e){ return a + (e.durationMs || 0); }, 0);
  var seenCards    = {};
  var backtracks   = 0;
  var stackEnters  = 0;
  var prevIsObj    = false;
  visits.forEach(function(e) {
    if (seenCards[e.cardId]) backtracks++;
    seenCards[e.cardId] = true;
    if (e.isObjCard && !prevIsObj) stackEnters++;
    prevIsObj = e.isObjCard;
  });
  var intendedVisits = visits.filter(function(e){ return e.intendedPath; }).length;
  return {
    totalVisits:      visits.length,
    intendedVisits:   intendedVisits,
    intendedPct:      visits.length ? Math.round(intendedVisits / visits.length * 100) : 0,
    noteCount:        (notes || []).length,
    answerCount:      Math.max(0, visits.length - 1),
    objectionVisits:  visits.filter(function(e){ return e.isObjCard; }).length,
    uniqueCards:      Object.keys(seenCards).length,
    stackEnterCount:  stackEnters,
    backtrackCount:   backtracks,
    totalMs:          totalMs,
    totalDurationSec: Math.round(totalMs / 1000),
  };
}

// ─── PERSONA DEFINITIONS ─────────────────────────────────────────────────────
var PERSONAS = {
  star: {
    sessionRange: [24, 30],
    practiceRatio: 0.14,
    winRate:       0.40,
    bookedRate:    0.28,
    abandonRate:   0.05,
    objHitRate:    0.18,
    noteFreq:      0.35,
    pathBias:      "ideal",
    durationMod:   0.80,
  },
  solid: {
    sessionRange: [18, 24],
    practiceRatio: 0.26,
    winRate:       0.24,
    bookedRate:    0.30,
    abandonRate:   0.10,
    objHitRate:    0.36,
    noteFreq:      0.55,
    pathBias:      "mixed",
    durationMod:   1.00,
  },
  grinder: {
    sessionRange: [20, 26],
    practiceRatio: 0.36,
    winRate:       0.15,
    bookedRate:    0.30,
    abandonRate:   0.13,
    objHitRate:    0.62,
    noteFreq:      0.72,
    pathBias:      "struggle",
    durationMod:   1.28,
  },
  newbie: {
    sessionRange: [14, 18],
    practiceRatio: 0.52,
    winRate:       0.07,
    bookedRate:    0.16,
    abandonRate:   0.24,
    objHitRate:    0.44,
    noteFreq:      0.82,
    pathBias:      "newbie",
    durationMod:   1.18,
  },
};

function pickOutcome(persona, isLive) {
  if (!isLive) return "completed";
  var r = Math.random();
  if (r < persona.winRate)                       return "sold";
  if (r < persona.winRate + persona.bookedRate)  return "booked";
  if (r > 1 - persona.abandonRate)               return "abandoned";
  return "completed";
}

var NOTE_TEXTS = [
  "Good opener", "Stumbled here", "Strong close", "Prospect engaged",
  "Needs follow-up", "Hit resistance on price", "Clean objection handle",
  "Lost momentum", "Good energy", "Revisit pain point next call",
  "Prospect distracted", "Strong buying signal", "Missed the transition",
  "Great rapport", "Too rushed here", "Solid discovery", "More confidence needed",
  "Anchor the stat", "Slow down on this card", "Good recovery after objection",
  "Ask for next steps sooner", "Let the silence land", "Watch the tone here",
];

var ACCOUNTS = [
  "Acme Corp","Zenith Inc","Stratford Co","Nova Tech","Redline Capital",
  "Orion Systems","Vantage Co","Crestline LLC","Ironwood Partners","Summit Group",
  "Axiom Capital","Peak Solutions","Harbor Group","Atlas Ventures","Coda Systems",
  "Sterling Corp","Radiant Health","Frontier Dynamics","Cobalt Labs","Vertex Group",
  "Cascade Partners","Prism Consulting","Nexus Solutions","Harbinger Tech","Solaris Inc",
];

var CONTACTS = [
  "Jamie Lee","Chris Park","Morgan Wells","Alex Torres","Sam Quinn",
  "Dana Ross","Pat Kim","Quinn Davis","Blake Foster","Cameron Reyes",
  "Jules Morgan","Reese Carter","Avery Hill","Taylor Vance","Jordan Cross",
  "Casey Monroe","Riley West","Logan Pierce","Drew Shaw","Sage Newman",
  "Peyton Cruz","River Stone","Harlow James","Devin Hart","Kendall Wu",
];

/** Generate a set of sessions for a single user. Pure JS — no DB calls. */
function generateUserSessions(user, persona, deckConfigs, orgId) {
  var count    = jitter(persona.sessionRange[0], persona.sessionRange[1] - persona.sessionRange[0] + 1);
  var sessions = [];

  for (var i = 0; i < count; i++) {
    var daysBack  = Math.floor(Math.pow(Math.random(), 0.85) * 90) + 1;
    var isLive    = Math.random() > persona.practiceRatio;
    var mode      = isLive ? "live" : "practice";
    var account_  = isLive ? rnd(ACCOUNTS) : "";
    var contact_  = isLive ? rnd(CONTACTS) : "";
    var deckCfg   = rnd(deckConfigs);

    var hitObj    = Math.random() < persona.objHitRate;
    var pathSet   = hitObj ? deckCfg.pathSets.objection
                  : (persona.pathBias === "ideal"    ? deckCfg.pathSets.ideal
                   : persona.pathBias === "mixed"    ? rnd([deckCfg.pathSets.ideal, deckCfg.pathSets.mixed, deckCfg.pathSets.objection])
                   : persona.pathBias === "struggle" ? rnd([deckCfg.pathSets.struggle, deckCfg.pathSets.objection, deckCfg.pathSets.exit])
                   :                                   rnd([deckCfg.pathSets.mixed,   deckCfg.pathSets.exit,      deckCfg.pathSets.ideal]));

    var segments  = rnd(pathSet);
    var events    = makeEvents(segments, deckCfg.cards, deckCfg.objCardMaps, persona.durationMod);
    var outcome   = pickOutcome(persona, isLive);
    var sold      = outcome === "sold";
    var startTs   = sessionTs(daysBack);
    var durMs     = events.reduce(function(a, e){ return a + (e.durationMs || 0); }, 0);
    var endTs     = startTs + durMs + 2000;

    var notes = [];
    if (Math.random() < persona.noteFreq) {
      var midIdx    = Math.floor(segments.length / 2);
      var noteSegId = segments[midIdx].cardIds[0];
      notes.push({
        cardId: noteSegId,
        cardTitle: (deckCfg.cards[noteSegId] || {}).title || noteSegId,
        text: rnd(NOTE_TEXTS),
        ts: startTs + jitter(5000, 15000),
      });
    }
    if (Math.random() < persona.noteFreq * 0.35) {
      var earlyId = segments[0].cardIds[0];
      notes.push({
        cardId: earlyId,
        cardTitle: (deckCfg.cards[earlyId] || {}).title || earlyId,
        text: rnd(NOTE_TEXTS),
        ts: startTs + jitter(1000, 4000),
      });
    }

    var soldCardId    = null;
    var soldCardTitle = null;
    if (sold) {
      var lastSeg    = segments[segments.length - 1];
      soldCardId     = lastSeg.cardIds[lastSeg.cardIds.length - 1];
      soldCardTitle  = (deckCfg.cards[soldCardId] || {}).title || null;
    }

    sessions.push({
      id:            uid("s"),
      orgId:         orgId,
      userId:        user.id,
      deckId:        deckCfg.id,
      deckName:      deckCfg.name,
      deckColor:     deckCfg.color,
      deckIcon:      deckCfg.icon,
      name:          isLive ? account_ + " · " + contact_ : "Practice run",
      account:       account_,
      contact:       contact_,
      mode:          mode,
      status:        "completed",
      outcome:       outcome,
      startTs:       startTs,
      endTs:         endTs,
      sold:          sold,
      soldCardId:    soldCardId,
      soldCardTitle: soldCardTitle,
      events:        events,
      notes:         notes,
      metrics:       computeMetrics(events, notes),
    });
  }
  return sessions;
}


// ─── SEED HELPERS ─────────────────────────────────────────────────────────────
// Compute a deterministic hash of an object for change detection
function seedHash(obj) {
  return crypto.createHash("md5").update(JSON.stringify(obj)).digest("hex");
}

// Upsert a seed record with user-modification protection.
// - If never tracked: insert and add to manifest
// - If tracked and record deleted: restore it
// - If tracked and unmodified (current DB state matches last-seeded hash): refresh with new seed data
// - If tracked and user-modified: skip (preserve user changes)
async function seedUpsert(tableName, id, trackedFields, upsertFn, getCurrentHashFn) {
  var newHash = seedHash(trackedFields);
  var manifestRes = await pool.query(
    "SELECT content_hash FROM seed_manifest WHERE table_name=$1 AND record_id=$2",
    [tableName, id]
  );

  if (manifestRes.rows.length === 0) {
    // Never tracked — first run. Insert and claim as seed record.
    await upsertFn();
    await pool.query(
      "INSERT INTO seed_manifest (table_name, record_id, content_hash, seeded_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [tableName, id, newHash, Date.now()]
    );
    return "new";
  }

  // Check if record still exists in DB
  var existsRes = await pool.query("SELECT 1 FROM " + tableName + " WHERE id=$1", [id]);
  if (existsRes.rows.length === 0) {
    // Was deleted — restore it
    await upsertFn();
    await pool.query(
      "UPDATE seed_manifest SET content_hash=$1, seeded_at=$2 WHERE table_name=$3 AND record_id=$4",
      [newHash, Date.now(), tableName, id]
    );
    return "restored";
  }

  // Compare current DB state to what seed last set
  var currentHash = await getCurrentHashFn();
  if (currentHash !== manifestRes.rows[0].content_hash) {
    // Hash differs → user modified this record → preserve their changes
    return "skipped";
  }

  // Unmodified — refresh with latest seed data
  await upsertFn();
  await pool.query(
    "UPDATE seed_manifest SET content_hash=$1, seeded_at=$2 WHERE table_name=$3 AND record_id=$4",
    [newHash, Date.now(), tableName, id]
  );
  return "refreshed";
}

// ─── SESSION CLEANUP ──────────────────────────────────────────────────────────
// Delete previously-seeded sessions so we can re-generate fresh ones.
// User-created sessions are never in seed_manifest so they're always preserved.
var oldSeedSessRes = await pool.query(
  "SELECT record_id FROM seed_manifest WHERE table_name='sessions'"
);
var oldSeedIds = oldSeedSessRes.rows.map(function(r) { return r.record_id; });
if (oldSeedIds.length > 0) {
  await pool.query("DELETE FROM sessions WHERE id = ANY($1::text[])", [oldSeedIds]);
  await pool.query("DELETE FROM seed_manifest WHERE table_name='sessions'");
  console.log("Cleared " + oldSeedIds.length + " old seed sessions");
}


// ═══════════════════════════════════════════════════════════════════════════════
// ORG 1 — APEX SALES
// ═══════════════════════════════════════════════════════════════════════════════
var ORG_ID = "org_apex";
var now = Date.now();
{

await seedUpsert("orgs", ORG_ID,
  { name: "Apex Sales" },
  async function() {
    await pool.query(
      'INSERT INTO orgs (id,name,"createdAt") VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET name=$2',
      [ORG_ID, "Apex Sales", now]
    );
  },
  async function() {
    var res = await pool.query("SELECT name FROM orgs WHERE id=$1", [ORG_ID]);
    return res.rows[0] ? seedHash({ name: res.rows[0].name }) : null;
  }
);

// ─── TEAMS ────────────────────────────────────────────────────────────────────
const TEAMS = [
  { id: "team_alpha", name: "Team Alpha" },
  { id: "team_beta",  name: "Team Beta"  },
  { id: "team_gamma", name: "Team Gamma" },
];
for (var i = 0; i < TEAMS.length; i++) {
  var t = TEAMS[i];
  await seedUpsert("teams", t.id,
    { name: t.name, orgId: ORG_ID },
    async function() {
      await pool.query(
        'INSERT INTO teams (id,"orgId",name,"createdAt") VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET name=$3',
        [t.id, ORG_ID, t.name, now]
      );
    },
    async function() {
      var res = await pool.query('SELECT name, "orgId" FROM teams WHERE id=$1', [t.id]);
      return res.rows[0] ? seedHash({ name: res.rows[0].name, orgId: res.rows[0].orgId }) : null;
    }
  );
}

// ─── ADMINS ───────────────────────────────────────────────────────────────────
const ADMINS = [
  { id: "u_alex",   email: "alex@apexsales.com",   displayName: "Alex Mercer",   teamAdmin: "team_alpha" },
  { id: "u_jordan", email: "jordan@apexsales.com",  displayName: "Jordan Rivera", teamAdmin: "team_beta"  },
  { id: "u_sam",    email: "sam@apexsales.com",     displayName: "Sam Patel",     teamAdmin: "team_gamma" },
];
for (var i = 0; i < ADMINS.length; i++) {
  var a = ADMINS[i];
  var aStatus = await seedUpsert("users", a.id,
    { email: a.email, displayName: a.displayName, role: "admin", teamId: null },
    async function() {
      await pool.query(
        'INSERT INTO users (id,"orgId","teamId",email,"passwordHash","displayName",role,"createdAt") VALUES ($1,$2,NULL,$3,$4,$5,\'admin\',$6) ON CONFLICT (id) DO UPDATE SET "teamId"=NULL,email=$3,"displayName"=$5,role=\'admin\'',
        [a.id, ORG_ID, a.email, PW_HASH, a.displayName, now]
      );
    },
    async function() {
      var res = await pool.query('SELECT email, "displayName", role, "teamId" FROM users WHERE id=$1', [a.id]);
      return res.rows[0] ? seedHash({ email: res.rows[0].email, displayName: res.rows[0].displayName, role: res.rows[0].role, teamId: null }) : null;
    }
  );
  await setTeamAdmins(a.teamAdmin, [a.id]);
  await setUserTeams(a.id, [a.teamAdmin]);
}

// ─── REGULAR USERS ────────────────────────────────────────────────────────────
const USERS = [
  { id: "u_marcus",  email: "marcus@apexsales.com",  displayName: "Marcus Chen",    teamId: "team_alpha", persona: "star"    },
  { id: "u_priya",   email: "priya@apexsales.com",   displayName: "Priya Nair",     teamId: "team_alpha", persona: "solid"   },
  { id: "u_tyler",   email: "tyler@apexsales.com",   displayName: "Tyler Brooks",   teamId: "team_alpha", persona: "grinder" },
  { id: "u_sofia",   email: "sofia@apexsales.com",   displayName: "Sofia Martinez", teamId: "team_alpha", persona: "newbie"  },
  { id: "u_dani",    email: "dani@apexsales.com",    displayName: "Dani Walsh",     teamId: "team_beta",  persona: "solid"   },
  { id: "u_kenji",   email: "kenji@apexsales.com",   displayName: "Kenji Tanaka",   teamId: "team_beta",  persona: "star"    },
  { id: "u_amara",   email: "amara@apexsales.com",   displayName: "Amara Osei",     teamId: "team_beta",  persona: "grinder" },
  { id: "u_ryan",    email: "ryan@apexsales.com",    displayName: "Ryan Costello",  teamId: "team_beta",  persona: "newbie"  },
  { id: "u_leila",   email: "leila@apexsales.com",   displayName: "Leila Hassan",   teamId: "team_gamma", persona: "solid"   },
  { id: "u_colt",    email: "colt@apexsales.com",    displayName: "Colt Barnard",   teamId: "team_gamma", persona: "star"    },
  { id: "u_zara",    email: "zara@apexsales.com",    displayName: "Zara Kim",       teamId: "team_gamma", persona: "newbie"  },
  { id: "u_derek",   email: "derek@apexsales.com",   displayName: "Derek Pham",     teamId: "team_gamma", persona: "grinder" },
];
for (var i = 0; i < USERS.length; i++) {
  var u = USERS[i];
  var uStatus = await seedUpsert("users", u.id,
    { email: u.email, displayName: u.displayName, role: "user", teamId: u.teamId },
    async function() {
      await pool.query(
        'INSERT INTO users (id,"orgId","teamId",email,"passwordHash","displayName",role,"createdAt") VALUES ($1,$2,$3,$4,$5,$6,\'user\',$7) ON CONFLICT (id) DO UPDATE SET "teamId"=$3,email=$4,"displayName"=$6,role=\'user\'',
        [u.id, ORG_ID, u.teamId, u.email, PW_HASH, u.displayName, now]
      );
    },
    async function() {
      var res = await pool.query('SELECT email, "displayName", role, "teamId" FROM users WHERE id=$1', [u.id]);
      return res.rows[0] ? seedHash({ email: res.rows[0].email, displayName: res.rows[0].displayName, role: res.rows[0].role, teamId: res.rows[0].teamId }) : null;
    }
  );
  // Always sync user_teams — idempotent, ensures membership is correct even if
  // the old TRUNCATE-based seed never populated user_teams for this user
  await setUserTeams(u.id, [u.teamId]);
}

// ─── DECKS ────────────────────────────────────────────────────────────────────
const ENT_ID  = "d_apex_ent";
const SMB_ID  = "d_apex_smb";
const PRIV_ID = "d_apex_exec";

const ENT_CARDS = {
  "ec0":  { id:"ec0",  title:"Cold Open",         type:"pitch",     prompt:"*Hey [Name]*[Warm] — quick one. I help sales teams cut ramp time by 40%. **Worth 90 seconds?**",                                                         overview:["Short, punchy opener","Watch their energy"],    intendedPath:true,  answers:[{id:"ea0",label:"Sure, go ahead",next:"ec1"},{id:"ea1",label:"Not interested / busy",next:"ec2"},{id:"ea2",label:"Who are you?",next:"ec0b"}] },
  "ec0b": { id:"ec0b", title:"Re-intro",           type:"pitch",     prompt:"*Totally fair*[Empathetic] — I'm [Name] from OverCard. We help SDR teams stay on script under pressure. **30 seconds?**",                                 overview:["Brief re-anchor","Stay confident"],             intendedPath:false, answers:[{id:"ea3",label:"Fine, go ahead",next:"ec1"},{id:"ea4",label:"Still not interested",next:"ec2"}] },
  "ec1":  { id:"ec1",  title:"Value Hook",         type:"pitch",     prompt:"We noticed most reps *forget 60% of their script*[Pause] within the first 30 seconds of objections. **OverCard keeps them on track — live, in the call.**", overview:["Land the stat","Short silence after"],          intendedPath:true,  answers:[{id:"ea5",label:"Interesting — how?",next:"ec3"},{id:"ea6",label:"We have training already",next:"eo_train"},{id:"ea7",label:"Not a priority",next:"ec2"}] },
  "ec2":  { id:"ec2",  title:"Soft Exit",          type:"close",     prompt:"*No worries at all*[Empathetic] — *when would be a better time?*[Question]",                                                                              overview:["Low pressure close","Always leave the door open"],intendedPath:false, answers:[{id:"ea8",label:"Try next quarter",next:null},{id:"ea9",label:"Actually, keep going",next:"ec1"}] },
  "ec3":  { id:"ec3",  title:"Discovery — Pain",   type:"discovery", prompt:"*Quick question*[Pause] — how long does it take a new rep at your company to hit quota? And **how many are still struggling at 6 months?**",              overview:["Let them calculate","Don't rush the silence"],  intendedPath:true,  answers:[{id:"eaa",label:"Long ramp / high struggle",next:"ec4"},{id:"eab",label:"We're actually doing fine",next:"ec3b"},{id:"eac",label:"Not sure / varies",next:"ec4"}] },
  "ec3b": { id:"ec3b", title:"Reframe",             type:"discovery", prompt:"*That's great*[Warm] — even teams at 80% quota hit still leave 20% on the table. **What's that worth to you annually?**",                                overview:["Reframe from good to great","Let the math sink in"],intendedPath:false,answers:[{id:"ead",label:"Hmm, fair point",next:"ec4"},{id:"eae",label:"Still don't see the need",next:"ec2"}] },
  "ec4":  { id:"ec4",  title:"Demo Ask",            type:"close",     prompt:"*Here's what I'd suggest*[Confident] — **let me show you a 15-minute live demo with your actual reps' scenarios.** No pitch deck, just the tool.",       overview:["Specific and concrete ask","Offer a clear next step"],intendedPath:true,answers:[{id:"eaf",label:"Yeah, set it up",next:"ec5"},{id:"eag",label:"Need to check with my team",next:"ec4b"},{id:"eah",label:"Not ready yet",next:"ec2"}] },
  "ec4b": { id:"ec4b", title:"Stakeholder Bridge",  type:"close",     prompt:"*Completely understand*[Empathetic] — **who else should be on the call?** I can send a short overview to get everyone aligned beforehand.",               overview:["Don't stall here","Get the next meeting"],      intendedPath:false, answers:[{id:"eai",label:"I'll loop them in",next:"ec5"},{id:"eaj",label:"Just me for now",next:"ec5"}] },
  "ec5":  { id:"ec5",  title:"Book the Demo",       type:"close",     prompt:"**Perfect.** *I'll send a calendar link now*[Speed Up] — does **Tuesday or Wednesday** work, morning or afternoon?",                                     overview:["Assume the meeting","Two-option close"],        intendedPath:true,  answers:[{id:"eak",label:"Booked ✓",next:null},{id:"eal",label:"Different time",next:null}] },
};

const ENT_OBJ_STACKS = [
  {
    id:"os_price", label:"Too Expensive", icon:"💰", rootCard:"op1",
    cards:{
      "op1":{ id:"op1",title:"Price Objection",type:"objection",prompt:"*I hear you*[Empathetic] — *what budget range are you working with?*[Question]",overview:[],intendedPath:false,answers:[{id:"opa1",label:"Under $X",next:"op2"},{id:"opa2",label:"Nothing right now",next:"op3"}] },
      "op2":{ id:"op2",title:"ROI Frame",     type:"objection",prompt:"*At that range*[Cautious] — if we cut onboarding time by just **two weeks per rep**, what does that save you in lost revenue?",overview:["Let them do the math"],intendedPath:false,answers:[{id:"opa3",label:"That's actually significant",next:null},{id:"opa4",label:"Still too much",next:"op3"}] },
      "op3":{ id:"op3",title:"Future Hook",   type:"objection",prompt:"*Totally fair*[Empathetic] — **mind if I check back when Q2 planning opens up?**",overview:[],intendedPath:false,answers:[{id:"opa5",label:"Sure",next:null},{id:"opa6",label:"No thanks",next:null}] },
    },
  },
  {
    id:"os_comp", label:"Using a Competitor", icon:"⚔️", rootCard:"oc1",
    cards:{
      "oc1":{ id:"oc1",title:"Comp Probe",    type:"objection",prompt:"*Interesting — which one?*[Question] *We actually integrate with most of them*[Confident] — or replace them depending on the gap.",overview:["Stay curious, not defensive"],intendedPath:false,answers:[{id:"oca1",label:"Tool X",next:"oc2"},{id:"oca2",label:"Built in-house",next:"oc3"}] },
      "oc2":{ id:"oc2",title:"Differentiate", type:"objection",prompt:"*[Tool X] is great for [Y]*[Confident] — **where it falls short is live in-call coaching.** That's where reps lose deals they should win.",overview:["Specific, not generic"],intendedPath:false,answers:[{id:"oca3",label:"That's our gap too",next:null},{id:"oca4",label:"We're happy with it",next:null}] },
      "oc3":{ id:"oc3",title:"Built In-House",type:"objection",prompt:"*Nice — what does maintaining that cost you per quarter?*[Question] **Most teams find the upkeep isn't worth it once they see the difference.**",overview:[],intendedPath:false,answers:[{id:"oca5",label:"Fair point",next:null},{id:"oca6",label:"We're committed to it",next:null}] },
    },
  },
];

await seedUpsert("decks", ENT_ID,
  { name:"Enterprise Outbound", color:"#F5A623", icon:"🏢", rootCard:"ec0", visibility:"public", cards:ENT_CARDS, objStacks:ENT_OBJ_STACKS },
  async function() {
    await pool.query(
      `INSERT INTO decks (id,"orgId","createdBy",name,color,icon,"rootCard",cards,"objStacks",visibility,"updatedAt","createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
       ON CONFLICT (id) DO UPDATE SET name=$4,color=$5,icon=$6,"rootCard"=$7,cards=$8,"objStacks"=$9,visibility=$10,"updatedAt"=$11`,
      [ENT_ID, ORG_ID, "u_alex", "Enterprise Outbound", "#F5A623", "🏢", "ec0",
       JSON.stringify(ENT_CARDS), JSON.stringify(ENT_OBJ_STACKS), "public", now]
    );
  },
  async function() {
    var res = await pool.query(
      'SELECT name, color, icon, "rootCard", visibility, cards, "objStacks" FROM decks WHERE id=$1',
      [ENT_ID]
    );
    if (!res.rows[0]) return null;
    var r = res.rows[0];
    var cards = typeof r.cards === "string" ? JSON.parse(r.cards) : (r.cards || {});
    var objStacks = typeof r["objStacks"] === "string" ? JSON.parse(r["objStacks"]) : (r["objStacks"] || []);
    return seedHash({ name:r.name, color:r.color, icon:r.icon, rootCard:r.rootCard, visibility:r.visibility||"public", cards, objStacks });
  }
);

const SMB_CARDS = {
  "sc0":    { id:"sc0",    title:"Warm Open",       type:"pitch",     prompt:"*Hey — thanks for picking up*[Warm]. I'll be quick. **We help small sales teams close 20% more deals with better call structure.** Sound useful?",    overview:["Friendly, casual tone","Stay conversational"],  intendedPath:true,  answers:[{id:"sa0",label:"Maybe — what is it?",next:"sc1"},{id:"sa1",label:"Not interested",next:"sc_exit"},{id:"sa2",label:"How'd you get my number?",next:"sc0b"}] },
  "sc0b":   { id:"sc0b",   title:"Source Bridge",   type:"pitch",     prompt:"*Fair question*[Sincere] — you came up through [Source]. I won't take much of your time. **30 seconds?**",                                           overview:[],                                               intendedPath:false, answers:[{id:"sa3",label:"Fine",next:"sc1"},{id:"sa4",label:"Take me off the list",next:null}] },
  "sc1":    { id:"sc1",    title:"Problem Probe",   type:"discovery", prompt:"*Quick question*[Pause] — **what's the #1 thing killing your close rate right now?** Objections? Pipeline? Inconsistency across reps?",              overview:["Open-ended","Let them name the pain"],          intendedPath:true,  answers:[{id:"sa5",label:"Objection handling",next:"sc2"},{id:"sa6",label:"Inconsistent reps",next:"sc2"},{id:"sa7",label:"We're doing fine",next:"sc1b"}] },
  "sc1b":   { id:"sc1b",   title:"Reframe",         type:"discovery", prompt:"*That's great*[Warm] — even teams hitting quota leave deals on the table. **How many reps do you have, and what's your average deal size?**",        overview:[],                                               intendedPath:false, answers:[{id:"sa8",label:"Small team, small deals",next:"sc2"},{id:"sa9",label:"Not sharing that",next:"sc_exit"}] },
  "sc2":    { id:"sc2",    title:"Solution Bridge", type:"pitch",     prompt:"**That's exactly what OverCard solves** — your reps get a *live prompt system*[Confident] that keeps them on-script under pressure. No more winging it.", overview:["Keep it simple","One clear benefit"],           intendedPath:true,  answers:[{id:"saa",label:"Show me how",next:"sc3"},{id:"sab",label:"We have a playbook already",next:"sc2b"},{id:"sac",label:"Sounds complicated",next:"sc2c"}] },
  "sc2b":   { id:"sc2b",   title:"Playbook Gap",    type:"pitch",     prompt:"*Playbooks are great*[Empathetic] — **the problem is reps don't use them in the moment.** OverCard puts it in their ear live.",                       overview:[],                                               intendedPath:false, answers:[{id:"sad",label:"True, that's our issue",next:"sc3"},{id:"sae",label:"Our reps are disciplined",next:"sc_exit"}] },
  "sc2c":   { id:"sc2c",   title:"Simplicity Sell", type:"pitch",     prompt:"*It's actually the opposite*[Warm] — **3 taps and they're in the flow.** Most reps are live in under 5 minutes.",                                    overview:[],                                               intendedPath:false, answers:[{id:"saf",label:"Oh, that simple?",next:"sc3"},{id:"sag",label:"Still skeptical",next:"sc_exit"}] },
  "sc3":    { id:"sc3",    title:"Close — Trial",   type:"close",     prompt:"*Here's what I'd do*[Confident] — **let's set up a free 2-week trial with two of your reps.** No contract. Just results.",                           overview:["Low-risk ask","Specific and concrete"],         intendedPath:true,  answers:[{id:"sah",label:"Sure, let's try it",next:"sc4"},{id:"sai",label:"Need approval first",next:"sc3b"},{id:"saj",label:"Not ready",next:"sc_exit"}] },
  "sc3b":   { id:"sc3b",   title:"Approval Path",   type:"close",     prompt:"*Totally get it*[Empathetic] — **what does your approval process look like, and who's the decision maker?**",                                        overview:["Map the path","Don't get stuck"],               intendedPath:false, answers:[{id:"sak",label:"I can decide",next:"sc4"},{id:"sal",label:"Need to talk to my manager",next:null}] },
  "sc4":    { id:"sc4",    title:"Next Step Locked", type:"close",    prompt:"**Great.** *I'll send over the setup link now*[Speed Up] — **what's the best email, and should I cc anyone?**",                                      overview:["Assume the yes","Move fast"],                   intendedPath:true,  answers:[{id:"sam",label:"Trial booked ✓",next:null}] },
  "sc_exit":{ id:"sc_exit",title:"Graceful Exit",   type:"close",     prompt:"*No worries at all*[Empathetic] — *mind if I reach back out next quarter?*[Question]",                                                               overview:["Always leave the door open"],                   intendedPath:false, answers:[{id:"san",label:"Sure",next:null},{id:"sao",label:"No thanks",next:null}] },
};

const SMB_OBJ_STACKS = [
  {
    id:"os_time", label:"No Time Right Now", icon:"⏰", rootCard:"ot1",
    cards:{
      "ot1":{ id:"ot1",title:"Time Objection", type:"objection",prompt:"*Totally understand*[Empathetic] — **literally 60 seconds: is ramp time or objection handling your bigger headache right now?**",overview:["Reframe as short"],intendedPath:false,answers:[{id:"ota1",label:"Ramp time",next:null},{id:"ota2",label:"Objections",next:null},{id:"ota3",label:"Call me later",next:null}] },
    },
  },
  {
    id:"os_size", label:"Too Small / Not for Us", icon:"📏", rootCard:"os1",
    cards:{
      "os1":{ id:"os1",title:"Size Objection", type:"objection",prompt:"*Actually our best customers have 3–10 reps*[Warm] — **smaller teams see faster ROI because every rep matters more.** What size is your team?",overview:[],intendedPath:false,answers:[{id:"osa1",label:"Under 5 reps",next:null},{id:"osa2",label:"5–15 reps",next:null},{id:"osa3",label:"Still not for us",next:null}] },
    },
  },
];

await seedUpsert("decks", SMB_ID,
  { name:"SMB Inbound", color:"#4FC3F7", icon:"🏗️", rootCard:"sc0", visibility:"public", cards:SMB_CARDS, objStacks:SMB_OBJ_STACKS },
  async function() {
    await pool.query(
      `INSERT INTO decks (id,"orgId","createdBy",name,color,icon,"rootCard",cards,"objStacks",visibility,"updatedAt","createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
       ON CONFLICT (id) DO UPDATE SET name=$4,color=$5,icon=$6,"rootCard"=$7,cards=$8,"objStacks"=$9,visibility=$10,"updatedAt"=$11`,
      [SMB_ID, ORG_ID, "u_alex", "SMB Inbound", "#4FC3F7", "🏗️", "sc0",
       JSON.stringify(SMB_CARDS), JSON.stringify(SMB_OBJ_STACKS), "public", now]
    );
  },
  async function() {
    var res = await pool.query(
      'SELECT name, color, icon, "rootCard", visibility, cards, "objStacks" FROM decks WHERE id=$1',
      [SMB_ID]
    );
    if (!res.rows[0]) return null;
    var r = res.rows[0];
    var cards = typeof r.cards === "string" ? JSON.parse(r.cards) : (r.cards || {});
    var objStacks = typeof r["objStacks"] === "string" ? JSON.parse(r["objStacks"]) : (r["objStacks"] || []);
    return seedHash({ name:r.name, color:r.color, icon:r.icon, rootCard:r.rootCard, visibility:r.visibility||"public", cards, objStacks });
  }
);

// ─── PRIVATE TEST DECK (Team Alpha only) ──────────────────────────────────────
const PRIV_CARDS = {
  "pc0": { id:"pc0", title:"Exec Opener",      type:"pitch",     prompt:"*[Name]*[Warm] — I'll keep this tight. **We help sales orgs compress their top-of-funnel by 35% without adding headcount.** Worth 2 minutes?",                  overview:["Executive-level energy","No fluff"],           intendedPath:true,  answers:[{id:"pa0",label:"Sure, go ahead",next:"pc1"},{id:"pa1",label:"Not now",next:"pc_exit"}] },
  "pc1": { id:"pc1", title:"Strategic Pain",   type:"discovery", prompt:"*Quick one*[Pause] — **where's your biggest pipeline leak right now?** Top of funnel, mid-stage, or close?",                                                   overview:["Let them name it","Don't lead the witness"],   intendedPath:true,  answers:[{id:"pa2",label:"Top of funnel",next:"pc2"},{id:"pa3",label:"Mid-stage",next:"pc2"},{id:"pa4",label:"Close stage",next:"pc2"},{id:"pa5",label:"We're good",next:"pc_exit"}] },
  "pc2": { id:"pc2", title:"Business Impact",  type:"discovery", prompt:"*At your scale*[Confident] — **what does a 10% improvement in that stage mean in closed revenue per quarter?** I want to make sure the math makes sense.",     overview:["Anchor to dollars","Let them calculate"],      intendedPath:true,  answers:[{id:"pa6",label:"Significant",next:"pc3"},{id:"pa7",label:"Not sure",next:"pc3"}] },
  "pc3": { id:"pc3", title:"Close — Workshop", type:"close",     prompt:"*Here's what I'd propose*[Confident] — **a 30-minute executive walkthrough with your VP and two team leads.** We map your specific gaps and show the delta.", overview:["High-level ask","Name the attendees"],          intendedPath:true,  answers:[{id:"pa8",label:"Set it up",next:null},{id:"pa9",label:"Send info first",next:null},{id:"paa",label:"Not ready",next:"pc_exit"}] },
  "pc_exit":{ id:"pc_exit", title:"Executive Exit", type:"close", prompt:"*Completely understand*[Empathetic] — *when would be a better quarter to revisit this?*[Question]",                                                           overview:["Leave the door open"],                          intendedPath:false, answers:[{id:"pab",label:"Next quarter",next:null},{id:"pac",label:"Not interested",next:null}] },
};

await seedUpsert("decks", PRIV_ID,
  { name:"Executive Playbook", color:"#AB47BC", icon:"🔒", rootCard:"pc0", visibility:"private", cards:PRIV_CARDS, objStacks:[] },
  async function() {
    await pool.query(
      `INSERT INTO decks (id,"orgId","createdBy",name,color,icon,"rootCard",cards,"objStacks",visibility,"updatedAt","createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
       ON CONFLICT (id) DO UPDATE SET name=$4,color=$5,icon=$6,"rootCard"=$7,cards=$8,"objStacks"=$9,visibility=$10,"updatedAt"=$11`,
      [PRIV_ID, ORG_ID, "u_alex", "Executive Playbook", "#AB47BC", "🔒", "pc0",
       JSON.stringify(PRIV_CARDS), JSON.stringify([]), "private", now]
    );
  },
  async function() {
    var res = await pool.query(
      'SELECT name, color, icon, "rootCard", visibility, cards, "objStacks" FROM decks WHERE id=$1',
      [PRIV_ID]
    );
    if (!res.rows[0]) return null;
    var r = res.rows[0];
    var cards = typeof r.cards === "string" ? JSON.parse(r.cards) : (r.cards || {});
    var objStacks = typeof r["objStacks"] === "string" ? JSON.parse(r["objStacks"]) : (r["objStacks"] || []);
    return seedHash({ name:r.name, color:r.color, icon:r.icon, rootCard:r.rootCard, visibility:r.visibility||"public", cards, objStacks });
  }
);
await setDeckAccess(PRIV_ID, [{ entityType: "team", entityId: "team_alpha" }]);

// ─── ENT PATH TEMPLATES ───────────────────────────────────────────────────────
var ENT_PATH_SETS = {
  ideal: [
    [{cardIds:["ec0","ec1","ec3","ec4","ec5"],            isObjCard:false}],
    [{cardIds:["ec0","ec1","ec3","ec3b","ec4","ec5"],      isObjCard:false}],
    [{cardIds:["ec0","ec1","ec3","ec4b","ec5"],            isObjCard:false}],
  ],
  mixed: [
    [{cardIds:["ec0","ec0b","ec1","ec3","ec4","ec5"],      isObjCard:false}],
    [{cardIds:["ec0","ec1","ec3","ec3b","ec4","ec4b","ec5"],isObjCard:false}],
    [{cardIds:["ec0","ec1","ec3","ec4","ec5"],             isObjCard:false}],
  ],
  objection: [
    [{cardIds:["ec0","ec1"],isObjCard:false},{cardIds:["op1","op2"],isObjCard:true,stackLabel:"Too Expensive",stackId:"os_price"},{cardIds:["ec3","ec4","ec5"],isObjCard:false}],
    [{cardIds:["ec0","ec1"],isObjCard:false},{cardIds:["oc1","oc2"],isObjCard:true,stackLabel:"Using a Competitor",stackId:"os_comp"},{cardIds:["ec3","ec4","ec5"],isObjCard:false}],
    [{cardIds:["ec0","ec1"],isObjCard:false},{cardIds:["op1","op3"],isObjCard:true,stackLabel:"Too Expensive",stackId:"os_price"},{cardIds:["ec3","ec4"],isObjCard:false}],
    [{cardIds:["ec0","ec1"],isObjCard:false},{cardIds:["oc1","oc3"],isObjCard:true,stackLabel:"Using a Competitor",stackId:"os_comp"},{cardIds:["ec3","ec4b","ec5"],isObjCard:false}],
  ],
  struggle: [
    [{cardIds:["ec0","ec1"],isObjCard:false},{cardIds:["op1","op2"],isObjCard:true,stackLabel:"Too Expensive",stackId:"os_price"},{cardIds:["ec3"],isObjCard:false},{cardIds:["oc1","oc2"],isObjCard:true,stackLabel:"Using a Competitor",stackId:"os_comp"},{cardIds:["ec4","ec5"],isObjCard:false}],
    [{cardIds:["ec0","ec0b","ec1"],isObjCard:false},{cardIds:["op1","op3"],isObjCard:true,stackLabel:"Too Expensive",stackId:"os_price"},{cardIds:["ec3","ec3b","ec4b","ec5"],isObjCard:false}],
    [{cardIds:["ec0","ec1"],isObjCard:false},{cardIds:["oc1","oc3"],isObjCard:true,stackLabel:"Using a Competitor",stackId:"os_comp"},{cardIds:["ec3","ec3b"],isObjCard:false},{cardIds:["op1","op2"],isObjCard:true,stackLabel:"Too Expensive",stackId:"os_price"},{cardIds:["ec4","ec5"],isObjCard:false}],
  ],
  exit: [
    [{cardIds:["ec0","ec2"],                              isObjCard:false}],
    [{cardIds:["ec0","ec0b","ec2"],                       isObjCard:false}],
    [{cardIds:["ec0","ec1","ec2"],                        isObjCard:false}],
    [{cardIds:["ec0","ec1","ec3","ec4"],                  isObjCard:false}],
  ],
};

var ENT_OBJ_MAP = {};
ENT_OBJ_STACKS.forEach(function(s){ ENT_OBJ_MAP[s.id] = s.cards; });

// ─── SMB PATH TEMPLATES ───────────────────────────────────────────────────────
var SMB_PATH_SETS = {
  ideal: [
    [{cardIds:["sc0","sc1","sc2","sc3","sc4"],            isObjCard:false}],
    [{cardIds:["sc0","sc1","sc2","sc2b","sc3","sc4"],      isObjCard:false}],
    [{cardIds:["sc0","sc1","sc2","sc3b","sc4"],            isObjCard:false}],
  ],
  mixed: [
    [{cardIds:["sc0","sc0b","sc1","sc2","sc3","sc4"],      isObjCard:false}],
    [{cardIds:["sc0","sc1","sc1b","sc2","sc3","sc4"],      isObjCard:false}],
    [{cardIds:["sc0","sc1","sc2","sc2c","sc3","sc4"],      isObjCard:false}],
  ],
  objection: [
    [{cardIds:["sc0","sc1"],isObjCard:false},{cardIds:["ot1"],isObjCard:true,stackLabel:"No Time Right Now",stackId:"os_time"},{cardIds:["sc2","sc3","sc4"],isObjCard:false}],
    [{cardIds:["sc0","sc1"],isObjCard:false},{cardIds:["os1"],isObjCard:true,stackLabel:"Too Small / Not for Us",stackId:"os_size"},{cardIds:["sc2","sc3","sc4"],isObjCard:false}],
    [{cardIds:["sc0","sc1","sc2"],isObjCard:false},{cardIds:["ot1"],isObjCard:true,stackLabel:"No Time Right Now",stackId:"os_time"},{cardIds:["sc3","sc4"],isObjCard:false}],
    [{cardIds:["sc0","sc1"],isObjCard:false},{cardIds:["os1"],isObjCard:true,stackLabel:"Too Small / Not for Us",stackId:"os_size"},{cardIds:["sc2","sc2b","sc3","sc4"],isObjCard:false}],
  ],
  struggle: [
    [{cardIds:["sc0","sc1"],isObjCard:false},{cardIds:["ot1"],isObjCard:true,stackLabel:"No Time Right Now",stackId:"os_time"},{cardIds:["sc2","sc2b"],isObjCard:false},{cardIds:["os1"],isObjCard:true,stackLabel:"Too Small / Not for Us",stackId:"os_size"},{cardIds:["sc3","sc4"],isObjCard:false}],
    [{cardIds:["sc0","sc0b","sc1","sc1b"],isObjCard:false},{cardIds:["ot1"],isObjCard:true,stackLabel:"No Time Right Now",stackId:"os_time"},{cardIds:["sc2","sc3b","sc4"],isObjCard:false}],
    [{cardIds:["sc0","sc1","sc2","sc2c"],isObjCard:false},{cardIds:["os1"],isObjCard:true,stackLabel:"Too Small / Not for Us",stackId:"os_size"},{cardIds:["sc3","sc3b","sc4"],isObjCard:false}],
  ],
  exit: [
    [{cardIds:["sc0","sc_exit"],                          isObjCard:false}],
    [{cardIds:["sc0","sc1","sc_exit"],                    isObjCard:false}],
    [{cardIds:["sc0","sc0b","sc1","sc2","sc_exit"],        isObjCard:false}],
    [{cardIds:["sc0","sc1","sc2","sc3","sc_exit"],         isObjCard:false}],
  ],
};

var SMB_OBJ_MAP = {};
SMB_OBJ_STACKS.forEach(function(s){ SMB_OBJ_MAP[s.id] = s.cards; });

var APEX_DECK_CONFIGS = [
  { id:ENT_ID, name:"Enterprise Outbound", color:"#F5A623", icon:"🏢", cards:ENT_CARDS, objCardMaps:ENT_OBJ_MAP, pathSets:ENT_PATH_SETS },
  { id:SMB_ID, name:"SMB Inbound",         color:"#4FC3F7", icon:"🏗️", cards:SMB_CARDS, objCardMaps:SMB_OBJ_MAP, pathSets:SMB_PATH_SETS },
];

// ─── GENERATE SESSIONS ────────────────────────────────────────────────────────
var totalSessions = 0;
for (var i = 0; i < USERS.length; i++) {
  var u        = USERS[i];
  var persona  = PERSONAS[u.persona];
  var sessions = generateUserSessions(u, persona, APEX_DECK_CONFIGS, ORG_ID);
  for (var j = 0; j < sessions.length; j++) {
    await insertSession(sessions[j]);
    await pool.query(
      "INSERT INTO seed_manifest (table_name, record_id, content_hash, seeded_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      ["sessions", sessions[j].id, "seed", Date.now()]
    );
    totalSessions++;
  }
}

console.log("Apex Sales seeded:");
console.log("   Teams: 3 | Admins: 3 | Users: 12 | Decks: 3 (1 private: Executive Playbook -> team_alpha) | Sessions: " + totalSessions);
console.log("   Personas -- star: Marcus, Kenji, Colt | solid: Priya, Dani, Leila");
console.log("           -- grinder: Tyler, Amara, Derek | newbie: Sofia, Ryan, Zara");
console.log("   Password (all): [see seed.js]");

} // end org_apex block


// ═══════════════════════════════════════════════════════════════════════════════
// ORG 2 — MERIDIAN GROUP
// ═══════════════════════════════════════════════════════════════════════════════
var ORG2_ID = "org_meridian";
var m_now = Date.now();
{

await seedUpsert("orgs", ORG2_ID,
  { name: "Meridian Group" },
  async function() {
    await pool.query(
      'INSERT INTO orgs (id,name,"createdAt") VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET name=$2',
      [ORG2_ID, "Meridian Group", m_now]
    );
  },
  async function() {
    var res = await pool.query("SELECT name FROM orgs WHERE id=$1", [ORG2_ID]);
    return res.rows[0] ? seedHash({ name: res.rows[0].name }) : null;
  }
);

var M_TEAMS = [
  { id: "team_north", name: "Team North" },
  { id: "team_south", name: "Team South" },
];
for (var i = 0; i < M_TEAMS.length; i++) {
  var t = M_TEAMS[i];
  await seedUpsert("teams", t.id,
    { name: t.name, orgId: ORG2_ID },
    async function() {
      await pool.query(
        'INSERT INTO teams (id,"orgId",name,"createdAt") VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET name=$3',
        [t.id, ORG2_ID, t.name, m_now]
      );
    },
    async function() {
      var res = await pool.query('SELECT name, "orgId" FROM teams WHERE id=$1', [t.id]);
      return res.rows[0] ? seedHash({ name: res.rows[0].name, orgId: res.rows[0].orgId }) : null;
    }
  );
}

var M_ADMINS = [
  { id: "u_casey", email: "casey@meridiangroup.com", displayName: "Casey Wright", teamAdmin: "team_north" },
  { id: "u_riley", email: "riley@meridiangroup.com", displayName: "Riley Stone",  teamAdmin: "team_south" },
];
for (var i = 0; i < M_ADMINS.length; i++) {
  var a = M_ADMINS[i];
  await seedUpsert("users", a.id,
    { email: a.email, displayName: a.displayName, role: "admin", teamId: null },
    async function() {
      await pool.query(
        'INSERT INTO users (id,"orgId","teamId",email,"passwordHash","displayName",role,"createdAt") VALUES ($1,$2,NULL,$3,$4,$5,\'admin\',$6) ON CONFLICT (id) DO UPDATE SET "teamId"=NULL,email=$3,"displayName"=$5,role=\'admin\'',
        [a.id, ORG2_ID, a.email, PW_HASH, a.displayName, m_now]
      );
    },
    async function() {
      var res = await pool.query('SELECT email, "displayName", role, "teamId" FROM users WHERE id=$1', [a.id]);
      return res.rows[0] ? seedHash({ email: res.rows[0].email, displayName: res.rows[0].displayName, role: res.rows[0].role, teamId: null }) : null;
    }
  );
  await setTeamAdmins(a.teamAdmin, [a.id]);
  await setUserTeams(a.id, [a.teamAdmin]);
}

var M_USERS = [
  { id: "u_fox",   email: "fox@meridiangroup.com",   displayName: "Jordan Fox",  teamId: "team_north", persona: "solid"   },
  { id: "u_blake", email: "blake@meridiangroup.com", displayName: "Avery Blake", teamId: "team_north", persona: "star"    },
  { id: "u_shaw",  email: "shaw@meridiangroup.com",  displayName: "Morgan Shaw", teamId: "team_south", persona: "grinder" },
  { id: "u_reed",  email: "reed@meridiangroup.com",  displayName: "Taylor Reed", teamId: "team_south", persona: "newbie"  },
];
for (var i = 0; i < M_USERS.length; i++) {
  var u = M_USERS[i];
  var muStatus = await seedUpsert("users", u.id,
    { email: u.email, displayName: u.displayName, role: "user", teamId: u.teamId },
    async function() {
      await pool.query(
        'INSERT INTO users (id,"orgId","teamId",email,"passwordHash","displayName",role,"createdAt") VALUES ($1,$2,$3,$4,$5,$6,\'user\',$7) ON CONFLICT (id) DO UPDATE SET "teamId"=$3,email=$4,"displayName"=$6,role=\'user\'',
        [u.id, ORG2_ID, u.teamId, u.email, PW_HASH, u.displayName, m_now]
      );
    },
    async function() {
      var res = await pool.query('SELECT email, "displayName", role, "teamId" FROM users WHERE id=$1', [u.id]);
      return res.rows[0] ? seedHash({ email: res.rows[0].email, displayName: res.rows[0].displayName, role: res.rows[0].role, teamId: res.rows[0].teamId }) : null;
    }
  );
  await setUserTeams(u.id, [u.teamId]);
}

// ─── MERIDIAN DECK ────────────────────────────────────────────────────────────
var M_DECK_ID  = "d_merd_out";
var M_PRIV_ID  = "d_merd_partner";

var M_CARDS = {
  "mc0":    { id:"mc0",    title:"Intro",          type:"pitch",     prompt:"*Hi [Name]*[Warm] — I'll be quick. **Meridian helps mid-market teams close 30% faster with structured outreach.** Got 60 seconds?",    overview:["Keep it punchy","Watch for energy"],intendedPath:true,  answers:[{id:"ma0",label:"Sure",next:"mc1"},{id:"ma1",label:"Not interested",next:"mc_exit"},{id:"ma2",label:"Who are you?",next:"mc0b"}] },
  "mc0b":   { id:"mc0b",   title:"Re-intro",       type:"pitch",     prompt:"*Fair*[Sincere] — I'm [Name] from Meridian. We work with teams your size on pipeline consistency. **30 seconds?**",                   overview:["Stay grounded"],                    intendedPath:false, answers:[{id:"ma3",label:"Go ahead",next:"mc1"},{id:"ma4",label:"No thanks",next:"mc_exit"}] },
  "mc1":    { id:"mc1",    title:"Pain Probe",     type:"discovery", prompt:"*Quick one*[Pause] — **where do deals stall most for your team?** Early pipeline, objection stage, or close?",                        overview:["Let them pick","Don't suggest"],    intendedPath:true,  answers:[{id:"ma5",label:"Early pipeline",next:"mc2"},{id:"ma6",label:"Objections",next:"mc2"},{id:"ma7",label:"We're solid",next:"mc1b"}] },
  "mc1b":   { id:"mc1b",   title:"Reframe",        type:"discovery", prompt:"*Good to hear*[Warm] — **what's your team's average ramp time for new reps?**",                                                       overview:["Pivot to ramp cost"],               intendedPath:false, answers:[{id:"ma8",label:"Under 60 days",next:"mc2"},{id:"ma9",label:"Longer",next:"mc2"},{id:"maa",label:"Not sharing",next:"mc_exit"}] },
  "mc2":    { id:"mc2",    title:"Solution",       type:"pitch",     prompt:"**That's exactly our lane.** Meridian gives reps a *live structured flow*[Confident] — so they stay on track even under pressure.",   overview:["Simple and direct"],                intendedPath:true,  answers:[{id:"mab",label:"Tell me more",next:"mc3"},{id:"mac",label:"We have a process",next:"mc2b"},{id:"mad",label:"Sounds complex",next:"mc2c"}] },
  "mc2b":   { id:"mc2b",   title:"Process Gap",    type:"pitch",     prompt:"*Great*[Warm] — **the issue is most processes live in docs, not in the moment.** Meridian puts the process live in the call.",         overview:["Validate then pivot"],              intendedPath:false, answers:[{id:"mae",label:"That's our gap",next:"mc3"},{id:"maf",label:"Ours works fine",next:"mc_exit"}] },
  "mc2c":   { id:"mc2c",   title:"Simplicity",     type:"pitch",     prompt:"*Actually the opposite*[Sincere] — **it's 3 taps. Reps are live in under 5 minutes.** No training required.",                        overview:["Concrete and fast"],                intendedPath:false, answers:[{id:"mag",label:"That simple?",next:"mc3"},{id:"mah",label:"Still not sure",next:"mc_exit"}] },
  "mc3":    { id:"mc3",    title:"Demo Close",     type:"close",     prompt:"*Here's what makes sense*[Confident] — **a 20-minute live demo with two of your reps on a real scenario.** No deck, no commitment.",  overview:["Specific ask","Low friction"],      intendedPath:true,  answers:[{id:"mai",label:"Let's do it",next:"mc4"},{id:"maj",label:"Need to check",next:"mc3b"},{id:"mak",label:"Not yet",next:"mc_exit"}] },
  "mc3b":   { id:"mc3b",   title:"Approval Path",  type:"close",     prompt:"*Totally get it*[Empathetic] — **who else needs to be looped in, and what's your usual sign-off process?**",                         overview:["Map the org"],                      intendedPath:false, answers:[{id:"mal",label:"Just me",next:"mc4"},{id:"mam",label:"Need manager",next:null}] },
  "mc4":    { id:"mc4",    title:"Book It",         type:"close",    prompt:"**Perfect.** *Sending a calendar link now*[Speed Up] — **does Tuesday or Thursday work, 30 minutes?**",                              overview:["Assume the yes","Two-option close"],intendedPath:true,  answers:[{id:"man",label:"Booked ✓",next:null},{id:"mao",label:"Different time",next:null}] },
  "mc_exit":{ id:"mc_exit",title:"Graceful Exit",  type:"close",     prompt:"*No problem at all*[Empathetic] — *mind if I reach back next quarter?*[Question]",                                                   overview:["Always leave the door open"],       intendedPath:false, answers:[{id:"map",label:"Sure",next:null},{id:"maq",label:"No thanks",next:null}] },
};

var M_OBJ_STACKS = [
  {
    id:"mos_time", label:"No Time", icon:"⏰", rootCard:"mot1",
    cards:{
      "mot1":{ id:"mot1",title:"Time Objection",type:"objection",prompt:"*Totally fair*[Empathetic] — *literally 45 seconds: is it ramp time or objections that hurt you more?*[Question]",overview:["Reframe short"],intendedPath:false,answers:[{id:"mota1",label:"Ramp",next:null},{id:"mota2",label:"Objections",next:null},{id:"mota3",label:"Call later",next:null}] },
    },
  },
  {
    id:"mos_comp", label:"Have a Solution", icon:"⚔️", rootCard:"moc1",
    cards:{
      "moc1":{ id:"moc1",title:"Comp Probe",    type:"objection",prompt:"*Good to know — which one?*[Question] *We complement most tools*[Confident] — or replace them where there's a gap.",overview:["Stay curious"],intendedPath:false,answers:[{id:"moca1",label:"Specific tool",next:"moc2"},{id:"moca2",label:"Built in-house",next:"moc3"}] },
      "moc2":{ id:"moc2",title:"Differentiate", type:"objection",prompt:"*[Tool] handles [X] well*[Confident] — **where it misses is live in-call structure.** That's where reps drift.",overview:["Specific gap"],intendedPath:false,answers:[{id:"moca3",label:"That's our gap",next:null},{id:"moca4",label:"Happy with it",next:null}] },
      "moc3":{ id:"moc3",title:"In-House Cost",  type:"objection",prompt:"*Smart*[Warm] — **what does maintaining it cost per quarter?** Most teams find upkeep eats the ROI.",overview:[],intendedPath:false,answers:[{id:"moca5",label:"Fair point",next:null},{id:"moca6",label:"Worth it for us",next:null}] },
    },
  },
];

await seedUpsert("decks", M_DECK_ID,
  { name:"Meridian Outbound", color:"#CE93D8", icon:"💎", rootCard:"mc0", visibility:"public", cards:M_CARDS, objStacks:M_OBJ_STACKS },
  async function() {
    await pool.query(
      `INSERT INTO decks (id,"orgId","createdBy",name,color,icon,"rootCard",cards,"objStacks",visibility,"updatedAt","createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
       ON CONFLICT (id) DO UPDATE SET name=$4,color=$5,icon=$6,"rootCard"=$7,cards=$8,"objStacks"=$9,visibility=$10,"updatedAt"=$11`,
      [M_DECK_ID, ORG2_ID, "u_casey", "Meridian Outbound", "#CE93D8", "💎", "mc0",
       JSON.stringify(M_CARDS), JSON.stringify(M_OBJ_STACKS), "public", m_now]
    );
  },
  async function() {
    var res = await pool.query(
      'SELECT name, color, icon, "rootCard", visibility, cards, "objStacks" FROM decks WHERE id=$1',
      [M_DECK_ID]
    );
    if (!res.rows[0]) return null;
    var r = res.rows[0];
    var cards = typeof r.cards === "string" ? JSON.parse(r.cards) : (r.cards || {});
    var objStacks = typeof r["objStacks"] === "string" ? JSON.parse(r["objStacks"]) : (r["objStacks"] || []);
    return seedHash({ name:r.name, color:r.color, icon:r.icon, rootCard:r.rootCard, visibility:r.visibility||"public", cards, objStacks });
  }
);

// ─── PRIVATE TEST DECK (Team North only) ──────────────────────────────────────
var M_PRIV_CARDS = {
  "mp0": { id:"mp0", title:"Partner Intro",    type:"pitch",     prompt:"*[Name]*[Warm] — quick intro. **Meridian's partner program gives your team white-label access to our structured call framework.** Got 90 seconds?",          overview:["Warm and direct","Partnership frame"],         intendedPath:true,  answers:[{id:"mpa0",label:"Sure",next:"mp1"},{id:"mpa1",label:"Not interested",next:"mp_exit"}] },
  "mp1": { id:"mp1", title:"Channel Pain",     type:"discovery", prompt:"*Tell me*[Pause] — **what's the biggest friction point in your current partner channel?** Onboarding, pipeline quality, or rep consistency?",              overview:["Open question","Let them pick"],                intendedPath:true,  answers:[{id:"mpa2",label:"Onboarding",next:"mp2"},{id:"mpa3",label:"Pipeline quality",next:"mp2"},{id:"mpa4",label:"Consistency",next:"mp2"},{id:"mpa5",label:"We're solid",next:"mp_exit"}] },
  "mp2": { id:"mp2", title:"Value Tie-In",     type:"pitch",     prompt:"**That's our core solve.** *Partners using our framework see 28% faster onboarding and 20% higher close rates within the first 60 days.*[Confident]",       overview:["Lead with outcomes","Specific numbers"],        intendedPath:true,  answers:[{id:"mpa6",label:"Interesting — tell me more",next:"mp3"},{id:"mpa7",label:"We have something similar",next:"mp_exit"}] },
  "mp3": { id:"mp3", title:"Close — Pilot",    type:"close",     prompt:"*What I'd suggest*[Confident] — **a 30-day pilot with two of your top partners.** No fees upfront, just results.",                                         overview:["Low-commitment ask","Specific scope"],          intendedPath:true,  answers:[{id:"mpa8",label:"Let's do it",next:null},{id:"mpa9",label:"Need to check internally",next:null},{id:"mpaa",label:"Not right now",next:"mp_exit"}] },
  "mp_exit":{ id:"mp_exit", title:"Graceful Exit", type:"close", prompt:"*No problem at all*[Empathetic] — *mind if I follow up next quarter when you're evaluating partner tools?*[Question]",                                        overview:["Keep the door open"],                           intendedPath:false, answers:[{id:"mpab",label:"Sure",next:null},{id:"mpac",label:"No thanks",next:null}] },
};

await seedUpsert("decks", M_PRIV_ID,
  { name:"Partner Channel Playbook", color:"#26C6DA", icon:"🔒", rootCard:"mp0", visibility:"private", cards:M_PRIV_CARDS, objStacks:[] },
  async function() {
    await pool.query(
      `INSERT INTO decks (id,"orgId","createdBy",name,color,icon,"rootCard",cards,"objStacks",visibility,"updatedAt","createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
       ON CONFLICT (id) DO UPDATE SET name=$4,color=$5,icon=$6,"rootCard"=$7,cards=$8,"objStacks"=$9,visibility=$10,"updatedAt"=$11`,
      [M_PRIV_ID, ORG2_ID, "u_casey", "Partner Channel Playbook", "#26C6DA", "🔒", "mp0",
       JSON.stringify(M_PRIV_CARDS), JSON.stringify([]), "private", m_now]
    );
  },
  async function() {
    var res = await pool.query(
      'SELECT name, color, icon, "rootCard", visibility, cards, "objStacks" FROM decks WHERE id=$1',
      [M_PRIV_ID]
    );
    if (!res.rows[0]) return null;
    var r = res.rows[0];
    var cards = typeof r.cards === "string" ? JSON.parse(r.cards) : (r.cards || {});
    var objStacks = typeof r["objStacks"] === "string" ? JSON.parse(r["objStacks"]) : (r["objStacks"] || []);
    return seedHash({ name:r.name, color:r.color, icon:r.icon, rootCard:r.rootCard, visibility:r.visibility||"public", cards, objStacks });
  }
);
await setDeckAccess(M_PRIV_ID, [{ entityType: "team", entityId: "team_north" }]);

var M_OBJ_MAP = {};
M_OBJ_STACKS.forEach(function(s){ M_OBJ_MAP[s.id] = s.cards; });

// ─── MERIDIAN PATH SETS ───────────────────────────────────────────────────────
var M_PATH_SETS = {
  ideal: [
    [{cardIds:["mc0","mc1","mc2","mc3","mc4"],            isObjCard:false}],
    [{cardIds:["mc0","mc1","mc2","mc2b","mc3","mc4"],      isObjCard:false}],
    [{cardIds:["mc0","mc1","mc2","mc3b","mc4"],            isObjCard:false}],
  ],
  mixed: [
    [{cardIds:["mc0","mc0b","mc1","mc2","mc3","mc4"],      isObjCard:false}],
    [{cardIds:["mc0","mc1","mc1b","mc2","mc3","mc4"],      isObjCard:false}],
    [{cardIds:["mc0","mc1","mc2","mc2c","mc3","mc4"],      isObjCard:false}],
  ],
  objection: [
    [{cardIds:["mc0","mc1"],isObjCard:false},{cardIds:["mot1"],isObjCard:true,stackLabel:"No Time",stackId:"mos_time"},{cardIds:["mc2","mc3","mc4"],isObjCard:false}],
    [{cardIds:["mc0","mc1"],isObjCard:false},{cardIds:["moc1","moc2"],isObjCard:true,stackLabel:"Have a Solution",stackId:"mos_comp"},{cardIds:["mc2","mc3","mc4"],isObjCard:false}],
    [{cardIds:["mc0","mc1","mc2"],isObjCard:false},{cardIds:["moc1","moc3"],isObjCard:true,stackLabel:"Have a Solution",stackId:"mos_comp"},{cardIds:["mc3b","mc4"],isObjCard:false}],
  ],
  struggle: [
    [{cardIds:["mc0","mc1"],isObjCard:false},{cardIds:["mot1"],isObjCard:true,stackLabel:"No Time",stackId:"mos_time"},{cardIds:["mc2","mc2b"],isObjCard:false},{cardIds:["moc1","moc2"],isObjCard:true,stackLabel:"Have a Solution",stackId:"mos_comp"},{cardIds:["mc3","mc4"],isObjCard:false}],
    [{cardIds:["mc0","mc0b","mc1","mc1b"],isObjCard:false},{cardIds:["mot1"],isObjCard:true,stackLabel:"No Time",stackId:"mos_time"},{cardIds:["mc2","mc3b","mc4"],isObjCard:false}],
    [{cardIds:["mc0","mc1","mc2","mc2c"],isObjCard:false},{cardIds:["moc1","moc3"],isObjCard:true,stackLabel:"Have a Solution",stackId:"mos_comp"},{cardIds:["mc3","mc3b","mc4"],isObjCard:false}],
  ],
  exit: [
    [{cardIds:["mc0","mc_exit"],                          isObjCard:false}],
    [{cardIds:["mc0","mc1","mc_exit"],                    isObjCard:false}],
    [{cardIds:["mc0","mc0b","mc1","mc2","mc_exit"],        isObjCard:false}],
    [{cardIds:["mc0","mc1","mc2","mc3","mc_exit"],         isObjCard:false}],
  ],
};

var MERIDIAN_DECK_CONFIGS = [
  { id:M_DECK_ID, name:"Meridian Outbound", color:"#CE93D8", icon:"💎", cards:M_CARDS, objCardMaps:M_OBJ_MAP, pathSets:M_PATH_SETS },
];

var m_totalSessions = 0;
for (var i = 0; i < M_USERS.length; i++) {
  var u        = M_USERS[i];
  var persona  = PERSONAS[u.persona];
  var sessions = generateUserSessions(u, persona, MERIDIAN_DECK_CONFIGS, ORG2_ID);
  for (var j = 0; j < sessions.length; j++) {
    await insertSession(sessions[j]);
    await pool.query(
      "INSERT INTO seed_manifest (table_name, record_id, content_hash, seeded_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      ["sessions", sessions[j].id, "seed", Date.now()]
    );
    m_totalSessions++;
  }
}

console.log("Meridian Group seeded:");
console.log("   Teams: 2 | Admins: 2 (casey, riley) | Users: 4 | Decks: 2 (1 private: Partner Channel Playbook -> team_north) | Sessions: " + m_totalSessions);
console.log("   Personas -- star: Blake | solid: Fox | grinder: Shaw | newbie: Reed");
console.log("   Password (all): [see seed.js]");

} // end org_meridian block

} // end runSeed()

module.exports = { runSeed };

// Run directly: node server/seed.js
if (require.main === module) {
  runSeed()
    .then(function() { return pool.end(); })
    .then(function() { process.exit(0); })
    .catch(function(err) { console.error("Seed failed:", err); process.exit(1); });
}
