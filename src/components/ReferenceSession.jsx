import { useState, useEffect, useRef } from "react";
import { TM, OBJ_COLOR } from "../lib/constants";
import { apiGet } from "../lib/api";
import { inputSt } from "../lib/styles";

// ─── REFERENCE SESSIONS ───────────────────────────────────────────────────────
// A live session can carry `referenceSessionId` — another completed session in
// the org that the rep wants to follow (e.g. a teammate's closed deal).
//   ReferencePicker — searchable, clearable picker for the start-session form
//   ReferencePanel  — in-session view of the reference's path, synced to the
//                     card on screen (time they spent, their notes, outcome)

var MUTED  = "rgba(255,255,255,.55)";
var SUBTLE = "rgba(255,255,255,.4)";
var REF_COLOR = "#B39DDB";

export function outcomeSpec(s) {
  var o = (s && s.outcome) || "";
  if (s && (s.sold || o === "sold")) return { t:"Sold",       c:"#66BB6A" };
  if (o === "booked")                return { t:"Booked",     c:"#FFD54F" };
  if (o === "not_contacted")         return { t:"No contact", c:"#B0BEC5" };
  if (o === "abandoned")             return { t:"Abandoned",  c:"#EF5350" };
  return { t:"Completed", c:"#B0BEC5" };
}

export function RefOutcome({ session, small }) {
  var spec = outcomeSpec(session);
  return (
    <span style={{fontSize:small?10:11,fontWeight:700,color:spec.c,background:spec.c+"1c",border:"1px solid "+spec.c+"44",borderRadius:99,padding:small?"1px 7px":"2px 9px",whiteSpace:"nowrap",flexShrink:0}}>{spec.t}</span>
  );
}

export function fmtDur(ms) {
  if (ms === null || ms === undefined || isNaN(ms)) return "—";
  var sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return sec + "s";
  var m = Math.floor(sec / 60), s = sec % 60;
  if (m < 60) return m + ":" + (s < 10 ? "0" : "") + s;
  var h = Math.floor(m / 60); m = m % 60;
  return h + "h " + m + "m";
}

function fmtDate(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString("en-US", { month:"short", day:"numeric", year: new Date(ts).getFullYear() !== new Date().getFullYear() ? "numeric" : undefined });
}

