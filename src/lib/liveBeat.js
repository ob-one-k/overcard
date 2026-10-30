import { useEffect, useRef } from "react";
import { apiPost, API_BASE, getStoredToken } from "./api";
import { onLive } from "./live";

// ─── LIVE HEARTBEAT ───────────────────────────────────────────────────────────
// Keeps the server's copy of a run in progress current, so admins can watch it live and
// nothing is lost if this device closes, crashes or is signed out mid-call:
//   start  → POST /sessions/:id/start once, when the run begins
//   beat   → POST /sessions/:id/beat {events, live} shortly after every card change or
//            note (debounced) and every HEARTBEAT_MS otherwise
//   pagehide → one last keepalive beat
// The finished run is still saved by the normal POST /sessions, which ends the live row.
//
//   session — the active session object (null when no run is in progress)
//   events  — visit/note events so far
//   live    — { cardId, cardTitle, cardType, inObjection, stackLabel } for the card on screen

var DEBOUNCE_MS  = 1500;
var HEARTBEAT_MS = 20000;

export function useLiveBeat(session, events, live) {
  var sessionId = session ? session.id : null;
  var latest = useRef({ events: events, live: live });
  latest.current = { events: events, live: live };
  var startRef = useRef(null);   // Promise of the start request for this session
  var stopped  = useRef(false);  // the server closed the run (finished elsewhere / signed out)
  var timer    = useRef(null);

  function send() {
    if (!sessionId || stopped.current || !startRef.current) return;
    var body = { events: latest.current.events || [], live: latest.current.live || null };
    startRef.current.then(function() {
      if (stopped.current) return;
      return apiPost("/sessions/" + encodeURIComponent(sessionId) + "/beat", body).catch(function(err) {
        if (err.status === 409) stopped.current = true;
      });
    });
  }

  // Start once per run
  useEffect(function() {
    if (!sessionId) return;
    stopped.current = false;
    var s = session;
    startRef.current = apiPost("/sessions/" + encodeURIComponent(sessionId) + "/start", {
      deckId: s.deckId, name: s.name, account: s.account || null, contact: s.contact || null,
      mode: s.mode, startTs: s.startTs, referenceSessionId: s.referenceSessionId || null,
      live: latest.current.live || null,
    }).catch(function() { /* offline: beats retry the row via the final save */ });

    var iv = setInterval(send, HEARTBEAT_MS);
    // Closing the tab: one last beat that survives the page unloading
    function onHide() {
      if (stopped.current) return;
      var headers = { "Content-Type": "application/json" };
      var t = getStoredToken();
      if (t) headers.Authorization = "Bearer " + t;
      try {
        fetch(API_BASE + "/sessions/" + encodeURIComponent(sessionId) + "/beat", {
          method: "POST", keepalive: true, credentials: "include", headers: headers,
          body: JSON.stringify({ events: latest.current.events || [], live: latest.current.live || null }),
        }).catch(function() {});
      } catch (_) {}
    }
    window.addEventListener("pagehide", onHide);
    return function() {
      clearInterval(iv);
      clearTimeout(timer.current);
      window.removeEventListener("pagehide", onHide);
      startRef.current = null;
    };
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced beat whenever the path, notes or the card on screen change
  var key = (events ? events.length : 0) + "|" + (live ? live.cardId + ":" + (live.inObjection ? 1 : 0) : "");
  useEffect(function() {
    if (!sessionId) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(send, DEBOUNCE_MS);
  }, [sessionId, key]); // eslint-disable-line react-hooks/exhaustive-deps
}

// Run fn when this device is signed out by the server (another device signed in, password
// changed, account removed) — Play uses it to keep the recording on the device
export function onSignedOut(fn) { return onLive("auth.ended", fn); }
