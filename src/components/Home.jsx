import { useState, useEffect } from "react";
import { TM, SESS_COLOR, OBJ_COLOR } from "../lib/constants";
import { apiGet } from "../lib/api";
import { SectionHdr, StatBox, BarRow } from "./ui";
import { sessionVisits, sessionDurSec, fmtSec, fmtDate } from "./Sessions";

// ─── STATS COMPUTATION ────────────────────────────────────────────────────────
function computeStats(sessions, decks) {
  var total = sessions.length;
  var live     = sessions.filter(function(s){ return (s.mode||s.sessionType||"live") === "live"; });
  var practice = sessions.filter(function(s){ return (s.mode||s.sessionType||"live") === "practice"; });
  var sold     = live.filter(function(s){ return s.sold || s.outcome === "sold"; });
  var winRate  = live.length > 0 ? Math.round(sold.length / live.length * 100) : null;

  // Flatten all visit events across sessions
  var allVisits = [];
  sessions.forEach(function(s){ allVisits = allVisits.concat(sessionVisits(s)); });
  var mainVisits = allVisits.filter(function(v){ return !v.isObjCard; });
  var intPct = mainVisits.length > 0
    ? Math.round(mainVisits.filter(function(v){ return v.intendedPath; }).length / mainVisits.length * 100)
    : null;

  // Average duration
  var completedSess = sessions.filter(function(s){ return s.endTs; });
  var avgSec = completedSess.length > 0
    ? Math.round(completedSess.reduce(function(sum, s){ return sum + (sessionDurSec(s) || 0); }, 0) / completedSess.length)
    : null;

  // Most used close card
  var closeCounts = {};
  sessions.forEach(function(s){
    sessionVisits(s).filter(function(v){ return !v.isObjCard && v.cardType === "close"; }).forEach(function(v){
      if (!closeCounts[v.cardId]) closeCounts[v.cardId] = { title: v.cardTitle, count: 0 };
      closeCounts[v.cardId].count++;
    });
  });
  var topClose = Object.values(closeCounts).sort(function(a, b){ return b.count - a.count; })[0] || null;

  // Objection stack usage
  var objCounts = {};
  sessions.forEach(function(s){
    sessionVisits(s).filter(function(v){ return v.isObjCard && v.stackLabel; }).forEach(function(v){
      objCounts[v.stackLabel] = (objCounts[v.stackLabel] || 0) + 1;
    });
  });
  var topObjEntries = Object.entries(objCounts).sort(function(a, b){ return b[1] - a[1]; });
  var topObj    = topObjEntries.length > 0 ? { label: topObjEntries[0][0], count: topObjEntries[0][1] } : null;
  var allObjEntries = topObjEntries.map(function(e){ return { label: e[0], count: e[1] }; });

  // Per-deck stats
  var deckMap = {};
  if (decks) { decks.forEach(function(d){ deckMap[d.id] = d; }); }
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

  // Contact rate (live only — not_contacted means no one answered)
  var notContacted  = live.filter(function(s){ return s.outcome === "not_contacted"; }).length;
  var contacted     = live.length - notContacted;
  var contactRate   = live.length > 0 ? Math.round(contacted / live.length * 100) : null;

  // Live funnel (contacted is the first stage, replacing "reached intro")
  var pastIntro    = live.filter(function(s){ return sessionVisits(s).some(function(v){ return v.cardType==="discovery" && !v.isObjCard; }); }).length;
  var reachedClose = live.filter(function(s){ return sessionVisits(s).some(function(v){ return v.cardType==="close" && !v.isObjCard; }); }).length;

  // Recent sessions (last 5)
  var recent = sessions.slice().sort(function(a, b){ return b.startTs - a.startTs; }).slice(0, 5);

  // Total objection visits
  var totalObjVisits = allVisits.filter(function(v){ return v.isObjCard; }).length;

  return {
    total, live: live.length, practice: practice.length,
    sold: sold.length, winRate,
    intPct, avgSec,
    notContacted, contacted, contactRate,
    topClose, topObj, allObjEntries,
    deckStats: Object.values(deckStatsMap),
    pastIntro, reachedClose,
    totalObjVisits,
    recent,
  };
}

