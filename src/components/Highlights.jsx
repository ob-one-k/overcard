import { useState, useContext } from "react";
import { STYPE, isAdminRole, themed } from "../lib/constants";
import { apiPut, apiDel } from "../lib/api";
import { useCachedGet } from "../lib/dataCache";
import { solidBtn, ghostBtn, inputSt, labelSt } from "../lib/styles";
import DesktopCtx from "../lib/DesktopCtx";

// ─── HIGHLIGHTED SESSIONS ─────────────────────────────────────────────────────
// Admins mark a finished session as an example for the whole org or one team
// (session.highlight = { scope, teamId, teamName, note, createdAt, createdByName }).
// The server only attaches highlights the viewer may see; anyone who sees one can open
// the session read-only.

// Gold star — a semantic marker, deliberately not themed with the org accent
export var HL_COLOR = "#FFC940";
var NOTE_MAX = 280;

export function highlightLabel(h) {
  if (!h) return "";
  return h.scope === "org" ? "Org highlight" : "Team · " + (h.teamName || "team");
}

export function HighlightChip({ highlight, fontSize }) {
  if (!highlight) return null;
  return (
    <span title={highlight.note || highlightLabel(highlight)}
      style={{display:"inline-flex",alignItems:"center",gap:3,fontSize:fontSize || 9,fontWeight:700,color:HL_COLOR,background:"rgba(255,201,64,.12)",border:"1px solid rgba(255,201,64,.32)",padding:"1px 7px",borderRadius:99,letterSpacing:.3,whiteSpace:"nowrap",flexShrink:0}}>
      ★ {highlightLabel(highlight)}
    </span>
  );
}

// Teams this admin may highlight for: the owner any team, an admin only teams they
// belong to or administer (mirrors the server's rule)
export function allowedHighlightTeams(authUser, orgTeams) {
  if (!authUser || !isAdminRole(authUser.role)) return [];
  var teams = orgTeams || [];
  if (authUser.role === "owner") return teams;
  return teams.filter(function(t) {
    return (t.memberIds || []).indexOf(authUser.id) > -1 || (t.adminIds || []).indexOf(authUser.id) > -1;
  });
}

// May this user change (or remove) the session's current highlight?
export function canEditHighlight(authUser, orgTeams, h) {
  if (!authUser || !isAdminRole(authUser.role)) return false;
  if (!h || h.scope === "org" || authUser.role === "owner") return true;
  return allowedHighlightTeams(authUser, orgTeams).some(function(t) { return t.id === h.teamId; });
}

// Strip under the review header: who it's highlighted for and why (everyone sees it)
export function HighlightBanner({ highlight, fz }) {
  if (!highlight) return null;
  var f = fz || function(n) { return n; };
  return (
    <div style={{display:"flex",alignItems:"flex-start",gap:8,padding:"8px 14px",background:"rgba(255,201,64,.06)",borderBottom:"1px solid rgba(255,201,64,.16)",flexShrink:0}}>
      <span aria-hidden="true" style={{color:HL_COLOR,fontSize:f(13),lineHeight:1.3}}>★</span>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:f(11),fontWeight:700,color:HL_COLOR}}>
          {highlight.scope === "org" ? "Highlighted for the whole organization" : "Highlighted for " + (highlight.teamName || "a team")}
        </div>
        {highlight.note && <div style={{fontSize:f(11),color:"rgba(255,255,255,.7)",lineHeight:1.5,marginTop:2,overflowWrap:"anywhere"}}>{highlight.note}</div>}
        {highlight.createdByName && <div style={{fontSize:f(9),color:"rgba(255,255,255,.3)",marginTop:2}}>by {highlight.createdByName}</div>}
      </div>
    </div>
  );
}

