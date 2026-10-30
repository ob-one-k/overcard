import { useState, useEffect, useContext } from "react";
import DesktopCtx from "../../lib/DesktopCtx";
import { STYPE, OBJ_COLOR, isAdminRole, roleMeta } from "../../lib/constants";
import { apiGet, apiDel } from "../../lib/api";
import { inputSt } from "../../lib/styles";
import { DarkDatePicker } from "../ui";
import { SessionReview, sessionVisits, sessionNotes, sessionDurSec, fmtSec, fmtDate, fmtTime } from "../Sessions";
import { deleteAudioBlob } from "../../lib/audioStore";

// ─── DESKTOP TYPE SCALE ───────────────────────────────────────────────────────
// body 14–15 · meta 13 · section heading 16–18 · page title 20–24 · badges ≥11
var ACCENT = "#FFD54F";
var TXT    = "#fff";
var TXT2   = "rgba(255,255,255,.72)";
var TXT3   = "rgba(255,255,255,.5)";
var LINE   = "rgba(255,255,255,.07)";

// Deterministic avatar colour per user so the same rep is always the same colour
var AVATAR_COLORS = ["#F5A623","#00B4FF","#66BB6A","#FFD54F","#4DB6AC","#FF8A65","#7C4DFF","#29B6F6","#EF5350","#A8FF3E"];
function avatarColor(key) {
  var s = String(key || "?"), h = 0;
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
function initials(name) {
  var parts = String(name || "?").trim().split(/\s+/);
  var a = parts[0] ? parts[0].charAt(0) : "?";
  var b = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
  return (a + b).toUpperCase();
}
function Avatar({ name, colorKey, size }) {
  var sz = size || 30;
  var c = avatarColor(colorKey || name);
  return (
    <span style={{width:sz,height:sz,borderRadius:"50%",background:c+"26",border:"1.5px solid "+c+"88",color:c,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:Math.round(sz*0.4),fontWeight:800,flexShrink:0,letterSpacing:.3}}>
      {initials(name)}
    </span>
  );
}

// ─── OUTCOME BADGE (local copy) ───────────────────────────────────────────────
function outcomeMeta(session) {
  var outcome = session.outcome || "";
  var mode = session.mode || "live";
  var sold = session.sold || outcome === "sold";
  if (mode === "practice")         return { label:"Practice",   color:"#00B4FF",               bg:"rgba(0,180,255,.12)",    border:"rgba(0,180,255,.3)" };
  if (outcome === "not_contacted") return { label:"No Contact", color:"rgba(255,255,255,.55)", bg:"rgba(255,255,255,.06)",  border:"rgba(255,255,255,.16)" };
  if (sold)                        return { label:"✓ Sold",     color:"#66BB6A",               bg:"rgba(102,187,106,.15)",  border:"rgba(102,187,106,.35)" };
  if (outcome === "booked")        return { label:"Booked",     color:"#FFD54F",               bg:"rgba(255,213,79,.12)",   border:"rgba(255,213,79,.3)" };
  if (outcome === "abandoned")     return { label:"Abandoned",  color:"#EF5350",               bg:"rgba(239,83,80,.1)",     border:"rgba(239,83,80,.28)" };
  return { label:"Live", color:"rgba(255,255,255,.65)", bg:"rgba(255,255,255,.07)", border:"rgba(255,255,255,.14)" };
}
function OutcomeBadge({ session }) {
  var m = outcomeMeta(session);
  return <span style={{fontSize:11,background:m.bg,border:"1px solid "+m.border,color:m.color,padding:"3px 9px",borderRadius:99,fontWeight:700,whiteSpace:"nowrap",flexShrink:0,letterSpacing:.2}}>{m.label}</span>;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function outcomePriority(s) {
  if ((s.mode||"live") === "practice") return 5;
  if (s.sold || s.outcome === "sold") return 1;
  if (s.outcome === "booked") return 2;
  if (s.outcome === "not_contacted") return 4;
  return 3;
}

function computeFilteredStats(list) {
  var live = list.filter(function(s){ return (s.mode||"live") === "live"; });
  var sold = live.filter(function(s){ return s.sold || s.outcome === "sold"; });
  var winRate = live.length > 0 ? Math.round(sold.length / live.length * 100) : null;
  var durSecs = list.filter(function(s){ return s.endTs; }).map(function(s){ return sessionDurSec(s) || 0; });
  var avgSec = durSecs.length > 0 ? Math.round(durSecs.reduce(function(a,b){return a+b;},0)/durSecs.length) : null;
  return { total:list.length, winRate:winRate, avgSec:avgSec, soldCount:sold.length, liveCount:live.length, practiceCount:list.length - live.length };
}

function pillBtn(on, color) {
  var c = color || ACCENT;
  return {
    background:on?c+"1f":"rgba(255,255,255,.04)",
    border:"1px solid "+(on?c+"66":"rgba(255,255,255,.1)"),
    borderRadius:99, padding:"5px 12px", cursor:"pointer",
    fontSize:13, color:on?c:TXT3, fontFamily:"inherit", fontWeight:on?700:500,
    whiteSpace:"nowrap", lineHeight:1.2
  };
}

function panelSt(extra) {
  return Object.assign({ background:"rgba(255,255,255,.035)", border:"1px solid "+LINE, borderRadius:14, padding:"16px 18px", minWidth:0 }, extra || {});
}
function PanelTitle({ children, right }) {
  return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,gap:8}}>
      <div style={{fontSize:16,fontWeight:700,color:TXT}}>{children}</div>
      {right}
    </div>
  );
}

