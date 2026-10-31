import { useState, useEffect, useRef, useContext } from "react";
import { LIMITS, themed } from "../lib/constants";
import { solidBtn, ghostBtn, inputSt, labelSt, overlayFill, SHEET_MAX_H } from "../lib/styles";
import { apiPost } from "../lib/api";
import { useCachedGet } from "../lib/dataCache";
import { openLibrary } from "../lib/library";
import { DesktopModal } from "./DesktopModal";
import { Handle } from "./ui";
import DesktopCtx from "../lib/DesktopCtx";

// ─── SAVING CLIPS ─────────────────────────────────────────────────────────────
// The ♥ on a card segment and the "Save clip" of a picked range open SaveClipDialog.
// The server cuts the audio and keeps the session's details with the clip; it lands in
// the person's Library (Library.jsx).

export var CLIP_COLOR = "#FF6B9A";

function fmt(ms) {
  if (!ms || ms < 0) ms = 0;
  var s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
}

// Segment ids of this session the person already saved as clips (filled ♥)
export function useSavedSegments(sessionId) {
  var mine = useCachedGet("/clips?view=mine");
  var set = {};
  (mine.data || []).forEach(function(c) { if (c.sessionId === sessionId && c.segId != null) set[String(c.segId)] = c.id; });
  return set;
}

export function HeartIcon({ filled, size }) {
  var s = size || 14;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true" style={{display:"block"}}>
      <path d="M12 20.5s-7.5-4.6-9.6-9.2C.9 8 2.7 4.5 6.3 4.1c2.2-.2 3.9 1 5.7 3 1.8-2 3.5-3.2 5.7-3 3.6.4 5.4 3.9 3.9 7.2-2.1 4.6-9.6 9.2-9.6 9.2z"
        fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
    </svg>
  );
}

// The Library's icon: a stack of saved items with a heart
export function LibraryIcon({ size }) {
  var s = size || 16;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{display:"block"}}>
      <rect x="3" y="6" width="14" height="15" rx="2.5"/>
      <path d="M7 3h11.5A2.5 2.5 0 0 1 21 5.5V17"/>
      <path d="M10 16.2s-3-1.8-3.6-3.6c-.5-1.4.3-2.7 1.6-2.8.8 0 1.4.4 2 1.1.6-.7 1.2-1.1 2-1.1 1.3.1 2.1 1.4 1.6 2.8-.6 1.8-3.6 3.6-3.6 3.6z" fill="currentColor" stroke="none"/>
    </svg>
  );
}

// Header button that opens the Library (clips + highlights)
export function LibraryButton({ size, small }) {
  var lg = size === "lg";
  var d = lg ? 40 : small ? 30 : 34;
  return (
    <button onClick={function(){ openLibrary({ tab: "clips" }); }} aria-label="Library — saved clips and highlights" title="Library"
      style={{width:d,height:d,borderRadius:"50%",background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.12)",color:"rgba(255,255,255,.85)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0,flexShrink:0,fontFamily:"inherit"}}>
      <LibraryIcon size={lg ? 18 : small ? 14 : 16}/>
    </button>
  );
}