// Admin editor shown under the review header: org-wide or one allowed team, optional note
export function HighlightEditor({ session, authUser, orgTeams, onClose, fz }) {
  var f = fz || function(n) { return n; };
  var h = session.highlight;
  var teams = allowedHighlightTeams(authUser, orgTeams);
  var [scope, setScope]   = useState(h ? h.scope : "org");
  var [teamId, setTeamId] = useState(h && h.teamId ? h.teamId : (teams[0] ? teams[0].id : ""));
  var [note, setNote]     = useState(h && h.note ? h.note : "");
  var [busy, setBusy]     = useState(false);
  var [err, setErr]       = useState("");

  function save() {
    if (scope === "team" && !teamId) { setErr("Pick a team"); return; }
    setBusy(true); setErr("");
    apiPut("/sessions/" + session.id + "/highlight", { scope: scope, teamId: scope === "team" ? teamId : null, note: note.trim() })
      .then(function() { onClose(); })
      .catch(function(e) { setErr(e.message || "Couldn't save the highlight"); })
      .finally(function() { setBusy(false); });
  }
  function remove() {
    setBusy(true); setErr("");
    apiDel("/sessions/" + session.id + "/highlight")
      .then(function() { onClose(); })
      .catch(function(e) { setErr(e.message || "Couldn't remove the highlight"); })
      .finally(function() { setBusy(false); });
  }

  var pill = function(on) {
    return {flex:1,minHeight:40,background:on?"rgba(255,201,64,.14)":"rgba(255,255,255,.05)",border:"1.5px solid "+(on?"rgba(255,201,64,.5)":"rgba(255,255,255,.1)"),borderRadius:10,color:on?HL_COLOR:"rgba(255,255,255,.55)",fontSize:f(12),fontWeight:on?700:500,cursor:"pointer",fontFamily:"inherit",padding:"8px 10px"};
  };

  return (
    <div style={{padding:"12px 14px 14px",background:themed("rgba(8,20,48,.6)"),borderBottom:"1px solid rgba(255,201,64,.18)",display:"flex",flexDirection:"column",gap:10,flexShrink:0,animation:"fadeIn .18s ease both"}}>
      <div style={{fontSize:f(12),fontWeight:700,color:"#fff"}}>★ {h ? "Edit highlight" : "Highlight this session"}</div>
      <div role="radiogroup" aria-label="Who sees this highlight" style={{display:"flex",gap:8}}>
        <button type="button" role="radio" aria-checked={scope === "org"} onClick={function(){ setScope("org"); }} style={pill(scope === "org")}>Whole org</button>
        <button type="button" role="radio" aria-checked={scope === "team"} disabled={!teams.length} onClick={function(){ setScope("team"); }} style={pill(scope === "team")}
          title={teams.length ? undefined : "You don't belong to or administer any team"}>One team</button>
      </div>
      {scope === "team" && (
        <div>
          <label style={labelSt()}>Team</label>
          <select value={teamId} onChange={function(e){ setTeamId(e.target.value); }} style={inputSt({marginBottom:0,fontSize:f(13)})}>
            {teams.map(function(t) { return <option key={t.id} value={t.id}>{t.name}</option>; })}
          </select>
        </div>
      )}
      <div>
        <label style={labelSt()}>Why it's worth a listen <span style={{textTransform:"none",letterSpacing:0,fontWeight:400,color:"rgba(255,255,255,.25)"}}>(optional)</span></label>
        <textarea value={note} maxLength={NOTE_MAX} rows={2} onChange={function(e){ setNote(e.target.value); }}
          placeholder="e.g. Great recovery on the pricing objection"
          style={inputSt({marginBottom:0,resize:"vertical",fontSize:f(13),lineHeight:1.5})}/>
      </div>
      {err && <div role="alert" style={{fontSize:f(11),color:"#EF5350"}}>{err}</div>}
      <div style={{display:"flex",gap:8}}>
        {h && <button type="button" disabled={busy} onClick={remove} style={Object.assign({}, ghostBtn(), {padding:"9px 12px",fontSize:f(12),color:"#EF5350",borderColor:"rgba(239,83,80,.35)"})}>Remove</button>}
        <button type="button" disabled={busy} onClick={onClose} style={Object.assign({}, ghostBtn(), {flex:1,padding:"9px 12px",fontSize:f(12)})}>Cancel</button>
        <button type="button" disabled={busy} onClick={save} style={Object.assign({}, solidBtn(HL_COLOR), {flex:2,padding:"9px 12px",fontSize:f(12)})}>{busy ? "Saving…" : h ? "Save" : "Highlight"}</button>
      </div>
    </div>
  );
}

