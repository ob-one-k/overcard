import { useState, useEffect, useRef, useContext } from "react";
import DesktopCtx from "../../lib/DesktopCtx";
import { SESS_COLOR, OBJ_COLOR, isAdminRole, accentA } from "../../lib/constants";
import { apiGet } from "../../lib/api";
import { solidBtn } from "../../lib/styles";
import { sessionVisits, sessionDurSec, fmtSec, fmtDate } from "../Sessions";

// ─── HELPERS (mirrors Home.jsx) ───────────────────────────────────────────────
function computeStats(sessions, decks) {
  var total    = sessions.length;
  var live     = sessions.filter(function(s){ return (s.mode||s.sessionType||"live") === "live"; });
  var practice = sessions.filter(function(s){ return (s.mode||s.sessionType||"live") === "practice"; });
  var sold     = live.filter(function(s){ return s.sold || s.outcome === "sold"; });
  var winRate  = live.length > 0 ? Math.round(sold.length / live.length * 100) : null;

  var allVisits = [];
  sessions.forEach(function(s){ allVisits = allVisits.concat(sessionVisits(s)); });
  var mainVisits = allVisits.filter(function(v){ return !v.isObjCard; });
  var intPct = mainVisits.length > 0
    ? Math.round(mainVisits.filter(function(v){ return v.intendedPath; }).length / mainVisits.length * 100)
    : null;

  var completedSess = sessions.filter(function(s){ return s.endTs; });
  var avgSec = completedSess.length > 0
    ? Math.round(completedSess.reduce(function(sum, s){ return sum + (sessionDurSec(s) || 0); }, 0) / completedSess.length)
    : null;

  var closeCounts = {};
  sessions.forEach(function(s){
    sessionVisits(s).filter(function(v){ return !v.isObjCard && v.cardType === "close"; }).forEach(function(v){
      if (!closeCounts[v.cardId]) closeCounts[v.cardId] = { title: v.cardTitle, count: 0 };
      closeCounts[v.cardId].count++;
    });
  });
  var topClose = Object.values(closeCounts).sort(function(a, b){ return b.count - a.count; })[0] || null;

  var objCounts = {};
  sessions.forEach(function(s){
    sessionVisits(s).filter(function(v){ return v.isObjCard && v.stackLabel; }).forEach(function(v){
      objCounts[v.stackLabel] = (objCounts[v.stackLabel] || 0) + 1;
    });
  });
  var topObjEntries = Object.entries(objCounts).sort(function(a, b){ return b[1] - a[1]; });
  var allObjEntries = topObjEntries.map(function(e){ return { label: e[0], count: e[1] }; });

  var deckStatsMap = {};
  sessions.forEach(function(s){
    var dk = s.deckId;
    if (!dk) return;
    if (!deckStatsMap[dk]) deckStatsMap[dk] = { deckId:dk, deckName:s.deckName, deckColor:s.deckColor, deckIcon:s.deckIcon, total:0, live:0, sold:0, practice:0 };
    deckStatsMap[dk].total++;
    if ((s.mode||s.sessionType||"live") === "live") {
      deckStatsMap[dk].live++;
      if (s.sold || s.outcome === "sold") deckStatsMap[dk].sold++;
    } else {
      deckStatsMap[dk].practice++;
    }
  });

  var notContacted = live.filter(function(s){ return s.outcome === "not_contacted"; }).length;
  var contacted    = live.length - notContacted;
  var contactRate  = live.length > 0 ? Math.round(contacted / live.length * 100) : null;

  var pastIntro    = live.filter(function(s){ return sessionVisits(s).some(function(v){ return v.cardType==="discovery" && !v.isObjCard; }); }).length;
  var reachedClose = live.filter(function(s){ return sessionVisits(s).some(function(v){ return v.cardType==="close" && !v.isObjCard; }); }).length;

  var recent = sessions.slice().sort(function(a, b){ return b.startTs - a.startTs; }).slice(0, 40);
  var totalObjVisits = allVisits.filter(function(v){ return v.isObjCard; }).length;

  return {
    total, live: live.length, practice: practice.length,
    sold: sold.length, winRate,
    intPct, avgSec,
    notContacted, contacted, contactRate,
    topClose, allObjEntries,
    deckStats: Object.values(deckStatsMap),
    pastIntro, reachedClose,
    totalObjVisits,
    recent,
  };
}

