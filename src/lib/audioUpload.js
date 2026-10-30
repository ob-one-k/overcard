import { useState, useEffect } from "react";
import { apiPutBlob } from "./api";
import { saveAudioBlob, getAudioBlob, deleteAudioBlob, listAudioBlobs } from "./audioStore";

// ─── SESSION AUDIO UPLOAD ─────────────────────────────────────────────────────
// After a session ends its recording is first saved to this device (IndexedDB), then
// uploaded to the server so anyone allowed to review the session can listen. The local
// copy is kept until the upload succeeds, so a failed upload can be retried later
// (the Sessions review shows "Retry upload").
//
// Upload state is module-level so the Play tab can start an upload and the Sessions tab
// (mounted right after) can show its progress.

var status = {};       // sessionId -> { state: "uploading"|"done"|"failed", progress, error }
var listeners = [];
var owner = null;      // signed-in user id — tags local copies so only they resume them

export function setAudioOwner(userId) { owner = userId || null; }
export function getAudioOwner() { return owner; }

function emit() { listeners.slice().forEach(function(fn) { fn(); }); }
function set(sessionId, s) { status[sessionId] = s; emit(); }

function attempt(sessionId, blob, durationMs, tries) {
  set(sessionId, { state: "uploading", progress: 0 });
  var path = "/sessions/" + encodeURIComponent(sessionId) + "/audio" + (durationMs ? "?durationMs=" + Math.round(durationMs) : "");
  return apiPutBlob(path, blob, function(p) { set(sessionId, { state: "uploading", progress: p }); })
    .then(function() {
      set(sessionId, { state: "done", progress: 1 });
      return deleteAudioBlob(sessionId);
    })
    .catch(function(err) {
      // Retry network/server errors with backoff; auth/validation errors won't improve
      var retryable = !err.status || err.status >= 500;
      if (retryable && tries > 1) {
        return new Promise(function(r) { setTimeout(r, 3000); }).then(function() { return attempt(sessionId, blob, durationMs, tries - 1); });
      }
      set(sessionId, { state: "failed", progress: 0, error: err.message || "Upload failed" });
    });
}

// Save locally first (never lose a recording), then upload with retries.
export function uploadSessionAudio(sessionId, blob, mimeType, durationMs) {
  set(sessionId, { state: "uploading", progress: 0 });
  return saveAudioBlob(sessionId, blob, mimeType, durationMs, owner)
    .catch(function() {})
    .then(function() { return attempt(sessionId, blob, durationMs, 3); });
}

// Keep a recording on this device to upload later (signed out mid-call, or the final save
// failed). forOwner is captured when the call ended — by the time the recorder hands over
// the audio the app may already be signed out.
export function savePendingAudio(sessionId, audio, forOwner) {
  return saveAudioBlob(sessionId, audio.blob, audio.mimeType, audio.durationMs, forOwner || owner).catch(function() {});
}

// After sign-in: upload every recording this user left on this device (signed out mid-call,
// or the app closed before an upload finished). Recordings of deleted sessions are dropped.
export function resumePendingUploads() {
  var me = owner;
  if (!me) return Promise.resolve();
  return listAudioBlobs().then(function(list) {
    return list.filter(function(r) { return r.owner === me && !(status[r.sessionId] && status[r.sessionId].state === "uploading"); })
      .reduce(function(p, r) {
        return p.then(function() {
          return getAudioBlob(r.sessionId).then(function(rec) {
            if (!rec || !rec.blob) return;
            var path = "/sessions/" + encodeURIComponent(r.sessionId) + "/audio" + (rec.durationMs ? "?durationMs=" + Math.round(rec.durationMs) : "");
            set(r.sessionId, { state: "uploading", progress: 0 });
            return apiPutBlob(path, rec.blob, function(pr) { set(r.sessionId, { state: "uploading", progress: pr }); })
              .then(function() { set(r.sessionId, { state: "done", progress: 1 }); return deleteAudioBlob(r.sessionId); })
              .catch(function(err) {
                // Session gone for good (deleted) — drop the copy, but only once it is old enough
                // that a run still being saved can't be the cause
                if (err.status === 404 && Date.now() - (r.createdAt || 0) > 7 * 24 * 3600 * 1000) { delete status[r.sessionId]; emit(); return deleteAudioBlob(r.sessionId); }
                set(r.sessionId, { state: "failed", progress: 0, error: err.message || "Upload failed" });
              });
          });
        });
      }, Promise.resolve());
  });
}

// Retry from the local copy (e.g. after the app was reloaded while offline)
export function retrySessionAudio(sessionId) {
  return getAudioBlob(sessionId).then(function(rec) {
    if (!rec || !rec.blob) { set(sessionId, { state: "failed", progress: 0, error: "No local copy of this recording on this device" }); return; }
    return attempt(sessionId, rec.blob, rec.durationMs || null, 2);
  });
}

export function useUploadStatus(sessionId) {
  var [, force] = useState(0);
  useEffect(function() {
    function fn() { force(function(n) { return n + 1; }); }
    listeners.push(fn);
    return function() { listeners = listeners.filter(function(l) { return l !== fn; }); };
  }, []);
  return sessionId ? (status[sessionId] || null) : null;
}
