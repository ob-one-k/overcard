// Saved clips: who may save, play, share, rename and delete them; the audio is a real cut.
//   Apex: apexUser runs the session; apexUser2 has no access to it; apexAdmin is an admin.
const test = require("node:test");
const assert = require("node:assert/strict");
const { login, tid, fixtures, putAudio, getBytes } = require("./helpers");

var F;
test.before(async function() { F = await fixtures(); });

var SEGS = [
  { segId: 111, cardId: "c_open", cardTitle: "Opening", cardType: "pitch", isObjCard: false, stackLabel: null, startMs: 0, endMs: 8000, segmentIndex: 0 },
  { segId: 222, cardId: "c_open", cardTitle: "Opening", cardType: "pitch", isObjCard: false, stackLabel: null, startMs: 8000, endMs: 20000, segmentIndex: 1 },
];

async function recordedSession(c, name) {
  var id = tid("cl");
  var r = await c.post("/sessions", {
    id: id, deckId: F.apexDeck, name: name, mode: "live", outcome: "sold", sold: true, account: "Acme", contact: "Pat",
    startTs: Date.now() - 20000, endTs: Date.now(), events: [], notes: [{ cardId: "c_open", cardTitle: "Opening", text: "Great intro", ts: Date.now() - 15000 }],
    audioSegments: SEGS, audioDurationMs: 20000,
  });
  assert.equal(r.status, 200, r.text);
  var up = await putAudio(c, id, 20000);
  assert.equal(up.status, 200, up.text);
  return id;
}

