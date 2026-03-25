// ─── AUDIO STORE — IndexedDB utility ─────────────────────────────────────────
// Stores session audio blobs locally in IndexedDB, keyed by sessionId.
// Audio is device-local — recordings are only accessible on the device where
// they were made. This is acceptable for a personal sales training tool.
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

export function saveAudioBlob(sessionId, blob, mimeType) {
  return initAudioDB().then(function(db) {
    if (!db) return;
    return new Promise(function(resolve, reject) {
      var tx    = db.transaction(STORE_NAME, "readwrite");
      var store = tx.objectStore(STORE_NAME);
      var req   = store.put({ sessionId: sessionId, blob: blob, mimeType: mimeType, createdAt: Date.now() });
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
        resolve(rec ? { blob: rec.blob, mimeType: rec.mimeType } : null);
      };
      req.onerror = function() { resolve(null); };
    });
  }).catch(function() { return null; });
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
