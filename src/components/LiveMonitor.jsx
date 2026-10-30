import { useState, useEffect, useContext } from "react";
import { TM, OBJ_COLOR, STYPE } from "../lib/constants";
import { apiGet } from "../lib/api";
import { onLive } from "../lib/live";
import { iconBtn, solidBtn, SHEET_MAX_H, overlayFill } from "../lib/styles";
import { Handle } from "./ui";
import { DesktopModal } from "./DesktopModal";
import DesktopCtx from "../lib/DesktopCtx";

var MUTED  = "rgba(255,255,255,.55)";
var SUBTLE = "rgba(255,255,255,.4)";
var LIVE_RED = "#FF5252";

// ─── LIVE SESSION STORE ───────────────────────────────────────────────────────
// Admins' view of the org's runs in progress. One module-level list shared by every
// monitor on screen: loaded from GET /sessions/live, then kept current by the event
// stream (session.started / progress / finished), and reloaded after a reconnect.
var runs = null;          // null = not loaded
var subs = [];
var loading = false;
var wired = false;

function emit() { subs.slice().forEach(function(fn) { fn(); }); }
function load() {
  if (loading) return;
  loading = true;
  apiGet("/sessions/live")
    .then(function(list) { runs = Array.isArray(list) ? list : []; })
    .catch(function() { if (runs === null) runs = []; })
    .finally(function() { loading = false; emit(); });
}
function upsert(run) {
  if (!run || !run.id) return;
  var list = (runs || []).filter(function(r) { return r.id !== run.id; });
  list.unshift(run);
  list.sort(function(a, b) { return b.startTs - a.startTs; });
  runs = list; emit();
}
function wire() {
  if (wired) return;
  wired = true;
  onLive("session.started",  upsert);
  // A heartbeat that raced the final save can arrive after "finished" — ignore it
  onLive("session.progress", function(run) { if (run && !ended[run.id]) upsert(run); });
  onLive("session.finished", function(d) {
    if (!d) return;
    ended[d.id] = d;
    var ids = Object.keys(ended);
    if (ids.length > 200) delete ended[ids[0]];
    if (!runs) return;
    runs = runs.filter(function(r) { return r.id !== d.id; });
    emit();
  });
  // Signed out: forget this org's runs
  onLive("live.reset", function() { runs = null; ended = {}; emit(); });
  onLive("live.resync", function() { if (subs.length) load(); });
}
var ended = {};   // id → finish event (lets an open watch view say "call ended")

export function useLiveRuns() {
  var [, force] = useState(0);
  useEffect(function() {
    wire();
    function fn() { force(function(n) { return n + 1; }); }
    subs.push(fn);
    load();
    return function() { subs = subs.filter(function(f) { return f !== fn; }); };
  }, []);
  return runs;
}

// One shared 1s clock for every elapsed timer on screen
function useNow(active) {
  var [now, setNow] = useState(Date.now());
  useEffect(function() {
    if (!active) return;
    var iv = setInterval(function() { setNow(Date.now()); }, 1000);
    return function() { clearInterval(iv); };
  }, [active]);
  return now;
}

function fmtElapsed(ms) {
  var s = Math.max(0, Math.floor(ms / 1000));
  var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (r < 10 ? "0" : "") + r;
}

function visitsOf(run) { return (run.events || []).filter(function(e) { return e.type === "visit"; }); }
function notesOf(run)  { return (run.events || []).filter(function(e) { return e.type === "note"; }); }

function LiveDot({ size }) {
  var s = size || 8;
  return <span aria-hidden="true" style={{width:s,height:s,borderRadius:"50%",background:LIVE_RED,boxShadow:"0 0 0 3px rgba(255,82,82,.18)",flexShrink:0,animation:"savePulse 1.6s ease-in-out infinite"}}/>;
}

function ModeChip({ mode }) {
  var st = STYPE[mode === "practice" ? "practice" : "live"] || {};
  return <span style={{fontSize:11,fontWeight:700,color:st.color || "#fff",border:"1px solid "+(st.color || "#fff")+"55",borderRadius:99,padding:"1px 8px",flexShrink:0}}>{st.label || mode}</span>;
}

function CurrentCard({ run, size }) {
  var live = run.live || {};
  if (!live.cardTitle) return <span style={{fontSize:size || 13,color:SUBTLE}}>Getting started…</span>;
  var meta = live.inObjection ? { color: OBJ_COLOR, icon: "⚡" } : (TM[live.cardType] || TM.pitch);
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:6,minWidth:0,fontSize:size || 13,color:"rgba(255,255,255,.85)"}}>
      <span style={{color:meta.color,flexShrink:0}}>{meta.icon}</span>
      <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
        {live.inObjection && live.stackLabel ? live.stackLabel + " · " : ""}{live.cardTitle}
      </span>
    </span>
  );
}

