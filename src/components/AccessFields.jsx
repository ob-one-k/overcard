import { SESS_COLOR, accentA } from "../lib/constants";
import { labelSt } from "../lib/styles";

// ─── WHO CAN USE / WHO CAN EDIT ───────────────────────────────────────────────
// The objection-stack permission fields (same choices as a deck's): org-wide or assigned to
// teams/people, plus the admins allowed to edit. value = { visibility, accessList, editorIds };
// onChange gets the whole updated value. creatorId is left out of the editor chips (the
// creator and the owner always edit).
export function AccessFields({ value, onChange, orgUsers, orgTeams, creatorId, noun }) {
  var v = value || {};
  var al = v.accessList || [];
  var editors = v.editorIds || [];
  function set(changes) { onChange(Object.assign({}, v, changes)); }
  function has(type, id) { return al.some(function(a) { return a.entityType === type && a.entityId === id; }); }
  function toggle(type, id) {
    set({ accessList: has(type, id)
      ? al.filter(function(a) { return !(a.entityType === type && a.entityId === id); })
      : al.concat([{ entityType: type, entityId: id }]) });
  }
  function chip(on, label, onClick, key, color) {
    return (
      <button key={key} type="button" aria-pressed={on} onClick={onClick}
        style={{background:on?(color ? accentA(.16) : "rgba(0,180,255,.18)"):"rgba(255,255,255,.05)",border:"1px solid "+(on?(color ? accentA(.45) : "rgba(0,180,255,.45)"):"rgba(255,255,255,.1)"),borderRadius:8,padding:"6px 11px",cursor:"pointer",fontFamily:"inherit",fontSize:12,color:on?(color ? SESS_COLOR : "#00B4FF"):"rgba(255,255,255,.5)",fontWeight:on?700:500}}>{label}</button>
    );
  }
  var admins = (orgUsers || []).filter(function(u) { return u.role === "admin" && u.id !== creatorId; });
  return (
    <div>
      <label style={labelSt()}>Who can use it</label>
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        {["public", "private"].map(function(opt) {
          var on = (v.visibility || "public") === opt;
          return (
            <button key={opt} type="button" aria-pressed={on} onClick={function() { set({ visibility: opt }); }}
              style={{flex:1,background:on?accentA(.1):"rgba(255,255,255,.07)",border:"1.5px solid "+(on?accentA(.35):"rgba(255,255,255,.1)"),borderRadius:10,padding:"8px 6px",cursor:"pointer",fontFamily:"inherit",textAlign:"center"}}>
              <div style={{fontSize:15}}>{opt === "public" ? "🌐" : "🔒"}</div>
              <div style={{fontSize:11,color:on?SESS_COLOR:"rgba(255,255,255,.45)",fontWeight:on?700:500,marginTop:2}}>{opt === "public" ? "Everyone on the deck" : "Teams & people"}</div>
            </button>
          );
        })}
      </div>
      {v.visibility === "private" && (
        <div style={{marginBottom:12}}>
          {(orgTeams || []).length > 0 && <>
            <label style={labelSt()}>Teams</label>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
              {(orgTeams || []).map(function(t) { return chip(has("team", t.id), t.name, function() { toggle("team", t.id); }, t.id); })}
            </div>
          </>}
          {(orgUsers || []).length > 0 && <>
            <label style={labelSt()}>People</label>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {(orgUsers || []).map(function(u) { return chip(has("user", u.id), u.displayName, function() { toggle("user", u.id); }, u.id); })}
            </div>
          </>}
          {al.length === 0 && <div style={{fontSize:11,color:"#FFB74D",marginTop:8}}>Nobody is picked yet — only people who can edit it will see this {noun || "stack"}.</div>}
        </div>
      )}
      {admins.length > 0 && (
        <div style={{marginBottom:12}}>
          <label style={labelSt()}>Can edit</label>
          <div style={{fontSize:11,color:"rgba(255,255,255,.4)",marginBottom:6,lineHeight:1.5}}>The owner and the {noun || "stack"}'s creator always can. Pick other admins who may edit it.</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {admins.map(function(u) {
              var on = editors.indexOf(u.id) > -1;
              return chip(on, "✎ " + u.displayName, function() {
                set({ editorIds: on ? editors.filter(function(x) { return x !== u.id; }) : editors.concat([u.id]) });
              }, u.id, true);
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// One-line summary for people who can't change the settings
export function accessSummary(stack) {
  return (stack.visibility === "private" ? "🔒 Assigned to teams/people" : "🌐 Everyone on the deck")
    + " · only the owner or the stack's creator can change who uses or edits it.";
}