// ─── OUTCOME BADGE ────────────────────────────────────────────────────────────
function OutcomeBadge({ session }) {
  var mode = session.mode || session.sessionType || "live";
  var outcome = session.outcome || "";
  var sold = session.sold || outcome === "sold";
  if (mode === "practice") {
    return <span style={{fontSize:9,background:"rgba(0,180,255,.12)",border:"1px solid rgba(0,180,255,.25)",color:"#00B4FF",padding:"2px 7px",borderRadius:99,fontWeight:700}}>Practice</span>;
  }
  if (outcome === "not_contacted") {
    return <span style={{fontSize:9,background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.14)",color:"rgba(255,255,255,.4)",padding:"2px 7px",borderRadius:99,fontWeight:700}}>📵 No Contact</span>;
  }
  if (sold) {
    return <span style={{fontSize:9,background:"rgba(102,187,106,.15)",border:"1px solid rgba(102,187,106,.3)",color:"#66BB6A",padding:"2px 7px",borderRadius:99,fontWeight:700}}>✓ Sold</span>;
  }
  if (outcome === "booked") {
    return <span style={{fontSize:9,background:"rgba(255,213,79,.12)",border:"1px solid rgba(255,213,79,.25)",color:"#FFD54F",padding:"2px 7px",borderRadius:99,fontWeight:700}}>Booked</span>;
  }
  if (outcome === "abandoned") {
    return <span style={{fontSize:9,background:"rgba(239,83,80,.1)",border:"1px solid rgba(239,83,80,.2)",color:"#EF5350",padding:"2px 7px",borderRadius:99,fontWeight:700}}>Abandoned</span>;
  }
  return <span style={{fontSize:9,background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.12)",color:"rgba(255,255,255,.5)",padding:"2px 7px",borderRadius:99,fontWeight:700}}>Live</span>;
}

// ─── HOME TAB ─────────────────────────────────────────────────────────────────
export function HomeTab({ authUser, decks, orgTeams, onSwitchDeckAndPlay }) {
  var [mySessions,   setMySessions]   = useState(null);
  var [teamSessions, setTeamSessions] = useState({});
  var [activeSubTab, setActiveSubTab] = useState("me");
  var [loadingTeam,  setLoadingTeam]  = useState(null);
  var [showAllDecks, setShowAllDecks] = useState(false);

  // Build teams list — explicit priority chain to avoid [] truthy bug:
  // 1. Admins: use orgTeams (already loaded by App, full roster)
  // 2. Users with teams array from new backend: use it
  // 3. Users with only teamId/teamName (old backend or fallback): construct from that
  var myTeams;
  if (authUser.role === "admin" && orgTeams && orgTeams.length > 0) {
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

  function loadTeamSessions(teamId) {
    // Non-admins can't scope by team — mark as null to signal "use mySessions"
    if (authUser.role !== "admin") {
      setTeamSessions(function(prev){ return Object.assign({}, prev, { [teamId]: null }); });
      return;
    }
    if (teamSessions[teamId] !== undefined) return; // already loaded or loading
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

  function handleSubTab(tabId) {
    setActiveSubTab(tabId);
    if (tabId !== "me") loadTeamSessions(tabId);
  }

  // Resolve sessions for current sub-tab
  var currentSessions;
  if (activeSubTab === "me") {
    currentSessions = mySessions;
  } else {
    var loaded = teamSessions[activeSubTab];
    currentSessions = (loaded === undefined || loaded === null) ? mySessions : loaded;
  }

  var isLoadingTeam = activeSubTab !== "me" && loadingTeam === activeSubTab;
  var isLoading = currentSessions === null || isLoadingTeam;
  var stats = (!isLoading && currentSessions && currentSessions.length > 0)
    ? computeStats(currentSessions, decks)
    : null;

  var hr = new Date().getHours();
  var greeting = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
  var firstName = (authUser.displayName || "").split(" ")[0] || authUser.displayName;

  // Deck cards to show: decks with sessions + decks without (used by Deck Performance section)
  var decksWithSessions  = stats ? stats.deckStats.sort(function(a, b){ return b.total - a.total; }) : [];
  var deckIdsWithSessions = decksWithSessions.map(function(ds){ return ds.deckId; });
  var decksWithoutSessions = (decks || []).filter(function(d){ return !deckIdsWithSessions.includes(d.id); });

  // Recency-sorted deck selector (always uses user's own sessions for recency)
  var deckLastUsed = {};
  (mySessions || []).forEach(function(s) {
    if (!deckLastUsed[s.deckId] || s.startTs > deckLastUsed[s.deckId]) {
      deckLastUsed[s.deckId] = s.startTs;
    }
  });
  var sortedDecks = (decks || []).slice().sort(function(a, b) {
    var aTs = deckLastUsed[a.id] || 0;
    var bTs = deckLastUsed[b.id] || 0;
    if (aTs !== bTs) return bTs - aTs;
    return (a.name || "").localeCompare(b.name || "");
  });
  var visibleDecks = showAllDecks ? sortedDecks : sortedDecks.slice(0, 3);
  var hiddenCount  = Math.max(0, sortedDecks.length - 3);

  var isTeamTab = activeSubTab !== "me";
  var activeTeam = isTeamTab ? myTeams.find(function(t){ return t.id === activeSubTab; }) : null;
  var isNonAdminTeamTab = isTeamTab && authUser.role !== "admin";

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>

      {/* ── Header ── */}
      <div style={{padding:"14px 16px 12px",flexShrink:0,background:"rgba(8,25,55,.3)",borderBottom:"1px solid rgba(255,255,255,.06)"}}>
        <div style={{fontSize:18,fontWeight:700,color:"#fff",marginBottom:3,fontFamily:"'Lora',Georgia,serif"}}>{greeting}, {firstName}</div>
        {stats ? (
          <div style={{fontSize:12,color:"rgba(255,255,255,.4)"}}>
            {stats.total} session{stats.total!==1?"s":""} total
            {stats.winRate !== null ? " · " + stats.winRate + "% close rate" : ""}
            {stats.intPct !== null ? " · " + stats.intPct + "% on-path" : ""}
          </div>
        ) : (
          <div style={{fontSize:12,color:"rgba(255,255,255,.3)"}}>Your performance overview</div>
        )}
      </div>

      {/* ── Sub-tabs (only if user has teams) ── */}
      {myTeams.length > 0 && (
        <div style={{flexShrink:0,background:"rgba(4,12,32,.6)",borderBottom:"1px solid rgba(255,255,255,.06)",display:"flex",overflowX:"auto",paddingLeft:4}}>
          {[{ id:"me", label:"Me" }].concat(myTeams).map(function(tab){
            var on = activeSubTab === tab.id;
            var sessCount = tab.id === "me" ? null
              : (teamSessions[tab.id] !== undefined && teamSessions[tab.id] !== null ? teamSessions[tab.id].length : null);
            return (
              <button key={tab.id} onClick={function(){ handleSubTab(tab.id); }}
                style={{background:"none",border:"none",borderBottom:"2px solid "+(on?SESS_COLOR:"transparent"),cursor:"pointer",padding:"10px 14px",fontSize:11,fontWeight:700,color:on?SESS_COLOR:"rgba(255,255,255,.35)",fontFamily:"inherit",whiteSpace:"nowrap",transition:"color .15s",letterSpacing:.3,flexShrink:0}}>
                {tab.label}
                {sessCount !== null && authUser.role === "admin" && (
                  <span style={{marginLeft:4,fontSize:9,color:"rgba(255,255,255,.25)",fontWeight:400}}>({sessCount})</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Scrollable content ── */}
      <div style={{flex:1,overflowY:"auto"}}>
        <div style={{padding:"14px 14px 0"}}>

          {/* Team context banner for non-admin viewing team tab */}
          {isNonAdminTeamTab && activeTeam && (
            <div style={{background:"rgba(0,180,255,.07)",border:"1px solid rgba(0,180,255,.18)",borderRadius:12,padding:"9px 13px",marginBottom:12,display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:14}}>🏷️</span>
              <div>
                <div style={{fontSize:11,fontWeight:700,color:"#00B4FF"}}>Your stats for {activeTeam.name}</div>
                <div style={{fontSize:9,color:"rgba(255,255,255,.3)"}}>Showing your personal performance in team context</div>
              </div>
            </div>
          )}

          {/* ── Loading ── */}
          {isLoading && (
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"48px 0",gap:10}}>
              <div style={{fontSize:26,opacity:.35}}>⏳</div>
              <div style={{fontSize:12,color:"rgba(255,255,255,.3)"}}>Loading sessions…</div>
            </div>
          )}

          {/* ── Empty state (no sessions) ── */}
          {!isLoading && (!currentSessions || currentSessions.length === 0) && (
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:isTeamTab?"44px 16px":"20px 16px",gap:10,textAlign:"center"}}>
              <div style={{fontSize:36}}>📊</div>
              <div style={{fontSize:14,fontWeight:700,color:"rgba(255,255,255,.6)"}}>No sessions yet</div>
              <div style={{fontSize:12,color:"rgba(255,255,255,.3)",lineHeight:1.6,maxWidth:240}}>
                {isTeamTab && authUser.role === "admin"
                  ? "No sessions recorded for this team yet."
                  : "Select a deck below and run your first session."}
              </div>
            </div>
          )}

          {/* ── Stats content ── */}
          {!isLoading && stats && (
            <div>
              {/* Key Metrics */}
              <SectionHdr>Key Metrics</SectionHdr>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
                <StatBox value={stats.total} label="Sessions" color={SESS_COLOR}/>
                <StatBox value={stats.winRate !== null ? stats.winRate+"%" : "—"} label="Close rate" color="#66BB6A"/>
                <StatBox value={stats.intPct !== null ? stats.intPct+"%" : "—"} label="On-path" color="#00B4FF"/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
                <StatBox value={stats.live} label="Live" color={SESS_COLOR}/>
                <StatBox value={stats.practice} label="Practice" color="#00B4FF"/>
                <StatBox value={stats.avgSec !== null ? fmtSec(stats.avgSec) : "—"} label="Avg time" color="#FFD54F"/>
              </div>
              {stats.live > 0 && (
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:18}}>
                  <StatBox value={stats.contactRate !== null ? stats.contactRate+"%" : "—"} label="Contact rate" color="#FFD54F"/>
                  <StatBox value={stats.notContacted} label="No contact" color="rgba(255,255,255,.4)"/>
                </div>
              )}

              {/* Deck Performance — recency-sorted, top 3 visible, collapsible */}
              {!isTeamTab && sortedDecks.length > 0 && (
                <div style={{marginBottom:18}}>
                  <SectionHdr>Deck Performance</SectionHdr>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {visibleDecks.map(function(d) {
                      var deckStat  = decksWithSessions.find(function(ds){ return ds.deckId === d.id; });
                      var dColor    = d.color || "#F5A623";
                      var dIcon     = d.icon  || "💼";
                      var deckWinRate = deckStat && deckStat.live > 0 ? Math.round(deckStat.sold / deckStat.live * 100) : null;
                      return (
                        <div key={d.id} style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderLeft:"3px solid "+dColor,borderRadius:"0 14px 14px 0",padding:"12px 14px",display:"flex",alignItems:"center",gap:12}}>
                          <div style={{width:34,height:34,borderRadius:9,background:dColor+"22",border:"1.5px solid "+dColor+"44",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{dIcon}</div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:13,fontWeight:700,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:4}}>{d.name}</div>
                            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                              {deckStat ? (
                                <>
                                  <span style={{fontSize:10,color:"rgba(255,255,255,.4)"}}>{deckStat.total} session{deckStat.total!==1?"s":""}</span>
                                  {deckStat.live > 0 && <span style={{fontSize:10,color:"rgba(168,255,62,.65)"}}>{deckWinRate}% close</span>}
                                  {deckStat.practice > 0 && <span style={{fontSize:10,color:"rgba(0,180,255,.55)"}}>{deckStat.practice} practice</span>}
                                </>
                              ) : (
                                <span style={{fontSize:10,color:"rgba(255,255,255,.25)"}}>No sessions yet</span>
                              )}
                            </div>
                          </div>
                          {onSwitchDeckAndPlay && (
                            <button onClick={function(){ onSwitchDeckAndPlay(d.id); }}
                              style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.12)",borderRadius:10,padding:"8px 11px",cursor:"pointer",fontSize:11,color:"rgba(255,255,255,.7)",fontFamily:"inherit",fontWeight:700,flexShrink:0}}>
                              Play →
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {!showAllDecks && hiddenCount > 0 && (
                    <button onClick={function(){ setShowAllDecks(true); }}
                      style={{marginTop:8,width:"100%",background:"none",border:"1px solid rgba(255,255,255,.1)",borderRadius:10,padding:"8px 12px",cursor:"pointer",fontFamily:"inherit",fontSize:11,color:"rgba(255,255,255,.4)",textAlign:"center"}}>
                      Show {hiddenCount} more deck{hiddenCount!==1?"s":""} ↓
                    </button>
                  )}
                  {showAllDecks && hiddenCount > 0 && (
                    <button onClick={function(){ setShowAllDecks(false); }}
                      style={{marginTop:8,width:"100%",background:"none",border:"1px solid rgba(255,255,255,.1)",borderRadius:10,padding:"8px 12px",cursor:"pointer",fontFamily:"inherit",fontSize:11,color:"rgba(255,255,255,.4)",textAlign:"center"}}>
                      Show less ↑
                    </button>
                  )}
                </div>
              )}

              {/* Performance Highlights */}
              {(stats.topClose || stats.topObj) && (
                <div style={{marginBottom:18}}>
                  <SectionHdr>Performance Highlights</SectionHdr>
                  <div style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:14,padding:"14px 15px",display:"flex",flexDirection:"column",gap:0}}>
                    {stats.topClose && (
                      <div style={{marginBottom:stats.topObj?12:0}}>
                        <div style={{fontSize:9,fontWeight:700,color:"rgba(102,187,106,.7)",textTransform:"uppercase",letterSpacing:.8,marginBottom:5}}>🤝 Most Used Close Card</div>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <span style={{fontSize:13,color:"#fff",fontWeight:600,flex:1,marginRight:8}}>{stats.topClose.title}</span>
                          <span style={{fontSize:11,color:"#66BB6A",background:"rgba(102,187,106,.12)",border:"1px solid rgba(102,187,106,.25)",padding:"3px 9px",borderRadius:99,flexShrink:0,fontWeight:700}}>{stats.topClose.count}x</span>
                        </div>
                      </div>
                    )}
                    {stats.topClose && stats.topObj && <div style={{height:1,background:"rgba(255,255,255,.07)",margin:"0 0 12px"}}/>}
                    {stats.topObj && (
                      <div style={{marginBottom:stats.totalObjVisits>0?12:0}}>
                        <div style={{fontSize:9,fontWeight:700,color:"rgba(239,83,80,.7)",textTransform:"uppercase",letterSpacing:.8,marginBottom:5}}>🛡️ Most Handled Objection</div>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <span style={{fontSize:13,color:"#fff",fontWeight:600,flex:1,marginRight:8}}>{stats.topObj.label}</span>
                          <span style={{fontSize:11,color:OBJ_COLOR,background:"rgba(239,83,80,.12)",border:"1px solid rgba(239,83,80,.25)",padding:"3px 9px",borderRadius:99,flexShrink:0,fontWeight:700}}>{stats.topObj.count}x</span>
                        </div>
                      </div>
                    )}
                    {stats.totalObjVisits > 0 && stats.topObj && (
                      <div>
                        <div style={{height:1,background:"rgba(255,255,255,.07)",margin:"0 0 12px"}}/>
                        <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,.3)",textTransform:"uppercase",letterSpacing:.8,marginBottom:5}}>🛡️ All Objection Stacks</div>
                        {stats.allObjEntries.map(function(e){
                          return (
                            <BarRow key={e.label} label={e.label} value={e.count} denom={stats.allObjEntries[0].count} color={OBJ_COLOR}/>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Live Funnel */}
              {stats.live > 0 && (
                <div style={{marginBottom:18}}>
                  <SectionHdr>Live Funnel</SectionHdr>
                  <div style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:14,padding:"14px 15px"}}>
                    <BarRow label="Contacted"      value={stats.contacted}     denom={stats.live}          color={SESS_COLOR}/>
                    <BarRow label="Into discovery" value={stats.pastIntro}     denom={stats.contacted}     color="#00B4FF"/>
                    <BarRow label="Reached close"  value={stats.reachedClose}  denom={stats.pastIntro}     color="#66BB6A"/>
                    <BarRow label="Sold"           value={stats.sold}          denom={stats.reachedClose}  color="#A8FF3E"/>
                  </div>
                </div>
              )}


              {/* Recent Sessions */}
              {stats.recent.length > 0 && (
                <div style={{marginBottom:18}}>
                  <SectionHdr>Recent Sessions</SectionHdr>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {stats.recent.map(function(s){
                      var mode = s.mode || s.sessionType || "live";
                      var modeIcon = mode === "live" ? "📞" : "🎯";
                      var deckObj = decks ? decks.find(function(d){ return d.id === s.deckId; }) : null;
                      var dColor = s.deckColor || (deckObj && deckObj.color) || "#F5A623";
                      return (
                        <div key={s.id} style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.07)",borderRadius:12,padding:"10px 13px",display:"flex",alignItems:"center",gap:10}}>
                          <span style={{fontSize:15,flexShrink:0}}>{modeIcon}</span>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:12,fontWeight:600,color:"rgba(255,255,255,.85)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name}</div>
                            <div style={{fontSize:9,color:"rgba(255,255,255,.3)",marginTop:2,display:"flex",gap:5,alignItems:"center"}}>
                              <span style={{width:6,height:6,borderRadius:"50%",background:dColor,display:"inline-block",flexShrink:0}}/>
                              {s.deckName || "—"}
                              <span style={{color:"rgba(255,255,255,.2)"}}>·</span>
                              {fmtDate(s.startTs)}
                            </div>
                          </div>
                          <OutcomeBadge session={s}/>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div style={{height:24}}/>
      </div>
    </div>
  );
}
