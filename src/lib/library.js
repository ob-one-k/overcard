// ─── LIBRARY OPENER ───────────────────────────────────────────────────────────
// Anything (header button, notification, a just-saved clip) can open the Library sheet
// without threading callbacks through the app: openLibrary({ tab, clipId }). App listens.
var listeners = [];

export function openLibrary(req) {
  var r = Object.assign({ tab: "clips" }, req || {}, { nonce: Date.now() });
  listeners.slice().forEach(function(fn) { fn(r); });
}
// While the Library is open, keyboard shortcuts of the screen under it stand down
var openCount = 0;
export function setLibraryOpen(on) { openCount = Math.max(0, openCount + (on ? 1 : -1)); }
export function isLibraryOpen() { return openCount > 0; }

export function onOpenLibrary(fn) {
  listeners.push(fn);
  return function() { listeners = listeners.filter(function(f) { return f !== fn; }); };
}
