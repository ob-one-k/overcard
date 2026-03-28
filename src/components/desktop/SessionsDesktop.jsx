import { useState, useEffect, useContext } from "react";
import { SESS_COLOR, OBJ_COLOR, STYPE } from "../../lib/constants";
import { apiGet, apiDel } from "../../lib/api";
import { solidBtn, ghostBtn, ghostSm, iconBtn, cardBg, badgeSt, labelSt, inputSt } from "../../lib/styles";
import { TypeBadge, SectionHdr, StatBox, BarRow, DarkDatePicker } from "../ui";
import { SessionReview, sessionVisits, sessionDurSec, fmtSec, fmtDate, fmtTime } from "../Sessions";
import { deleteAudioBlob } from "../../lib/audioStore";

// ─── OUTCOME BADGE (local copy) ───────────────────────────────────────────────
function OutcomeBadge({ session }) {
  var outcome = session.outcome || "";
  var mode = session.mode || "live";
  var sold = session.sold || outcome === "sold";
  if (mode === "practice") return <span style={{fontSize:9,background:"rgba(0,180,255,.12)",border:"1px solid rgba(0,180,255,.25)",color:"#00B4FF",padding:"2px 7px",borderRadius:99,fontWeight:700}}>Practice</span>;
  if (outcome === "not_contacted") return <span style={{fontSize:9,background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.14)",color:"rgba(255,255,255,.4)",padding:"2px 7px",borderRadius:99,fontWeight:700}}>📵 No Contact</span>;
  if (sold) return <span style={{fontSize:9,background:"rgba(102,187,106,.15)",border:"1px solid rgba(102,187,106,.3)",color:"#66BB6A",padding:"2px 7px",borderRadius:99,fontWeight:700}}>✓ Sold</span>;
  if (outcome === "booked") return <span style={{fontSize:9,background:"rgba(255,213,79,.12)",border:"1px solid rgba(255,213,79,.25)",color:"#FFD54F",padding:"2px 7px",borderRadius:99,fontWeight:700}}>Booked</span>;
  if (outcome === "abandoned") return <span style={{fontSize:9,background:"rgba(239,83,80,.1)",border:"1px solid rgba(239,83,80,.2)",color:"#EF5350",padding:"2px 7px",borderRadius:99,fontWeight:700}}>Abandoned</span>;
  return <span style={{fontSize:9,background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.12)",color:"rgba(255,255,255,.5)",padding:"2px 7px",borderRadius:99,fontWeight:700}}>Live</span>;
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
  return { total:list.length, winRate:winRate, avgSec:avgSec, soldCount:sold.length };
}

// ─── SESSIONS DESKTOP ─────────────────────────────────────────────────────────
// Two-pane: session list (left ~380px) + session review (right flex:1)
// Left pane: stat strip + search + filters (mode, sort, date range, reset) + scrollable list
export function SessionsDesktop({ deckId, deckName, deckColor, deckRootCard, onInitialReview, viewScope, setViewScope, authUser, orgUsers, orgTeams }) {
  var [sessions,    setSessions]    = useState(null);
  var [selectedId,  setSelectedId]  = useState(onInitialReview || null);
  var [fType,       setFType]       = useState("all");
  var [sortBy,      setSortBy]      = useState("date");
  var [search,      setSearch]      = useState("");
  var [fFrom,       setFFrom]       = useState("");
  var [fTo,         setFTo]         = useState("");
  var [fbSeenTs,    setFbSeenTs]    = useState(function(){ try { return JSON.parse(localStorage.getItem("rc_fb_seen") || "{}"); } catch(e){ return {}; } });

  var isAdmin      = !!(authUser && authUser.role === "admin");
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
    apiGet(buildUrl())
      .then(function(data) { setSessions(data.sort(function(a,b){ return b.startTs - a.startTs; })); })
      .catch(function() { setSessions([]); });
  }, [deckId, viewScope]);

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
    }).catch(function(e){ console.error("overcard:", e); });
  }

  function resetFilters() {
    setSearch(""); setFType("all"); setFFrom(""); setFTo(""); setSortBy("date");
  }

  function getFiltered() {
    if (!sessions) return [];
    var list = sessions.filter(function(s) {
      if (fType !== "all" && (s.mode||"live") !== fType) return false;
      if (search && !s.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (fFrom) { var d = new Date(fFrom); d.setHours(0,0,0,0); if (s.startTs < d.getTime()) return false; }
      if (fTo)   { var d2 = new Date(fTo); d2.setHours(23,59,59,999); if (s.startTs > d2.getTime()) return false; }
      return true;
    });
    if (sortBy === "duration") {
      list = list.slice().sort(function(a,b){ return (sessionDurSec(b)||0) - (sessionDurSec(a)||0); });
    } else if (sortBy === "outcome") {
      list = list.slice().sort(function(a,b){ return outcomePriority(a) - outcomePriority(b); });
    }
    return list;
  }

  var filtered = getFiltered();
  var selectedSession = sessions ? sessions.find(function(s){ return s.id === selectedId; }) : null;
  var accent = "#FFD54F";
  var filtersActive = search || fType !== "all" || fFrom || fTo || sortBy !== "date";
  var stats = sessions !== null && filtered.length > 0 ? computeFilteredStats(filtered) : null;

  return (
    <div style={{display:"flex",height:"100%",overflow:"hidden"}}>

      {/* ── Left pane: session list ── */}
      <div style={{width:400,minWidth:400,display:"flex",flexDirection:"column",borderRight:"1px solid rgba(255,255,255,.06)",overflow:"hidden"}}>

        {/* Stat strip — live summary of currently filtered results */}
        {stats && (
          <div style={{display:"flex",flexShrink:0,borderBottom:"1px solid rgba(255,255,255,.05)",background:"rgba(0,0,0,.18)"}}>
            {[
              {v:stats.total,             l:"sessions",  c:"rgba(255,255,255,.75)"},
              {v:stats.winRate !== null ? stats.winRate+"%" : "—", l:"close rate", c:"#66BB6A"},
              {v:stats.avgSec !== null ? fmtSec(stats.avgSec) : "—", l:"avg time",   c:"rgba(255,213,79,.85)"},
              {v:stats.soldCount,          l:"sold",      c:"#A8FF3E"},
            ].map(function(st, i) {
              return (
                <div key={i} style={{flex:1,padding:"8px 0 7px",textAlign:"center",borderRight:i<3?"1px solid rgba(255,255,255,.05)":"none"}}>
                  <div style={{fontSize:15,fontWeight:700,color:st.c,lineHeight:1}}>{st.v}</div>
                  <div style={{fontSize:8,color:"rgba(255,255,255,.28)",textTransform:"uppercase",letterSpacing:.7,marginTop:3}}>{st.l}</div>
                </div>
              );
            })}
          </div>
        )}

        {/* Filter bar */}
        <div style={{padding:"10px 12px 8px",borderBottom:"1px solid rgba(255,255,255,.06)",flexShrink:0,background:"rgba(8,25,55,.25)"}}>

          {/* Admin scope selector */}
          {isAdmin && (
            <div style={{marginBottom:8}}>
              <select
                value={viewScope||"self"}
                onChange={function(e){ setViewScope(e.target.value); setSelectedId(null); }}
                style={Object.assign({},inputSt({padding:"6px 10px",fontSize:11}),{width:"100%"})}>
                <option value="self">My Sessions</option>
                <option value="org">All Org Sessions</option>
                {(orgTeams||[]).map(function(t){ return <option key={t.id} value={t.id}>{t.name}</option>; })}
              </select>
            </div>
          )}

          {/* Search input */}
          <div style={{position:"relative",marginBottom:8}}>
            <span style={{position:"absolute",left:9,top:"50%",transform:"translateY(-50%)",color:"rgba(255,255,255,.25)",fontSize:11,pointerEvents:"none"}}>🔎</span>
            <input
              value={search}
              onChange={function(e){ setSearch(e.target.value); }}
              placeholder="Search sessions…"
              style={inputSt({paddingLeft:28,height:32,fontSize:12})}/>
          </div>

          {/* Mode pills + sort pills on one row */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:4,marginBottom:6}}>
            {/* Mode filter */}
            <div style={{display:"flex",gap:4}}>
              {["all","live","practice"].map(function(ft) {
                var on = fType === ft;
                return (
                  <button key={ft} onClick={function(){ setFType(ft); }}
                    style={{background:on?accent+"18":"rgba(255,255,255,.05)",border:"1px solid "+(on?accent+"55":"rgba(255,255,255,.1)"),borderRadius:99,padding:"3px 9px",cursor:"pointer",fontSize:10,color:on?accent:"rgba(255,255,255,.4)",fontFamily:"inherit",fontWeight:on?700:400}}>
                    {ft==="all"?"All":ft==="live"?"📞":"🎯"}
                  </button>
                );
              })}
            </div>
            {/* Sort control */}
            <div style={{display:"flex",gap:3}}>
              {[["date","↓ Date"],["duration","⏱ Time"],["outcome","✦ Result"]].map(function(pair) {
                var sk = pair[0]; var lbl = pair[1]; var on = sortBy === sk;
                return (
                  <button key={sk} onClick={function(){ setSortBy(sk); }}
                    style={{background:on?"rgba(255,255,255,.1)":"transparent",border:"1px solid "+(on?"rgba(255,255,255,.2)":"rgba(255,255,255,.07)"),borderRadius:99,padding:"3px 7px",cursor:"pointer",fontSize:9,color:on?"rgba(255,255,255,.85)":"rgba(255,255,255,.3)",fontFamily:"inherit",fontWeight:on?700:400}}>
                    {lbl}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Date range + reset */}
          <div style={{display:"flex",gap:5,alignItems:"center"}}>
            <div style={{flex:1}}>
              <DarkDatePicker value={fFrom} onChange={function(e){ setFFrom(e.target.value); }} style={{fontSize:10,padding:"4px 8px"}}/>
            </div>
            <div style={{flex:1}}>
              <DarkDatePicker value={fTo} onChange={function(e){ setFTo(e.target.value); }} style={{fontSize:10,padding:"4px 8px"}}/>
            </div>
            {filtersActive && (
              <button onClick={resetFilters}
                style={{background:"none",border:"none",cursor:"pointer",color:"rgba(255,255,255,.3)",fontSize:11,fontFamily:"inherit",padding:"4px 6px",flexShrink:0,whiteSpace:"nowrap"}}>
                × Reset
              </button>
            )}
          </div>
        </div>

        {/* Session list */}
        <div style={{flex:1,overflowY:"auto",padding:"8px 10px"}}>
          {sessions === null && (
            <div style={{textAlign:"center",padding:"32px 0",color:"rgba(255,255,255,.3)",fontSize:13}}>Loading…</div>
          )}
          {sessions !== null && filtered.length === 0 && (
            <div style={{textAlign:"center",padding:"32px 0",color:"rgba(255,255,255,.3)",fontSize:13}}>
              {search || filtersActive ? "No sessions match" : "No sessions yet"}
            </div>
          )}
          {filtered.map(function(s) {
            var sel = s.id === selectedId;
            var v = sessionVisits(s);
            var d = sessionDurSec(s);
            var intV = v.filter(function(x){ return x.intendedPath; });
            var intPct = v.length ? Math.round(intV.length/v.length*100) : null;
            var hasFb = s.feedbackCount > 0;
            var fbUnseen = hasFb && (!fbSeenTs[s.id] || fbSeenTs[s.id] < s.latestFeedbackAt);
            return (
              <button key={s.id}
                onClick={function(){ setSelectedId(s.id); markFbSeen(s.id); }}
                style={{
                  display:"block",width:"100%",textAlign:"left",
                  background:sel?"rgba(255,213,79,.08)":"rgba(255,255,255,.03)",
                  border:"1.5px solid "+(sel?accent+"66":"rgba(255,255,255,.06)"),
                  borderRadius:12,padding:"10px 12px",marginBottom:6,
                  cursor:"pointer",fontFamily:"inherit",
                  borderLeft:sel?"3px solid "+accent:undefined,
                  transition:"background .12s"
                }}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
                  <span style={{fontSize:12,fontWeight:700,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1,marginRight:6}}>{s.name}</span>
                  <OutcomeBadge session={s}/>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                  <span style={{width:8,height:8,borderRadius:"50%",background:s.deckColor||"#666",flexShrink:0,display:"inline-block"}}/>
                  <span style={{fontSize:10,color:"rgba(255,255,255,.35)",flex:1}}>{fmtDate(s.startTs)} · {fmtTime(s.startTs)}</span>
                  {intPct !== null && <span style={{fontSize:9,color:"rgba(255,213,79,.6)"}}>{intPct}% path</span>}
                  {d !== null && <span style={{fontSize:9,color:"rgba(255,255,255,.3)"}}>{fmtSec(d)}</span>}
                  {fbUnseen && <span style={{fontSize:9,background:"rgba(168,255,62,.15)",color:"#A8FF3E",borderRadius:99,padding:"1px 5px",fontWeight:700}}>feedback</span>}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Right pane: session review ── */}
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0}}>
        {selectedSession ? (
          <SessionReview
            session={selectedSession}
            onBack={function(){ setSelectedId(null); }}
            authUser={authUser}
            orgUsers={orgUsers}
            orgTeams={orgTeams}
            onMarkFeedbackSeen={markFbSeen}
          />
        ) : (
          <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,color:"rgba(255,255,255,.2)"}}>
            <span style={{fontSize:40}}>📋</span>
            <span style={{fontSize:14}}>Select a session to review</span>
          </div>
        )}
      </div>
    </div>
  );
}
