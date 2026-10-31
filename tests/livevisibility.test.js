// Who may watch a run in progress: the owner always; admins every run only while the org
// has no teams — once it has teams, only runs by reps who share a team with them.
//   Apex: team Alpha (admin apexAdmin; apexUser is a member); apexAdmin2 is on no team.
//   Meridian: merAdmin administers North + South.  Solo: no teams.
const test = require("node:test");
const assert = require("node:assert/strict");
const { login, tid, sleep, fixtures } = require("./helpers");

var F;
test.before(async function() { F = await fixtures(); });

async function startRun(rep, deckId) {
  var id = tid("lv");
  var r = await rep.post("/sessions/" + id + "/start", { deckId: deckId, name: "Visibility", mode: "live", startTs: Date.now(), live: { cardId: "c1" } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return id;
}
function listed(r, id) { assert.equal(r.status, 200); return r.body.some(function(s) { return s.id === id; }); }

test("with teams: owner + admins on the rep's team watch; other admins don't", async function() {
  var rep = await login("apexUser"), teamAdmin = await login("apexAdmin"), lone = await login("apexAdmin2"), owner = await login("apexOwner");
  var sTeam = await teamAdmin.stream(), sLone = await lone.stream(), sOwner = await owner.stream();
  var id;
  try {
    id = await startRun(rep, F.apexDeck);
    assert.ok(await sTeam.waitFor("session.started", function(d) { return d.id === id; }), "team admin sees it start");
    assert.ok(await sOwner.waitFor("session.started", function(d) { return d.id === id; }), "owner sees it start");
    await rep.post("/sessions/" + id + "/beat", { events: [], live: { cardId: "c2" } });
    assert.ok(await sTeam.waitFor("session.progress", function(d) { return d.id === id; }), "team admin gets progress");
    await sleep(400);
    assert.ok(!sLone.events.some(function(e) { return e.data && e.data.id === id && /session\.(started|progress)/.test(e.type); }), "admin on no team gets no live data");
    assert.ok(listed(await teamAdmin.get("/sessions/live"), id), "team admin's monitor lists it");
    assert.ok(listed(await owner.get("/sessions/live"), id), "owner's monitor lists it");
    assert.ok(!listed(await lone.get("/sessions/live"), id), "other admin's monitor doesn't");

    // Meridian: an admin of both teams sees a South rep's run
    var south = await login("merUserSouth"), merAdmin = await login("merAdmin");
    var sid = await startRun(south, F.merDeck);
    try { assert.ok(listed(await merAdmin.get("/sessions/live"), sid), "admin of the rep's team"); }
    finally { await south.del("/sessions/" + sid); }
  } finally {
    if (id) await rep.del("/sessions/" + id);
    sTeam.close(); sLone.close(); sOwner.close();
  }
});

test("without teams every admin watches; adding a team narrows it", async function() {
  var rep = await login("soloUser"), admin = await login("soloAdmin"), owner = await login("soloOwner");
  var stream = await admin.stream();
  var id, teamId;
  try {
    id = await startRun(rep, F.soloDeck);
    assert.ok(await stream.waitFor("session.started", function(d) { return d.id === id; }), "no teams: admin sees it start");
    assert.ok(listed(await admin.get("/sessions/live"), id), "no teams: admin's monitor lists it");

    // A team the admin isn't on (only the rep): the admin loses the run
    var t = await owner.post("/admin/teams", { name: "t_team " + tid(), adminIds: [owner.user.id], memberIds: [rep.user.id] });
    assert.equal(t.status, 201, t.text);
    teamId = t.body.id;
    assert.ok(!listed(await admin.get("/sessions/live"), id), "teams exist and the admin isn't on the rep's: hidden");
    assert.ok(listed(await owner.get("/sessions/live"), id), "owner still sees it");
    var m = stream.mark();
    await rep.post("/sessions/" + id + "/beat", { events: [], live: { cardId: "c3" } });
    assert.equal(await stream.waitFor("session.progress", function(d) { return d.id === id; }, 1500, m), null, "no progress to the admin");
  } finally {
    if (teamId) await owner.del("/admin/teams/" + teamId);
    if (id) await rep.del("/sessions/" + id);
    stream.close();
  }
});
