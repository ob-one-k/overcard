import { useEffect } from "react";
import { API_BASE, getStoredToken } from "./api";
import { invalidate } from "./dataCache";

// ─── LIVE EVENTS ──────────────────────────────────────────────────────────────
// One Server-Sent Events stream per signed-in tab (GET /api/events). Read with
// fetch rather than EventSource so the Authorization: Bearer fallback works on
// cross-site deployments where the cookie is blocked. Reconnects with backoff;
// after a reconnect every live-backed cache is refreshed, since events may have
// been missed while offline.
//
// Event types (server/realtime.js):
//   session.started / session.progress / session.finished   — org admins (live monitor)
//   session.changed {id}                                    — lists, reviews
//   feedback.changed {sessionId} · share.changed {sessionId}
//   notification.new · notification.read
//   auth.ended {reason}                                     — signed out (replaced, reset, removed)

var handlers = {};          // type → [fn]
var ctrl = null;            // AbortController of the open stream
var running = false;
var retryMs = 1000;
var retryTimer = null;
var connected = false;
var everConnected = false;  // a later successful connect is a reconnect → resync caches
var connListeners = [];

export function onLive(type, fn) {
  (handlers[type] = handlers[type] || []).push(fn);
  return function() { handlers[type] = (handlers[type] || []).filter(function(f) { return f !== fn; }); };
}

// React helper: subscribe for the component's lifetime. deps re-subscribe like useEffect.
export function useLive(type, fn, deps) {
  useEffect(function() { return onLive(type, fn); }, deps || []);
}

export function isLiveConnected() { return connected; }
export function onLiveConnection(fn) {
  connListeners.push(fn);
  return function() { connListeners = connListeners.filter(function(f) { return f !== fn; }); };
}
function setConnected(v) {
  if (connected === v) return;
  connected = v;
  connListeners.slice().forEach(function(fn) { fn(v); });
}

function dispatch(type, data) {
  // Built-in cache wiring: finished/changed sessions, feedback and shares make cached
  // session reads stale (progress ticks don't — in-progress runs aren't in the lists)
  if (type === "session.finished" || type === "session.changed" || type === "feedback.changed" || type === "share.changed") invalidate("/sessions");
  if (type === "live.resync") invalidate("/");
  (handlers[type] || []).slice().forEach(function(fn) { try { fn(data); } catch (e) { console.error(e); } });
  (handlers["*"] || []).slice().forEach(function(fn) { try { fn(type, data); } catch (e) { console.error(e); } });
}

function parseBlock(block) {
  var type = "message", data = "";
  block.split("\n").forEach(function(line) {
    if (!line || line[0] === ":") return;
    var i = line.indexOf(":");
    var field = i === -1 ? line : line.slice(0, i);
    var val = i === -1 ? "" : line.slice(i + 1).replace(/^ /, "");
    if (field === "event") type = val;
    else if (field === "data") data += (data ? "\n" : "") + val;
  });
  if (!data) return;
  var parsed = null;
  try { parsed = JSON.parse(data); } catch (_) { return; }
  dispatch(type, parsed);
}

async function connect() {
  ctrl = new AbortController();
  var headers = { Accept: "text/event-stream" };
  var t = getStoredToken();
  if (t) headers.Authorization = "Bearer " + t;
  var r = await fetch(API_BASE + "/events", { credentials: "include", headers: headers, signal: ctrl.signal, cache: "no-store" });
  if (r.status === 401) {
    // Let the normal API path decide (session_replaced banner vs login screen)
    var body = null;
    try { body = await r.json(); } catch (_) {}
    dispatch("auth.ended", { reason: body && body.error === "session_replaced" ? "replaced" : "unauthenticated" });
    return "stop";
  }
  if (!r.ok || !r.body) throw new Error("stream " + r.status);
  retryMs = 1000;
  setConnected(true);
  if (everConnected) dispatch("live.resync", {});
  everConnected = true;
  var reader = r.body.getReader();
  var dec = new TextDecoder();
  var buf = "";
  for (;;) {
    var chunk = await reader.read();
    if (chunk.done) break;
    buf += dec.decode(chunk.value, { stream: true }).replace(/\r\n/g, "\n");
    var idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      var block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      parseBlock(block);
    }
  }
  return "closed";
}

function loop() {
  if (!running) return;
  connect().then(function(result) {
    setConnected(false);
    if (result === "stop") { running = false; return; }
    schedule();
  }, function() {
    setConnected(false);
    schedule();
  });
}

function schedule() {
  if (!running) return;
  var wait = retryMs + Math.floor(Math.random() * 500);
  retryMs = Math.min(retryMs * 2, 30000);
  retryTimer = setTimeout(loop, wait);
}

function onVisible() {
  // Phones suspend background tabs — reconnect right away when the app comes back
  if (document.visibilityState === "visible" && running && !connected && retryTimer) {
    clearTimeout(retryTimer); retryTimer = null; loop();
  }
}

export function startLive() {
  if (running) return;
  running = true;
  retryMs = 1000;
  everConnected = false;
  document.addEventListener("visibilitychange", onVisible);
  loop();
}

export function stopLive() {
  running = false;
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  if (ctrl) { try { ctrl.abort(); } catch (_) {} ctrl = null; }
  document.removeEventListener("visibilitychange", onVisible);
  setConnected(false);
}
