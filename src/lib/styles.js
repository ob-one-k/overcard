// ─── STYLE HELPERS ────────────────────────────────────────────────────────────
export function solidBtn(color) {
  var lightColors = ["#F5A623","#FFD54F","#66BB6A","#00B4FF","#A8FF3E"];
  var tc = lightColors.includes(color) ? "#000" : "#fff";
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
  var b = { display:"block", width:"100%", background:"rgba(8,25,60,.5)", border:"1.5px solid rgba(255,255,255,.1)", borderRadius:12, color:"#fff", fontSize:14, padding:"11px 14px", fontFamily:"inherit", outline:"none", boxSizing:"border-box" };
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