function computeRankings(sessions, orgUsers) {
  var userMap = {};
  sessions.forEach(function(s) {
    if (!s.userId) return;
    if (!userMap[s.userId]) userMap[s.userId] = [];
    userMap[s.userId].push(s);
  });
  var entries = Object.keys(userMap).map(function(uid) {
    var uSessions = userMap[uid];
    var user = orgUsers ? orgUsers.find(function(u){ return String(u.id) === String(uid); }) : null;
    var live = uSessions.filter(function(s){ return (s.mode||"live") === "live"; });
    var sold = live.filter(function(s){ return s.sold || s.outcome === "sold"; });
    var winRate = live.length > 0 ? Math.round(sold.length / live.length * 100) : null;
    return { userId: uid, displayName: user ? (user.displayName || user.email) : uid, total: uSessions.length, live: live.length, sold: sold.length, winRate: winRate };
  });
  entries.sort(function(a, b) {
    if (a.winRate !== null && b.winRate !== null) {
      if (b.winRate !== a.winRate) return b.winRate - a.winRate;
      return b.total - a.total;
    }
    if (a.winRate !== null) return -1;
    if (b.winRate !== null) return 1;
    return b.total - a.total;
  });
  return entries;
}

var MUTED  = "rgba(255,255,255,.55)";
var SUBTLE = "rgba(255,255,255,.4)";
var PANEL  = { background:"rgba(255,255,255,.045)", border:"1px solid rgba(255,255,255,.08)", borderRadius:16, display:"flex", flexDirection:"column", overflow:"hidden", minHeight:0 };

function OutcomeBadge({ session }) {
  var mode = session.mode || session.sessionType || "live";
  var outcome = session.outcome || "";
  var sold = session.sold || outcome === "sold";
  var spec;
  if (mode === "practice")              spec = { t:"Practice",   c:"#00B4FF", bg:"rgba(0,180,255,.12)",   b:"rgba(0,180,255,.3)" };
  else if (outcome === "not_contacted") spec = { t:"No contact", c:"rgba(255,255,255,.6)", bg:"rgba(255,255,255,.06)", b:"rgba(255,255,255,.16)" };
  else if (sold)                        spec = { t:"✓ Sold",     c:"#66BB6A", bg:"rgba(102,187,106,.15)", b:"rgba(102,187,106,.35)" };
  else if (outcome === "booked")        spec = { t:"Booked",     c:"#FFD54F", bg:"rgba(255,213,79,.12)",  b:"rgba(255,213,79,.3)" };
  else if (outcome === "abandoned")     spec = { t:"Abandoned",  c:"#EF5350", bg:"rgba(239,83,80,.1)",    b:"rgba(239,83,80,.25)" };
  else                                  spec = { t:"Live",       c:"rgba(255,255,255,.7)", bg:"rgba(255,255,255,.07)", b:"rgba(255,255,255,.16)" };
  return <span style={{fontSize:12,background:spec.bg,border:"1px solid "+spec.b,color:spec.c,padding:"3px 10px",borderRadius:99,fontWeight:700,whiteSpace:"nowrap",flexShrink:0}}>{spec.t}</span>;
}

// Larger desktop bar row (ui.jsx BarRow is sized for mobile)
function Bar({ label, value, denom, color, showCount }) {
  // Clamp: funnel stages are counted independently, so a later stage can exceed an earlier one
  var pct = denom > 0 ? Math.min(100, Math.round(value / denom * 100)) : 0;
  return (
    <div style={{marginBottom:12}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:5,gap:10}}>
        <span style={{fontSize:14,color:"rgba(255,255,255,.8)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{label}</span>
        <span style={{fontSize:14,fontWeight:700,color:color,flexShrink:0}}>{showCount ? value : pct + "%"}{showCount ? "" : <span style={{fontSize:12,fontWeight:500,color:SUBTLE,marginLeft:6}}>{value}/{denom}</span>}</span>
      </div>
      <div style={{height:6,background:"rgba(255,255,255,.07)",borderRadius:99,overflow:"hidden"}}>
        <div style={{height:"100%",background:color,borderRadius:99,width:pct+"%",transition:"width .4s"}}/>
      </div>
    </div>
  );
}

function PanelHead({ title, meta, compact }) {
  return (
    <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:10,padding:compact?"14px 16px 10px":"16px 20px 12px",borderBottom:"1px solid rgba(255,255,255,.06)",flexShrink:0}}>
      <h2 style={{margin:0,fontSize:compact?16:17,fontWeight:700,color:"#fff"}}>{title}</h2>
      {meta && <span style={{fontSize:13,color:MUTED,whiteSpace:"nowrap"}}>{meta}</span>}
    </div>
  );
}

function SubHead({ children }) {
  return <div style={{fontSize:12,fontWeight:700,color:SUBTLE,letterSpacing:1.1,textTransform:"uppercase",margin:"4px 0 12px"}}>{children}</div>;
}

function EmptyNote({ icon, title, body, action }) {
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",textAlign:"center",padding:"36px 20px",gap:8,color:MUTED,flex:1}}>
      {icon && <div style={{fontSize:34,marginBottom:4}}>{icon}</div>}
      <div style={{fontSize:16,fontWeight:700,color:"rgba(255,255,255,.85)"}}>{title}</div>
      {body && <div style={{fontSize:14,lineHeight:1.6,maxWidth:340}}>{body}</div>}
      {action}
    </div>
  );
}