// ── PICKER ────────────────────────────────────────────────────────────────────
// value: the chosen option object (or null); onChange(optionOrNull)
export function ReferencePicker({ deckId, value, onChange, size }) {
  var lg = size === "lg";
  var [open,    setOpen]    = useState(false);
  var [q,       setQ]       = useState("");
  var [items,   setItems]   = useState(null);
  var [err,     setErr]     = useState(false);
  var [reload,  setReload]  = useState(0);
  var inputRef = useRef(null);

  // Debounced search against the reference-options endpoint
  useEffect(function() {
    if (!open) return;
    var cancelled = false;
    setErr(false);
    var t = setTimeout(function() {
      apiGet("/sessions/reference-options?deckId=" + encodeURIComponent(deckId) + "&q=" + encodeURIComponent(q.trim()))
        .then(function(d) { if (!cancelled) setItems(Array.isArray(d) ? d : []); })
        .catch(function() { if (!cancelled) { setItems([]); setErr(true); } });
    }, q ? 250 : 0);
    return function() { cancelled = true; clearTimeout(t); };
  }, [open, q, deckId, reload]);

  // A reference from another deck makes no sense — drop it on deck switch
  useEffect(function() {
    if (value && value.deckId && value.deckId !== deckId) onChange(null);
    setItems(null);
  }, [deckId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(function() { if (open && inputRef.current) inputRef.current.focus(); }, [open]);

  var labelStyle = lg
    ? {display:"block",fontSize:13,fontWeight:600,color:"rgba(255,255,255,.75)",marginBottom:7}
    : {display:"block",fontSize:10,fontWeight:700,letterSpacing:1.5,color:"rgba(255,255,255,.35)",textTransform:"uppercase",marginBottom:7};

  function pick(it) { onChange(it); setOpen(false); setQ(""); }

  return (
    <div>
      <div style={labelStyle}>
        Reference session <span style={{color:lg?SUBTLE:"rgba(255,255,255,.25)",fontWeight:400,textTransform:"none",letterSpacing:0,fontSize:lg?13:10}}>(optional)</span>
      </div>

      {value && !open && (
        <div style={{display:"flex",alignItems:"center",gap:10,background:REF_COLOR+"14",border:"1px solid "+REF_COLOR+"40",borderRadius:12,padding:lg?"10px 12px":"9px 11px"}}>
          <span aria-hidden="true" style={{fontSize:lg?18:15,flexShrink:0}}>📎</span>
          <span style={{flex:1,minWidth:0}}>
            <span style={{display:"block",fontSize:lg?14:13,fontWeight:600,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{value.name || "Untitled session"}</span>
            <span style={{display:"block",fontSize:lg?12:11,color:MUTED,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{value.userName}{value.startTs ? " · " + fmtDate(value.startTs) : ""}</span>
          </span>
          <RefOutcome session={value} small={!lg}/>
          <button onClick={function(){ setOpen(true); }} style={{background:"transparent",border:"none",color:REF_COLOR,fontSize:lg?13:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",padding:"6px 4px",minHeight:32}}>Change</button>
          <button onClick={function(){ onChange(null); }} aria-label="Clear reference session" title="Clear"
            style={{width:32,height:32,borderRadius:"50%",border:"none",background:"rgba(255,255,255,.08)",color:"rgba(255,255,255,.7)",cursor:"pointer",fontSize:13,flexShrink:0,fontFamily:"inherit"}}>✕</button>
        </div>
      )}

      {!value && !open && (
        <button onClick={function(){ setOpen(true); }}
          style={{display:"flex",alignItems:"center",gap:10,width:"100%",textAlign:"left",background:"rgba(255,255,255,.035)",border:"1.5px dashed rgba(255,255,255,.16)",borderRadius:12,padding:lg?"11px 14px":"10px 12px",minHeight:44,cursor:"pointer",fontFamily:"inherit",color:MUTED,fontSize:lg?14:13}}>
          <span aria-hidden="true">📎</span>
          <span style={{flex:1}}>Follow a past session from your team…</span>
          <span aria-hidden="true" style={{color:SUBTLE}}>▾</span>
        </button>
      )}

      {open && (
        <div style={{background:"rgba(4,12,30,.6)",border:"1px solid rgba(255,255,255,.12)",borderRadius:12,overflow:"hidden"}}>
          <div style={{display:"flex",gap:8,padding:8,borderBottom:"1px solid rgba(255,255,255,.07)"}}>
            <input ref={inputRef} value={q} onChange={function(e){ setQ(e.target.value); }}
              onKeyDown={function(e){ if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } if (e.key === "Enter") e.preventDefault(); }}
              placeholder="Search by title or rep…" aria-label="Search reference sessions"
              style={inputSt({fontSize:lg?14:13,padding:"9px 12px"})}/>
            <button onClick={function(){ setOpen(false); setQ(""); }}
              style={{background:"transparent",border:"1px solid rgba(255,255,255,.15)",borderRadius:10,color:MUTED,fontSize:12,padding:"0 12px",cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>Cancel</button>
          </div>
          <div role="listbox" aria-label="Completed sessions" style={{maxHeight:lg?260:220,overflowY:"auto",padding:4}}>
            {items === null && <div style={{fontSize:13,color:SUBTLE,padding:"10px 10px"}}>Loading sessions…</div>}
            {err && (
              <div style={{fontSize:13,color:"#EF5350",padding:"10px 10px"}}>
                Couldn't load sessions. <button onClick={function(){ setItems(null); setReload(function(n){ return n + 1; }); }} style={{background:"none",border:"none",color:REF_COLOR,fontWeight:700,cursor:"pointer",fontFamily:"inherit",fontSize:13,padding:0}}>Retry</button>
              </div>
            )}
            {items !== null && !err && items.length === 0 && (
              <div style={{fontSize:13,color:SUBTLE,padding:"10px 10px",lineHeight:1.5}}>{q ? "No completed sessions match “" + q + "”." : "No completed sessions on this deck yet."}</div>
            )}
            {(items || []).map(function(it) {
              var sold = it.sold || it.outcome === "sold";
              var on = value && value.id === it.id;
              return (
                <button key={it.id} role="option" aria-selected={!!on} onClick={function(){ pick(it); }}
                  style={{display:"flex",alignItems:"center",gap:10,width:"100%",textAlign:"left",background:on?REF_COLOR+"22":sold?"rgba(102,187,106,.07)":"transparent",border:"none",borderLeft:"3px solid "+(sold?"#66BB6A":"transparent"),borderRadius:8,padding:"9px 10px",minHeight:44,cursor:"pointer",fontFamily:"inherit",marginBottom:2}}>
                  <span aria-hidden="true" style={{fontSize:15,flexShrink:0}}>{it.mode === "practice" ? "🎯" : "📞"}</span>
                  <span style={{flex:1,minWidth:0}}>
                    <span style={{display:"block",fontSize:lg?14:13,fontWeight:600,color:"rgba(255,255,255,.92)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.name || "Untitled session"}</span>
                    <span style={{display:"block",fontSize:lg?12:11,color:MUTED,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.userName || "Unknown rep"} · {fmtDate(it.startTs)}{it.endTs ? " · " + fmtDur(it.endTs - it.startTs) : ""}</span>
                  </span>
                  <RefOutcome session={it} small/>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── PANEL ─────────────────────────────────────────────────────────────────────
// refId: reference session id; currentCardId: card on screen.
// variant "rail" (desktop right rail) | "strip" (phone, collapsible under header)
export function ReferencePanel({ refId, currentCardId, variant }) {
  var strip = variant === "strip";
  var [data,     setData]     = useState(null);
  var [err,      setErr]      = useState(false);
  var [attempt,  setAttempt]  = useState(0);
  var [expanded, setExpanded] = useState(false);
  var listRef = useRef(null);

  useEffect(function() {
    if (!refId) return;
    var cancelled = false;
    setErr(false);
    apiGet("/sessions/" + encodeURIComponent(refId) + "/reference")
      .then(function(d) { if (!cancelled) setData(d); })
      .catch(function() { if (!cancelled) setErr(true); });
    return function() { cancelled = true; };
  }, [refId, attempt]);

  var visits = (data && data.visits) || [];
  var notes  = (data && data.notes) || [];
  var matchIdx = [];
  visits.forEach(function(v, i) { if (v.cardId === currentCardId) matchIdx.push(i); });
  var hereMs = matchIdx.reduce(function(sum, i) { return sum + (visits[i].durationMs || 0); }, 0);
  var hereNotes = notes.filter(function(n) { return n.cardId === currentCardId; });

  // Keep the first matching row in view (scroll the list only, never the page)
  useEffect(function() {
    var list = listRef.current;
    if (!list || matchIdx.length === 0) return;
    var row = list.querySelector("[data-ref-row='" + matchIdx[0] + "']");
    if (!row) return;
    var top = row.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = Math.max(0, top - 24);
    }
  }, [currentCardId, data, expanded]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!refId) return null;

  var hdr = { fontSize:strip?10:12, fontWeight:700, letterSpacing:1.1, textTransform:"uppercase", color:REF_COLOR };

  if (err) {
    return (
      <div style={{padding:strip?"8px 16px":"14px 16px",fontSize:13,color:MUTED,borderBottom:strip?"1px solid rgba(255,255,255,.07)":undefined}}>
        <span style={hdr}>📎 Reference</span>
        <span style={{marginLeft:8}}>Couldn't load. </span>
        <button onClick={function(){ setAttempt(function(n){ return n + 1; }); }} style={{background:"none",border:"none",color:REF_COLOR,fontWeight:700,cursor:"pointer",fontFamily:"inherit",fontSize:13,padding:"4px 2px"}}>Retry</button>
      </div>
    );
  }
  if (!data) {
    return <div style={{padding:strip?"8px 16px":"14px 16px",fontSize:13,color:SUBTLE,borderBottom:strip?"1px solid rgba(255,255,255,.07)":undefined}}><span style={hdr}>📎 Reference</span> <span style={{marginLeft:6}}>Loading…</span></div>;
  }

  var visited = matchIdx.length > 0;
  var hereBox = (
    <div style={{background:visited?REF_COLOR+"14":"rgba(255,255,255,.04)",borderRadius:10,padding:strip?"8px 10px":"10px 12px",marginBottom:strip?8:10}}>
      <div style={{fontSize:strip?11:12,fontWeight:700,color:visited?REF_COLOR:SUBTLE}}>
        {visited ? "On this card they spent " + fmtDur(hereMs) + (matchIdx.length > 1 ? " over " + matchIdx.length + " visits" : "") : "They didn't visit this card"}
      </div>
      {hereNotes.map(function(n, i) {
        return <div key={i} style={{fontSize:strip?12:13,color:"rgba(255,255,255,.85)",lineHeight:1.45,marginTop:5,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>“{n.text}”</div>;
      })}
    </div>
  );

  var list = (
    <ol ref={listRef} style={{listStyle:"none",margin:0,padding:0,overflowY:"auto",position:"relative",maxHeight:strip?"30vh":undefined,flex:strip?undefined:1,minHeight:0}}>
      {visits.map(function(v, i) {
        var m = TM[v.cardType] || TM.pitch;
        var on = v.cardId === currentCardId;
        var c = v.isObjCard ? OBJ_COLOR : m.color;
        return (
          <li key={i} data-ref-row={i} aria-current={on || undefined}
            style={{display:"flex",alignItems:"center",gap:8,padding:strip?"5px 8px":"6px 8px",borderRadius:8,marginBottom:1,background:on?REF_COLOR+"26":"transparent",boxShadow:on?"inset 3px 0 0 "+REF_COLOR:"none"}}>
            <span style={{width:7,height:7,borderRadius:"50%",background:c,flexShrink:0,opacity:on?1:.7}}/>
            <span style={{flex:1,minWidth:0,fontSize:strip?12:13,color:on?"#fff":"rgba(255,255,255,.66)",fontWeight:on?700:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
              {v.isObjCard && v.stackLabel ? "🛡️ " : ""}{v.cardTitle || "Card"}
            </span>
            <span style={{fontSize:11,color:on?REF_COLOR:SUBTLE,fontFeatureSettings:'"tnum"',flexShrink:0}}>{fmtDur(v.durationMs)}</span>
          </li>
        );
      })}
      {visits.length === 0 && <li style={{fontSize:13,color:SUBTLE,padding:"4px 8px"}}>No cards recorded on this session.</li>}
    </ol>
  );

  var summary = (
    <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
      <span style={{flex:1,minWidth:0,fontSize:strip?12:13,color:"rgba(255,255,255,.85)",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
        {data.name || "Untitled session"}<span style={{color:SUBTLE,fontWeight:400}}> · {data.userName}</span>
      </span>
      <RefOutcome session={data} small/>
    </div>
  );

  if (strip) {
    return (
      <div style={{flexShrink:0,background:"rgba(179,157,219,.06)",borderBottom:"1px solid rgba(179,157,219,.2)"}}>
        <button onClick={function(){ setExpanded(!expanded); }} aria-expanded={expanded}
          style={{display:"flex",alignItems:"center",gap:8,width:"100%",background:"transparent",border:"none",padding:"8px 16px",minHeight:40,cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}>
          <span style={Object.assign({},hdr,{flexShrink:0})}>📎 Ref</span>
          <span style={{flex:1,minWidth:0,fontSize:12,color:"rgba(255,255,255,.75)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
            {visited ? <span>Here <strong style={{color:REF_COLOR}}>{fmtDur(hereMs)}</strong>{hereNotes.length ? " · " + hereNotes.length + " note" + (hereNotes.length !== 1 ? "s" : "") : ""}</span> : <span style={{color:SUBTLE}}>Not visited by reference</span>}
            <span style={{color:SUBTLE}}> · {data.userName}</span>
          </span>
          <RefOutcome session={data} small/>
          <span aria-hidden="true" style={{color:SUBTLE,fontSize:11,transform:expanded?"rotate(180deg)":"none",transition:"transform .2s"}}>▾</span>
        </button>
        {expanded && (
          <div style={{padding:"0 12px 10px",animation:"fadeIn .15s ease both"}}>
            {hereBox}
            <div style={{fontSize:11,color:SUBTLE,margin:"0 4px 4px"}}>{data.name || "Untitled"} · {fmtDur(data.endTs && data.startTs ? data.endTs - data.startTs : null)}{data.soldCardTitle ? " · closed on " + data.soldCardTitle : ""}</div>
            {list}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{display:"flex",flexDirection:"column",minHeight:0,height:"100%",padding:"14px 16px 12px"}}>
      <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:8,marginBottom:8}}>
        <span style={hdr}>📎 Reference</span>
        <span style={{fontSize:12,color:SUBTLE,fontFeatureSettings:'"tnum"'}}>{fmtDur(data.endTs && data.startTs ? data.endTs - data.startTs : null)} total</span>
      </div>
      <div style={{marginBottom:10}}>
        {summary}
        {data.soldCardTitle && <div style={{fontSize:12,color:"#66BB6A",marginTop:3}}>Closed on “{data.soldCardTitle}”</div>}
      </div>
      {hereBox}
      {list}
    </div>
  );
}
