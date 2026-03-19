// ─── API LAYER ────────────────────────────────────────────────────────────────
var _apiUrl = import.meta.env.VITE_API_URL || "";
export var API_BASE = _apiUrl + "/api";
export var SAVE_DELAY = 800;

var _onUnauth          = null; // set by App shell to redirect to login on 401
var _onSessionReplaced = null; // set by App shell to show "replaced" message on 401 session_replaced

export function setUnauthHandler(fn)          { _onUnauth = fn; }
export function setSessionReplacedHandler(fn) { _onSessionReplaced = fn; }

// Token stored in localStorage for mobile/Safari ITP fallback (Authorization: Bearer header)
var _token = localStorage.getItem("overcard_token") || null;
export function setStoredToken(t) {
  _token = t;
  if (t) localStorage.setItem("overcard_token", t);
  else   localStorage.removeItem("overcard_token");
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
  const r = await fetch(API_BASE + path, { credentials:"include", headers: authHeaders() });
  if (r.status === 401) return handle401(r);
  if (!r.ok) { var e = new Error("API " + r.status); e.status = r.status; throw e; }
  return r.json();
}
export async function apiPut(path, body) {
  const r = await fetch(API_BASE + path, {
    method:"PUT", headers: authHeaders({"Content-Type":"application/json"}),
    body: JSON.stringify(body), credentials:"include"
  });
  if (r.status === 401) return handle401(r);
  if (!r.ok) { var e = new Error("API " + r.status); e.status = r.status; throw e; }
  return r.json();
}
export async function apiPost(path, body) {
  const r = await fetch(API_BASE + path, {
    method:"POST", headers: authHeaders({"Content-Type":"application/json"}),
    body: JSON.stringify(body), credentials:"include"
  });
  if (r.status === 401) return handle401(r);
  if (!r.ok) { var e = new Error("API " + r.status); e.status = r.status; throw e; }
  return r.json();
}
export async function apiDel(path) {
  const r = await fetch(API_BASE + path, {
    method:"DELETE", headers: authHeaders(), credentials:"include"
  });
  if (r.status === 401) return handle401(r);
  if (!r.ok) { var e = new Error("API " + r.status); e.status = r.status; throw e; }
  return r.json();
}
