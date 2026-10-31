// ─── VIEWER STORE ─────────────────────────────────────────────────────────────
// The signed-in person's first name, kept in memory so every card script can show
// a {{NAME}} block as "you" without threading authUser through every component.
// App sets it from /auth/me before the main shell renders and clears it on sign-out.
var name = "";

export function setViewerName(n) { name = typeof n === "string" ? n.trim() : ""; }
export function getViewerName() { return name; }