// ─── LIVE NOW ─────────────────────────────────────────────────────────────────
// Admin panel listing every rep on a call right now. Click a row to watch it.
//   variant  — "strip" (Home: compact header row, hides when idle) | "card" (Admin roster)
//   onOpenSession(id, deckId) — opens a finished run's review
export function LiveNow({ variant, onOpenSession }) {
  var list = useLiveRuns();
  var desktop = useContext(DesktopCtx);
  var compact = !desktop || !desktop.isDesktop || desktop.compact;
  var now = useNow(!!(list && list.length));
  var [watchId, setWatchId] = useState(null);
  var n = list ? list.length : 0;

  var rows = (list || []).map(function(run) {
    var v = visitsOf(run).length;
    return (
      <button key={run.id} onClick={function() { setWatchId(run.id); }}
        style={{display:"flex",alignItems:"center",gap:12,width:"100%",textAlign:"left",background:"rgba(255,255,255,.035)",border:"1px solid rgba(255,255,255,.08)",borderRadius:12,padding:compact?"10px 12px":"10px 14px",cursor:"pointer",fontFamily:"inherit",minHeight:compact?52:48}}>
        <LiveDot/>
        <span style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",gap:3}}>
          <span style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
            <span style={{fontSize:14,fontWeight:700,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flexShrink:0,maxWidth:"60%"}}>{run.userName || "Rep"}</span>
            <ModeChip mode={run.mode}/>
            <span title={run.deckName} style={{flex:1,fontSize:12,color:MUTED,minWidth:0,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>
              <span style={{color:run.deckColor,marginRight:4}}>{run.deckIcon}</span>{run.deckName}
            </span>
          </span>
          <CurrentCard run={run}/>
        </span>
        <span style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:3,flexShrink:0}}>
          <span style={{fontSize:14,fontWeight:700,color:"#fff",fontVariantNumeric:"tabular-nums"}}>{fmtElapsed(now - run.startTs)}</span>
          <span style={{fontSize:11,color:SUBTLE}}>{v} card{v !== 1 ? "s" : ""}</span>
        </span>
      </button>
    );
  });

  var header = (
    <div style={{display:"flex",alignItems:"center",gap:8}}>
      {n > 0 ? <LiveDot/> : <span style={{width:8,height:8,borderRadius:"50%",background:"rgba(255,255,255,.2)"}}/>}
      <span style={{fontSize:compact?15:16,fontWeight:700,color:"#fff"}}>Live now</span>
      <span style={{fontSize:13,color:MUTED}}>{list === null ? "…" : n === 0 ? "Nobody is on a call" : n + " on a call"}</span>
    </div>
  );

  var watch = watchId && <LiveWatch runId={watchId} onClose={function() { setWatchId(null); }} onOpenSession={onOpenSession}/>;

  if (variant === "strip") {
    return (
      <section aria-label="Live sessions" style={{background:"rgba(255,82,82,.05)",border:"1px solid "+(n ? "rgba(255,82,82,.25)" : "rgba(255,255,255,.08)"),borderRadius:compact?12:14,padding:compact?"10px 12px":"12px 16px",display:"flex",flexDirection:"column",gap:n ? 10 : 0}}>
        {header}
        {n > 0 && <div style={{display:"grid",gridTemplateColumns:compact ? "1fr" : "repeat(auto-fill,minmax(360px,1fr))",gap:8}}>{rows}</div>}
        {watch}
      </section>
    );
  }
  return (
    <section aria-label="Live sessions" style={{background:"rgba(255,255,255,.045)",border:"1px solid rgba(255,255,255,.08)",borderRadius:16,padding:"14px 16px",display:"flex",flexDirection:"column",gap:10}}>
      {header}
      {n > 0 ? rows : <div style={{fontSize:13,color:SUBTLE,lineHeight:1.5}}>When a rep starts a call or practice run it appears here, and you can follow it card by card.</div>}
      {watch}
    </section>
  );
}

