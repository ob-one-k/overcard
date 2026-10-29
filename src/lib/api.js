// ─── API LAYER ────────────────────────────────────────────────────────────────
var _apiUrl = import.meta.env.VITE_API_URL || "";
export var API_BASE = _apiUrl + "/api";
export var SAVE_DELAY = 800;

var _onUnauth          = null; // set by App shell to redirect to login on 401
var _onSessionReplaced = null; // set by App shell to show "replaced" message on 401 session_replaced

export function setUnauthHandler(fn)          { _onUnauth = fn; }
export function setSessionReplacedHandler(fn) { _onSessionReplaced = fn; }

// localStorage can throw (Safari private mode, blocked site data) — never let that break the app
export function lsGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
export function lsSet(key, val) {
  try { if (val === null || val === undefined) localStorage.removeItem(key); else localStorage.setItem(key, val); } catch (e) {}
}

// Token stored in localStorage for mobile/Safari ITP fallback (Authorization: Bearer header)
var _token = lsGet("overcard_token") || null;
export function setStoredToken(t) {
  _token = t || null;
  lsSet("overcard_token", _token);
}
export function getStoredToken() { return _token; }

// Abort requests that hang (e.g. backend down or cold-starting) instead of waiting forever
export var REQUEST_TIMEOUT = 30000;
export function fetchWithTimeout(url, opts, ms) {
  var ctrl  = new AbortController();
  var timer = setTimeout(function() { ctrl.abort(); }, ms || REQUEST_TIMEOUT);
  return fetch(url, Object.assign({}, opts, { signal: ctrl.signal }))
    .finally(function() { clearTimeout(timer); });
}

function authHeaders(extra) {
  var h = Object.assign({}, extra || {});
  if (_token) h["Authorization"] = "Bearer " + _token;
  return h;
}

async function handle401(r) {
  // Try to read body to distinguish session_replaced vs normal 401
  try {
    var body = await r.clone().json();
    if (body && body.error === "session_replaced") {
      if (_onSessionReplaced) _onSessionReplaced();
      var err = new Error(body.message || "session_replaced");
      err.status = 401; err.code = "session_replaced";
      throw err;
    }
  } catch (e) { if (e.code === "session_replaced") throw e; }
  if (_onUnauth) _onUnauth();
  var e = new Error("401"); e.status = 401; throw e;
}

export async function apiGet(path) {
  const r = await fetchWithTimeout(API_BASE + path, { credentials:"include", headers: authHeaders() });
  if (r.status === 401) return handle401(r);
  if (!r.ok) { var e = new Error("API " + r.status); e.status = r.status; throw e; }
  return r.json();
}
export async function apiPut(path, body) {
  const r = await fetchWithTimeout(API_BASE + path, {
    method:"PUT", headers: authHeaders({"Content-Type":"application/json"}),
    body: JSON.stringify(body), credentials:"include"
  });
  if (r.status === 401) return handle401(r);
  if (!r.ok) { var e = new Error("API " + r.status); e.status = r.status; throw e; }
  return r.json();
}
export async function apiPost(path, body) {
  const r = await fetchWithTimeout(API_BASE + path, {
    method:"POST", headers: authHeaders({"Content-Type":"application/json"}),
    body: JSON.stringify(body), credentials:"include"
  });
  if (r.status === 401) return handle401(r);
  if (!r.ok) { var e = new Error("API " + r.status); e.status = r.status; throw e; }
  return r.json();
}
export async function apiDel(path) {
  const r = await fetchWithTimeout(API_BASE + path, {
    method:"DELETE", headers: authHeaders(), credentials:"include"
  });
  if (r.status === 401) return handle401(r);
  if (!r.ok) { var e = new Error("API " + r.status); e.status = r.status; throw e; }
  return r.json();
}