test("clips: saving, playing, sharing and who may do what", async function() {
  var rep = await login("apexUser"), other = await login("apexUser2"), admin = await login("apexAdmin"), owner = await login("apexOwner");
  var mer = await login("merUser");
  var sid = await recordedSession(rep, "Clip source call");
  var clipIds = [];
  try {
    // Validation
    assert.equal((await rep.post("/clips", { sessionId: sid, startMs: 0, endMs: 8000, title: "" })).status, 400, "title required");
    assert.equal((await rep.post("/clips", { sessionId: sid, startMs: 0, endMs: 8000, title: "x".repeat(51) })).status, 400, "title ≤ 50");
    assert.equal((await rep.post("/clips", { sessionId: sid, startMs: 5000, endMs: 5000, title: "x" })).status, 400, "end after start");
    assert.equal((await rep.post("/clips", { sessionId: sid, startMs: 0, endMs: 11 * 60000, title: "x" })).status, 400, "≤ 10 minutes");
    assert.equal((await rep.post("/clips", { sessionId: sid, startMs: 25000, endMs: 27000, title: "x" })).status, 400, "inside the recording");

    // The rep saves a whole card segment
    var r = await rep.post("/clips", { sessionId: sid, segId: 111, startMs: 0, endMs: 8000, title: "  Great   opener " });
    assert.equal(r.status, 201, r.text);
    var clip = r.body; clipIds.push(clip.id);
    assert.equal(clip.title, "Great opener");
    assert.equal(clip.kind, "segment");
    assert.equal(clip.durationMs, 8000);
    assert.equal(clip.meta.sessionName, "Clip source call");
    assert.equal(clip.meta.repName, rep.user.displayName);
    assert.equal(clip.meta.cardTitle, "Opening");
    assert.equal(clip.meta.account, "Acme");
    assert.equal(clip.meta.outcome, "sold");
    assert.equal(clip.meta.notes.length, 1);
    assert.equal(clip.data, undefined, "lists never carry the audio");

    // Its audio is its own small file, seekable
    var a = await getBytes(rep, "/clips/" + clip.id + "/audio");
    assert.equal(a.status, 200);
    assert.match(a.headers.get("content-type"), /audio\/webm/);
    assert.ok(a.body.length > 200 && a.body.length < 48415, "a cut, not the whole recording (" + a.body.length + " bytes)");
    var part = await getBytes(rep, "/clips/" + clip.id + "/audio", { Range: "bytes=0-99" });
    assert.equal(part.status, 206);
    assert.equal(part.body.length, 100);

    // Anyone who can open the session may save a range: an admin, and the owner
    r = await admin.post("/clips", { sessionId: sid, startMs: 2500, endMs: 6500, title: "Admin pick" });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.body.kind, "range");
    clipIds.push(r.body.id);
    r = await owner.post("/clips", { sessionId: sid, startMs: 9000, endMs: 12000, title: "Owner pick" });
    assert.equal(r.status, 201, r.text);
    clipIds.push(r.body.id);
    // …but not a teammate without access, nor another org
    assert.equal((await other.post("/clips", { sessionId: sid, startMs: 0, endMs: 2000, title: "x" })).status, 404);
    assert.equal((await mer.post("/clips", { sessionId: sid, startMs: 0, endMs: 2000, title: "x" })).status, 404);

    // Clips are private to their owner (and the org owner)
    var mine = (await rep.get("/clips")).body.map(function(c) { return c.id; });
    assert.deepEqual(mine, [clip.id], "a person's library holds their own clips");
    assert.equal((await other.get("/clips/" + clip.id)).status, 404);
    assert.equal((await admin.get("/clips/" + clip.id)).status, 404, "admins don't see others' clips");
    assert.equal((await owner.get("/clips/" + clip.id)).status, 200, "the owner does");
    assert.equal((await other.get("/clips/" + clip.id + "/audio")).status, 404);

    // Sharing: the recipient is notified, sees and plays it, but can't manage it
    var stream = await other.stream();
    var m = stream.mark();
    r = await rep.post("/clips/" + clip.id + "/share", { toUserId: other.user.id, note: "Listen to this" });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.created, true);
    assert.ok(await stream.waitFor("notification.new", function(d) { return d.clipId === clip.id; }, 5000, m), "recipient notified live");
    stream.close();
    assert.equal((await rep.post("/clips/" + clip.id + "/share", { toUserId: other.user.id })).body.created, false, "sharing twice adds nothing");
    assert.equal((await rep.post("/clips/" + clip.id + "/share", { toUserId: mer.user.id })).status, 400, "not outside the org");
    var shared = (await other.get("/clips?view=shared")).body.find(function(c) { return c.id === clip.id; });
    assert.ok(shared, "listed as shared");
    assert.equal(shared.sharedByName, rep.user.displayName);
    assert.equal(shared.shareNote, "Listen to this");
    var note = (await other.get("/notifications")).body.items.find(function(n) { return n.clipId === clip.id; });
    assert.ok(note && note.type === "clip_share" && note.clipTitle === "Great opener", "notification names the clip");
    assert.equal((await getBytes(other, "/clips/" + clip.id + "/audio")).status, 200);
    assert.equal((await other.put("/clips/" + clip.id, { title: "Mine now" })).status, 403);
    assert.equal((await other.del("/clips/" + clip.id)).status, 403);
    assert.equal((await other.post("/clips/" + clip.id + "/share", { toUserId: admin.user.id })).status, 403);
    assert.equal((await other.get("/clips/" + clip.id + "/shares")).status, 403);

    // Renaming
    assert.equal((await rep.put("/clips/" + clip.id, { title: "y".repeat(51) })).status, 400);
    assert.equal((await rep.put("/clips/" + clip.id, { title: "Best opener" })).body.title, "Best opener");

    // A clip outlives its session
    assert.equal((await rep.del("/sessions/" + sid)).status, 200);
    sid = null;
    var after = (await rep.get("/clips/" + clip.id)).body;
    assert.equal(after.sessionId, null);
    assert.equal(after.meta.sessionName, "Clip source call", "session details kept");
    assert.equal((await getBytes(rep, "/clips/" + clip.id + "/audio")).status, 200);

    // Revoking a share takes it away
    var shares = (await rep.get("/clips/" + clip.id + "/shares")).body;
    assert.equal(shares.length, 1);
    assert.equal((await rep.del("/clips/" + clip.id + "/shares/" + shares[0].id)).status, 200);
    assert.equal((await other.get("/clips/" + clip.id)).status, 404);

    // The org owner may delete anyone's clip
    assert.equal((await owner.del("/clips/" + clip.id)).status, 200);
    assert.equal((await rep.get("/clips/" + clip.id)).status, 404);
  } finally {
    if (sid) await rep.del("/sessions/" + sid);
    for (var id of clipIds) await owner.del("/clips/" + id);
  }
});
