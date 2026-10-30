import { lsGet, lsSet } from "./api";

// ─── ORG BRAND STORE ──────────────────────────────────────────────────────────
// The signed-in org's name/logo/accent, kept in memory for OrgMark (so deep
// components don't need authUser) and cached on the device so the boot, error and
// "waking up" screens can show the org's mark before /auth/me answers.
// The logo is a data: URL of up to ~300 KB, so /auth/me only re-sends it when the
// cached version (orgLogoVer) is stale.
var KEY = "overcard_brand";
var current = read();

function read() {
  try { var v = JSON.parse(lsGet(KEY) || "null"); return v && typeof v === "object" ? v : null; } catch (e) { return null; }
}

export function getBrand() { return current; }

// Merge a /auth/me (or login) response with the cache and remember the result.
// Returns the user object with orgLogo filled in when the server omitted it.
export function syncBrand(user) {
  if (!user) return user;
  var u = user;
  if (user.orgLogoCached) {
    u = Object.assign({}, user, { orgLogo: current && current.orgLogoVer === user.orgLogoVer ? current.orgLogo : null });
    delete u.orgLogoCached;
  }
  setBrand({ orgName: u.orgName || null, orgLogo: u.orgLogo || null, orgAccent: u.orgAccent || null, orgLogoVer: u.orgLogoVer || null });
  return u;
}

export function setBrand(b) {
  current = b;
  lsSet(KEY, b ? JSON.stringify(b) : null);
}

export function cachedLogoVer() { return current && current.orgLogo && current.orgLogoVer ? current.orgLogoVer : ""; }
