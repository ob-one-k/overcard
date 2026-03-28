import { useState, useEffect } from "react";
import { TM, SESS_COLOR, OBJ_COLOR } from "../../lib/constants";
import { apiGet } from "../../lib/api";
import { solidBtn, ghostBtn, ghostSm } from "../../lib/styles";
import { SectionHdr, StatBox, BarRow } from "../ui";
import { sessionVisits, sessionDurSec, fmtSec, fmtDate, fmtTime } from "../Sessions";

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

  var recent = sessions.slice().sort(function(a, b){ return b.startTs - a.startTs; }).slice(0, 5);
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

function OutcomeBadge({ session }) {
  var mode = session.mode || session.sessionType || "live";
  var outcome = session.outcome || "";
  var sold = session.sold || outcome === "sold";
  if (mode === "practice") return <span style={{fontSize:9,background:"rgba(0,180,255,.12)",border:"1px solid rgba(0,180,255,.25)",color:"#00B4FF",padding:"2px 7px",borderRadius:99,fontWeight:700}}>Practice</span>;
  if (outcome === "not_contacted") return <span style={{fontSize:9,background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.14)",color:"rgba(255,255,255,.4)",padding:"2px 7px",borderRadius:99,fontWeight:700}}>📵 No Contact</span>;
  if (sold) return <span style={{fontSize:9,background:"rgba(102,187,106,.15)",border:"1px solid rgba(102,187,106,.3)",color:"#66BB6A",padding:"2px 7px",borderRadius:99,fontWeight:700}}>✓ Sold</span>;
  if (outcome === "booked") return <span style={{fontSize:9,background:"rgba(255,213,79,.12)",border:"1px solid rgba(255,213,79,.25)",color:"#FFD54F",padding:"2px 7px",borderRadius:99,fontWeight:700}}>Booked</span>;
  if (outcome === "abandoned") return <span style={{fontSize:9,background:"rgba(239,83,80,.1)",border:"1px solid rgba(239,83,80,.2)",color:"#EF5350",padding:"2px 7px",borderRadius:99,fontWeight:700}}>Abandoned</span>;
  return <span style={{fontSize:9,background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.12)",color:"rgba(255,255,255,.5)",padding:"2px 7px",borderRadius:99,fontWeight:700}}>Live</span>;
}

// ─── HOME DESKTOP ─────────────────────────────────────────────────────────────
// Two-column dashboard: left (recent + decks) | right (funnel + analytics)
// Mirrors HomeTab data/state — no hooks extracted to avoid conditional-hooks issues
export function HomeDesktop({ authUser, decks, orgTeams, orgUsers, onSwitchDeckAndPlay }) {
  var [mySessions,   setMySessions]   = useState(null);
  var [teamSessions, setTeamSessions] = useState({});
  var [activeSubTab, setActiveSubTab] = useState("me");
  var [loadingTeam,  setLoadingTeam]  = useState(null);

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

  useEffect(function() {
    myTeams.forEach(function(team) { loadTeamSessions(team.id); });
  }, [myTeams.length]); // eslint-disable-line react-hooks/exhaustive-deps

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

  function handleSubTab(tabId) {
    setActiveSubTab(tabId);
    if (tabId !== "me") loadTeamSessions(tabId);
  }

  var currentSessions;
  if (activeSubTab === "me") {
    currentSessions = mySessions;
  } else {
    var loaded = teamSessions[activeSubTab];
    currentSessions = (loaded === undefined) ? null : loaded;
  }

  var isLoadingTeam = activeSubTab !== "me" && loadingTeam === activeSubTab;
  var isLoading = currentSessions === null || isLoadingTeam;
  var stats = (!isLoading && currentSessions && currentSessions.length > 0)
    ? computeStats(currentSessions, decks)
    : null;

  var isTeamTab = activeSubTab !== "me";

  var hr = new Date().getHours();
  var greeting = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
  var firstName = (authUser.displayName || "").split(" ")[0] || authUser.displayName;

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
  var decksWithSessions = stats ? stats.deckStats.sort(function(a, b){ return b.total - a.total; }) : [];

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",overflow:"hidden"}}>

      {/* ── Header row: greeting + sub-tabs ── */}
      <div style={{flexShrink:0,borderBottom:"1px solid rgba(255,255,255,.06)",background:"rgba(8,25,55,.3)"}}>
        <div style={{display:"flex",alignItems:"center",gap:0,padding:"0 24px",minHeight:52}}>
          {/* Greeting */}
          <div style={{flex:1,display:"flex",alignItems:"center",gap:0}}>
            <span style={{fontSize:16,fontWeight:700,color:"#fff",fontFamily:"'Lora',Georgia,serif",marginRight:12}}>{greeting}, {firstName}</span>
            {stats && (
              <span style={{fontSize:11,color:"rgba(255,255,255,.32)"}}>
                {stats.total} session{stats.total!==1?"s":""}
                {stats.winRate !== null ? " · " + stats.winRate + "% close" : ""}
                {stats.intPct !== null ? " · " + stats.intPct + "% on-path" : ""}
              </span>
            )}
          </div>
          {/* Sub-tabs */}
          {myTeams.length > 0 && (
            <div style={{display:"flex"}}>
              {[{ id:"me", label:"Me" }].concat(myTeams).map(function(t){
                var on = activeSubTab === t.id;
                var cnt = t.id === "me" ? null
                  : (teamSessions[t.id] !== undefined ? teamSessions[t.id].length : null);
                return (
                  <button key={t.id} onClick={function(){ handleSubTab(t.id); }}
                    style={{background:"none",border:"none",borderBottom:"2px solid "+(on?SESS_COLOR:"transparent"),cursor:"pointer",padding:"14px 14px",fontSize:11,fontWeight:on?700:500,color:on?SESS_COLOR:"rgba(255,255,255,.35)",fontFamily:"inherit",whiteSpace:"nowrap",transition:"color .15s"}}>
                    {t.label || t.name}
                    {cnt !== null && <span style={{marginLeft:4,fontSize:9,color:"rgba(255,255,255,.2)"}}>{cnt}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Stat strip ── */}
      {stats && (
        <div style={{flexShrink:0,display:"flex",borderBottom:"1px solid rgba(255,255,255,.05)",background:"rgba(0,0,0,.18)"}}>
          {[
            {v:stats.total,                                          l:"Sessions",   c:"rgba(255,255,255,.8)"},
            {v:stats.winRate !== null ? stats.winRate+"%" : "—",     l:"Close Rate", c:"#66BB6A"},
            {v:stats.intPct  !== null ? stats.intPct+"%"  : "—",     l:"On-Path",    c:"#00B4FF"},
            {v:stats.avgSec  !== null ? fmtSec(stats.avgSec) : "—",  l:"Avg Time",   c:"rgba(255,213,79,.85)"},
          ].map(function(st, i) {
            return (
              <div key={i} style={{flex:1,padding:"9px 0 8px",textAlign:"center",borderRight:i<3?"1px solid rgba(255,255,255,.05)":"none"}}>
                <div style={{fontSize:17,fontWeight:700,color:st.c,lineHeight:1}}>{st.v}</div>
                <div style={{fontSize:9,color:"rgba(255,255,255,.28)",textTransform:"uppercase",letterSpacing:.7,marginTop:3}}>{st.l}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Two-column body ── */}
      <div style={{flex:1,display:"flex",overflow:"hidden",minHeight:0}}>

        {/* ── Left column: recent + decks ── */}
        <div style={{flex:1,overflowY:"auto",padding:"18px 20px",borderRight:"1px solid rgba(255,255,255,.05)"}}>

          {isLoading && (
            <div style={{display:"flex",alignItems:"center",justifyContent:"center",padding:"48px 0",gap:10,color:"rgba(255,255,255,.3)",fontSize:13}}>
              <span style={{opacity:.4}}>⏳</span> Loading sessions…
            </div>
          )}

          {!isLoading && (!currentSessions || currentSessions.length === 0) && (
            <div style={{textAlign:"center",padding:"48px 0",color:"rgba(255,255,255,.3)"}}>
              <div style={{fontSize:32,marginBottom:10}}>📊</div>
              <div style={{fontSize:14,fontWeight:700,marginBottom:6}}>No sessions yet</div>
              <div style={{fontSize:12,lineHeight:1.6}}>
                {isTeamTab ? "No sessions for this team yet." : "Select a deck and run your first session."}
              </div>
            </div>
          )}

          {!isLoading && stats && (
            <div>
              {/* Recent Sessions */}
              {!isTeamTab && stats.recent.length > 0 && (
                <div style={{marginBottom:20}}>
                  <div style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,.35)",letterSpacing:1,textTransform:"uppercase",marginBottom:10}}>Recent Sessions</div>
                  <div style={{display:"flex",flexDirection:"column",gap:5}}>
                    {stats.recent.map(function(s){
                      var modeIcon = (s.mode||s.sessionType||"live") === "live" ? "📞" : "🎯";
                      var dColor = s.deckColor || "#F5A623";
                      return (
                        <div key={s.id} style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.07)",borderRadius:12,padding:"9px 13px",display:"flex",alignItems:"center",gap:10}}>
                          <span style={{fontSize:14,flexShrink:0}}>{modeIcon}</span>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:12,fontWeight:600,color:"rgba(255,255,255,.85)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name}</div>
                            <div style={{fontSize:9,color:"rgba(255,255,255,.28)",marginTop:2,display:"flex",gap:5,alignItems:"center"}}>
                              <span style={{width:6,height:6,borderRadius:"50%",background:dColor,display:"inline-block",flexShrink:0}}/>
                              {s.deckName || "—"}
                              <span style={{color:"rgba(255,255,255,.18)"}}>·</span>
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

              {/* Deck Quick-Launch */}
              {!isTeamTab && sortedDecks.length > 0 && (
                <div style={{marginBottom:20}}>
                  <div style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,.35)",letterSpacing:1,textTransform:"uppercase",marginBottom:10}}>Decks</div>
                  <div style={{display:"flex",flexDirection:"column",gap:7}}>
                    {sortedDecks.slice(0, 5).map(function(d) {
                      var deckStat = decksWithSessions.find(function(ds){ return ds.deckId === d.id; });
                      var dColor   = d.color || "#F5A623";
                      var wr       = deckStat && deckStat.live > 0 ? Math.round(deckStat.sold / deckStat.live * 100) : null;
                      return (
                        <div key={d.id} style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.07)",borderLeft:"3px solid "+dColor,borderRadius:"0 14px 14px 0",padding:"11px 14px",display:"flex",alignItems:"center",gap:12}}>
                          <div style={{width:34,height:34,borderRadius:9,background:dColor+"22",border:"1.5px solid "+dColor+"44",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,flexShrink:0}}>{d.icon||"💼"}</div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:13,fontWeight:700,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.name}</div>
                            <div style={{fontSize:10,color:"rgba(255,255,255,.3)",marginTop:2}}>
                              {deckStat ? deckStat.total+" session"+(deckStat.total!==1?"s":"") : "No sessions"}
                              {wr !== null ? " · "+wr+"% close" : ""}
                            </div>
                          </div>
                          {onSwitchDeckAndPlay && (
                            <button onClick={function(){ onSwitchDeckAndPlay(d.id); }}
                              style={{background:"rgba(168,255,62,.1)",border:"1px solid rgba(168,255,62,.25)",borderRadius:10,padding:"7px 13px",cursor:"pointer",fontSize:11,color:"#A8FF3E",fontFamily:"inherit",fontWeight:700,flexShrink:0}}>
                              ▶ Play
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Team Leaderboard */}
              {isTeamTab && currentSessions && currentSessions.length > 0 && (function() {
                var rankings = computeRankings(currentSessions, orgUsers);
                if (rankings.length === 0) return null;
                return (
                  <div style={{marginBottom:20}}>
                    <div style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,.35)",letterSpacing:1,textTransform:"uppercase",marginBottom:10}}>Team Leaderboard</div>
                    <div style={{display:"flex",flexDirection:"column",gap:5}}>
                      {rankings.map(function(entry, idx) {
                        var isMe = String(entry.userId) === String(authUser.id);
                        var rn = idx + 1;
                        var rc = rn === 1 ? "#FFD700" : rn === 2 ? "#C0C0C0" : rn === 3 ? "#CD7F32" : "rgba(255,255,255,.3)";
                        return (
                          <div key={entry.userId} style={{background:isMe?"rgba(168,255,62,.07)":"rgba(255,255,255,.04)",border:"1px solid "+(isMe?"rgba(168,255,62,.3)":"rgba(255,255,255,.07)"),borderRadius:12,padding:"9px 13px",display:"flex",alignItems:"center",gap:10}}>
                            <div style={{fontSize:13,fontWeight:900,color:rc,minWidth:22,textAlign:"center"}}>#{rn}</div>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontSize:12,fontWeight:isMe?700:600,color:isMe?SESS_COLOR:"rgba(255,255,255,.8)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                {entry.displayName}{isMe ? " (you)" : ""}
                              </div>
                              <div style={{fontSize:9,color:"rgba(255,255,255,.35)",marginTop:1}}>
                                {entry.total} session{entry.total!==1?"s":""}
                                {entry.live > 0 ? " · "+entry.live+" live" : ""}
                              </div>
                            </div>
                            <div style={{fontSize:12,fontWeight:700,color:entry.winRate!==null?"#66BB6A":"rgba(255,255,255,.25)"}}>
                              {entry.winRate !== null ? entry.winRate+"%" : "—"}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {/* ── Right column: analytics ── */}
        <div style={{width:340,minWidth:340,overflowY:"auto",padding:"18px 18px",flexShrink:0}}>

          {!isLoading && stats && (
            <div>
              {/* Live Funnel */}
              {stats.live > 0 && (
                <div style={{marginBottom:20}}>
                  <div style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,.35)",letterSpacing:1,textTransform:"uppercase",marginBottom:10}}>Live Funnel</div>
                  <div style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:14,padding:"13px 15px"}}>
                    <BarRow label="Contacted"      value={stats.contacted}     denom={stats.live}          color={SESS_COLOR}/>
                    <BarRow label="Into discovery" value={stats.pastIntro}     denom={stats.contacted}     color="#00B4FF"/>
                    <BarRow label="Reached close"  value={stats.reachedClose}  denom={stats.pastIntro}     color="#66BB6A"/>
                    <BarRow label="Sold"           value={stats.sold}          denom={stats.reachedClose}  color="#A8FF3E"/>
                  </div>
                </div>
              )}

              {/* Objection Breakdown */}
              {stats.allObjEntries.length > 0 && (
                <div style={{marginBottom:20}}>
                  <div style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,.35)",letterSpacing:1,textTransform:"uppercase",marginBottom:10}}>Objection Usage</div>
                  <div style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:14,padding:"13px 15px"}}>
                    {stats.allObjEntries.slice(0, 6).map(function(e){
                      return <BarRow key={e.label} label={e.label} value={e.count} denom={stats.allObjEntries[0].count} color={OBJ_COLOR}/>;
                    })}
                  </div>
                </div>
              )}

              {/* My Ranking — Me tab only */}
              {!isTeamTab && myTeams.length > 0 && (function() {
                var rankRows = myTeams.map(function(team) {
                  var tSess = teamSessions[team.id];
                  if (!tSess || tSess.length === 0) return null;
                  var rankings = computeRankings(tSess, orgUsers);
                  if (rankings.length < 2) return null;
                  var myIdx = rankings.findIndex(function(r){ return String(r.userId) === String(authUser.id); });
                  if (myIdx === -1) return null;
                  var me = rankings[myIdx];
                  return { team: team, rank: myIdx + 1, total: rankings.length, winRate: me.winRate, totalSess: me.total };
                }).filter(Boolean);
                if (rankRows.length === 0) return null;
                return (
                  <div style={{marginBottom:20}}>
                    <div style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,.35)",letterSpacing:1,textTransform:"uppercase",marginBottom:10}}>My Ranking</div>
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      {rankRows.map(function(row) {
                        var rc = row.rank === 1 ? "#FFD700" : row.rank === 2 ? "#C0C0C0" : row.rank === 3 ? "#CD7F32" : SESS_COLOR;
                        return (
                          <div key={row.team.id} style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:12,padding:"11px 14px",display:"flex",alignItems:"center",gap:12}}>
                            <div style={{fontSize:18,fontWeight:900,color:rc,minWidth:28,textAlign:"center"}}>#{row.rank}</div>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,.85)"}}>{row.team.name}</div>
                              <div style={{fontSize:10,color:"rgba(255,255,255,.35)",marginTop:2}}>
                                {row.winRate !== null ? row.winRate+"% close" : "No live sessions"}
                                {" · #"+row.rank+" of "+row.total}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Top Close Card */}
              {stats.topClose && (
                <div style={{marginBottom:20}}>
                  <div style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,.35)",letterSpacing:1,textTransform:"uppercase",marginBottom:10}}>Top Close Card</div>
                  <div style={{background:"rgba(102,187,106,.07)",border:"1px solid rgba(102,187,106,.2)",borderRadius:14,padding:"13px 15px",display:"flex",alignItems:"center",gap:12}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,color:"#fff",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{stats.topClose.title}</div>
                      <div style={{fontSize:10,color:"rgba(255,255,255,.35)",marginTop:3}}>Most reached close card</div>
                    </div>
                    <span style={{fontSize:12,color:"#66BB6A",background:"rgba(102,187,106,.12)",border:"1px solid rgba(102,187,106,.25)",padding:"4px 10px",borderRadius:99,flexShrink:0,fontWeight:700}}>{stats.topClose.count}×</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {!isLoading && !stats && !isLoading && (
            <div style={{textAlign:"center",padding:"32px 0",color:"rgba(255,255,255,.2)",fontSize:12}}>
              Analytics will appear once sessions are recorded.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
