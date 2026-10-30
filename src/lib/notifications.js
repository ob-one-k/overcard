import { useState, useEffect } from "react";
import { apiGet, apiPost } from "./api";

// ─── IN-APP NOTIFICATIONS ─────────────────────────────────────────────────────
// Module-level store polled every 30s (and when the tab regains focus) so the bell in the
// header and the session review (which marks a session's notifications read) stay in sync.

var POLL_MS = 30000;
var state = { items: [], unreadCount: 0, loaded: false };
var listeners = [];
var timer = null;
var subscribers = 0;

function emit() { listeners.slice().forEach(function(fn) { fn(); }); }
function apply(data) {
  if (!data || !Array.isArray(data.items)) return;
  state = { items: data.items, unreadCount: data.unreadCount || 0, loaded: true };
  emit();
}

export function refreshNotifications() {
  return apiGet("/notifications").then(apply).catch(function() {});
}

// Marks one session's notifications read (called when its review is opened)
export function markSessionNotificationsRead(sessionId) {
  var has = state.items.some(function(n) { return n.sessionId === sessionId && !n.readAt; });
  if (!has) return Promise.resolve();
  return apiPost("/notifications/read", { sessionId: sessionId }).then(apply).catch(function() {});
}

export function markAllNotificationsRead() {
  return apiPost("/notifications/read", {}).then(apply).catch(function() {});
}

function onVisible() { if (document.visibilityState === "visible") refreshNotifications(); }

export function useNotifications() {
  var [, force] = useState(0);
  useEffect(function() {
    function fn() { force(function(n) { return n + 1; }); }
    listeners.push(fn);
    subscribers++;
    if (subscribers === 1) {
      refreshNotifications();
      timer = setInterval(refreshNotifications, POLL_MS);
      document.addEventListener("visibilitychange", onVisible);
    }
    return function() {
      listeners = listeners.filter(function(l) { return l !== fn; });
      subscribers--;
      if (subscribers === 0) { clearInterval(timer); timer = null; document.removeEventListener("visibilitychange", onVisible); }
    };
  }, []);
  return state;
}