// ─── HOME DESKTOP ─────────────────────────────────────────────────────────────
// Full-width dashboard.
//   Header:   greeting + Me / team switcher
//   KPI strip: sessions, close rate, on-path, avg time, objections handled
//   Body (3 full-height panels, each scrolls on its own):
//     Me tab:   Recent sessions | Decks (quick launch) | Insights (funnel, objections, ranking, top close)
//     Team tab: Leaderboard     | Recent team sessions | Insights
// Mirrors HomeTab data/state — no hooks extracted to avoid conditional-hooks issues
export function HomeDesktop({ authUser, decks, orgTeams, orgUsers, onSwitchDeckAndPlay }) {
  var [mySessions,   setMySessions]   = useState(null);
  var [teamSessions, setTeamSessions] = useState({});
  var [activeSubTab, setActiveSubTab] = useState("me");   // "me" | "all" | teamId
  var [loadingTeam,  setLoadingTeam]  = useState(null);
  // Admins/owners can view any individual in the org through the "Me" scope
  var isAdmin = isAdminRole(authUser.role);
  var [personId,       setPersonId]       = useState(authUser.id);
  var [personSessions, setPersonSessions] = useState({});   // userId -> sessions (others only)
  var [orgSessions,    setOrgSessions]    = useState(null); // admins' "All" scope
  var [vw,           setVw]           = useState(function(){ return window.innerWidth; });
  var desktop = useContext(DesktopCtx);
  var compact = !!desktop.compact;   // tablet: compact desktop

  var myTeams;
  if (isAdminRole(authUser.role) && orgTeams && orgTeams.length > 0) {
    myTeams = orgTeams.map(function(t){ return { id: t.id, name: t.name }; });
  } else if (authUser.teams && authUser.teams.length > 0) {
    myTeams = authUser.teams;
  } else if (authUser.teamId) {
    myTeams = [{ id: authUser.teamId, name: authUser.teamName || "My Team" }];
  } else {
    myTeams = [];
  }

  useEffect(function() {
    apiGet("/sessions")
      .then(function(data){ setMySessions(Array.isArray(data) ? data : []); })
      .catch(function(){ setMySessions([]); });
  }, []);

  useEffect(function() {
    myTeams.forEach(function(team) { loadTeamSessions(team.id); });
  }, [myTeams.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // No personal sessions yet → open on the first team so the dashboard isn't empty (until the user picks a scope)
  var userPickedRef = useRef(false);
  useEffect(function() {
    if (userPickedRef.current) return;
    if (mySessions && mySessions.length === 0 && myTeams.length > 0 && activeSubTab === "me") {
      setActiveSubTab(myTeams[0].id);
      loadTeamSessions(myTeams[0].id);
    }
  }, [mySessions, myTeams.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(function() {
    var timer = null;
    function onResize() { clearTimeout(timer); timer = setTimeout(function(){ setVw(window.innerWidth); }, 60); }
    window.addEventListener("resize", onResize);
    return function() { window.removeEventListener("resize", onResize); clearTimeout(timer); };
  }, []);

  function loadTeamSessions(teamId) {
    if (teamSessions[teamId] !== undefined) return;
    setLoadingTeam(teamId);
    apiGet("/sessions?scope=team:" + teamId)
      .then(function(data){
        setTeamSessions(function(prev){ return Object.assign({}, prev, { [teamId]: Array.isArray(data) ? data : [] }); });
        setLoadingTeam(null);
      })
      .catch(function(){
        setTeamSessions(function(prev){ return Object.assign({}, prev, { [teamId]: [] }); });
        setLoadingTeam(null);
      });
  }

  function loadAll() {
    if (isAdmin) {
      if (orgSessions !== null) return;
      apiGet("/sessions?scope=org")
        .then(function(data){ setOrgSessions(Array.isArray(data) ? data : []); })
        .catch(function(){ setOrgSessions([]); });
    } else {
      // Non-admins can only read their own teams — "All" is every team they belong to
      myTeams.forEach(function(team) { loadTeamSessions(team.id); });
    }
  }

  function loadPerson(userId) {
    if (String(userId) === String(authUser.id) || personSessions[userId] !== undefined) return;
    apiGet("/sessions?scope=user:" + encodeURIComponent(userId))
      .then(function(data){ setPersonSessions(function(prev){ var n = Object.assign({}, prev); n[userId] = Array.isArray(data) ? data : []; return n; }); })
      .catch(function(){ setPersonSessions(function(prev){ var n = Object.assign({}, prev); n[userId] = []; return n; }); });
  }

  function handleSubTab(tabId) {
    userPickedRef.current = true;
    setActiveSubTab(tabId);
    if (tabId === "all") loadAll();
    else if (tabId !== "me") loadTeamSessions(tabId);
  }

  function pickPerson(userId) {
    userPickedRef.current = true;
    setPersonId(userId);
    setActiveSubTab("me");
    loadPerson(userId);
  }

  var viewingSelf = String(personId) === String(authUser.id);
  var person = viewingSelf ? null : (orgUsers || []).find(function(u){ return String(u.id) === String(personId); });

  // Union of the caller's team sessions (deduped) for a non-admin "All" scope
  function unionTeams() {
    var seen = {}, out = [], pending = false;
    myTeams.forEach(function(t) {
      var list = teamSessions[t.id];
      if (list === undefined) { pending = true; return; }
      list.forEach(function(x){ if (!seen[x.id]) { seen[x.id] = true; out.push(x); } });
    });
    return pending ? null : out;
  }

  var currentSessions;
  if (activeSubTab === "me") {
    currentSessions = viewingSelf ? mySessions : (personSessions[personId] === undefined ? null : personSessions[personId]);
  } else if (activeSubTab === "all") {
    currentSessions = isAdmin ? orgSessions : unionTeams();
  } else {
    var loaded = teamSessions[activeSubTab];
    currentSessions = (loaded === undefined) ? null : loaded;
  }

  var isLoadingTeam = activeSubTab !== "me" && activeSubTab !== "all" && loadingTeam === activeSubTab;
  var isLoading = currentSessions === null || isLoadingTeam;
  var stats = (!isLoading && currentSessions && currentSessions.length > 0)
    ? computeStats(currentSessions, decks)
    : null;

  var isTeamTab = activeSubTab !== "me";   // team or "all": leaderboard + rep-labelled sessions
  var activeTeam = isTeamTab && activeSubTab !== "all" ? myTeams.find(function(t){ return t.id === activeSubTab; }) : null;
  var scopeLabel = activeSubTab === "all" ? (isAdmin ? "Whole organization" : "All your teams") : activeTeam ? activeTeam.name : "";

  var hr = new Date().getHours();
  var greeting = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
  var firstName = (authUser.displayName || "").split(" ")[0] || authUser.displayName;
  var personName = person ? (person.displayName || person.email) : "";

  // Recency-sorted decks for quick-launch section
  var deckLastUsed = {};
  (mySessions || []).forEach(function(s) {
    if (!deckLastUsed[s.deckId] || s.startTs > deckLastUsed[s.deckId]) deckLastUsed[s.deckId] = s.startTs;
  });
  var sortedDecks = (decks || []).slice().sort(function(a, b) {
    var aTs = deckLastUsed[a.id] || 0;
    var bTs = deckLastUsed[b.id] || 0;
    if (aTs !== bTs) return bTs - aTs;
    return (a.name || "").localeCompare(b.name || "");
  });
  // Deck stats always come from the user's own sessions so the quick-launch list is personal
  var myStats = (mySessions && mySessions.length > 0) ? (activeSubTab === "me" && viewingSelf && stats ? stats : computeStats(mySessions, decks)) : null;
  var myDeckStats = myStats ? myStats.deckStats : [];

  var userName = {};
  (orgUsers || []).forEach(function(u){ userName[String(u.id)] = u.displayName || u.email; });

  // Tablet: the 72px rail eats into the width; 2 columns in landscape, stacked in portrait
  var contentW = vw - (compact ? 72 : 0);
  var wide   = !compact && vw >= 1360;
  var twoCol = !compact || contentW >= 860;
  var cols   = wide ? "minmax(0,1.15fr) minmax(0,1.05fr) minmax(0,1fr)" : twoCol ? "minmax(0,1fr) minmax(0,1fr)" : "minmax(0,1fr)";
  // Stacked (tablet portrait): panels size to their content, capped so each still scrolls on its own
  var panelH    = wide || !twoCol ? undefined : compact ? 420 : 460;
  var panelMaxH = !twoCol ? 480 : undefined;
  var padX   = compact ? 16 : 24;

  // ── Panel: recent sessions (me or team) ─────────────────────────────────────
  function renderRecent(showRep) {
    var list = currentSessions ? currentSessions.slice().sort(function(a, b){ return b.startTs - a.startTs; }).slice(0, 40) : [];
    return (
      <section style={Object.assign({}, PANEL, { height:panelH, maxHeight:panelMaxH })}>
        <PanelHead compact={compact} title={showRep ? "Recent team sessions" : "Recent sessions"} meta={currentSessions && currentSessions.length > 0 ? "Latest " + list.length + " of " + currentSessions.length : null}/>
        <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column"}}>
          {isLoading && <EmptyNote title="Loading sessions…"/>}
          {!isLoading && list.length === 0 && (
            <EmptyNote icon="📊" title="No sessions yet"
              body={showRep ? "Nobody on this team has run a session yet." : "Pick a deck and run your first practice or live session — results will land here."}
              action={!showRep && sortedDecks.length > 0 && onSwitchDeckAndPlay ? (
                <button onClick={function(){ onSwitchDeckAndPlay(sortedDecks[0].id); }} style={Object.assign({}, solidBtn(SESS_COLOR), {marginTop:10,fontSize:15,padding:"11px 20px",borderRadius:12})}>▶ Start a session</button>
              ) : null}/>
          )}
          {!isLoading && list.map(function(s){
            var modeIcon = (s.mode||s.sessionType||"live") === "live" ? "📞" : "🎯";
            var dColor = s.deckColor || "#F5A623";
            var dur = sessionDurSec(s);
            var rep = showRep ? (userName[String(s.userId)] || "Unknown rep") : null;
            return (
              <div key={s.id} style={{display:"flex",alignItems:"center",gap:14,padding:"11px 20px",borderBottom:"1px solid rgba(255,255,255,.05)"}}>
                <span style={{fontSize:18,flexShrink:0}}>{modeIcon}</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:15,fontWeight:600,color:"rgba(255,255,255,.92)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name || "Untitled session"}</div>
                  <div style={{fontSize:13,color:MUTED,marginTop:3,display:"flex",gap:7,alignItems:"center",minWidth:0,whiteSpace:"nowrap",overflow:"hidden"}}>
                    {rep && <span style={{color:"rgba(255,255,255,.8)",fontWeight:600,flexShrink:0}}>{rep}</span>}
                    {rep && <span style={{color:"rgba(255,255,255,.25)",flexShrink:0}}>·</span>}
                    <span title={s.deckName || ""} style={{width:8,height:8,borderRadius:"50%",background:dColor,display:"inline-block",flexShrink:0}}/>
                    <span style={{overflow:"hidden",textOverflow:"ellipsis",minWidth:24,flex:"0 1 auto"}}>{s.deckName || "—"}</span>
                    <span style={{color:"rgba(255,255,255,.25)",flexShrink:0}}>·</span>
                    <span style={{flexShrink:0}}>{fmtDate(s.startTs)}</span>
                    {dur ? <span style={{color:"rgba(255,255,255,.25)",flexShrink:0}}>·</span> : null}
                    {dur ? <span style={{flexShrink:0}}>{fmtSec(dur)}</span> : null}
                  </div>
                </div>
                <OutcomeBadge session={s}/>
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  // ── Panel: decks quick launch ───────────────────────────────────────────────
  function renderDecks() {
    return (
      <section style={Object.assign({}, PANEL, { height:panelH, maxHeight:panelMaxH })}>
        <PanelHead compact={compact} title="Your decks" meta={sortedDecks.length + " deck" + (sortedDecks.length!==1?"s":"")}/>
        <div style={{flex:1,overflowY:"auto",padding:"12px 14px",display:"flex",flexDirection:"column",gap:10}}>
          {sortedDecks.length === 0 && <EmptyNote icon="🗂️" title="No decks yet" body="Decks your admin shares with you will appear here."/>}
          {sortedDecks.map(function(d) {
            var deckStat = myDeckStats.find(function(ds){ return ds.deckId === d.id; });
            var dColor   = d.color || "#F5A623";
            var wr       = deckStat && deckStat.live > 0 ? Math.round(deckStat.sold / deckStat.live * 100) : null;
            var nCards   = Object.keys(d.cards || {}).length;
            var nStacks  = (d.objStacks || []).length;
            return (
              <div key={d.id} title={d.name} style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderLeft:"4px solid "+dColor,borderRadius:"4px 14px 14px 4px",padding:"14px 14px",display:"flex",alignItems:"center",gap:12}}>
                <div style={{width:40,height:40,borderRadius:12,background:dColor+"22",border:"1.5px solid "+dColor+"55",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>{d.icon||"💼"}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:16,fontWeight:700,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.name}</div>
                  <div style={{fontSize:13,color:MUTED,marginTop:3,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                    {nCards} card{nCards!==1?"s":""} · {nStacks} stack{nStacks!==1?"s":""}
                  </div>
                  <div style={{fontSize:13,color:SUBTLE,marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                    {deckStat ? deckStat.total + " session" + (deckStat.total!==1?"s":"") : "Not run yet"}
                    {wr !== null ? <span style={{color:"#66BB6A",fontWeight:600}}>{" · " + wr + "% close"}</span> : ""}
                  </div>
                </div>
                {onSwitchDeckAndPlay && (
                  <button onClick={function(){ onSwitchDeckAndPlay(d.id); }} aria-label={"Play " + d.name}
                    style={{background:accentA(.12),border:("1px solid "+accentA(.35)),borderRadius:10,padding:"9px 13px",minHeight:compact?44:undefined,cursor:"pointer",fontSize:14,color:SESS_COLOR,fontFamily:"inherit",fontWeight:700,flexShrink:0}}>
                    ▶ Play
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  // ── Panel: team leaderboard ─────────────────────────────────────────────────
  function renderLeaderboard() {
    var allRanks = currentSessions && currentSessions.length > 0 ? computeRankings(currentSessions, orgUsers) : [];
    // Top 10 (fewer only when the scope has fewer reps); your own rank is pinned below if you're outside it
    var rankings = allRanks.slice(0, 10);
    var myIdx = allRanks.findIndex(function(e){ return String(e.userId) === String(authUser.id); });
    var meBelow = myIdx >= 10 ? allRanks[myIdx] : null;
    return (
      <section style={Object.assign({}, PANEL, { height:panelH, maxHeight:panelMaxH })}>
        <PanelHead compact={compact} title="Leaderboard" meta={allRanks.length > 0 ? (allRanks.length > 10 ? "Top 10 of " + allRanks.length + " reps" : allRanks.length + " rep" + (allRanks.length!==1?"s":"")) + " · by close rate" : null}/>
        <div style={{flex:1,overflowY:"auto",padding:"10px 14px",display:"flex",flexDirection:"column",gap:6}}>
          {isLoading && <EmptyNote title="Loading team…"/>}
          {!isLoading && rankings.length === 0 && <EmptyNote icon="🏆" title="No rankings yet" body="Rankings appear once team members record sessions."/>}
          {!isLoading && rankings.map(function(entry, idx) {
            var isMe = String(entry.userId) === String(authUser.id);
            var rn = idx + 1;
            var rc = rn === 1 ? "#FFD700" : rn === 2 ? "#C0C0C0" : rn === 3 ? "#CD7F32" : "rgba(255,255,255,.45)";
            return (
              <div key={entry.userId} style={{background:isMe?accentA(.07):"rgba(255,255,255,.035)",border:"1px solid "+(isMe?accentA(.3):"rgba(255,255,255,.06)"),borderRadius:12,padding:"11px 14px",display:"flex",alignItems:"center",gap:14}}>
                <div style={{fontSize:16,fontWeight:900,color:rc,minWidth:30,textAlign:"center"}}>#{rn}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:15,fontWeight:isMe?700:600,color:isMe?SESS_COLOR:"rgba(255,255,255,.9)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {entry.displayName}{isMe ? " (you)" : ""}
                  </div>
                  <div style={{fontSize:13,color:MUTED,marginTop:2}}>
                    {entry.total} session{entry.total!==1?"s":""}
                    {entry.live > 0 ? " · " + entry.live + " live · " + entry.sold + " sold" : ""}
                  </div>
                </div>
                <div style={{textAlign:"right",flexShrink:0}}>
                  <div style={{fontSize:18,fontWeight:700,color:entry.winRate!==null?"#66BB6A":"rgba(255,255,255,.3)"}}>{entry.winRate !== null ? entry.winRate+"%" : "—"}</div>
                  <div style={{fontSize:12,color:SUBTLE}}>close</div>
                </div>
              </div>
            );
          })}
          {!isLoading && meBelow && (
            <div style={{marginTop:4,borderTop:"1px dashed rgba(255,255,255,.12)",paddingTop:10}}>
              <div style={{background:accentA(.07),border:("1px solid "+accentA(.3)),borderRadius:12,padding:"11px 14px",display:"flex",alignItems:"center",gap:14}}>
                <div style={{fontSize:16,fontWeight:900,color:"rgba(255,255,255,.45)",minWidth:30,textAlign:"center"}}>#{myIdx + 1}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:15,fontWeight:700,color:SESS_COLOR}}>You</div>
                  <div style={{fontSize:13,color:MUTED,marginTop:2}}>{meBelow.total} sessions{meBelow.live > 0 ? " · " + meBelow.live + " live · " + meBelow.sold + " sold" : ""}</div>
                </div>
                <div style={{fontSize:18,fontWeight:700,color:meBelow.winRate!==null?"#66BB6A":"rgba(255,255,255,.3)"}}>{meBelow.winRate !== null ? meBelow.winRate+"%" : "—"}</div>
              </div>
            </div>
          )}
        </div>
      </section>
    );
  }

  // ── Panel: insights ─────────────────────────────────────────────────────────
  function renderInsights() {
    var rankRows = [];
    if (!isTeamTab && myTeams.length > 0) {
      rankRows = myTeams.map(function(team) {
        var tSess = teamSessions[team.id];
        if (!tSess || tSess.length === 0) return null;
        var rankings = computeRankings(tSess, orgUsers);
        if (rankings.length < 2) return null;
        // Rank of whoever is being viewed (yourself, or the person an admin picked)
        var myIdx = rankings.findIndex(function(r){ return String(r.userId) === String(personId); });
        if (myIdx === -1) return null;
        var me = rankings[myIdx];
        return { team: team, rank: myIdx + 1, total: rankings.length, winRate: me.winRate, totalSess: me.total };
      }).filter(Boolean);
    }
    var hasAny = stats && (stats.live > 0 || stats.allObjEntries.length > 0 || stats.topClose || rankRows.length > 0);
    return (
      <section style={Object.assign({}, PANEL, { height:panelH, maxHeight:panelMaxH, gridColumn: wide ? undefined : "1 / -1" })}>
        <PanelHead compact={compact} title="Insights" meta={isTeamTab ? scopeLabel : viewingSelf ? "Your performance" : personName}/>
        <div style={{flex:1,overflowY:"auto",padding:"16px 20px",display:wide?"block":"grid",gridTemplateColumns:"1fr 1fr",columnGap:28}}>
          {isLoading && <EmptyNote title="Loading…"/>}
          {!isLoading && !hasAny && <EmptyNote icon="📈" title="No insights yet" body="Funnel, objection and close-card insights appear once sessions are recorded."/>}

          {!isLoading && stats && stats.live > 0 && (
            <div style={{marginBottom:20}}>
              <SubHead>Live call funnel</SubHead>
              <Bar label="Contacted"      value={stats.contacted}    denom={stats.live}         color={SESS_COLOR}/>
              <Bar label="Into discovery" value={stats.pastIntro}    denom={stats.contacted}    color="#00B4FF"/>
              <Bar label="Reached close"  value={stats.reachedClose} denom={stats.pastIntro}    color="#66BB6A"/>
              <Bar label="Sold"           value={stats.sold}         denom={stats.reachedClose} color={SESS_COLOR}/>
            </div>
          )}

          {!isLoading && stats && stats.allObjEntries.length > 0 && (
            <div style={{marginBottom:20}}>
              <SubHead>Most common objections</SubHead>
              {stats.allObjEntries.slice(0, 6).map(function(e){
                return <Bar key={e.label} label={e.label} value={e.count} denom={stats.allObjEntries[0].count} color={OBJ_COLOR} showCount={true}/>;
              })}
            </div>
          )}

          {!isLoading && rankRows.length > 0 && (
            <div style={{marginBottom:20}}>
              <SubHead>{viewingSelf ? "My ranking" : personName.split(" ")[0] + "'s ranking"}</SubHead>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {rankRows.map(function(row) {
                  var rc = row.rank === 1 ? "#FFD700" : row.rank === 2 ? "#C0C0C0" : row.rank === 3 ? "#CD7F32" : SESS_COLOR;
                  return (
                    <div key={row.team.id} style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:12,padding:"11px 14px",display:"flex",alignItems:"center",gap:14}}>
                      <div style={{fontSize:20,fontWeight:900,color:rc,minWidth:34,textAlign:"center"}}>#{row.rank}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:15,fontWeight:700,color:"rgba(255,255,255,.9)"}}>{row.team.name}</div>
                        <div style={{fontSize:13,color:MUTED,marginTop:2}}>
                          {row.winRate !== null ? row.winRate + "% close" : "No live sessions"}{" · #" + row.rank + " of " + row.total}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!isLoading && stats && stats.topClose && (
            <div style={{marginBottom:20}}>
              <SubHead>Top close card</SubHead>
              <div style={{background:"rgba(102,187,106,.07)",border:"1px solid rgba(102,187,106,.22)",borderRadius:12,padding:"13px 15px",display:"flex",alignItems:"center",gap:12}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:15,color:"#fff",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{stats.topClose.title}</div>
                  <div style={{fontSize:13,color:MUTED,marginTop:3}}>Most reached close card</div>
                </div>
                <span style={{fontSize:14,color:"#66BB6A",background:"rgba(102,187,106,.12)",border:"1px solid rgba(102,187,106,.3)",padding:"4px 11px",borderRadius:99,flexShrink:0,fontWeight:700}}>{stats.topClose.count}×</span>
              </div>
            </div>
          )}
        </div>
      </section>
    );
  }

  var kpis = [
    { v: stats ? stats.total : (isLoading ? "…" : 0),                         l:"Sessions",        sub: stats ? stats.live + " live · " + stats.practice + " practice" : null, c:"#fff" },
    { v: stats && stats.winRate !== null ? stats.winRate + "%" : "—",          l:"Close rate",      sub: stats && stats.live > 0 ? stats.sold + " sold of " + stats.live + " live" : "Live calls only", c:"#66BB6A" },
    { v: stats && stats.contactRate !== null ? stats.contactRate + "%" : "—",  l:"Contact rate",    sub: stats && stats.live > 0 ? stats.contacted + " reached" : null, c:SESS_COLOR },
    { v: stats && stats.intPct !== null ? stats.intPct + "%" : "—",            l:"On intended path", sub: "Main-deck card visits", c:"#00B4FF" },
    { v: stats && stats.avgSec !== null ? fmtSec(stats.avgSec) : "—",          l:"Avg session",     sub: stats ? stats.totalObjVisits + " objection cards used" : null, c:"#FFD54F" },
  ];

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",overflow:"hidden"}}>

      {/* ── Header: greeting + scope switcher ── */}
      <div style={{flexShrink:0,display:"flex",alignItems:"center",gap:compact?12:20,padding:compact?"14px "+padX+"px 0":"18px 24px 0",flexWrap:"wrap"}}>
        <div style={{flex:1,minWidth:compact?220:260}}>
          <div style={{fontSize:compact?21:24,fontWeight:700,color:"#fff",fontFamily:"'Lora',Georgia,serif"}}>{greeting}, {firstName}</div>
          <div style={{fontSize:compact?13:14,color:MUTED,marginTop:4}}>
            {isTeamTab ? (activeSubTab === "all" ? "Overview · " : "Team view · ") + scopeLabel
              : viewingSelf ? "Here's how your calls are going." : "Viewing " + personName + "'s calls"}
          </div>
        </div>
        {(myTeams.length > 0 || isAdmin) && (
          <div role="tablist" aria-label="Dashboard scope" style={{display:"flex",alignItems:"center",background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.09)",borderRadius:12,padding:4,gap:2,flexWrap:"wrap"}}>
            {isAdmin && (
              // Admins/owners: the individual scope is a person picker (defaults to themselves)
              <label style={{position:"relative",display:"flex",alignItems:"center",borderRadius:9,background:activeSubTab==="me"?accentA(.14):"transparent",border:"1px solid "+(activeSubTab==="me"?accentA(.35):"transparent"),minHeight:compact?44:undefined}}>
                <span style={{position:"absolute",left:12,fontSize:14,pointerEvents:"none"}} aria-hidden="true">👤</span>
                <select aria-label="View an individual" value={String(personId)}
                  onChange={function(e){ pickPerson(e.target.value); }}
                  onClick={function(){ if (activeSubTab !== "me") { userPickedRef.current = true; setActiveSubTab("me"); } }}
                  style={{appearance:"none",WebkitAppearance:"none",background:"transparent",border:"none",color:activeSubTab==="me"?SESS_COLOR:"rgba(255,255,255,.7)",fontSize:14,fontWeight:activeSubTab==="me"?700:500,fontFamily:"inherit",padding:"8px 30px 8px 34px",cursor:"pointer",maxWidth:220}}>
                  <option value={String(authUser.id)} style={{color:"#000"}}>Me</option>
                  {(orgUsers || []).filter(function(u){ return String(u.id) !== String(authUser.id); })
                    .slice().sort(function(a, b){ return (a.displayName || "").localeCompare(b.displayName || ""); })
                    .map(function(u){ return <option key={u.id} value={String(u.id)} style={{color:"#000"}}>{u.displayName || u.email}</option>; })}
                </select>
                <span style={{position:"absolute",right:11,fontSize:11,color:activeSubTab==="me"?SESS_COLOR:SUBTLE,pointerEvents:"none"}} aria-hidden="true">▾</span>
              </label>
            )}
            {(isAdmin ? [] : [{ id:"me", label:"Me" }]).concat(isAdmin || myTeams.length > 1 ? [{ id:"all", label:isAdmin ? "All" : "All teams" }] : []).concat(myTeams).map(function(t){
              var on = activeSubTab === t.id;
              var cnt = t.id === "me" ? (mySessions ? mySessions.length : null)
                : t.id === "all" ? (isAdmin ? (orgSessions ? orgSessions.length : null) : (unionTeams() ? unionTeams().length : null))
                : (teamSessions[t.id] !== undefined ? teamSessions[t.id].length : null);
              return (
                <button key={t.id} role="tab" aria-selected={on} onClick={function(){ handleSubTab(t.id); }}
                  style={{background:on?accentA(.14):"transparent",border:"1px solid "+(on?accentA(.35):"transparent"),borderRadius:9,cursor:"pointer",padding:"8px 14px",minHeight:compact?44:undefined,fontSize:14,fontWeight:on?700:500,color:on?SESS_COLOR:"rgba(255,255,255,.7)",fontFamily:"inherit",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:7}}>
                  {t.label || t.name}
                  {cnt !== null && <span style={{fontSize:12,fontWeight:600,color:on?accentA(.75):SUBTLE}}>{cnt}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── KPI strip ── */}
      <div style={{flexShrink:0,display:"grid",gridTemplateColumns:"repeat(5,minmax(0,1fr))",gap:compact?10:14,padding:compact?"14px "+padX+"px":"18px 24px"}}>
        {kpis.map(function(k) {
          return (
            <div key={k.l} style={{background:"rgba(255,255,255,.045)",border:"1px solid rgba(255,255,255,.08)",borderRadius:compact?12:14,padding:compact?"10px 12px":"14px 18px",minWidth:0}}>
              <div style={{fontSize:compact?12:13,fontWeight:600,color:MUTED,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{k.l}</div>
              <div style={{fontSize:compact?22:28,fontWeight:700,color:k.c,lineHeight:1.15,marginTop:4}}>{k.v}</div>
              {k.sub && <div style={{fontSize:compact?11:12,color:SUBTLE,marginTop:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{k.sub}</div>}
            </div>
          );
        })}
      </div>

      {/* ── Panels ── */}
      <div style={{flex:1,minHeight:0,overflowY:wide?"hidden":"auto",padding:compact?"0 "+padX+"px "+padX+"px":"0 24px 24px",display:"grid",gridTemplateColumns:cols,gridAutoRows:wide?"minmax(0,1fr)":"auto",gap:compact?12:16}}>
        {isTeamTab ? renderLeaderboard() : renderRecent(false)}
        {isTeamTab ? renderRecent(true) : renderDecks()}
        {renderInsights()}
      </div>
    </div>
  );
}
