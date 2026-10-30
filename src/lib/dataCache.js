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

function notify(url) { (subs[url] || []).slice().forEach(function(fn) { fn(); }); }

// Any successful write to /sessions/…, /admin/…, /org… makes that area's cached reads stale
setWriteHook(function(path) {
  var m = /^\/[^/?]+/.exec(path);
  if (m) invalidate(m[0]);
  // Creating/editing/deleting users changes who appears in session lists and pickers
  if (path.indexOf("/admin/users") === 0) invalidate("/sessions");
});

// Forget everything (sign-out / account switch — cached data belongs to one user)
export function clearCache() { store = {}; inflight = {}; gen++; }

export function peek(url) { return store[url] ? store[url].data : undefined; }

// Resolves with cached data when it is fresher than ttl, otherwise fetches (deduped)
export function cachedGet(url, opts) {
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
    store[url] = { data: data, ts: Date.now() };
    delete inflight[url];
    notify(url);
    return data;
  }, function(err) {
    if (g === gen) delete inflight[url];
    throw err;
  });
  inflight[url] = p;
  return p;
}

// Drop every cached URL starting with prefix (e.g. "/sessions") and refetch the
// ones that are on screen right now
export function invalidate(prefix) {
  Object.keys(store).forEach(function(url) {
    if (url.indexOf(prefix) !== 0) return;
    store[url].ts = 0;
    if (subs[url] && subs[url].length) revalidate(url).catch(function() {});
  });
}

// React hook: { data, error, loading, reload }. data is the cached value right
// away when one exists (loading=false), so revisiting a tab shows no spinner.
// url=null skips fetching.
export function useCachedGet(url, opts) {
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