// target = { startMs, endMs, segId?, cardTitle?, cardType?, isObjCard?, stackLabel? }
export function SaveClipDialog({ session, target, onClose, onSaved }) {
  var desktop = useContext(DesktopCtx);
  var defaultTitle = (target.cardTitle ? target.cardTitle : "Clip at " + fmt(target.startMs)).slice(0, LIMITS.clipTitle);
  var [title, setTitle] = useState(defaultTitle);
  var [busy, setBusy] = useState(false);
  var [err, setErr] = useState(null);
  var [saved, setSaved] = useState(null);
  var inputRef = useRef(null);
  useEffect(function() {
    if (!desktop.isTouchPrimary && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function save() {
    var t = title.trim();
    if (!t || busy) return;
    setBusy(true); setErr(null);
    var body = { sessionId: session.id, startMs: Math.round(target.startMs), endMs: Math.round(target.endMs), title: t };
    if (target.segId != null) body.segId = target.segId;
    apiPost("/clips", body)
      .then(function(clip) { setBusy(false); setSaved(clip); if (onSaved) onSaved(clip); })
      .catch(function(e) { setBusy(false); setErr(e && e.message ? e.message : "Couldn't save the clip"); });
  }

  var len = target.endMs - target.startMs;
  var body = saved ? (
    <div style={{padding:"22px 20px 22px",textAlign:"center"}}>
      <div style={{width:52,height:52,borderRadius:"50%",margin:"0 auto 12px",background:CLIP_COLOR+"22",border:"1.5px solid "+CLIP_COLOR+"77",color:CLIP_COLOR,display:"flex",alignItems:"center",justifyContent:"center",animation:"deckPop .5s cubic-bezier(.22,1,.36,1) both"}}>
        <HeartIcon filled size={24}/>
      </div>
      <div style={{fontSize:17,fontWeight:700,color:"#fff",fontFamily:"'Lora',serif"}}>Saved to your Library</div>
      <div style={{fontSize:13,color:"rgba(255,255,255,.5)",marginTop:4,overflowWrap:"anywhere"}}>“{saved.title}” · {fmt(saved.durationMs)}</div>
      <div style={{display:"flex",gap:10,marginTop:18}}>
        <button onClick={onClose} style={Object.assign({}, ghostBtn(), {flex:1})}>Done</button>
        <button onClick={function(){ onClose(); openLibrary({ tab: "clips", clipId: saved.id }); }} style={Object.assign({}, solidBtn(CLIP_COLOR), {flex:1})}>Open Library</button>
      </div>
    </div>
  ) : (
    <div style={{padding:"16px 20px 20px"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:12,padding:"10px 12px",marginBottom:14}}>
        <span style={{color:CLIP_COLOR,flexShrink:0}}><HeartIcon size={18}/></span>
        <div style={{minWidth:0,flex:1}}>
          <div style={{fontSize:13,fontWeight:600,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{session.name || "Session"}</div>
          <div style={{fontSize:12,color:"rgba(255,255,255,.5)",marginTop:2}}>
            {target.segId != null ? (target.isObjCard ? "🛡 " : "") + (target.cardTitle || "Card") + " · whole segment" : "Your selection"} · {fmt(target.startMs)}–{fmt(target.endMs)} ({fmt(len)})
          </div>
        </div>
      </div>
      <label style={labelSt()}>Clip title</label>
      <input ref={inputRef} value={title} maxLength={LIMITS.clipTitle} onChange={function(e){ setTitle(e.target.value); setErr(null); }}
        onKeyDown={function(e){ if (e.key === "Enter") save(); }} placeholder="e.g. Perfect price reframe"
        style={inputSt({marginBottom:4})}/>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"rgba(255,255,255,.35)",marginBottom:14}}>
        <span>The call's details are saved with the clip.</span>
        <span style={{color:title.length >= LIMITS.clipTitle ? "#EF5350" : undefined}}>{title.length}/{LIMITS.clipTitle}</span>
      </div>
      {err && <div role="alert" style={{fontSize:13,color:"#EF8070",marginBottom:12}}>{err}</div>}
      <div style={{display:"flex",gap:10}}>
        <button onClick={onClose} style={Object.assign({}, ghostBtn(), {flex:1})}>Cancel</button>
        <button onClick={save} disabled={!title.trim() || busy} style={Object.assign({}, solidBtn(CLIP_COLOR), {flex:2,opacity:!title.trim() || busy ? .6 : 1})}>
          {busy ? "Saving…" : "♥ Save clip"}
        </button>
      </div>
    </div>
  );

  if (desktop.isDesktop) return <DesktopModal title={saved ? "Clip saved" : "Save clip"} width={440} onClose={onClose}>{body}</DesktopModal>;
  return (
    <div style={overlayFill(700)}>
      <div onClick={onClose} style={{flex:1,background:"rgba(0,0,0,.65)",backdropFilter:"blur(8px)"}}/>
      <div style={{background:themed("#081428"),borderRadius:"22px 22px 0 0",border:"1px solid rgba(255,255,255,.1)",borderBottom:"none",maxHeight:SHEET_MAX_H,overflowY:"auto",animation:"sheetUp .3s cubic-bezier(.22,1,.36,1) both",paddingBottom:"env(safe-area-inset-bottom,0px)"}}>
        <Handle/>
        {!saved && <div style={{padding:"0 20px",fontSize:17,fontWeight:700,color:"#fff",fontFamily:"'Lora',serif"}}>Save clip</div>}
        {body}
      </div>
    </div>
  );
}

// The clip colour at an alpha (range overlays, chips)
export function clipTint(a) { return CLIP_COLOR + Math.round(a * 255).toString(16).padStart(2, "0"); }
