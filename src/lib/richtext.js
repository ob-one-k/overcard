import { getViewerName } from "./viewer";

// ─── RICH TEXT ────────────────────────────────────────────────────────────────
// Markup: **bold**, *italic*, *italic*[Inflection], and {{NAME}} — a block that shows
// the viewer's first name. {{NAME}} is matched first so it never reads as an inflection.
export var NAME_TOKEN = "{{NAME}}";
var NAME_RE = /\{\{NAME\}\}/g;

// The name a {{NAME}} block shows ("NAME" when nobody is signed in, e.g. previews in tests)
export function nameText() { return getViewerName() || "NAME"; }
export function fillName(s) { return (s || "").replace(NAME_RE, nameText()); }

export function parseRichText(raw) {
  if (!raw) return [];
  var segs = [], re = /\{\{NAME\}\}|\*\*(.+?)\*\*|\*(.+?)\*\[([^\]]+)\]|\*(.+?)\*/g, last = 0, m;
  while ((m = re.exec(raw)) !== null) {
    if (m.index > last) segs.push({ type:"text", content: raw.slice(last, m.index) });
    if (m[0] === NAME_TOKEN)     segs.push({ type:"name" });
    else if (m[1] !== undefined) segs.push({ type:"bold",   content: m[1] });
    else if (m[2] !== undefined) segs.push({ type:"italic", content: m[2], inflection: m[3] });
    else                         segs.push({ type:"italic", content: m[4], inflection: null });
    last = re.lastIndex;
  }
  if (last < raw.length) segs.push({ type:"text", content: raw.slice(last) });
  return segs;
}

// Plain text of a script as the viewer reads it ({{NAME}} → their first name)
export function stripMarkup(raw) {
  if (!raw) return "";
  return fillName(raw.replace(/\*\*(.+?)\*\*/g,"$1").replace(/\*(.+?)\*\[([^\]]+)\]/g,"$1").replace(/\*(.+?)\*/g,"$1"));
}

// Characters a script counts against its limit: visible text, with each {{NAME}} as "[NAME]"
export function scriptLength(raw) {
  if (!raw) return 0;
  return raw.replace(/\*\*(.+?)\*\*/g,"$1").replace(/\*(.+?)\*\[([^\]]+)\]/g,"$1").replace(/\*(.+?)\*/g,"$1").replace(NAME_RE, "[NAME]").length;
}

// Scripts are one line: line breaks become single spaces
export function oneLine(raw) { return (raw || "").replace(/\s*[\r\n]+\s*/g, " "); }
