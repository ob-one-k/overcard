import { useState, useEffect, useContext } from "react";
import { cachedGet, peek, useCacheVersion } from "../../lib/dataCache";
import DesktopCtx from "../../lib/DesktopCtx";
import { STYPE, OBJ_COLOR, isAdminRole, roleMeta, SESS_COLOR } from "../../lib/constants";
import { apiDel } from "../../lib/api";
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

// ─── WEEKLY ACTIVITY PIE ──────────────────────────────────────────────────────
// Live and Practice each get their own non-overlapping slices.
var LIVE_SLICES = [
  { key:"sold",      label:"Sold",       color:"#66BB6A", of:function(w){ return w.sold; } },
  { key:"booked",    label:"Booked",     color:"#FFD54F", of:function(w){ return w.booked; } },
  { key:"noContact", label:"No contact", color:"#EF5350", of:function(w){ return w.noContact; } },
  { key:"other",     label:"Other",      color:"rgba(255,255,255,.55)", of:function(w){ return Math.max(0, w.total - w.sold - w.booked - w.noContact); } },
];
var PRACTICE_SLICES = [
  { key:"reached", label:"Reached close", color:"#66BB6A", of:function(w){ return w.reached; } },
  { key:"earlier", label:"Ended earlier", color:"#00B4FF", of:function(w){ return Math.max(0, w.total - w.reached); } },
];
// By-rep columns per mode: [key, label, "%"?, colour]
var REP_COLS = {
  live:     [["name","Rep"],["total","Calls"],["sold","Sold",null,"#66BB6A"],["booked","Booked",null,"#FFD54F"],["rate","Close rate","%"],["last","Last call"]],
  practice: [["name","Rep"],["total","Runs"],["reach","Reached close","%","#66BB6A"],["onPath","On path","%"],["avgSec","Avg run"],["last","Last run"]],
};
function WeekPie({ week, slices, size, hover }) {
  var total = week.total;
  var r = 15.9155;                       // circumference = 100 → dash lengths are percentages
  var offset = 25;                       // start at 12 o'clock
  return (
    <svg width={size} height={size} viewBox="0 0 42 42" role="img"
      aria-label={total + " sessions: " + slices.map(function(sl){ return sl.of(week) + " " + sl.label.toLowerCase(); }).join(", ")}
      style={{display:"block",transform:hover ? "scale(1.08)" : "none",transition:"transform .15s"}}>
      <circle cx="21" cy="21" r={r} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="6"/>
      {total > 0 && slices.map(function(sl) {
        var pct = sl.of(week) / total * 100;
        if (!pct) return null;
        var el = <circle key={sl.key} cx="21" cy="21" r={r} fill="none" stroke={sl.color} strokeWidth="6"
          strokeDasharray={pct + " " + (100 - pct)} strokeDashoffset={offset}/>;
        offset -= pct;
        return el;
      })}
      <text x="21" y="21" textAnchor="middle" dominantBaseline="central" fill={total ? "#fff" : "rgba(255,255,255,.3)"} fontSize="10" fontWeight="700" fontFamily="inherit">{total}</text>
    </svg>
  );
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
  var [repSort,  setRepSort]  = useState({ key:"total", dir:"desc" });   // By-rep table ordering
  var [repGroup, setRepGroup] = useState(false);                         // group By-rep rows by team
  var [hoverWeek, setHoverWeek] = useState(null);                        // activity chart tooltip
  var [ovMode,   setOvMode]   = useState("live");   // overview sub-tab: live | practice (metrics never mix)
  var [fSource,  setFSource]  = useState("all");    // my scope: all | mine | shared (sessions shared with me)
  var [groupRep, setGroupRep] = useState(false);    // team/org scopes: group the list by rep
  var [openGroups, setOpenGroups] = useState({});   // rep id -> expanded

  // Tablet (compact): smaller type, 44px targets, no hover-only controls.
  // When the window is too narrow for two panes (portrait), list and detail
  // stack: picking a session replaces the list; the review's ← returns to it.
  var desktop = useContext(DesktopCtx);
  var compact = !!desktop.compact;
  var touch   = !!desktop.isTouchPrimary;
  var stacked = compact && !desktop.splitPanes;

  var isAdmin      = !!(authUser && isAdminRole(authUser.role));
  var isAdminScope = !!(isAdmin && viewScope && viewScope !== "self");
  // Scope values are shared with the mobile layout ("org" | "team:<id>" | "user:<id>").
  // Older desktop builds stored a bare team id — normalise it so the API gets a valid scope.
  var scopeVal = !viewScope || viewScope === "self" || viewScope === "org" || /^(team|user):/.test(viewScope) ? (viewScope || "self") : "team:" + viewScope;
  var scopeIsPerson = /^user:/.test(scopeVal);

  useEffect(function() {
    if (onInitialReview) setSelectedId(onInitialReview);
  }, [onInitialReview]);

  var sv = useCacheVersion("/sessions");
  function buildUrl() {
    var url = "/sessions?deckId=" + deckId;
    if (isAdminScope) url += "&scope=" + encodeURIComponent(scopeVal);
    return url;
  }

  useEffect(function() {
    var cancelled = false;
    var url = buildUrl();
    function sorted(data) { return (Array.isArray(data) ? data : []).slice().sort(function(a,b){ return b.startTs - a.startTs; }); }
    var cached = peek(url);
    setSessions(cached !== undefined ? sorted(cached) : null);
    cachedGet(url)
      .then(function(data) { if (!cancelled) setSessions(sorted(data)); })
      .catch(function() { if (!cancelled) setSessions([]); });
    return function() { cancelled = true; };
  }, [deckId, viewScope, sv]);

  // Picking Live/Practice in the list filter moves the overview to the same sub-tab
  useEffect(function() { if (fType === "live" || fType === "practice") setOvMode(fType); }, [fType]);

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
    setSearch(""); setFType("all"); setFFrom(""); setFTo(""); setSortBy("date"); setFUser(""); setFSource("all");
  }

  function getFiltered() {
    if (!sessions) return [];
    var q = search.toLowerCase();
    var list = sessions.filter(function(s) {
      if (fType !== "all" && (s.mode||"live") !== fType) return false;
      if (!isAdminScope && fSource === "mine" && s._shared) return false;
      if (!isAdminScope && fSource === "shared" && !s._shared) return false;
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
  var filtersActive = !!(search || fType !== "all" || fFrom || fTo || sortBy !== "date" || fUser || fSource !== "all");
  var sharedCount = sessions ? sessions.filter(function(x){ return x._shared; }).length : 0;
  var stats = sessions !== null && filtered.length > 0 ? computeFilteredStats(filtered) : null;
  var scopeLabel = !isAdminScope ? "My sessions"
                 : scopeVal === "org" ? "All org sessions"
                 : scopeIsPerson ? ((userMap[scopeVal.slice(5)] || {}).displayName || "Rep") + "'s sessions"
                 : (((orgTeams||[]).find(function(t){ return "team:" + t.id === scopeVal; }) || {}).name || "Team") + " sessions";
  var canGroup = isAdminScope && !scopeIsPerson;

  // ── Overview aggregation — one mode at a time (Live and Practice never mix) ──────
  var ovList = filtered.filter(function(x){ return (x.mode || "live") === ovMode; });
  var isLiveOv = ovMode === "live";
  function reachedClose(x) { return sessionVisits(x).some(function(v){ return v.cardType === "close" && !v.isObjCard; }); }
  function lastMainCard(x) { var v = sessionVisits(x).filter(function(e){ return !e.isObjCard; }); return v.length ? v[v.length - 1] : null; }
  function onPathPct(list) {
    var all = 0, on = 0;
    list.forEach(function(x){ sessionVisits(x).forEach(function(v){ if (v.isObjCard) return; all++; if (v.intendedPath) on++; }); });
    return all ? Math.round(on / all * 100) : null;
  }
  function avgSecOf(list) {
    var d = list.map(sessionDurSec).filter(Boolean);
    return d.length ? Math.round(d.reduce(function(t, x){ return t + x; }, 0) / d.length) : null;
  }

  // Per-rep rows (overview table + rep filter chip)
  var repRows = [];
  if (sessions) {
    var reps = {};
    ovList.forEach(function(x) {
      var k = x.userId || "__unknown";
      if (!reps[k]) reps[k] = { id:x.userId, name:ownerName(x), role:ownerRole(x), list:[] };
      reps[k].list.push(x);
    });
    repRows = Object.keys(reps).map(function(k) {
      var r = reps[k], l = r.list;
      var sold = l.filter(function(x){ return x.sold || x.outcome === "sold"; }).length;
      var booked = l.filter(function(x){ return x.outcome === "booked"; }).length;
      var closeN = l.filter(reachedClose).length;
      return { id:r.id, name:r.name, role:r.role, total:l.length, sold:sold, booked:booked,
        rate: l.length ? Math.round(sold / l.length * 100) : null,
        reach: l.length ? Math.round(closeN / l.length * 100) : null,
        onPath: onPathPct(l), avgSec: avgSecOf(l),
        last: l.reduce(function(m, x){ return Math.max(m, x.startTs || 0); }, 0) };
    });
  }
  var fUserName = fUser ? ((userMap[fUser] && (userMap[fUser].displayName || userMap[fUser].email)) || (repRows.find(function(r){ return r.id === fUser; }) || {}).name || "Rep") : "";

  // Mix panel: live = call outcomes · practice = how far runs got
  var mixRows = [];
  if (isLiveOv) {
    var oc = {};
    ovList.forEach(function(x){
      var m = outcomeMeta(x);
      var label = m.label === "Live" ? "Not sold" : m.label;   // a completed live call without a sale
      if (!oc[label]) oc[label] = { label:label, color:m.color, n:0 };
      oc[label].n++;
    });
    mixRows = Object.keys(oc).map(function(k){ return oc[k]; });
  } else {
    var depth = { close:0, discovery:0, pitch:0 };
    ovList.forEach(function(x) {
      var types = sessionVisits(x).filter(function(v){ return !v.isObjCard; }).map(function(v){ return v.cardType; });
      if (types.indexOf("close") !== -1) depth.close++;
      else if (types.indexOf("discovery") !== -1) depth.discovery++;
      else depth.pitch++;
    });
    mixRows = [
      { label:"Reached close", color:"#66BB6A", n:depth.close },
      { label:"Stopped in discovery", color:"#00B4FF", n:depth.discovery },
      { label:"Stopped in pitch", color:"#F5A623", n:depth.pitch },
    ];
  }
  mixRows = mixRows.filter(function(r){ return r.n > 0; }).sort(function(a, b){ return b.n - a.n; });

  // Live: cards deals closed on · Practice: cards runs ended on
  var endRows = [];
  (function() {
    var cc = {};
    ovList.forEach(function(x) {
      var t = isLiveOv ? ((x.sold || x.outcome === "sold") ? x.soldCardTitle : null) : (lastMainCard(x) || {}).cardTitle;
      if (t) cc[t] = (cc[t] || 0) + 1;
    });
    endRows = Object.keys(cc).map(function(k){ return { title:k, n:cc[k] }; }).sort(function(a, b){ return b.n - a.n; }).slice(0, 5);
  })();

  // Objection stacks raised (once per session)
  var objRows = [];
  (function() {
    var ob = {};
    ovList.forEach(function(x) {
      var seen = {};
      sessionVisits(x).forEach(function(v) {
        if (!v.isObjCard) return;
        var k = v.stackLabel || "Objection";
        if (seen[k]) return; seen[k] = true;
        ob[k] = (ob[k] || 0) + 1;
      });
    });
    objRows = Object.keys(ob).map(function(k){ return { label:k, n:ob[k] }; }).sort(function(a, b){ return b.n - a.n; }).slice(0, 5);
  })();

  // Weekly activity — last 12 weeks ending at the newest session in view
  var weeks = [];
  if (ovList.length) {
    var WEEK = 7 * 24 * 3600 * 1000;
    var newest = ovList.reduce(function(m, x){ return Math.max(m, x.startTs || 0); }, 0);
    var end = new Date(newest); end.setHours(23,59,59,999);
    var endTs = end.getTime();
    for (var w = 11; w >= 0; w--) weeks.push({ start:endTs - (w + 1) * WEEK + 1, total:0, sold:0, booked:0, noContact:0, reached:0, durSum:0, durN:0, onPathAll:0, onPathOn:0 });
    ovList.forEach(function(x) {
      var idx = 11 - Math.floor((endTs - x.startTs) / WEEK);
      if (idx < 0 || idx > 11) return;
      var wk = weeks[idx];
      wk.total++;
      if (x.sold || x.outcome === "sold") wk.sold++;
      else if (x.outcome === "booked") wk.booked++;
      else if (x.outcome === "not_contacted") wk.noContact++;
      if (reachedClose(x)) wk.reached++;
      sessionVisits(x).forEach(function(v){ if (v.isObjCard) return; wk.onPathAll++; if (v.intendedPath) wk.onPathOn++; });
      var d = sessionDurSec(x); if (d) { wk.durSum += d; wk.durN++; }
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
          {hasFb && <span style={{color:fbUnseen?SESS_COLOR:TXT3,fontWeight:fbUnseen?700:400}}>{s.feedbackCount} feedback</span>}
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
    var liveN = filtered.filter(function(x){ return (x.mode || "live") === "live"; }).length;
    var pracN = filtered.length - liveN;
    var modeTabs = (
      <div role="tablist" aria-label="Overview metrics" style={{display:"inline-flex",background:"rgba(255,255,255,.05)",border:"1px solid "+LINE,borderRadius:12,padding:3,gap:2}}>
        {[["live","📞 Live calls",liveN,STYPE.live.color],["practice","🎯 Practice",pracN,STYPE.practice.color]].map(function(t) {
          var on = ovMode === t[0];
          return (
            <button key={t[0]} role="tab" aria-selected={on} onClick={function(){ setOvMode(t[0]); }}
              style={{background:on ? t[3] + "22" : "transparent",border:"1px solid "+(on ? t[3] + "66" : "transparent"),borderRadius:9,padding:compact ? "10px 16px" : "7px 16px",minHeight:compact ? 44 : undefined,
                color:on ? t[3] : TXT2,fontSize:14,fontWeight:on ? 700 : 500,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}>
              {t[1]}<span style={{fontSize:12,color:on ? t[3] : TXT3,fontWeight:600}}>{t[2]}</span>
            </button>
          );
        })}
      </div>
    );
    var header = (
      <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",gap:12,flexWrap:"wrap",marginBottom:compact ? 14 : 18}}>
        <div style={{minWidth:0}}>
          <div style={{display:"flex",alignItems:"baseline",gap:12,flexWrap:"wrap"}}>
            <div style={{fontSize:compact?19:22,fontWeight:700,color:TXT,fontFamily:"'Lora',serif"}}>{deckName || "Sessions"}</div>
            <div style={{fontSize:14,color:TXT3}}>{scopeLabel}{fUser ? " · " + fUserName : ""}{filtersActive && !fUser ? " · filtered" : ""}</div>
          </div>
          <div style={{fontSize:compact?13:14,color:TXT3,marginTop:4}}>{stacked ? "Go back to the list and pick a session to review it." : "Select a session on the left to review its path, notes and feedback."}</div>
        </div>
        {modeTabs}
      </div>
    );
    if (!ovList.length) {
      return (
        <div style={{flex:1,overflowY:"auto",padding:compact?"16px 16px 20px":"22px 26px 28px"}}>
          {header}
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10,color:TXT3,padding:"60px 24px",textAlign:"center"}}>
            <div style={{fontSize:20,fontWeight:700,color:TXT2}}>{filtered.length ? "No " + (isLiveOv ? "live calls" : "practice runs") + " in this view" : filtersActive ? "No sessions match these filters" : "No sessions yet for " + (deckName || "this deck")}</div>
            <div style={{fontSize:15,maxWidth:460,lineHeight:1.6}}>
              {filtered.length ? "Switch to " + (isLiveOv ? "Practice" : "Live calls") + " above, or widen your filters." : filtersActive ? "Try widening the date range or clearing filters." : "Run the deck from the Play tab — completed sessions appear here for review."}
            </div>
            {filtersActive && <button onClick={resetFilters} style={Object.assign(pillBtn(true), {marginTop:6,fontSize:14,padding:"7px 16px"})}>Clear filters</button>}
            {isAdmin && !isAdminScope && !filtersActive && !filtered.length && <button onClick={function(){ setViewScope("org"); }} style={Object.assign(pillBtn(true), {marginTop:6,fontSize:14,padding:"7px 16px"})}>View all org sessions</button>}
          </div>
        </div>
      );
    }

    var n = ovList.length;
    var soldN = ovList.filter(function(x){ return x.sold || x.outcome === "sold"; }).length;
    var bookedN = ovList.filter(function(x){ return x.outcome === "booked"; }).length;
    var contacted = ovList.filter(function(x){ return x.outcome !== "not_contacted"; }).length;
    var reachN = ovList.filter(reachedClose).length;
    var visitsN = ovList.reduce(function(t, x){ return t + sessionVisits(x).filter(function(v){ return !v.isObjCard; }).length; }, 0);
    var avgSec = avgSecOf(ovList);
    var onPath = onPathPct(ovList);
    var kpis = isLiveOv ? [
      { v:n, l:"Live calls", c:TXT },
      { v:soldN, l:"Sold", c:"#66BB6A" },
      { v:Math.round(soldN / n * 100) + "%", l:"Close rate", c:"#66BB6A" },
      { v:bookedN, l:"Booked", c:"#FFD54F" },
      { v:Math.round(contacted / n * 100) + "%", l:"Contact rate", c:"#00B4FF" },
      { v:avgSec !== null ? fmtSec(avgSec) : "—", l:"Avg call", c:ACCENT },
    ] : [
      { v:n, l:"Practice runs", c:TXT },
      { v:Math.round(reachN / n * 100) + "%", l:"Reached close", sub:reachN + " of " + n + " runs", c:"#66BB6A" },
      { v:onPath !== null ? onPath + "%" : "—", l:"On intended path", c:"#4DB6AC" },
      { v:avgSec !== null ? fmtSec(avgSec) : "—", l:"Avg run", c:ACCENT },
      { v:(visitsN / n).toFixed(1), l:"Cards per run", c:"#00B4FF" },
    ];
    var maxMix = mixRows.reduce(function(m, r){ return Math.max(m, r.n); }, 1);
    var slices = isLiveOv ? LIVE_SLICES : PRACTICE_SLICES;
    var showReps = repRows.length > 1 || isAdminScope;

    return (
      <div style={{flex:1,overflowY:"auto",padding:compact?"16px 16px 20px":"22px 26px 28px"}}>
        {header}

        {/* KPI strip */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(" + (compact ? 110 : 118) + "px, 1fr))",gap:12,marginBottom:16}}>
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

        <div style={{display:"flex",flexWrap:"wrap",gap:16,alignItems:"stretch",marginBottom:16}}>
          <div style={panelSt({flex:"1 1 300px"})}>
            <PanelTitle>{isLiveOv ? "Call outcomes" : "How far runs got"}</PanelTitle>
            {mixRows.map(function(r) {
              return (
                <div key={r.label} style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
                  <span style={{fontSize:14,color:r.color,fontWeight:600,width:isLiveOv ? 100 : 160,flexShrink:0}}>{r.label}</span>
                  <div style={{flex:1,height:8,background:"rgba(255,255,255,.06)",borderRadius:99,overflow:"hidden"}}>
                    <div style={{width:Math.round(r.n / maxMix * 100) + "%",height:"100%",background:r.color,borderRadius:99,opacity:.85}}/>
                  </div>
                  <span style={{fontSize:14,color:TXT2,fontWeight:700,width:34,textAlign:"right"}}>{r.n}</span>
                  <span style={{fontSize:13,color:TXT3,width:40,textAlign:"right"}}>{Math.round(r.n / n * 100)}%</span>
                </div>
              );
            })}
          </div>
          <div style={{flex:"1 1 300px",display:"flex",flexDirection:"column",gap:16,minWidth:0}}>
            <div style={panelSt()}>
              <PanelTitle>{isLiveOv ? "Where deals close" : "Where runs end"}</PanelTitle>
              {endRows.length === 0 && <div style={{fontSize:14,color:TXT3}}>{isLiveOv ? "No sold calls in this view yet." : "No runs in this view yet."}</div>}
              {endRows.map(function(r, i) {
                return (
                  <div key={r.title} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderTop:i?"1px solid "+LINE:"none"}}>
                    <span style={{fontSize:13,color:TXT3,width:18}}>{i+1}</span>
                    <span style={{fontSize:14,color:TXT2,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.title}</span>
                    <span style={{fontSize:14,fontWeight:700,color:isLiveOv ? "#66BB6A" : "#00B4FF"}}>{r.n}</span>
                  </div>
                );
              })}
            </div>
            <div style={panelSt()}>
              <PanelTitle>Objections raised</PanelTitle>
              {objRows.length === 0 && <div style={{fontSize:14,color:TXT3}}>No objections in this view.</div>}
              {objRows.map(function(r, i) {
                return (
                  <div key={r.label} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderTop:i?"1px solid "+LINE:"none"}}>
                    <span style={{fontSize:14,color:TXT2,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.label}</span>
                    <span style={{fontSize:13,color:TXT3}}>{Math.round(r.n / n * 100)}% of {isLiveOv ? "calls" : "runs"}</span>
                    <span style={{fontSize:14,fontWeight:700,color:OBJ_COLOR,width:28,textAlign:"right"}}>{r.n}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Weekly activity — pies split by this mode's outcomes */}
        <div style={panelSt({marginBottom:16})}>
          <PanelTitle right={
            <span style={{display:"flex",gap:14,fontSize:13,color:TXT3,flexWrap:"wrap"}}>
              {slices.map(function(sl) {
                return <span key={sl.key} style={{display:"inline-flex",alignItems:"center",gap:6}}><span style={{width:10,height:10,borderRadius:"50%",background:sl.color}}/>{sl.label}</span>;
              })}
            </span>
          }>Activity · last 12 weeks</PanelTitle>
          <div style={{display:"grid",gridTemplateColumns:"repeat(12, minmax(0, 1fr))",gap:8,alignItems:"end"}}>
            {weeks.map(function(w, i) {
              var hov = hoverWeek === i;
              var wEnd = w.start + 7 * 24 * 3600 * 1000 - 1;
              var rows = isLiveOv ? [
                ["Live calls", w.total, TXT], ["Sold", w.sold, "#66BB6A"], ["Booked", w.booked, "#FFD54F"], ["No contact", w.noContact, "rgba(255,255,255,.6)"],
                ["Other", w.total - w.sold - w.booked - w.noContact, "rgba(255,255,255,.75)"],
                ["Close rate", w.total ? Math.round(w.sold / w.total * 100) + "%" : "—", TXT2], ["Avg call", w.durN ? fmtSec(Math.round(w.durSum / w.durN)) : "—", TXT2],
              ] : [
                ["Practice runs", w.total, TXT], ["Reached close", w.reached, "#66BB6A"], ["Ended earlier", w.total - w.reached, "#00B4FF"],
                ["On path", w.onPathAll ? Math.round(w.onPathOn / w.onPathAll * 100) + "%" : "—", TXT2], ["Avg run", w.durN ? fmtSec(Math.round(w.durSum / w.durN)) : "—", TXT2],
              ];
              return (
                <div key={i} onMouseEnter={function(){ setHoverWeek(i); }} onMouseLeave={function(){ setHoverWeek(null); }} onClick={function(){ setHoverWeek(hov ? null : i); }}
                  style={{position:"relative",display:"flex",flexDirection:"column",alignItems:"center",gap:6,minWidth:0}}>
                  {hov && (
                    <div role="tooltip" style={{position:"absolute",bottom:"calc(100% + 6px)",left:"50%",transform:"translateX(" + (i < 2 ? "-20%" : i > 9 ? "-80%" : "-50%") + ")",zIndex:20,
                      minWidth:190,background:"#0b1a34",border:"1px solid rgba(255,255,255,.16)",borderRadius:10,padding:"10px 12px",boxShadow:"0 12px 32px rgba(0,0,0,.6)",pointerEvents:"none",textAlign:"left"}}>
                      <div style={{fontSize:12,color:TXT3,marginBottom:6,whiteSpace:"nowrap"}}>
                        {new Date(w.start).toLocaleDateString("en-US",{month:"short",day:"numeric"})} – {new Date(wEnd).toLocaleDateString("en-US",{month:"short",day:"numeric"})}
                      </div>
                      {rows.map(function(row) {
                        return (
                          <div key={row[0]} style={{display:"flex",justifyContent:"space-between",gap:16,fontSize:13,lineHeight:1.7,whiteSpace:"nowrap"}}>
                            <span style={{color:TXT3}}>{row[0]}</span><strong style={{color:row[2],fontVariantNumeric:"tabular-nums"}}>{row[1]}</strong>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <WeekPie week={w} slices={slices} size={compact ? 54 : 64} hover={hov}/>
                  <span style={{fontSize:12,color:TXT3,whiteSpace:"nowrap"}}>{new Date(w.start).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* By rep */}
        {showReps && (
          <div style={panelSt()}>
            <PanelTitle right={
              <span style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
                {(orgTeams||[]).length > 0 && (
                  <span style={{display:"inline-flex",background:"rgba(255,255,255,.05)",borderRadius:99,padding:2}}>
                    {[[false,"All reps"],[true,"By team"]].map(function(o) {
                      var on = repGroup === o[0];
                      return <button key={o[1]} onClick={function(){ setRepGroup(o[0]); }}
                        style={{background:on?"rgba(255,255,255,.12)":"transparent",border:"none",borderRadius:99,padding:compact?"8px 14px":"4px 12px",fontSize:13,color:on?TXT:TXT3,fontWeight:on?700:500,cursor:"pointer",fontFamily:"inherit"}}>{o[1]}</button>;
                    })}
                  </span>
                )}
                {fUser ? <button onClick={function(){ setFUser(""); }} style={pillBtn(true)}>Show all reps ×</button> : <span style={{fontSize:13,color:TXT3}}>Click a rep to filter the list</span>}
              </span>
            }>By rep · {isLiveOv ? "live calls" : "practice"}</PanelTitle>
            {(function() {
              var cols = REP_COLS[ovMode];
              var gridCols = "minmax(180px,2fr) repeat(" + (cols.length - 1) + ", minmax(70px,1fr))";
              function val(r, k) { return k === "name" ? (r.name || "").toLowerCase() : (r[k] === null || r[k] === undefined ? -1 : r[k]); }
              var sk = cols.some(function(c){ return c[0] === repSort.key; }) ? repSort.key : "total";
              var sorted = repRows.slice().sort(function(a, b) {
                var va = val(a, sk), vb = val(b, sk);
                var d = va < vb ? -1 : va > vb ? 1 : 0;
                if (!d) d = (a.name || "").localeCompare(b.name || "");
                return repSort.dir === "asc" ? d : -d;
              });
              function rowCells(r) {
                return cols.slice(1).map(function(c) {
                  var v = r[c[0]];
                  var txt = c[0] === "last" ? (v ? fmtDate(v) : "—") : c[0] === "avgSec" ? (v ? fmtSec(v) : "—") : c[2] === "%" ? (v === null ? "—" : v + "%") : v;
                  return <span key={c[0]} style={{textAlign:"right",fontWeight:c[0] === "total" ? 700 : 500,color:c[3] || TXT2,fontSize:c[0] === "last" ? 13 : 14,fontVariantNumeric:"tabular-nums"}}>{txt}</span>;
                });
              }
              function repRow(r) {
                var on = fUser && fUser === r.id;
                var rm = r.role ? roleMeta(r.role) : null;
                return (
                  <button key={r.id || r.name} onClick={function(){ if (r.id) { setFUser(on ? "" : r.id); if (stacked && !on) setShowOverview(false); } }}
                    style={{display:"grid",gridTemplateColumns:gridCols,gap:8,alignItems:"center",width:"100%",textAlign:"left",background:on?"rgba(255,213,79,.08)":"transparent",border:"none",borderBottom:"1px solid "+LINE,padding:"10px 10px",cursor:r.id?"pointer":"default",fontFamily:"inherit",color:TXT2,fontSize:14}}>
                    <span style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
                      <Avatar name={r.name} colorKey={r.id || r.name} size={28}/>
                      <span style={{fontWeight:600,color:TXT,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.name}</span>
                      {rm && r.role !== "user" && <span style={{fontSize:11,fontWeight:700,color:rm.color,background:rm.bg,border:"1px solid "+rm.border,borderRadius:99,padding:"1px 7px",flexShrink:0}}>{rm.label}</span>}
                    </span>
                    {rowCells(r)}
                  </button>
                );
              }
              var head = (
                <div style={{display:"grid",gridTemplateColumns:gridCols,fontSize:13,color:TXT3,padding:"0 10px 8px",borderBottom:"1px solid "+LINE,gap:8}}>
                  {cols.map(function(c) {
                    var on = sk === c[0];
                    return (
                      <button key={c[0]} aria-sort={on ? (repSort.dir === "asc" ? "ascending" : "descending") : "none"}
                        onClick={function(){ setRepSort(on ? { key:c[0], dir:repSort.dir === "asc" ? "desc" : "asc" } : { key:c[0], dir:c[0] === "name" ? "asc" : "desc" }); }}
                        style={{background:"none",border:"none",padding:compact?"8px 0":0,cursor:"pointer",fontFamily:"inherit",fontSize:13,color:on?TXT:TXT3,fontWeight:on?700:500,display:"flex",alignItems:"center",justifyContent:c[0] === "name" ? "flex-start" : "flex-end",gap:4}}>
                        {c[1]}<span style={{fontSize:10,opacity:on?1:.35}}>{on ? (repSort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
                      </button>
                    );
                  })}
                </div>
              );
              if (!repGroup) return <>{head}{sorted.map(repRow)}</>;
              var groups = (orgTeams||[]).map(function(t) {
                return { id:t.id, name:t.name, rows:sorted.filter(function(r){ return (t.memberIds||[]).indexOf(r.id) !== -1; }) };
              }).filter(function(g){ return g.rows.length; });
              var inTeam = {};
              groups.forEach(function(g){ g.rows.forEach(function(r){ inTeam[r.id] = true; }); });
              var loose = sorted.filter(function(r){ return !inTeam[r.id]; });
              if (loose.length) groups.push({ id:"__none", name:"No team", rows:loose });
              return (
                <>
                  {head}
                  {groups.map(function(g) {
                    var tot = g.rows.reduce(function(t, r){ return t + r.total; }, 0);
                    var sold = g.rows.reduce(function(t, r){ return t + r.sold; }, 0);
                    return (
                      <div key={g.id} style={{marginTop:10}}>
                        <div style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",background:"rgba(255,255,255,.04)",borderRadius:8,fontSize:13,color:TXT2,fontWeight:700}}>
                          <span style={{color:TXT,flex:1}}>🏷️ {g.name} <span style={{fontWeight:500,color:TXT3}}>· {g.rows.length} rep{g.rows.length!==1?"s":""}</span></span>
                          <span>{tot} {isLiveOv ? "calls" : "runs"}{isLiveOv ? " · " + sold + " sold · " + (tot ? Math.round(sold / tot * 100) : 0) + "% close" : ""}</span>
                        </div>
                        {g.rows.map(repRow)}
                      </div>
                    );
                  })}
                </>
              );
            })()}
          </div>
        )}
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
                value={scopeVal}
                onChange={function(e){ setViewScope(e.target.value); setSelectedId(null); }}
                style={Object.assign({},inputSt({padding:"8px 12px",fontSize:14,borderRadius:10}),{flex:1,width:"auto",cursor:"pointer",minHeight:ctlH})}>
                <option value="self">My Sessions</option>
                <option value="org">All Org Sessions</option>
                {(orgTeams||[]).length > 0 && (
                  <optgroup label="Teams">
                    {(orgTeams||[]).map(function(t){ return <option key={t.id} value={"team:" + t.id}>{t.name}</option>; })}
                  </optgroup>
                )}
                <optgroup label="People">
                  {(orgUsers||[]).filter(function(u){ return u.id !== authUser.id; }).slice().sort(function(a, b){ return (a.displayName||"").localeCompare(b.displayName||""); })
                    .map(function(u){ return <option key={u.id} value={"user:" + u.id}>{u.displayName}</option>; })}
                </optgroup>
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
            list="overcard-rep-names"
            style={inputSt({height:compact?44:38,fontSize:14,padding:"0 14px",borderRadius:10})}/>
          {/* Rep-name suggestions (mobile has an autocomplete; the native datalist gives the same here) */}
          <datalist id="overcard-rep-names">
            {(function() {
              var seen = {};
              return (sessions || []).filter(function(x){ var n = ownerName(x); if (seen[n]) return false; seen[n] = true; return true; })
                .map(function(x){ return <option key={x.userId || ownerName(x)} value={ownerName(x)}/>; });
            })()}
          </datalist>

          {/* My scope: all / my own / shared with me — team & org scopes: group by rep */}
          {!isAdminScope && (
            <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
              {[["all","All"],["mine","My runs"],["shared","Shared with me" + (sharedCount ? " · " + sharedCount : "")]].map(function(pair) {
                return <button key={pair[0]} onClick={function(){ setFSource(pair[0]); }} style={pill(fSource === pair[0], pair[0] === "shared" ? "#00B4FF" : ACCENT)}>{pair[1]}</button>;
              })}
            </div>
          )}
          {canGroup && (
            // Pill toggle (native checkboxes are unstyled by the app's global input reset)
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <button onClick={function(){ setGroupRep(!groupRep); }} aria-pressed={groupRep} style={pill(groupRep, ACCENT)}>
                {groupRep ? "✓ " : ""}Group by rep
              </button>
              {groupRep && (
                <button onClick={function(){
                    var all = {}, anyClosed = false;
                    filtered.forEach(function(x){ var k = x.userId || "__unknown"; all[k] = true; if (!openGroups[k]) anyClosed = true; });
                    setOpenGroups(anyClosed ? all : {});
                  }}
                  style={{background:"none",border:"none",color:TXT3,fontSize:13,cursor:"pointer",fontFamily:"inherit",textDecoration:"underline",minHeight:ctlH}}>
                  Expand / collapse all
                </button>
              )}
            </div>
          )}

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
              {v:stats.soldCount, l:"Sold", c:SESS_COLOR},
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
          {!(canGroup && groupRep) && filtered.map(renderRow)}
          {canGroup && groupRep && (function() {
            // Same rep grouping the mobile list has: collapsible header with each rep's totals
            var groups = {}, order = [];
            filtered.forEach(function(x) {
              var k = x.userId || "__unknown";
              if (!groups[k]) { groups[k] = { id:k, name:ownerName(x), list:[] }; order.push(k); }
              groups[k].list.push(x);
            });
            order.sort(function(a, b){ return groups[a].name.localeCompare(groups[b].name); });
            return order.map(function(k) {
              var g = groups[k];
              var live = g.list.filter(function(x){ return (x.mode||"live") === "live"; });
              var sold = live.filter(function(x){ return x.sold || x.outcome === "sold"; }).length;
              var open = !!openGroups[k];
              return (
                <div key={k} style={{marginBottom:8}}>
                  <button onClick={function(){ setOpenGroups(function(p){ var n = Object.assign({}, p); n[k] = !open; return n; }); }} aria-expanded={open}
                    style={{display:"flex",alignItems:"center",gap:10,width:"100%",textAlign:"left",background:"rgba(255,255,255,.05)",border:"1px solid "+LINE,borderRadius:12,padding:compact ? "12px" : "10px 12px",cursor:"pointer",fontFamily:"inherit",marginBottom:open ? 6 : 0}}>
                    <Avatar name={g.name} colorKey={k} size={28}/>
                    <span style={{flex:1,minWidth:0}}>
                      <span style={{display:"block",fontSize:14,fontWeight:700,color:TXT,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{g.name}</span>
                      <span style={{display:"block",fontSize:12,color:TXT3}}>{g.list.length} session{g.list.length !== 1 ? "s" : ""} · {live.length} live · {sold} sold{live.length ? " · " + Math.round(sold / live.length * 100) + "% close" : ""}</span>
                    </span>
                    <span style={{fontSize:12,color:TXT3}}>{open ? "▲" : "▼"}</span>
                  </button>
                  {open && g.list.map(renderRow)}
                </div>
              );
            });
          })()}
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