// Home: the three most recent highlights the viewer can see, across every deck
// `style` is merged onto the section (used for the desktop strip's padding) — nothing
// renders at all when there are no highlights
export function HomeHighlights({ onOpen, title, style }) {
  var desktop = useContext(DesktopCtx);
  var big = !!(desktop && desktop.isDesktop);
  var r = useCachedGet("/sessions/highlights?limit=3");
  var list = Array.isArray(r.data) ? r.data : [];
  if (!list.length) return null;
  return (
    <section aria-label="Highlighted sessions" style={Object.assign({marginBottom:big ? 0 : 18}, style)}>
      <div style={{fontSize:big ? 13 : 10,fontWeight:700,color:"rgba(255,255,255,.4)",letterSpacing:big ? 1.1 : 1.5,textTransform:"uppercase",marginBottom:big ? 10 : 8}}>
        <span style={{color:HL_COLOR}}>★</span> {title || "Highlighted sessions"}
      </div>
      <div style={{display:"grid",gridTemplateColumns:big ? "repeat(auto-fill,minmax(260px,1fr))" : "1fr",gap:big ? 12 : 8}}>
        {list.map(function(s) {
          var st = STYPE[s.mode || "live"] || STYPE.live;
          var outcome = s.sold || s.outcome === "sold" ? { t:"Sold", c:"#66BB6A" } : s.outcome === "booked" ? { t:"Booked", c:"#00B4FF" } : s.outcome === "abandoned" ? { t:"Abandoned", c:"rgba(255,255,255,.35)" } : null;
          return (
            <button key={s.id} onClick={function(){ onOpen(s); }}
              style={{textAlign:"left",background:"rgba(255,201,64,.05)",border:"1px solid rgba(255,201,64,.2)",borderLeft:"3px solid " + HL_COLOR,borderRadius:12,padding:big ? "12px 14px" : "10px 12px",cursor:"pointer",fontFamily:"inherit",display:"flex",gap:10,alignItems:"flex-start",minWidth:0,minHeight:44}}>
              <div style={{width:big ? 34 : 30,height:big ? 34 : 30,borderRadius:9,background:(s.deckColor || "#00B4FF") + "22",border:"1.5px solid " + (s.deckColor || "#00B4FF") + "44",display:"flex",alignItems:"center",justifyContent:"center",fontSize:big ? 17 : 15,flexShrink:0}}>{s.deckIcon || "💼"}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:big ? 14 : 13,fontWeight:700,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name || "Untitled session"}</div>
                <div style={{fontSize:big ? 12 : 10,color:"rgba(255,255,255,.45)",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {s.userName}{s.deckName ? " · " + s.deckName : ""}
                </div>
                <div style={{display:"flex",gap:5,flexWrap:"wrap",marginTop:6}}>
                  <HighlightChip highlight={s.highlight} fontSize={big ? 10 : 9}/>
                  <span style={{fontSize:big ? 10 : 9,fontWeight:700,color:st.color,background:st.bg,border:"1px solid " + st.border,padding:"1px 7px",borderRadius:99,textTransform:"uppercase",letterSpacing:.3}}>{st.label}</span>
                  {outcome && <span style={{fontSize:big ? 10 : 9,fontWeight:700,color:outcome.c}}>{outcome.t}</span>}
                </div>
                {s.highlight && s.highlight.note && <div style={{fontSize:big ? 12 : 11,color:"rgba(255,255,255,.6)",marginTop:6,lineHeight:1.45,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{s.highlight.note}</div>}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
