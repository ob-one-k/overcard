// ─── AUDIO STORE — IndexedDB utility ─────────────────────────────────────────
// Stores session audio blobs locally in IndexedDB, keyed by sessionId.
// This is the on-device backup: audioUpload.js saves here first, uploads to the
// server, and deletes the local copy once the upload succeeds. Recordings made
// before server storage existed only live here, so playback falls back to it.
//
// Storage estimate: WebM/Opus ~1MB/min. A 30-min session ≈ 30MB.
// IndexedDB has no hard per-entry limit in modern browsers.
//
// All functions are safe to call even if IndexedDB is unavailable (e.g.,
// Firefox private browsing) — they return null/false without throwing.

var DB_NAME    = "OverCardAudio";
var DB_VERSION = 1;
var STORE_NAME = "recordings";

// Cached DB connection — opened once, reused across calls.
var _db = null;

function initAudioDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise(function(resolve, reject) {
    if (typeof window === "undefined" || !window.indexedDB) {
      return resolve(null);
    }
    var req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function(e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "sessionId" });
      }
    };
    req.onsuccess = function(e) {
      _db = e.target.result;
      resolve(_db);
    };
    req.onerror = function() {
      resolve(null); // graceful fallback — never reject
    };
  });
}

// owner — id of the signed-in user who recorded it, so pending uploads resume only for them
export function saveAudioBlob(sessionId, blob, mimeType, durationMs, owner) {
  return initAudioDB().then(function(db) {
    if (!db) return;
    return new Promise(function(resolve, reject) {
      var tx    = db.transaction(STORE_NAME, "readwrite");
      var store = tx.objectStore(STORE_NAME);
      var req   = store.put({ sessionId: sessionId, blob: blob, mimeType: mimeType, durationMs: durationMs || null, owner: owner || null, createdAt: Date.now() });
      req.onsuccess = function() { resolve(); };
      req.onerror   = function() { reject(req.error); };
    });
  });
}

export function getAudioBlob(sessionId) {
  return initAudioDB().then(function(db) {
    if (!db) return null;
    return new Promise(function(resolve) {
      var tx    = db.transaction(STORE_NAME, "readonly");
      var store = tx.objectStore(STORE_NAME);
      var req   = store.get(sessionId);
      req.onsuccess = function() {
        var rec = req.result;
        resolve(rec ? { blob: rec.blob, mimeType: rec.mimeType, durationMs: rec.durationMs || null } : null);
      };
      req.onerror = function() { resolve(null); };
    });
  }).catch(function() { return null; });
}

// Every local recording's metadata (no blobs) — used to resume uploads after sign-in
export function listAudioBlobs() {
  return initAudioDB().then(function(db) {
    if (!db) return [];
    return new Promise(function(resolve) {
      var out = [];
      var req = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).openCursor();
      req.onsuccess = function() {
        var cur = req.result;
        if (!cur) return resolve(out);
        out.push({ sessionId: cur.value.sessionId, owner: cur.value.owner || null, durationMs: cur.value.durationMs || null, createdAt: cur.value.createdAt });
        cur.continue();
      };
      req.onerror = function() { resolve(out); };
    });
  }).catch(function() { return []; });
}

export function hasAudioBlob(sessionId) {
  return initAudioDB().then(function(db) {
    if (!db) return false;
    return new Promise(function(resolve) {
      var tx    = db.transaction(STORE_NAME, "readonly");
      var store = tx.objectStore(STORE_NAME);
      var req   = store.count(sessionId);
      req.onsuccess = function() { resolve(req.result > 0); };
      req.onerror   = function() { resolve(false); };
    });
  }).catch(function() { return false; });
}

export function deleteAudioBlob(sessionId) {
  return initAudioDB().then(function(db) {
    if (!db) return;
    return new Promise(function(resolve) {
      var tx    = db.transaction(STORE_NAME, "readwrite");
      var store = tx.objectStore(STORE_NAME);
      var req   = store.delete(sessionId);
      req.onsuccess = function() { resolve(); };
      req.onerror   = function() { resolve(); }; // silent fail on delete
    });
  }).catch(function() {});
}