// ─── SESSIONS DESKTOP ─────────────────────────────────────────────────────────
// Two-pane layout:
//   Left  (clamp 360–440px) — filters + session list; every row shows WHO ran it
//   Right (flex:1)          — SessionReview for the selected session, or an
//                              overview dashboard of the filtered set (KPIs,
//                              outcome mix, per-rep breakdown) when none selected
export function SessionsDesktop({ deckId, deckName, deckColor, deckRootCard, onInitialReview, viewScope, setViewScope, authUser, orgUsers, orgTeams }) {
  var [sessions,    setSessions]    = useState(null);
  var [selectedId,  setSelectedId]  = useState(onInitialReview || null);
  var [fType,       setFType]       = useState("all");
  var [sortBy,      setSortBy]      = useState("date");
  var [search,      setSearch]      = useState("");
  var [fFrom,       setFFrom]       = useState("");
  var [fTo,         setFTo]         = useState("");
  var [fUser,       setFUser]       = useState("");
  var [confirmDel,  setConfirmDel]  = useState(null);
  var [hoverId,     setHoverId]     = useState(null);
  var [fbSeenTs,    setFbSeenTs]    = useState(function(){ try { return JSON.parse(localStorage.getItem("rc_fb_seen") || "{}"); } catch(e){ return {}; } });
  var [showOverview, setShowOverview] = useState(false); // tablet portrait: overview shown as the "detail" view

  // Tablet (compact): smaller type, 44px targets, no hover-only controls.
  // When the window is too narrow for two panes (portrait), list and detail
  // stack: picking a session replaces the list; the review's ← returns to it.
  var desktop = useContext(DesktopCtx);
  var compact = !!desktop.compact;
  var touch   = !!desktop.isTouchPrimary;
  var stacked = compact && !desktop.splitPanes;

  var isAdmin      = !!(authUser && isAdminRole(authUser.role));
  var isAdminScope = !!(isAdmin && viewScope && viewScope !== "self");

  useEffect(function() {
    if (onInitialReview) setSelectedId(onInitialReview);
  }, [onInitialReview]);

  function buildUrl() {
    var url = "/sessions?deckId=" + deckId;
    if (isAdminScope) url += "&scope=" + viewScope;
    return url;
  }

  useEffect(function() {
    var cancelled = false;
    setSessions(null);
    apiGet(buildUrl())
      .then(function(data) { if (!cancelled) setSessions(data.sort(function(a,b){ return b.startTs - a.startTs; })); })
      .catch(function() { if (!cancelled) setSessions([]); });
    return function() { cancelled = true; };
  }, [deckId, viewScope]);

  // Reset the rep filter when the scope changes (the rep may no longer be in range)
  useEffect(function() { setFUser(""); }, [viewScope, deckId]);

  // ── Owner name lookup: API userName → orgUsers by id → "Unknown" ────────────
  var userMap = {};
  (orgUsers || []).forEach(function(u) { userMap[u.id] = u; });
  function ownerName(s) {
    if (s.userName) return s.userName;
    var u = userMap[s.userId];
    if (u) return u.displayName || u.email || "Unknown";
    if (authUser && s.userId === authUser.id) return authUser.displayName || "You";
    return "Unknown";
  }
  function ownerRole(s) {
    var u = userMap[s.userId];
    return u ? u.role : null;
  }

  function markFbSeen(sessionId) {
    var now = Date.now();
    setFbSeenTs(function(prev) {
      var next = Object.assign({}, prev, {[sessionId]: now});
      try { localStorage.setItem("rc_fb_seen", JSON.stringify(next)); } catch(e) {}
      return next;
    });
  }

  function deleteSession(id) {
    apiDel("/sessions/" + id).then(function() {
      setSessions(function(prev) { return prev ? prev.filter(function(s){ return s.id !== id; }) : prev; });
      deleteAudioBlob(id).catch(function() {});
      if (selectedId === id) setSelectedId(null);
      setConfirmDel(null);
    }).catch(function(e){ console.error("overcard:", e); setConfirmDel(null); });
  }

  function resetFilters() {
    setSearch(""); setFType("all"); setFFrom(""); setFTo(""); setSortBy("date"); setFUser("");
  }

  function getFiltered() {
    if (!sessions) return [];
    var q = search.toLowerCase();
    var list = sessions.filter(function(s) {
      if (fType !== "all" && (s.mode||"live") !== fType) return false;
      if (fUser && s.userId !== fUser) return false;
      if (q && !(s.name || "").toLowerCase().includes(q) && !ownerName(s).toLowerCase().includes(q)) return false;
      if (fFrom) { var d = new Date(fFrom); d.setHours(0,0,0,0); if (s.startTs < d.getTime()) return false; }
      if (fTo)   { var d2 = new Date(fTo); d2.setHours(23,59,59,999); if (s.startTs > d2.getTime()) return false; }
      return true;
    });
    if (sortBy === "duration") {
      list = list.slice().sort(function(a,b){ return (sessionDurSec(b)||0) - (sessionDurSec(a)||0); });
    } else if (sortBy === "outcome") {
      list = list.slice().sort(function(a,b){ return outcomePriority(a) - outcomePriority(b); });
    } else if (sortBy === "rep") {
      list = list.slice().sort(function(a,b){ return ownerName(a).localeCompare(ownerName(b)) || (b.startTs - a.startTs); });
    }
    return list;
  }

  var filtered = getFiltered();
  var selectedSession = sessions ? sessions.find(function(s){ return s.id === selectedId; }) : null;
  var filtersActive = !!(search || fType !== "all" || fFrom || fTo || sortBy !== "date" || fUser);
  var stats = sessions !== null && filtered.length > 0 ? computeFilteredStats(filtered) : null;
  var scopeLabel = !isAdminScope ? "My sessions"
                 : viewScope === "org" ? "All org sessions"
                 : (((orgTeams||[]).find(function(t){ return t.id === viewScope; }) || {}).name || "Team") + " sessions";

  // ── Per-rep aggregation (overview panel + rep filter chip) ───────────────────
  var repRows = [];
  if (sessions) {
    var reps = {};
    filtered.forEach(function(s) {
      var k = s.userId || "__unknown";
      if (!reps[k]) reps[k] = { id:s.userId, name:ownerName(s), role:ownerRole(s), total:0, live:0, sold:0, booked:0, durSum:0, durN:0, last:0 };
      var r = reps[k];
      r.total++;
      if ((s.mode||"live") === "live") { r.live++; if (s.sold || s.outcome === "sold") r.sold++; if (s.outcome === "booked") r.booked++; }
      var d = sessionDurSec(s); if (d) { r.durSum += d; r.durN++; }
      if (s.startTs > r.last) r.last = s.startTs;
    });
    repRows = Object.keys(reps).map(function(k){ return reps[k]; }).sort(function(a,b){ return b.total - a.total; });
  }
  var fUserName = fUser ? ((userMap[fUser] && (userMap[fUser].displayName || userMap[fUser].email)) || (repRows.find(function(r){ return r.id === fUser; }) || {}).name || "Rep") : "";

  // ── Outcome distribution ─────────────────────────────────────────────────────
  var outcomeRows = [];
  if (stats) {
    var oc = {};
    filtered.forEach(function(s) { var m = outcomeMeta(s); if (!oc[m.label]) oc[m.label] = { m:m, n:0 }; oc[m.label].n++; });
    outcomeRows = Object.keys(oc).map(function(k){ return oc[k]; }).sort(function(a,b){ return b.n - a.n; });
  }
  // Top closing cards
  var closeRows = [];
  if (stats) {
    var cc = {};
    filtered.forEach(function(s) {
      if (!(s.sold || s.outcome === "sold") || !s.soldCardTitle) return;
      cc[s.soldCardTitle] = (cc[s.soldCardTitle] || 0) + 1;
    });
    closeRows = Object.keys(cc).map(function(k){ return { title:k, n:cc[k] }; }).sort(function(a,b){ return b.n - a.n; }).slice(0, 5);
  }

  // Objection stacks raised (visits to objection cards, counted once per session)
  var objRows = [];
  if (stats) {
    var ob = {};
    filtered.forEach(function(s) {
      var seen = {};
      sessionVisits(s).forEach(function(v) {
        if (!v.isObjCard) return;
        var k = v.stackLabel || "Objection";
        if (seen[k]) return; seen[k] = true;
        ob[k] = (ob[k] || 0) + 1;
      });
    });
    objRows = Object.keys(ob).map(function(k){ return { label:k, n:ob[k] }; }).sort(function(a,b){ return b.n - a.n; }).slice(0, 5);
  }
  // Weekly activity — last 12 weeks ending at the newest session in view
  var weeks = [];
  if (stats) {
    var WEEK = 7 * 24 * 3600 * 1000;
    var newest = filtered.reduce(function(m, s){ return Math.max(m, s.startTs || 0); }, 0);
    var end = new Date(newest); end.setHours(23,59,59,999);
    var endTs = end.getTime();
    for (var w = 11; w >= 0; w--) weeks.push({ start:endTs - (w + 1) * WEEK + 1, live:0, practice:0 });
    filtered.forEach(function(s) {
      var idx = 11 - Math.floor((endTs - s.startTs) / WEEK);
      if (idx < 0 || idx > 11) return;
      if ((s.mode||"live") === "practice") weeks[idx].practice++; else weeks[idx].live++;
    });
  }

  // ─── RENDER: session row ──────────────────────────────────────────────────────
  function renderRow(s) {
    var sel = s.id === selectedId;
    var hov = hoverId === s.id;
    var v = sessionVisits(s);
    var n = sessionNotes(s);
    var d = sessionDurSec(s);
    var objV = v.filter(function(x){ return x.isObjCard; }).length;
    var intV = v.filter(function(x){ return x.intendedPath; });
    var intPct = v.length ? Math.round(intV.length/v.length*100) : null;
    var hasFb = s.feedbackCount > 0;
    var fbUnseen = hasFb && (!fbSeenTs[s.id] || fbSeenTs[s.id] < s.latestFeedbackAt);
    var name = ownerName(s);
    var isMe = !!(authUser && s.userId === authUser.id);
    var isOwner = isMe && !s._shared;
    var st = STYPE[s.mode||"live"] || STYPE.live;
    var confirming = confirmDel === s.id;
    return (
      <div key={s.id}
        data-sess-row="1"
        role="button" tabIndex={0}
        onMouseEnter={touch ? undefined : function(){ setHoverId(s.id); }}
        onMouseLeave={touch ? undefined : function(){ setHoverId(function(p){ return p === s.id ? null : p; }); }}
        onClick={function(){ setSelectedId(s.id); markFbSeen(s.id); setConfirmDel(null); }}
        onKeyDown={function(e){ if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedId(s.id); markFbSeen(s.id); } }}
        style={{
          position:"relative",
          background:sel?"rgba(255,213,79,.08)":hov?"rgba(255,255,255,.055)":"rgba(255,255,255,.03)",
          borderTop:"1px solid "+(sel?ACCENT+"55":LINE),
          borderRight:"1px solid "+(sel?ACCENT+"55":LINE),
          borderBottom:"1px solid "+(sel?ACCENT+"55":LINE),
          borderLeft:"4px solid "+(sel?ACCENT:st.color+"88"),
          borderRadius:12, padding:compact?"10px 12px":"12px 14px 12px 14px", marginBottom:8,
          cursor:"pointer", outline:"none", transition:"background .12s"
        }}>
        {/* Row 1: session name + outcome */}
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
          <span style={{fontSize:compact?14:15,fontWeight:700,color:TXT,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1,minWidth:0}}>{s.name || "Untitled session"}</span>
          {fbUnseen && <span title="New feedback" style={{width:9,height:9,borderRadius:"50%",background:"#EF5350",boxShadow:"0 0 0 3px rgba(239,83,80,.25)",flexShrink:0}}/>}
          <OutcomeBadge session={s}/>
        </div>
        {/* Row 2: WHO ran it */}
        <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:8,minWidth:0}}>
          <Avatar name={name} colorKey={s.userId || name} size={26}/>
          <span style={{fontSize:compact?13:14,fontWeight:600,color:TXT2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",minWidth:0}}>{name}</span>
          {isMe && <span style={{fontSize:11,fontWeight:700,color:ACCENT,background:"rgba(255,213,79,.1)",border:"1px solid rgba(255,213,79,.25)",borderRadius:99,padding:"1px 7px",flexShrink:0}}>You</span>}
          {s._shared && (
            <span style={{fontSize:12,color:"rgba(0,180,255,.9)",background:"rgba(0,180,255,.08)",border:"1px solid rgba(0,180,255,.22)",borderRadius:99,padding:"2px 8px",flexShrink:0,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:170}}>
              Shared{s._shareFromName ? " by " + s._shareFromName : ""}
            </span>
          )}
        </div>
        {/* Row 3: when + metrics */}
        <div style={{display:"flex",alignItems:"center",columnGap:compact?12:14,rowGap:4,fontSize:compact?12:13,color:TXT3,flexWrap:"wrap"}}>
          <span style={{color:TXT2,whiteSpace:"nowrap"}}>{fmtDate(s.startTs)} · {fmtTime(s.startTs)}</span>
          {d !== null && <span>⏱ {fmtSec(d)}</span>}
          <span>{v.length} card{v.length!==1?"s":""}</span>
          {intPct !== null && <span style={{color:"rgba(255,213,79,.8)"}}>{intPct}% on path</span>}
          {objV > 0 && <span style={{color:OBJ_COLOR}}>{objV} obj</span>}
          {n.length > 0 && <span>{n.length} note{n.length!==1?"s":""}</span>}
          {hasFb && <span style={{color:fbUnseen?"#A8FF3E":TXT3,fontWeight:fbUnseen?700:400}}>{s.feedbackCount} feedback</span>}
          {(s.shareCount||0) > 0 && !s._shared && <span style={{color:"rgba(0,180,255,.8)"}}>shared ×{s.shareCount}</span>}
          {isOwner && (touch || sel || hov || confirming) && (
            <span style={{marginLeft:"auto",display:"flex",gap:6}}>
              {confirming ? (
                <>
                  <button onClick={function(e){ e.stopPropagation(); deleteSession(s.id); }}
                    style={{background:"rgba(239,83,80,.18)",border:"1px solid rgba(239,83,80,.5)",color:"#EF5350",borderRadius:8,fontSize:12,fontWeight:700,padding:"3px 10px",minHeight:touch?44:undefined,cursor:"pointer",fontFamily:"inherit"}}>Delete</button>
                  <button onClick={function(e){ e.stopPropagation(); setConfirmDel(null); }}
                    style={{background:"transparent",border:"1px solid rgba(255,255,255,.15)",color:TXT3,borderRadius:8,fontSize:12,padding:"3px 10px",minHeight:touch?44:undefined,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
                </>
              ) : (
                <button title="Delete session" onClick={function(e){ e.stopPropagation(); setConfirmDel(s.id); }}
                  style={{background:"transparent",border:"1px solid rgba(239,83,80,.25)",color:"rgba(239,83,80,.75)",borderRadius:8,fontSize:12,padding:"3px 10px",minHeight:touch?44:undefined,cursor:"pointer",fontFamily:"inherit"}}>Delete</button>
              )}
            </span>
          )}
        </div>
      </div>
    );
  }

  // ─── RENDER: overview (no session selected) ───────────────────────────────────
  function renderOverview() {
    if (sessions === null) {
      return <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:TXT3,fontSize:15}}>Loading sessions…</div>;
    }
    if (!stats) {
      return (
        <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10,color:TXT3,padding:24,textAlign:"center"}}>
          <div style={{fontSize:20,fontWeight:700,color:TXT2}}>{filtersActive ? "No sessions match these filters" : "No sessions yet for " + (deckName || "this deck")}</div>
          <div style={{fontSize:15,maxWidth:460,lineHeight:1.6}}>
            {filtersActive ? "Try widening the date range or clearing filters." : isAdmin && !isAdminScope ? "Switch the scope to All Org Sessions to review your team's runs, or start a session from Play." : "Run the deck from the Play tab — completed sessions appear here for review."}
          </div>
          {filtersActive && <button onClick={resetFilters} style={Object.assign(pillBtn(true), {marginTop:6,fontSize:14,padding:"7px 16px"})}>Clear filters</button>}
          {isAdmin && !isAdminScope && !filtersActive && <button onClick={function(){ setViewScope("org"); }} style={Object.assign(pillBtn(true), {marginTop:6,fontSize:14,padding:"7px 16px"})}>View all org sessions</button>}
        </div>
      );
    }
    var kpis = [
      { v:stats.total,                                            l:"Sessions", sub:stats.liveCount + " live · " + stats.practiceCount + " practice", c:TXT },
      { v:stats.soldCount,                                        l:"Sold",       c:"#66BB6A" },
      { v:stats.winRate !== null ? stats.winRate + "%" : "—",     l:"Close rate", c:"#66BB6A" },
      { v:stats.avgSec !== null ? fmtSec(stats.avgSec) : "—",     l:"Avg time",   c:ACCENT },
    ];
    var maxOutcome = outcomeRows.reduce(function(m, r){ return Math.max(m, r.n); }, 1);
    var showReps = repRows.length > 1 || isAdminScope;
    return (
      <div style={{flex:1,overflowY:"auto",padding:compact?"16px 16px 20px":"22px 26px 28px"}}>
        <div style={{display:"flex",alignItems:"baseline",gap:12,marginBottom:4,flexWrap:"wrap"}}>
          <div style={{fontSize:compact?19:22,fontWeight:700,color:TXT,fontFamily:"'Lora',serif"}}>{deckName || "Sessions"}</div>
          <div style={{fontSize:14,color:TXT3}}>{scopeLabel}{fUser ? " · " + fUserName : ""}{filtersActive && !fUser ? " · filtered" : ""}</div>
        </div>
        <div style={{fontSize:compact?13:14,color:TXT3,marginBottom:compact?14:18}}>{stacked ? "Go back to the list and pick a session to review its path, notes and feedback." : "Select a session on the left to review its path, notes and feedback."}</div>

        {/* KPI strip */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4, minmax(0, 1fr))",gap:12,marginBottom:16}}>
          {kpis.map(function(k) {
            return (
              <div key={k.l} style={panelSt({padding:"14px 16px"})}>
                <div style={{fontSize:compact?22:26,fontWeight:800,color:k.c,lineHeight:1.1}}>{k.v}</div>
                <div style={{fontSize:13,color:TXT3,marginTop:6,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{k.l}</div>
                {k.sub && <div style={{fontSize:12,color:"rgba(255,255,255,.4)",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{k.sub}</div>}
              </div>
            );
          })}
        </div>

        <div style={{display:"grid",gridTemplateColumns:"minmax(0, 1fr)",gap:16,alignItems:"start"}}>
          {/* Outcome mix (left) + closing cards / objections stacked (right) */}
          <div style={{gridColumn:"1 / -1",display:"flex",flexWrap:"wrap",gap:16,alignItems:"stretch"}}>
          <div style={panelSt({flex:"1 1 300px"})}>
            <PanelTitle>Outcome mix</PanelTitle>
            {outcomeRows.map(function(r) {
              var pct = Math.round(r.n / stats.total * 100);
              return (
                <div key={r.m.label} style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
                  <span style={{fontSize:14,color:r.m.color,fontWeight:600,width:100,flexShrink:0}}>{r.m.label}</span>
                  <div style={{flex:1,height:8,background:"rgba(255,255,255,.06)",borderRadius:99,overflow:"hidden"}}>
                    <div style={{width:Math.round(r.n / maxOutcome * 100) + "%",height:"100%",background:r.m.color,borderRadius:99,opacity:.85}}/>
                  </div>
                  <span style={{fontSize:14,color:TXT2,fontWeight:700,width:34,textAlign:"right"}}>{r.n}</span>
                  <span style={{fontSize:13,color:TXT3,width:40,textAlign:"right"}}>{pct}%</span>
                </div>
              );
            })}
          </div>

          <div style={{flex:"1 1 300px",display:"flex",flexDirection:"column",gap:16,minWidth:0}}>
          {/* Top closing cards */}
          <div style={panelSt()}>
            <PanelTitle>Where deals close</PanelTitle>
            {closeRows.length === 0 && <div style={{fontSize:14,color:TXT3}}>No sold sessions in this view yet.</div>}
            {closeRows.map(function(r, i) {
              return (
                <div key={r.title} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderTop:i?"1px solid "+LINE:"none"}}>
                  <span style={{fontSize:13,color:TXT3,width:18}}>{i+1}</span>
                  <span style={{fontSize:14,color:TXT2,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.title}</span>
                  <span style={{fontSize:14,fontWeight:700,color:"#66BB6A"}}>{r.n}</span>
                </div>
              );
            })}
          </div>

          {/* Objections raised */}
          <div style={panelSt()}>
            <PanelTitle>Objections raised</PanelTitle>
            {objRows.length === 0 && <div style={{fontSize:14,color:TXT3}}>No objection stacks opened in this view.</div>}
            {objRows.map(function(r, i) {
              var pct = Math.round(r.n / stats.total * 100);
              return (
                <div key={r.label} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderTop:i?"1px solid "+LINE:"none"}}>
                  <span style={{fontSize:14,color:TXT2,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.label}</span>
                  <span style={{fontSize:13,color:TXT3}}>{pct}% of sessions</span>
                  <span style={{fontSize:14,fontWeight:700,color:OBJ_COLOR,width:28,textAlign:"right"}}>{r.n}</span>
                </div>
              );
            })}
          </div>

          </div>
          </div>

          {/* Weekly activity */}
          <div style={panelSt({gridColumn:"1 / -1"})}>
            <PanelTitle right={
              <span style={{display:"flex",gap:14,fontSize:13,color:TXT3}}>
                <span style={{display:"inline-flex",alignItems:"center",gap:6}}><span style={{width:10,height:10,borderRadius:3,background:STYPE.live.color}}/>Live</span>
                <span style={{display:"inline-flex",alignItems:"center",gap:6}}><span style={{width:10,height:10,borderRadius:3,background:STYPE.practice.color}}/>Practice</span>
              </span>
            }>Activity · last 12 weeks</PanelTitle>
            {(function() {
              var maxW = weeks.reduce(function(m, w){ return Math.max(m, w.live + w.practice); }, 1);
              return (
                <div style={{display:"grid",gridTemplateColumns:"repeat(12, minmax(0, 1fr))",gap:8,alignItems:"end"}}>
                  {weeks.map(function(w, i) {
                    var tot = w.live + w.practice;
                    return (
                      <div key={i} title={tot + " session" + (tot!==1?"s":"") + " · week of " + fmtDate(w.start)} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6,minWidth:0}}>
                        <span style={{fontSize:12,color:tot?TXT2:"rgba(255,255,255,.25)",fontWeight:600}}>{tot}</span>
                        <div style={{width:"100%",maxWidth:44,height:90,display:"flex",flexDirection:"column",justifyContent:"flex-end",background:"rgba(255,255,255,.03)",borderRadius:6,overflow:"hidden"}}>
                          <div style={{height:Math.round(w.practice / maxW * 90),background:STYPE.practice.color,opacity:.85}}/>
                          <div style={{height:Math.round(w.live / maxW * 90),background:STYPE.live.color,opacity:.85}}/>
                        </div>
                        <span style={{fontSize:12,color:TXT3,whiteSpace:"nowrap"}}>{new Date(w.start).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          {/* By rep */}
          {showReps && (
            <div style={panelSt({gridColumn:"1 / -1"})}>
              <PanelTitle right={fUser ? <button onClick={function(){ setFUser(""); }} style={pillBtn(true)}>Show all reps ×</button> : <span style={{fontSize:13,color:TXT3}}>Click a rep to filter the list</span>}>By rep</PanelTitle>
              <div style={{display:"grid",gridTemplateColumns:"minmax(180px,2fr) repeat(5, minmax(70px,1fr))",fontSize:13,color:TXT3,padding:"0 10px 8px",borderBottom:"1px solid "+LINE,gap:8}}>
                <span>Rep</span><span style={{textAlign:"right"}}>Sessions</span><span style={{textAlign:"right"}}>Live</span><span style={{textAlign:"right"}}>Sold</span><span style={{textAlign:"right"}}>Close rate</span><span style={{textAlign:"right"}}>Last run</span>
              </div>
              {repRows.map(function(r) {
                var on = fUser && fUser === r.id;
                var rm = r.role ? roleMeta(r.role) : null;
                var rate = r.live ? Math.round(r.sold / r.live * 100) + "%" : "—";
                return (
                  <button key={r.id || r.name} onClick={function(){ if (r.id) { setFUser(on ? "" : r.id); if (stacked && !on) setShowOverview(false); } }}
                    style={{display:"grid",gridTemplateColumns:"minmax(180px,2fr) repeat(5, minmax(70px,1fr))",gap:8,alignItems:"center",width:"100%",textAlign:"left",background:on?"rgba(255,213,79,.08)":"transparent",border:"none",borderBottom:"1px solid "+LINE,padding:"10px 10px",cursor:r.id?"pointer":"default",fontFamily:"inherit",color:TXT2,fontSize:14}}>
                    <span style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
                      <Avatar name={r.name} colorKey={r.id || r.name} size={28}/>
                      <span style={{fontWeight:600,color:TXT,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.name}</span>
                      {rm && r.role !== "user" && <span style={{fontSize:11,fontWeight:700,color:rm.color,background:rm.bg,border:"1px solid "+rm.border,borderRadius:99,padding:"1px 7px",flexShrink:0}}>{rm.label}</span>}
                    </span>
                    <span style={{textAlign:"right",fontWeight:700,color:TXT}}>{r.total}</span>
                    <span style={{textAlign:"right"}}>{r.live}</span>
                    <span style={{textAlign:"right",color:"#66BB6A"}}>{r.sold}</span>
                    <span style={{textAlign:"right"}}>{rate}</span>
                    <span style={{textAlign:"right",fontSize:13,color:TXT3}}>{r.last ? fmtDate(r.last) : "—"}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Stacked (tablet portrait): show exactly one pane at a time
  var showList   = !stacked || (!selectedSession && !showOverview);
  var showDetail = !stacked || !!selectedSession || showOverview;
  var listW      = stacked ? "100%" : compact ? "clamp(320px, 34%, 380px)" : "clamp(360px, 32%, 440px)";
  var ctlH       = compact ? 44 : undefined; // touch-size filter controls on tablet
  var pill       = function(on, color) { return compact ? Object.assign(pillBtn(on, color), { minHeight:40, padding:"5px 14px" }) : pillBtn(on, color); };

  return (
    <div style={{display:"flex",height:"100%",overflow:"hidden"}}>

      {/* ── Left pane: filters + session list ── */}
      {showList && (
      <div style={{width:listW,flexShrink:0,display:"flex",flexDirection:"column",borderRight:stacked?"none":"1px solid "+LINE,overflow:"hidden",background:"rgba(4,12,32,.35)"}}>

        {/* Filter bar */}
        <div style={{padding:"14px 16px 12px",borderBottom:"1px solid "+LINE,flexShrink:0,display:"flex",flexDirection:"column",gap:10}}>

          {/* Scope selector (admins) + count */}
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            {isAdmin ? (
              <select
                aria-label="Session scope"
                value={viewScope||"self"}
                onChange={function(e){ setViewScope(e.target.value); setSelectedId(null); }}
                style={Object.assign({},inputSt({padding:"8px 12px",fontSize:14,borderRadius:10}),{flex:1,width:"auto",cursor:"pointer",minHeight:ctlH})}>
                <option value="self">My Sessions</option>
                <option value="org">All Org Sessions</option>
                {(orgTeams||[]).map(function(t){ return <option key={t.id} value={t.id}>{t.name}</option>; })}
              </select>
            ) : (
              <div style={{flex:1,fontSize:16,fontWeight:700,color:TXT}}>My Sessions</div>
            )}
            <span style={{fontSize:13,color:TXT3,whiteSpace:"nowrap"}}>
              {sessions === null ? "…" : filtered.length + (filtered.length !== sessions.length ? " of " + sessions.length : "") + " session" + (sessions.length !== 1 ? "s" : "")}
            </span>
            {stacked && sessions !== null && (
              <button onClick={function(){ setShowOverview(true); }}
                aria-label="Show sessions overview"
                style={Object.assign(pill(false, ACCENT), {minHeight:44, color:ACCENT, borderColor:"rgba(255,213,79,.35)", fontWeight:700})}>
                📊 Overview
              </button>
            )}
          </div>

          {/* Search */}
          <input
            value={search}
            onChange={function(e){ setSearch(e.target.value); }}
            placeholder="Search by session or rep name…"
            aria-label="Search sessions"
            style={inputSt({height:compact?44:38,fontSize:14,padding:"0 14px",borderRadius:10})}/>

          {/* Mode filter */}
          <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
            {[["all","All"],["live","Live"],["practice","Practice"]].map(function(pair) {
              var ft = pair[0];
              return <button key={ft} onClick={function(){ setFType(ft); }} style={pill(fType === ft, ft === "all" ? ACCENT : STYPE[ft].color)}>{pair[1]}</button>;
            })}
            <span style={{flex:1}}/>
            <label style={{fontSize:13,color:TXT3,display:"flex",alignItems:"center",gap:6}}>
              Sort
              <select value={sortBy} onChange={function(e){ setSortBy(e.target.value); }}
                aria-label="Sort sessions"
                style={{background:"rgba(8,25,60,.5)",border:"1px solid rgba(255,255,255,.12)",borderRadius:8,color:TXT,fontSize:13,padding:"5px 8px",minHeight:compact?40:undefined,fontFamily:"inherit",cursor:"pointer",outline:"none"}}>
                <option value="date">Newest</option>
                <option value="duration">Longest</option>
                <option value="outcome">Outcome</option>
                <option value="rep">Rep name</option>
              </select>
            </label>
          </div>

          {/* Date range + reset */}
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <div style={{flex:1,minWidth:0}}>
              <DarkDatePicker value={fFrom} onChange={function(e){ setFFrom(e.target.value); }} style={{fontSize:13,padding:compact?"11px 10px":"7px 10px"}}/>
            </div>
            <span style={{fontSize:13,color:TXT3}}>to</span>
            <div style={{flex:1,minWidth:0}}>
              <DarkDatePicker value={fTo} onChange={function(e){ setFTo(e.target.value); }} style={{fontSize:13,padding:compact?"11px 10px":"7px 10px"}}/>
            </div>
          </div>

          {(fUser || filtersActive) && (
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              {fUser && (
                <button onClick={function(){ setFUser(""); }} style={Object.assign(pillBtn(true), {display:"inline-flex",alignItems:"center",gap:6})}>
                  Rep: {fUserName} <span aria-hidden="true">×</span>
                </button>
              )}
              <span style={{flex:1}}/>
              {filtersActive && (
                <button onClick={resetFilters}
                  style={{background:"none",border:"none",cursor:"pointer",color:TXT3,fontSize:13,fontFamily:"inherit",padding:"2px 4px",minHeight:ctlH,textDecoration:"underline"}}>
                  Reset filters
                </button>
              )}
            </div>
          )}
        </div>

        {/* Stat strip — live summary of filtered results (the overview pane
            shows the same KPIs when nothing is selected, so only show it here
            while a session review occupies the right pane) */}
        {stats && selectedSession && (
          <div style={{display:"flex",flexShrink:0,borderBottom:"1px solid "+LINE,background:"rgba(0,0,0,.18)"}}>
            {[
              {v:stats.total, l:"Sessions", c:TXT},
              {v:stats.winRate !== null ? stats.winRate+"%" : "—", l:"Close rate", c:"#66BB6A"},
              {v:stats.avgSec !== null ? fmtSec(stats.avgSec) : "—", l:"Avg time", c:ACCENT},
              {v:stats.soldCount, l:"Sold", c:"#A8FF3E"},
            ].map(function(st, i) {
              return (
                <div key={i} style={{flex:1,padding:"10px 0 9px",textAlign:"center",borderRight:i<3?"1px solid "+LINE:"none"}}>
                  <div style={{fontSize:17,fontWeight:800,color:st.c,lineHeight:1.1}}>{st.v}</div>
                  <div style={{fontSize:12,color:TXT3,marginTop:3}}>{st.l}</div>
                </div>
              );
            })}
          </div>
        )}

        {/* Session list */}
        <div style={{flex:1,overflowY:"auto",padding:"12px 12px 16px"}}>
          {sessions === null && (
            <div style={{textAlign:"center",padding:"32px 0",color:TXT3,fontSize:15}}>Loading…</div>
          )}
          {sessions !== null && filtered.length === 0 && (
            <div style={{textAlign:"center",padding:"32px 12px",color:TXT3,fontSize:15,lineHeight:1.6}}>
              {filtersActive ? "No sessions match" : "No sessions yet"}
            </div>
          )}
          {filtered.map(renderRow)}
        </div>
      </div>
      )}

      {/* ── Right pane: session review or overview ── */}
      {showDetail && (
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0}}>
        {stacked && !selectedSession && showOverview && (
          <div style={{flexShrink:0,display:"flex",alignItems:"center",gap:10,padding:"6px 12px",borderBottom:"1px solid "+LINE}}>
            <button onClick={function(){ setShowOverview(false); }} aria-label="Back to session list"
              style={{minHeight:44,minWidth:44,display:"flex",alignItems:"center",gap:8,background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",borderRadius:10,padding:"0 14px",color:TXT2,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
              <span aria-hidden="true">←</span> Sessions
            </button>
          </div>
        )}
        {selectedSession ? (
          <SessionReview
            key={selectedSession.id}
            session={selectedSession}
            onBack={function(){ setSelectedId(null); }}
            authUser={authUser}
            orgUsers={orgUsers}
            orgTeams={orgTeams}
            onMarkFeedbackSeen={markFbSeen}
          />
        ) : renderOverview()}
      </div>
      )}
    </div>
  );
}
