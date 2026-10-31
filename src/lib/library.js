// ─── LIBRARY OPENER ───────────────────────────────────────────────────────────
// Anything (header button, notification, a just-saved clip) can open the Library sheet
// without threading callbacks through the app: openLibrary({ tab, clipId }). App listens.
var listeners = [];

export function openLibrary(req) {
  var r = Object.assign({ tab: "clips" }, req || {}, { nonce: Date.now() });
  listeners.slice().forEach(function(fn) { fn(r); });
}
export function onOpenLibrary(fn) {
  listeners.push(fn);
  return function() { listeners = listeners.filter(function(f) { return f !== fn; }); };
}
