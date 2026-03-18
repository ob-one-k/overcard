// ─── API LAYER ────────────────────────────────────────────────────────────────
var _apiUrl = import.meta.env.VITE_API_URL || "";
export var API_BASE = _apiUrl + "/api";
export var SAVE_DELAY = 800;

var _onUnauth = null; // set by App shell to redirect to login on 401
export function setUnauthHandler(fn) { _onUnauth = fn; }

export async function apiGet(path) {
  const r = await fetch(API_BASE + path, { credentials:"include" });
  if (r.status === 401) { if (_onUnauth) _onUnauth(); throw new Error("401"); }
  if (!r.ok) throw new Error("API " + r.status);
  return r.json();
}
export async function apiPut(path, body) {
  const r = await fetch(API_BASE + path, {
    method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body), credentials:"include"
  });
  if (r.status === 401) { if (_onUnauth) _onUnauth(); throw new Error("401"); }
  if (!r.ok) throw new Error("API " + r.status);
  return r.json();
}
export async function apiPost(path, body) {
  const r = await fetch(API_BASE + path, {
    method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body), credentials:"include"
  });
  if (r.status === 401) { if (_onUnauth) _onUnauth(); throw new Error("401"); }
  if (!r.ok) throw new Error("API " + r.status);
  return r.json();
}
export async function apiDel(path) {
  const r = await fetch(API_BASE + path, { method:"DELETE", credentials:"include" });
  if (r.status === 401) { if (_onUnauth) _onUnauth(); throw new Error("401"); }
  if (!r.ok) throw new Error("API " + r.status);
  return r.json();
}
