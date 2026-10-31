import { useState, useEffect, useRef } from "react";
import { apiGet, setWriteHook } from "./api";

// ─── CLIENT DATA CACHE ────────────────────────────────────────────────────────
// Stale-while-revalidate cache for GET endpoints. Tabs unmount when you leave
// them; with this, coming back renders the last data instantly while a fresh
// copy loads in the background. Concurrent requests for the same URL share one
// fetch. Writes call invalidate(prefix) so the next read refetches.

var store = {};      // url → { data, ts }
var inflight = {};   // url → Promise
var subs = {};       // url → [fn]
var DEFAULT_TTL = 30000;
var gen = 0;         // bumped by clearCache so responses for a previous user are dropped

// One cache entry per resource: "?b=1&a=2" and "?a=2&b=1" are the same request
function norm(url) {
  var q = url.indexOf("?");
  if (q < 0) return url;
  var parts = url.slice(q + 1).split("&").filter(Boolean).sort();
  return url.slice(0, q) + (parts.length ? "?" + parts.join("&") : "");
}

function notify(url) { (subs[url] || []).slice().forEach(function(fn) { fn(); }); }

// Any successful write to /sessions/…, /admin/…, /org… makes that area's cached reads stale
setWriteHook(function(path) {
  // Live-session heartbeats change nothing a list shows
  if (/^\/sessions\/[^/]+\/(start|beat)$/.test(path)) return;
  var m = /^\/[^/?]+/.exec(path);
  if (m) invalidate(m[0]);
  // Creating/editing/deleting users changes who appears in session lists and pickers
  if (path.indexOf("/admin/users") === 0) invalidate("/sessions");
});

// Forget everything (sign-out / account switch — cached data belongs to one user)
export function clearCache() { store = {}; inflight = {}; gen++; }

export function peek(url) { url = norm(url); return store[url] ? store[url].data : undefined; }

// Resolves with cached data when it is fresher than ttl, otherwise fetches (deduped)
export function cachedGet(url, opts) {
  url = norm(url);
  var ttl = opts && opts.ttl != null ? opts.ttl : DEFAULT_TTL;
  var hit = store[url];
  if (hit && Date.now() - hit.ts < ttl && !(opts && opts.force)) return Promise.resolve(hit.data);
  return revalidate(url);
}

function revalidate(url) {
  if (inflight[url]) return inflight[url];
  var g = gen;
  var p = apiGet(url).then(function(data) {
    if (g !== gen) return data;
    // Superseded by an invalidation while in flight: keep the data but mark it stale
    var current = inflight[url] === p;
    store[url] = { data: data, ts: current ? Date.now() : 0 };
    if (current) delete inflight[url];
    notify(url);
    return data;
  }, function(err) {
    if (g === gen && inflight[url] === p) delete inflight[url];
    throw err;
  });
  inflight[url] = p;
  return p;
}

// Drop every cached URL starting with prefix (e.g. "/sessions") and refetch the
// ones that are on screen right now
export function invalidate(prefix) {
  // A request already in flight may have been answered before the change — don't let it
  // be cached as fresh; the next read starts a new one
  Object.keys(inflight).forEach(function(url) { if (url.indexOf(prefix) === 0) delete inflight[url]; });
  Object.keys(store).forEach(function(url) {
    if (url.indexOf(prefix) !== 0) return;
    store[url].ts = 0;
    if (subs[url] && subs[url].length) revalidate(url).catch(function() {});
  });
  bumpVersion(prefix);
}

// ─── VERSION COUNTERS ─────────────────────────────────────────────────────────
// Components that load with cachedGet() inside an effect add useCacheVersion(prefix)
// to the effect's deps: it changes whenever that area is invalidated (a write or a
// live event), so the effect re-runs and picks up fresh data.
var versions = {};      // prefix → number
var verSubs = [];       // { prefix, fn }

function bumpVersion(prefix) {
  verSubs.slice().forEach(function(s) {
    if (s.prefix.indexOf(prefix) === 0 || prefix.indexOf(s.prefix) === 0) {
      versions[s.prefix] = (versions[s.prefix] || 0) + 1;
      s.fn();
    }
  });
}

export function useCacheVersion(prefix) {
  var [, force] = useState(0);
  useEffect(function() {
    var sub = { prefix: prefix, fn: function() { force(function(n) { return n + 1; }); } };
    verSubs.push(sub);
    return function() { verSubs = verSubs.filter(function(x) { return x !== sub; }); };
  }, [prefix]);
  return versions[prefix] || 0;
}

// React hook: { data, error, loading, reload }. data is the cached value right
// away when one exists (loading=false), so revisiting a tab shows no spinner.
// url=null skips fetching.
export function useCachedGet(url, opts) {
  if (url) url = norm(url);
  var ttl = opts && opts.ttl;
  var [, force] = useState(0);
  var errRef = useRef(null);
  var reqUrl = useRef(url);
  reqUrl.current = url;

  useEffect(function() {
    if (!url) return;
    errRef.current = null;
    var alive = true;
    function onChange() { if (alive) force(function(n) { return n + 1; }); }
    (subs[url] = subs[url] || []).push(onChange);
    cachedGet(url, { ttl: ttl }).catch(function(err) {
      if (alive && reqUrl.current === url) { errRef.current = err; force(function(n) { return n + 1; }); }
    });
    return function() {
      alive = false;
      subs[url] = (subs[url] || []).filter(function(f) { return f !== onChange; });
    };
  }, [url, ttl]);

  var data = url ? peek(url) : undefined;
  return {
    data: data,
    error: errRef.current,
    loading: !!url && data === undefined && !errRef.current,
    reload: function() { if (url) return revalidate(url); },
  };
}
