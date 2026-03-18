// ─── RICH TEXT ────────────────────────────────────────────────────────────────
export function parseRichText(raw) {
  if (!raw) return [];
  var segs = [], re = /\*\*(.+?)\*\*|\*(.+?)\*\[([^\]]+)\]|\*(.+?)\*/g, last = 0, m;
  while ((m = re.exec(raw)) !== null) {
    if (m.index > last) segs.push({ type:"text", content: raw.slice(last, m.index) });
    if (m[1] !== undefined)      segs.push({ type:"bold",   content: m[1] });
    else if (m[2] !== undefined) segs.push({ type:"italic", content: m[2], inflection: m[3] });
    else                         segs.push({ type:"italic", content: m[4], inflection: null });
    last = re.lastIndex;
  }
  if (last < raw.length) segs.push({ type:"text", content: raw.slice(last) });
  return segs;
}
export function stripMarkup(raw) {
  if (!raw) return "";
  return raw.replace(/\*\*(.+?)\*\*/g,"$1").replace(/\*(.+?)\*\[([^\]]+)\]/g,"$1").replace(/\*(.+?)\*/g,"$1");
}
