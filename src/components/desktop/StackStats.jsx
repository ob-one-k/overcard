import { useState, useEffect, useMemo, useContext } from "react";
import { cachedGet, peek, useCacheVersion } from "../../lib/dataCache";
import { TM, OBJ_COLOR } from "../../lib/constants";
import DesktopCtx from "../../lib/DesktopCtx";

// ─── OBJECTION STACK STATS (desktop/tablet Objections tab) ────────────────────
// What the right-hand pane shows when a stack is open but no card is: how often the
// objection comes up, where in the pitch, how reps move through the stack, and whether
// those calls still close. Built from the deck's sessions (org-wide for admins, own
// runs for reps) — the same data and cache as the Cards tab overview.

var TXT  = "#fff";
var TXT2 = "rgba(255,255,255,.72)";
var TXT3 = "rgba(255,255,255,.5)";
var LINE = "rgba(255,255,255,.07)";
var GREEN = "#66BB6A";
var AMBER = "#FFD54F";
var TEAL = "#4DB6AC";

function fmtDur(ms) {
  if (!ms) return "—";
  var sec = Math.round(ms / 1000);
  return sec < 60 ? sec + "s" : Math.floor(sec / 60) + "m" + (sec % 60 ? " " + (sec % 60) + "s" : "");
}
function pct(a, b) { return b ? Math.round(a / b * 100) : null; }
function isSold(x) { return !!(x.sold || x.outcome === "sold"); }
function fmtDate(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Does this visit belong to the stack? stackId (new events) → the stack's own card ids →
// the label (older sessions recorded only that)
function visitInStack(e, stack, cardIds) {
  if (!e || !e.isObjCard) return false;
  if (e.stackId) return e.stackId === stack.id;
  if (e.cardId && cardIds[e.cardId]) return true;
  return !!e.stackLabel && e.stackLabel === stack.label;
}

// Every pass through the stack in every session: where it started, which stack cards it
// reached, how long it took and how it ended.
export function computeStackStats(sessions, stack, deckCards) {
  var cardIds = {};
  Object.keys(stack.cards || {}).forEach(function(id) { cardIds[id] = true; });
  var n = sessions.length, live = 0, sold = 0;
  var raisedSessions = [], entries = 0, msTotal = 0, returned = 0, endedIn = 0, otherStack = 0;
  var liveRaised = 0, soldRaised = 0;
  var from = {}, reach = {}, exitAt = {};
  sessions.forEach(function(x) {
    var isLive = (x.mode || "live") === "live";
    if (isLive) { live++; if (isSold(x)) sold++; }
    var visits = (x.events || []).filter(function(e) { return e.type === "visit"; });
    var raisedHere = 0, lastMain = null, run = null;
    function closeRun(next) {
      if (!run) return;
      if (!next) endedIn++;
      else if (next.isObjCard) otherStack++;
      else returned++;
      if (run.last) exitAt[run.last] = (exitAt[run.last] || 0) + 1;
      Object.keys(run.seen).forEach(function(id) { reach[id] = (reach[id] || 0) + 1; });
      run = null;
    }
    visits.forEach(function(v) {
      var mine = visitInStack(v, stack, cardIds);
      if (mine) {
        if (!run) {
          run = { seen: {}, last: null };
          entries++; raisedHere++;
          var key = lastMain ? lastMain.cardId : "_start";
          if (!from[key]) from[key] = { n: 0, title: lastMain ? (deckCards[lastMain.cardId] || {}).title || lastMain.cardTitle : "Start of the call", type: lastMain ? lastMain.cardType : null };
          from[key].n++;
        }
        run.seen[v.cardId] = true;
        run.last = v.cardId;
        msTotal += v.durationMs || 0;
      } else {
        closeRun(v);
        if (!v.isObjCard) lastMain = v;
      }
    });
    closeRun(null);
    if (raisedHere) {
      raisedSessions.push({ s: x, times: raisedHere });
      if (isLive) { liveRaised++; if (isSold(x)) soldRaised++; }
    }
  });
  raisedSessions.sort(function(a, b) { return (b.s.startTs || 0) - (a.s.startTs || 0); });
  return {
    n: n, entries: entries, raised: raisedSessions.length, raisedSessions: raisedSessions,
    raisedPct: pct(raisedSessions.length, n),
    avgMs: entries ? msTotal / entries : 0,
    closeRaised: pct(soldRaised, liveRaised), liveRaised: liveRaised, soldRaised: soldRaised,
    closeAll: pct(sold, live), live: live,
    returnedPct: pct(returned, entries), returned: returned, endedIn: endedIn, otherStack: otherStack,
    from: Object.keys(from).map(function(k) { return Object.assign({ id: k }, from[k]); }).sort(function(a, b) { return b.n - a.n; }),
    reach: reach, exitAt: exitAt,
  };
}

// header: the stack heading block (icon, name, summary) — rendered above the stats
export function StackStats({ deck, stack, orderedCards, canOrg, onOpenCard, onOpenSession, header }) {
  var desktop = useContext(DesktopCtx);
  var compact = !!(desktop && desktop.compact);
  var [scope, setScope] = useState(canOrg ? "org" : "self");
  var [mode, setMode] = useState("all");      // all | live | practice
  var [sessions, setSessions] = useState(null);
  var sv = useCacheVersion("/sessions");
  useEffect(function() {
    var cancelled = false;
    var url = "/sessions?deckId=" + encodeURIComponent(deck.id) + (scope === "org" ? "&scope=org" : "");
    function own(list) { return Array.isArray(list) ? list.filter(function(x) { return !x._shared; }) : []; }
    var cached = peek(url);
    setSessions(cached !== undefined ? own(cached) : null);
    cachedGet(url)
      .then(function(list) { if (!cancelled) setSessions(own(list)); })
      .catch(function() { if (!cancelled) setSessions([]); });
    return function() { cancelled = true; };
  }, [deck.id, scope, sv]);

  var list = useMemo(function() {
    return (sessions || []).filter(function(x) { return mode === "all" || (x.mode || "live") === mode; });
  }, [sessions, mode]);
  var st = useMemo(function() { return computeStackStats(list, stack, deck.cards || {}); }, [list, stack, deck.cards]);
  var loading = sessions === null;

  var panel = { background: "rgba(255,255,255,.035)", border: "1px solid " + LINE, borderRadius: 14, padding: compact ? "14px" : "16px 18px", minWidth: 0 };
  var hdr = { fontSize: compact ? 15 : 16, fontWeight: 700, color: TXT };
  var sub = { fontSize: 12, color: TXT3, marginTop: 2, marginBottom: 12 };

  function pill(on, label, onClick) {
    return (
      <button key={label} onClick={onClick} aria-pressed={on}
        style={{background:on?"rgba(255,255,255,.12)":"transparent",border:"none",borderRadius:99,padding:compact?"8px 14px":"5px 12px",fontSize:13,color:on?TXT:TXT3,fontWeight:on?700:500,cursor:"pointer",fontFamily:"inherit"}}>{label}</button>
    );
  }
  function bar(p, color) {
    return (
      <div style={{height:6,borderRadius:99,background:"rgba(255,255,255,.06)",overflow:"hidden",marginTop:6}}>
        <div style={{height:"100%",width:Math.max(0, Math.min(100, p || 0)) + "%",background:color,borderRadius:99,transition:"width .35s ease"}}/>
      </div>
    );
  }

  var closeDelta = st.closeRaised !== null && st.closeAll !== null ? st.closeRaised - st.closeAll : null;
  var kpis = [
    { v: st.raisedPct === null ? "—" : st.raisedPct + "%", l: "Comes up in", s: st.raised + " of " + st.n + " call" + (st.n !== 1 ? "s" : ""), c: OBJ_COLOR },
    { v: st.entries, l: "Times raised", s: st.raised ? (st.entries / st.raised).toFixed(1).replace(/\.0$/, "") + " per call it came up in" : "Not raised yet", c: AMBER },
    { v: fmtDur(st.avgMs), l: "Avg time in stack", s: "per time it's raised", c: TEAL },
    { v: st.closeRaised === null ? "—" : st.closeRaised + "%", l: "Close rate when raised",
      s: closeDelta === null ? (st.liveRaised ? st.soldRaised + " sold of " + st.liveRaised + " live" : "No live calls raised it") : (closeDelta === 0 ? "same as the deck" : (closeDelta > 0 ? "+" : "") + closeDelta + " pts vs deck (" + st.closeAll + "%)"),
      c: closeDelta !== null && closeDelta < 0 ? "#FF8A65" : GREEN },
    { v: st.returnedPct === null ? "—" : st.returnedPct + "%", l: "Back on the pitch", s: st.endedIn ? st.endedIn + " call" + (st.endedIn !== 1 ? "s" : "") + " ended in the stack" : "after the stack", c: "#00B4FF" },
  ];

  var fromMax = st.from.length ? st.from[0].n : 1;
  var exitRows = Object.keys(st.exitAt).map(function(id) { return { id: id, n: st.exitAt[id], c: (stack.cards || {})[id] }; })
    .sort(function(a, b) { return b.n - a.n; }).slice(0, 5);
  var exitMax = exitRows.length ? exitRows[0].n : 1;

  return (
    <div style={{flex:1,overflowY:"auto",padding:compact?"16px":"22px 26px 28px"}}>
      <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",gap:12,flexWrap:"wrap",marginBottom:16}}>
        <div style={{minWidth:0}}>
          {header}
          <div style={{fontSize:13,color:TXT3,marginTop:6}}>
            Select a card on the left to {onOpenCard ? "open" : "read"} it. Stats below are from {loading ? "…" : st.n + " call" + (st.n !== 1 ? "s" : "")}{scope === "org" ? " across the org" : " you ran"} on this deck.
          </div>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <span style={{display:"inline-flex",background:"rgba(255,255,255,.05)",borderRadius:99,padding:2}}>
            {pill(mode === "all", "All", function() { setMode("all"); })}
            {pill(mode === "live", "Live", function() { setMode("live"); })}
            {pill(mode === "practice", "Practice", function() { setMode("practice"); })}
          </span>
          {canOrg && (
            <span style={{display:"inline-flex",background:"rgba(255,255,255,.05)",borderRadius:99,padding:2}}>
              {pill(scope === "org", "Org", function() { setScope("org"); })}
              {pill(scope === "self", "Mine", function() { setScope("self"); })}
            </span>
          )}
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(" + (compact ? 150 : 140) + "px, 1fr))",gap:12,marginBottom:16}}>
        {kpis.map(function(k) {
          return (
            <div key={k.l} style={Object.assign({}, panel, {padding:compact?"12px 14px":"14px 16px"})}>
              <div style={{fontSize:compact?24:28,fontWeight:800,color:k.c,lineHeight:1.1,fontVariantNumeric:"tabular-nums"}}>{loading ? "…" : k.v}</div>
              <div style={{fontSize:14,fontWeight:600,color:TXT2,marginTop:4}}>{k.l}</div>
              <div style={{fontSize:12,color:TXT3,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={k.s}>{k.s}</div>
            </div>
          );
        })}
      </div>

      {!loading && st.entries === 0 ? (
        <div style={{background:"rgba(239,83,80,.06)",border:"1px dashed rgba(239,83,80,.3)",borderRadius:14,padding:"28px 24px",textAlign:"center",color:TXT2,fontSize:15,lineHeight:1.6}}>
          {st.n === 0 ? "No calls on this deck yet" + (mode !== "all" ? " for this filter" : "") + "." : "None of these " + st.n + " call" + (st.n !== 1 ? "s" : "") + " opened this stack yet."}
          <div style={{fontSize:13,color:TXT3,marginTop:6}}>Stats fill in as reps open it from Play.</div>
        </div>
      ) : (
        <div style={{display:"grid",gridTemplateColumns:compact?"minmax(0,1fr)":"minmax(0,1fr) minmax(0,1fr)",gap:16,alignItems:"start"}}>
          {/* Where in the pitch the objection comes up */}
          <div style={panel}>
            <div style={hdr}>Where it comes up</div>
            <div style={sub}>The pitch card reps were on when they opened this stack</div>
            {st.from.slice(0, 6).map(function(r) {
              var m = r.type ? TM[r.type] || TM.pitch : null;
              var card = r.id !== "_start" ? (deck.cards || {})[r.id] : null;
              return (
                <div key={r.id} style={{padding:"7px 0",borderTop:"1px solid rgba(255,255,255,.04)"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,fontSize:14}}>
                    {m && <span style={{width:8,height:8,borderRadius:"50%",background:m.color,flexShrink:0}}/>}
                    <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:card ? TXT : TXT2,fontWeight:600}}>{r.title || "Untitled"}</span>
                    <span style={{color:TXT2,fontVariantNumeric:"tabular-nums"}}>{r.n}×</span>
                    <span style={{color:TXT3,fontSize:12,width:40,textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{pct(r.n, st.entries)}%</span>
                  </div>
                  {bar(r.n / fromMax * 100, m ? m.color : TXT3)}
                </div>
              );
            })}
          </div>

          {/* How far reps get through the stack */}
          <div style={panel}>
            <div style={hdr}>Path through the stack</div>
            <div style={sub}>Share of times raised that reached each card{onOpenCard ? " · click to open" : ""}</div>
            {orderedCards.length === 0 && <div style={{fontSize:14,color:TXT3}}>No cards in this stack.</div>}
            {orderedCards.map(function(c, i) {
              var p = pct(st.reach[c.id] || 0, st.entries);
              var row = (
                <>
                  <div style={{display:"flex",alignItems:"center",gap:8,fontSize:14}}>
                    <span style={{width:20,height:20,borderRadius:"50%",background:"rgba(239,83,80,.14)",border:"1px solid rgba(239,83,80,.4)",color:OBJ_COLOR,fontSize:11,fontWeight:800,display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{i + 1}</span>
                    <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:TXT,fontWeight:600,textAlign:"left"}}>{c.title || "Untitled"}</span>
                    <span style={{color:TXT2,fontVariantNumeric:"tabular-nums"}}>{p === null ? "—" : p + "%"}</span>
                  </div>
                  {bar(p, OBJ_COLOR)}
                </>
              );
              return onOpenCard ? (
                <button key={c.id} onClick={function() { onOpenCard(c); }}
                  style={{display:"block",width:"100%",background:"none",border:"none",borderTop:"1px solid rgba(255,255,255,.04)",padding:"7px 0",cursor:"pointer",fontFamily:"inherit"}}>{row}</button>
              ) : <div key={c.id} style={{padding:"7px 0",borderTop:"1px solid rgba(255,255,255,.04)"}}>{row}</div>;
            })}
          </div>

          {/* Where reps leave the stack */}
          <div style={panel}>
            <div style={hdr}>Where reps leave it</div>
            <div style={sub}>
              Last stack card before moving on · {st.returned} back to the pitch{st.otherStack ? " · " + st.otherStack + " into another stack" : ""} · {st.endedIn} ended the call
            </div>
            {exitRows.map(function(r) {
              return (
                <div key={r.id} style={{padding:"7px 0",borderTop:"1px solid rgba(255,255,255,.04)"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,fontSize:14}}>
                    <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:r.c ? TXT : TXT3,fontWeight:600}}>{r.c ? r.c.title || "Untitled" : "Removed card"}</span>
                    <span style={{color:TXT2,fontVariantNumeric:"tabular-nums"}}>{r.n}×</span>
                  </div>
                  {bar(r.n / exitMax * 100, AMBER)}
                </div>
              );
            })}
          </div>

          {/* Recent calls that raised it */}
          <div style={panel}>
            <div style={hdr}>Recent calls that raised it</div>
            <div style={sub}>{onOpenSession ? "Open one to review it" : "Newest first"}</div>
            {st.raisedSessions.slice(0, 8).map(function(r) {
              var x = r.s, isLive = (x.mode || "live") === "live";
              var outcome = isSold(x) ? "Sold" : x.outcome === "booked" ? "Booked" : x.outcome === "abandoned" ? "Abandoned" : isLive ? "No sale" : "Practice";
              var oc = isSold(x) ? GREEN : x.outcome === "booked" ? "#00B4FF" : TXT3;
              var inner = (
                <>
                  <span style={{flex:1,minWidth:0,textAlign:"left"}}>
                    <span style={{display:"block",fontSize:14,fontWeight:600,color:TXT,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{x.name || "Untitled call"}</span>
                    <span style={{display:"block",fontSize:12,color:TXT3,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                      {(x.userName || "Former member")} · {fmtDate(x.startTs)}{r.times > 1 ? " · raised " + r.times + "×" : ""}
                    </span>
                  </span>
                  <span style={{fontSize:12,fontWeight:700,color:oc,flexShrink:0}}>{outcome}</span>
                </>
              );
              return onOpenSession ? (
                <button key={x.id} onClick={function() { onOpenSession(x); }}
                  style={{display:"flex",alignItems:"center",gap:10,width:"100%",background:"none",border:"none",borderTop:"1px solid rgba(255,255,255,.04)",padding:"8px 0",cursor:"pointer",fontFamily:"inherit"}}>{inner}</button>
              ) : <div key={x.id} style={{display:"flex",alignItems:"center",gap:10,borderTop:"1px solid rgba(255,255,255,.04)",padding:"8px 0"}}>{inner}</div>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}
