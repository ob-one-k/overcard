// ─── STYLE HELPERS ────────────────────────────────────────────────────────────
import { inkOn, themed } from "./constants";

export function solidBtn(color) {
  // Text colour from the background's luminance, so any org accent stays readable
  var tc = inkOn(color);
  return { background:color, border:"none", borderRadius:14, color:tc, fontSize:14, fontWeight:700, padding:"12px 20px", cursor:"pointer", fontFamily:"inherit", textAlign:"center", display:"inline-flex", alignItems:"center", justifyContent:"center", gap:6 };
}
export function ghostBtn() {
  return { background:"transparent", border:"1.5px solid rgba(255,255,255,.15)", borderRadius:14, color:"rgba(255,255,255,.6)", fontSize:14, padding:"12px", cursor:"pointer", fontFamily:"inherit", textAlign:"center" };
}
export function ghostSm(extra) {
  var b = { background:"transparent", border:"1px solid rgba(255,255,255,.15)", borderRadius:99, color:"rgba(255,255,255,.5)", fontSize:12, padding:"6px 13px", cursor:"pointer", fontFamily:"inherit", flexShrink:0 };
  return extra ? Object.assign({}, b, extra) : b;
}
export function iconBtn() {
  return { background:"rgba(255,255,255,.07)", border:"1px solid rgba(255,255,255,.1)", borderRadius:10, color:"rgba(255,255,255,.6)", cursor:"pointer", fontSize:13, padding:"6px 10px", fontFamily:"inherit" };
}
export function labelSt() {
  return { display:"block", fontSize:10, fontWeight:700, letterSpacing:1.5, color:"rgba(255,255,255,.35)", textTransform:"uppercase", marginBottom:7 };
}
export function inputSt(extra) {
  var b = { display:"block", width:"100%", background:themed("rgba(8,25,60,.5)"), border:"1.5px solid rgba(255,255,255,.1)", borderRadius:12, color:"#fff", fontSize:14, padding:"11px 14px", fontFamily:"inherit", outline:"none", boxSizing:"border-box" };
  return extra ? Object.assign({}, b, extra) : b;
}
export function cardBg(extra) {
  var b = { background:"rgba(255,255,255,.07)", border:"1px solid rgba(255,255,255,.08)", borderRadius:12, padding:"12px 14px" };
  return extra ? Object.assign({}, b, extra) : b;
}
export function badgeSt(color, bg) {
  return { fontSize:9, padding:"1px 7px", borderRadius:99, border:"1px solid " + (color || "rgba(255,255,255,.15)"), color: color || "rgba(255,255,255,.5)", background: bg || "transparent", whiteSpace:"nowrap" };
}
export function dividerV(h) {
  return { width:1, height: h || 24, background:"rgba(255,255,255,.07)", flexShrink:0 };
}
export function modalOverlay() {
  return { position:"fixed", inset:0, zIndex:500, background:"rgba(0,0,0,.72)", backdropFilter:"blur(12px)", display:"flex", alignItems:"center", justifyContent:"center" };
}
export function modalDialog(w) {
  return { background:themed("#081428"), borderRadius:20, border:"1px solid rgba(255,255,255,.1)", width:w||480, maxWidth:"calc(100vw - 32px)", maxHeight:"85vh", overflowY:"auto", position:"relative", boxShadow:"0 24px 80px rgba(0,0,0,.8)" };
}
export function resizeHandle() {
  return { width:6, cursor:"col-resize", flexShrink:0, background:"transparent",
    borderRight:"1px solid rgba(255,255,255,.06)", transition:"background .15s" };
}
// Bottom sheets: the visible viewport (above any on-screen keyboard — see useViewport.js)
// minus a strip of backdrop that shrinks to 8px while the keyboard is up
export var SHEET_MAX_H = "calc(var(--vvh, 94vh) - var(--sheet-gap, 48px))";
// Full-screen fixed layer that tracks the visible viewport instead of inset:0
export function overlayFill(z) {
  return { position:"fixed", left:0, right:0, top:"var(--vvt, 0px)", height:"var(--vvh, 100%)", zIndex:z, display:"flex", flexDirection:"column" };
}
