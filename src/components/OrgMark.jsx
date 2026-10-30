import { SESS_COLOR, inkOn } from "../lib/constants";
import { getBrand } from "../lib/brand";

// ─── ORG MARK ─────────────────────────────────────────────────────────────────
// The signed-in organization's logo — or, without one, its initial on an accent tile.
// Replaces the generic OverCard "O" everywhere inside the app.
//   authUser — optional; defaults to the current org brand (lib/brand.js)
//   wide     — let horizontal logos run up to 3× wider than tall (headers)
//   withName — show the org name beside the mark (nameSize sets its font size)
export function OrgMark({ authUser, size, wide, withName, nameSize, nameColor }) {
  var b = authUser || getBrand() || {};
  var s = size || 36;
  var name = b.orgName || "OverCard";
  var mark;
  if (b.orgLogo) {
    mark = (
      <img src={b.orgLogo} alt={name + " logo"} height={s} width={wide ? undefined : s}
        style={{height:s,width:wide ? "auto" : s,maxWidth:wide ? s * 3 : s,borderRadius:Math.round(s * (wide ? 0.18 : 0.28)),objectFit:"contain",
          background:wide ? "transparent" : "rgba(255,255,255,.06)",flexShrink:0,display:"block"}}/>
    );
  } else {
    mark = (
      <div aria-hidden="true" style={{width:s,height:s,borderRadius:Math.round(s * 0.3),background:SESS_COLOR,display:"flex",alignItems:"center",justifyContent:"center",
        fontSize:Math.round(s * 0.52),fontWeight:900,color:inkOn(SESS_COLOR),flexShrink:0}}>
        {name.trim()[0] ? name.trim()[0].toUpperCase() : "O"}
      </div>
    );
  }
  if (!withName) return mark;
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:Math.round(s * 0.3),minWidth:0}}>
      {mark}
      <span style={{fontSize:nameSize || Math.round(s * 0.45),fontWeight:800,color:nameColor || "#fff",letterSpacing:-.2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",minWidth:0}}>{name}</span>
    </span>
  );
}
