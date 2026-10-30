import { SESS_COLOR, inkOn } from "../lib/constants";

// ─── ORG MARK ─────────────────────────────────────────────────────────────────
// The signed-in organization's logo — or, without one, its initial on an accent tile.
// Replaces the generic OverCard "O" everywhere inside the app.
export function OrgMark({ authUser, size }) {
  var s = size || 36;
  var name = (authUser && authUser.orgName) || "OverCard";
  if (authUser && authUser.orgLogo) {
    return (
      <img src={authUser.orgLogo} alt={name + " logo"} width={s} height={s}
        style={{width:s,height:s,borderRadius:Math.round(s * 0.28),objectFit:"contain",background:"rgba(255,255,255,.06)",flexShrink:0,display:"block"}}/>
    );
  }
  return (
    <div aria-hidden="true" style={{width:s,height:s,borderRadius:Math.round(s * 0.3),background:SESS_COLOR,display:"flex",alignItems:"center",justifyContent:"center",
      fontSize:Math.round(s * 0.52),fontWeight:900,color:inkOn(SESS_COLOR),flexShrink:0}}>
      {name.trim()[0] ? name.trim()[0].toUpperCase() : "O"}
    </div>
  );
}