// ─── WATCH ────────────────────────────────────────────────────────────────────
// One run followed live: the path so far, notes, and the card on screen now.
// When the run ends it offers the full review.
function LiveWatch({ runId, onClose, onOpenSession }) {
  var list = useLiveRuns();
  var desktop = useContext(DesktopCtx);
  var run = (list || []).find(function(r) { return r.id === runId; });
  var [last, setLast] = useState(run || null);
  useEffect(function() { if (run) setLast(run); }, [run]);
  var shown = run || last;
  var done = !run && list !== null;
  var now = useNow(!done);

  if (!shown) return null;
  var visits = visitsOf(shown);
  var notes = notesOf(shown);
  var finish = ended[runId];
  var title = (shown.userName || "Rep") + " · " + (shown.name || "Session");

  var body = (
    <div style={{display:"flex",flexDirection:"column",gap:14,padding:desktop && desktop.isDesktop ? "16px 20px 20px" : "0 18px 20px",overflowY:"auto",minHeight:0}}>
      <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
        {done ? <span style={{fontSize:12,fontWeight:700,color:MUTED,border:"1px solid rgba(255,255,255,.2)",borderRadius:99,padding:"2px 10px"}}>Call ended</span>
              : <span style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:12,fontWeight:700,color:LIVE_RED}}><LiveDot size={7}/>LIVE · {fmtElapsed(now - shown.startTs)}</span>}
        <ModeChip mode={shown.mode}/>
        <span style={{fontSize:13,color:MUTED}}><span style={{color:shown.deckColor}}>{shown.deckIcon}</span> {shown.deckName}</span>
      </div>

      {!done && (
        <div style={{background:"rgba(255,82,82,.07)",border:"1px solid rgba(255,82,82,.25)",borderRadius:12,padding:"12px 14px"}}>
          <div style={{fontSize:11,fontWeight:700,letterSpacing:1.1,textTransform:"uppercase",color:SUBTLE,marginBottom:6}}>On screen now</div>
          <CurrentCard run={shown} size={16}/>
        </div>
      )}

      {done && (
        <div style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",borderRadius:12,padding:"12px 14px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          <span style={{flex:1,minWidth:180,fontSize:14,color:"rgba(255,255,255,.8)",lineHeight:1.5}}>
            {finish && finish.abandoned ? "The call ended without being finished (the rep's device disconnected or signed out). Its path was saved." : "The rep finished this call."}
          </span>
          {onOpenSession && <button onClick={function() { onClose(); onOpenSession(runId, shown.deckId); }} style={solidBtn("#1565C0")}>Open review</button>}
        </div>
      )}

      <div>
        <div style={{fontSize:11,fontWeight:700,letterSpacing:1.1,textTransform:"uppercase",color:SUBTLE,marginBottom:8}}>Path so far · {visits.length}</div>
        {visits.length === 0 && <div style={{fontSize:13,color:SUBTLE}}>No cards completed yet.</div>}
        <ol style={{listStyle:"none",margin:0,padding:0,display:"flex",flexDirection:"column",gap:4}}>
          {visits.map(function(v, i) {
            var meta = v.isObjCard ? { color: OBJ_COLOR, icon: "⚡" } : (TM[v.cardType] || TM.pitch);
            return (
              <li key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 10px",borderRadius:9,background:"rgba(255,255,255,.03)"}}>
                <span style={{fontSize:12,color:SUBTLE,width:22,textAlign:"right",flexShrink:0}}>{i + 1}</span>
                <span style={{color:meta.color,flexShrink:0}}>{meta.icon}</span>
                <span style={{flex:1,minWidth:0,fontSize:14,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {v.isObjCard && v.stackLabel ? v.stackLabel + " · " : ""}{v.cardTitle}
                </span>
                {v.intendedPath && <span title="On the intended path" style={{fontSize:11,color:"#66BB6A",flexShrink:0}}>★</span>}
                <span style={{fontSize:12,color:MUTED,fontVariantNumeric:"tabular-nums",flexShrink:0}}>{fmtElapsed(v.durationMs || 0)}</span>
              </li>
            );
          })}
        </ol>
      </div>

      {notes.length > 0 && (
        <div>
          <div style={{fontSize:11,fontWeight:700,letterSpacing:1.1,textTransform:"uppercase",color:SUBTLE,marginBottom:8}}>Notes · {notes.length}</div>
          {notes.map(function(nt, i) {
            return (
              <div key={i} style={{fontSize:14,color:"rgba(255,255,255,.85)",lineHeight:1.5,padding:"8px 10px",borderLeft:"2px solid rgba(255,255,255,.15)",marginBottom:6}}>
                <div style={{fontSize:11,color:SUBTLE,marginBottom:2}}>{nt.cardTitle}</div>{nt.text}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  if (desktop && desktop.isDesktop) return <DesktopModal title={title} width={620} onClose={onClose}>{body}</DesktopModal>;
  return (
    <div style={overlayFill(330)}>
      <div onClick={onClose} style={{flex:1,background:"rgba(0,0,0,.6)",backdropFilter:"blur(8px)"}}/>
      <div style={{background:"#081428",borderRadius:"24px 24px 0 0",border:"1px solid rgba(255,255,255,.1)",borderBottom:"none",maxHeight:SHEET_MAX_H,display:"flex",flexDirection:"column",animation:"sheetUp .3s cubic-bezier(.22,1,.36,1) both"}}>
        <Handle/>
        <div style={{padding:"0 18px 12px",display:"flex",alignItems:"center",gap:10}}>
          <div style={{flex:1,minWidth:0,fontSize:16,fontWeight:700,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{title}</div>
          <button onClick={onClose} aria-label="Close" style={iconBtn()}>✕</button>
        </div>
        {body}
      </div>
    </div>
  );
}
