import { useState, useEffect, useRef, useContext, useMemo } from "react";
import { TM, OBJ_COLOR, SESS_COLOR, LIMITS, themed, accentA, isAdminRole } from "../lib/constants";
import { solidBtn, ghostBtn, ghostSm, inputSt, labelSt, iconBtn, overlayFill, SHEET_MAX_H } from "../lib/styles";
import { apiGetBlob, apiPut, apiPost, apiDel } from "../lib/api";
import { useCachedGet, cachedGet } from "../lib/dataCache";
import { onLive } from "../lib/live";
import { markNotificationsReadForClip } from "../lib/notifications";
import { useNoiseGraph, NoiseToggle } from "./AudioPlayer";
import { HeartIcon, LibraryIcon, CLIP_COLOR, clipTint } from "./ClipSave";
import { HL_COLOR } from "./Highlights";
import { Handle } from "./ui";
import DesktopCtx from "../lib/DesktopCtx";

// ─── LIBRARY ──────────────────────────────────────────────────────────────────
// One place for what's worth listening to again: the clips you saved, clips teammates
// shared with you, and the highlighted sessions you can see. A clip opens as a pop-out
// card with its own player and every detail of the call it came from.
//   Desktop/tablet: a wide modal — list on the left, the open clip on the right.
//   Phone: a full-screen sheet; the clip card slides up over the list.

var TXT = "#fff", TXT2 = "rgba(255,255,255,.72)", TXT3 = "rgba(255,255,255,.48)", LINE = "rgba(255,255,255,.08)";
var RATES = [1, 1.25, 1.5, 2];

function mmss(ms) {
  if (!ms || ms < 0) ms = 0;
  var s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
}
function fmtDate(ts, withTime) {
  if (!ts) return "";
  var o = { month: "short", day: "numeric" };
  if (new Date(ts).getFullYear() !== new Date().getFullYear()) o.year = "numeric";
  if (withTime) { o.hour = "numeric"; o.minute = "2-digit"; }
  return new Date(ts).toLocaleString(undefined, o);
}
function cardColor(meta) {
  if (!meta) return CLIP_COLOR;
  return meta.isObjCard ? OBJ_COLOR : (TM[meta.cardType] || {}).color || CLIP_COLOR;
}
function outcomeOf(m) {
  if (!m) return null;
  if (m.sold || m.outcome === "sold") return { label: "Sold", color: "#66BB6A" };
  if (m.outcome === "booked") return { label: "Booked", color: "#00B4FF" };
  if (m.outcome === "abandoned") return { label: "Abandoned", color: "#FFB74D" };
  if (m.mode === "practice") return { label: "Practice", color: "#B39DDB" };
  return { label: "No sale", color: TXT3 };
}

// ─── CLIP PLAYER ──────────────────────────────────────────────────────────────
// The clip's own audio (never the rest of the call), through the same playback noise
// reduction as session reviews.
export function useClipAudio(clip) {
  var [url, setUrl] = useState(null);
  var [state, setState] = useState("loading");
  var [playing, setPlaying] = useState(false);
  var [currentMs, setCurrentMs] = useState(0);
  var [mediaDur, setMediaDur] = useState(0);
  var [rate, setRateSt] = useState(1);
  var audioRef = useRef(null);
  var nr = useNoiseGraph(audioRef, url);
  useEffect(function() {
    var cancelled = false, made = null;
    setState("loading"); setUrl(null); setPlaying(false); setCurrentMs(0); setMediaDur(0);
    apiGetBlob("/clips/" + encodeURIComponent(clip.id) + "/audio")
      .then(function(res) {
        if (cancelled) return;
        made = URL.createObjectURL(res.blob);
        setUrl(made); setState("ready");
      })
      .catch(function() { if (!cancelled) setState("error"); });
    return function() { cancelled = true; if (made) URL.revokeObjectURL(made); };
  }, [clip.id]);
  var durationMs = mediaDur || clip.durationMs || 0;
  var ctl = {
    state: state, playing: playing, currentMs: currentMs, durationMs: durationMs, rate: rate,
    noiseReduction: nr.noiseReduction, setNoiseReduction: nr.setNoiseReduction,
    toggle: function() {
      var a = audioRef.current; if (!a) return;
      if (!a.paused) { a.pause(); return; }
      if (a.ended || a.currentTime * 1000 >= durationMs - 60) a.currentTime = 0;
      nr.ensureGraph();
      a.play().catch(function() {});
    },
    seek: function(ms) {
      var a = audioRef.current; if (!a) return;
      a.currentTime = Math.max(0, Math.min(ms, durationMs)) / 1000;
      setCurrentMs(a.currentTime * 1000);
    },
    skip: function(d) { ctl.seek((audioRef.current ? audioRef.current.currentTime * 1000 : 0) + d); },
    setRate: function(r) { setRateSt(r); if (audioRef.current) audioRef.current.playbackRate = r; },
  };
  ctl.element = url ? (
    <audio ref={audioRef} src={url} preload="auto" style={{display:"none"}}
      onLoadedMetadata={function() { var a = audioRef.current; if (!a) return; a.playbackRate = rate; if (isFinite(a.duration) && a.duration > 0) setMediaDur(a.duration * 1000); }}
      onDurationChange={function() { var a = audioRef.current; if (a && isFinite(a.duration) && a.duration > 0) setMediaDur(a.duration * 1000); }}
      onTimeUpdate={function() { var a = audioRef.current; if (a) setCurrentMs(a.currentTime * 1000); }}
      onPlay={function() { setPlaying(true); }} onPause={function() { setPlaying(false); }}
      onEnded={function() { setPlaying(false); setCurrentMs(durationMs); }}
      onError={function() { setState("error"); }}/>
  ) : null;
  return ctl;
}

// A soft animated "waveform" that fills as the clip plays (decorative; real bars would
// need the audio decoded). Bars are seeded from the clip id so each clip has its own shape.
function ClipWave({ ctl, color, seed, height }) {
  var bars = useMemo(function() {
    var h = 0, out = [];
    for (var i = 0; i < (seed || "").length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    for (var j = 0; j < 56; j++) {
      h = (h * 1103515245 + 12345) >>> 0;
      var base = 0.28 + ((h >>> 8) % 1000) / 1000 * 0.72;
      out.push(base * (0.55 + 0.45 * Math.sin(j / 3.1) * Math.sin(j / 7.3)));
    }
    return out.map(function(v) { return Math.max(0.14, Math.min(1, Math.abs(v))); });
  }, [seed]);
  var p = ctl.durationMs ? Math.min(1, ctl.currentMs / ctl.durationMs) : 0;
  var trackRef = useRef(null);
  function seekAt(clientX) {
    var r = trackRef.current.getBoundingClientRect();
    ctl.seek(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * ctl.durationMs);
  }
  return (
    <div ref={trackRef} role="slider" tabIndex={0} aria-label="Seek within the clip" aria-valuemin={0} aria-valuemax={Math.round(ctl.durationMs / 1000)}
      aria-valuenow={Math.round(ctl.currentMs / 1000)} aria-valuetext={mmss(ctl.currentMs)}
      onClick={function(e) { seekAt(e.clientX); }}
      onKeyDown={function(e) {
        if (e.key === "ArrowLeft") { e.preventDefault(); ctl.skip(-2000); }
        else if (e.key === "ArrowRight") { e.preventDefault(); ctl.skip(2000); }
      }}
      style={{display:"flex",alignItems:"center",gap:2,height:height || 54,cursor:"pointer",userSelect:"none",outlineOffset:4}}>
      {bars.map(function(v, i) {
        var on = (i + 0.5) / bars.length <= p;
        return <span key={i} style={{flex:1,height:(v * 100) + "%",borderRadius:2,background:on ? color : "rgba(255,255,255,.16)",transition:"background .12s",
          transform:ctl.playing && on && Math.abs((i + 0.5) / bars.length - p) < 0.05 ? "scaleY(1.12)" : "none"}}/>;
      })}
    </div>
  );
}

// ─── SHARE A CLIP ─────────────────────────────────────────────────────────────
function ClipSharePanel({ clip, authUser, onDone }) {
  var users = useCachedGet("/sessions/org-users");
  var shares = useCachedGet("/clips/" + clip.id + "/shares");
  var [q, setQ] = useState("");
  var [pick, setPick] = useState(null);
  var [note, setNote] = useState("");
  var [busy, setBusy] = useState(false);
  var [msg, setMsg] = useState(null);
  var boxRef = useRef(null);
  useEffect(function() { if (boxRef.current) boxRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, []);
  var sharedTo = {};
  (shares.data || []).forEach(function(s) { sharedTo[s.toUserId] = s; });
  var list = (users.data || []).filter(function(u) {
    return u.id !== authUser.id && u.id !== clip.userId && (!q || (u.displayName || "").toLowerCase().indexOf(q.toLowerCase()) > -1);
  });
  function send() {
    if (!pick || busy) return;
    setBusy(true); setMsg(null);
    apiPost("/clips/" + clip.id + "/share", { toUserId: pick.id, note: note.trim() || null })
      .then(function() { setBusy(false); setMsg("Shared with " + pick.displayName); setPick(null); setNote(""); shares.reload(); })
      .catch(function(e) { setBusy(false); setMsg(e.message || "Couldn't share"); });
  }
  function revoke(s) {
    apiDel("/clips/" + clip.id + "/shares/" + s.id).then(function() { shares.reload(); }).catch(function() {});
  }
  return (
    <div ref={boxRef} style={{background:"rgba(255,255,255,.035)",border:"1px solid "+LINE,borderRadius:14,padding:"12px 14px",marginTop:12}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
        <span style={{fontSize:13,fontWeight:700,color:TXT}}>Share this clip</span>
        <button onClick={onDone} style={ghostSm({fontSize:11,padding:"3px 9px"})}>Close</button>
      </div>
      {(shares.data || []).length > 0 && (
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
          {(shares.data || []).map(function(s) {
            return (
              <span key={s.id} style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:12,color:TXT2,background:"rgba(255,255,255,.06)",border:"1px solid "+LINE,borderRadius:99,padding:"3px 4px 3px 10px"}}>
                {s.toName || "Former member"}
                <button onClick={function(){ revoke(s); }} aria-label={"Stop sharing with " + (s.toName || "them")}
                  style={{background:"none",border:"none",color:TXT3,cursor:"pointer",fontSize:12,padding:"0 4px",fontFamily:"inherit"}}>✕</button>
              </span>
            );
          })}
        </div>
      )}
      <input value={q} onChange={function(e){ setQ(e.target.value); }} placeholder="Find a teammate…" aria-label="Find a teammate"
        style={inputSt({marginBottom:8,fontSize:14})}/>
      <div style={{maxHeight:150,overflowY:"auto",display:"flex",flexDirection:"column",gap:4,marginBottom:8}}>
        {users.loading && <div style={{fontSize:12,color:TXT3}}>Loading…</div>}
        {list.slice(0, 40).map(function(u) {
          var on = pick && pick.id === u.id, done = !!sharedTo[u.id];
          return (
            <button key={u.id} disabled={done} onClick={function(){ setPick(on ? null : u); }}
              style={{display:"flex",alignItems:"center",gap:8,background:on?clipTint(.14):"transparent",border:"1px solid "+(on?clipTint(.5):"transparent"),borderRadius:9,padding:"7px 9px",cursor:done?"default":"pointer",fontFamily:"inherit",textAlign:"left",opacity:done?.5:1}}>
              <span style={{width:24,height:24,borderRadius:"50%",background:"rgba(255,255,255,.08)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:TXT2,flexShrink:0}}>{(u.displayName || "?")[0].toUpperCase()}</span>
              <span style={{flex:1,fontSize:13,color:TXT}}>{u.displayName}</span>
              {done && <span style={{fontSize:11,color:TXT3}}>shared</span>}
            </button>
          );
        })}
        {!users.loading && list.length === 0 && <div style={{fontSize:12,color:TXT3}}>Nobody matches.</div>}
      </div>
      {pick && (
        <>
          <textarea value={note} maxLength={1000} onChange={function(e){ setNote(e.target.value); }} placeholder={"Add a note for " + pick.displayName + " (optional)"} rows={2}
            style={inputSt({marginBottom:8,fontSize:13,resize:"vertical",minHeight:52})}/>
          <button onClick={send} disabled={busy} style={Object.assign({}, solidBtn(CLIP_COLOR), {width:"100%",fontSize:14,opacity:busy?.6:1})}>{busy ? "Sharing…" : "Share with " + pick.displayName}</button>
        </>
      )}
      {msg && <div role="status" style={{fontSize:12,color:TXT2,marginTop:8}}>{msg}</div>}
    </div>
  );
}

// ─── CLIP CARD (pop-out) ──────────────────────────────────────────────────────
function ClipCard({ clip, authUser, onClose, onDeleted, onOpenSession, compact }) {
  var ctl = useClipAudio(clip);
  var m = clip.meta || {};
  var color = cardColor(m);
  var isMine = clip.userId === authUser.id;
  var canManage = isMine || authUser.role === "owner";
  var [editing, setEditing] = useState(false);
  var [title, setTitle] = useState(clip.title);
  var [sharing, setSharing] = useState(false);
  var [err, setErr] = useState(null);
  useEffect(function() { setTitle(clip.title); setEditing(false); setSharing(false); setErr(null); }, [clip.id, clip.title]);
  useEffect(function() { if (clip._shared) markNotificationsReadForClip(clip.id); }, [clip.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Space toggles play while the card is open (not while typing)
  useEffect(function() {
    function onKey(e) {
      var t = e.target, tag = t && t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (t && t.isContentEditable)) return;
      if (e.key === " " && !e.metaKey && !e.ctrlKey) { e.preventDefault(); ctl.toggle(); }
    }
    document.addEventListener("keydown", onKey);
    return function() { document.removeEventListener("keydown", onKey); };
  });

  function rename() {
    var t = title.trim();
    if (!t || t === clip.title) { setEditing(false); setTitle(clip.title); return; }
    apiPut("/clips/" + clip.id, { title: t }).then(function() { setEditing(false); }).catch(function(e) { setErr(e.message); });
  }
  function remove() {
    if (!window.confirm("Delete the clip \"" + clip.title + "\"? It's removed for everyone it was shared with.")) return;
    apiDel("/clips/" + clip.id).then(function() { onDeleted(clip); }).catch(function(e) { setErr(e.message); });
  }
  var oc = outcomeOf(m);
  var canOpenSession = !!clip.sessionId && !!onOpenSession && (isAdminRole(authUser.role) || m.repId === authUser.id);
  var rows = [
    ["Call", m.sessionName || "Untitled call"],
    ["Rep", m.repName || "Former member"],
    ["Deck", (m.deckIcon ? m.deckIcon + " " : "") + (m.deckName || "—")],
    ["When", fmtDate(m.startTs, true) || "—"],
    ["Type", m.mode === "practice" ? "Practice" : "Live call"],
    m.account ? ["Account", m.account] : null,
    m.contact ? ["Contact", m.contact] : null,
    ["Card", (m.isObjCard ? "🛡 " + (m.stackLabel ? m.stackLabel + " · " : "") : "") + (m.cardTitle || "—")],
    ["In the call", mmss(clip.startMs) + " – " + mmss(clip.endMs) + (m.callMs ? " of " + mmss(m.callMs) : "")],
    m.soldCardTitle ? ["Closed on", m.soldCardTitle] : null,
  ].filter(Boolean);

  return (
    <div style={{display:"flex",flexDirection:"column",minHeight:0,height:"100%"}}>
      {ctl.element}
      {/* Header: deck colour wash, title, actions */}
      <div style={{position:"relative",padding:compact ? "4px 18px 14px" : "18px 20px 14px",background:"linear-gradient(180deg, " + color + "22, transparent)",borderBottom:"1px solid "+LINE,flexShrink:0}}>
        <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
          <div style={{width:44,height:44,borderRadius:13,background:color+"26",border:"1.5px solid "+color+"77",color:color,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            <HeartIcon filled size={20}/>
          </div>
          <div style={{flex:1,minWidth:0}}>
            {editing ? (
              <input autoFocus value={title} maxLength={LIMITS.clipTitle} onChange={function(e){ setTitle(e.target.value); }}
                onKeyDown={function(e){ if (e.key === "Enter") rename(); if (e.key === "Escape") { setEditing(false); setTitle(clip.title); } }}
                onBlur={rename} aria-label="Clip title" style={inputSt({marginBottom:0,fontSize:16,fontWeight:700,padding:"6px 10px"})}/>
            ) : (
              <div style={{fontSize:compact?18:20,fontWeight:700,color:TXT,fontFamily:"'Lora',serif",lineHeight:1.25,overflowWrap:"anywhere"}}>{clip.title}</div>
            )}
            <div style={{fontSize:12,color:TXT3,marginTop:4}}>
              {isMine ? "Saved by you" : "Saved by " + (clip.ownerName || "a teammate")} · {fmtDate(clip.createdAt)}
              {clip._shared && clip.sharedByName ? " · shared by " + clip.sharedByName : ""}
            </div>
          </div>
          {onClose && <button onClick={onClose} aria-label="Close clip" style={Object.assign({}, iconBtn(), {flexShrink:0})}>✕</button>}
        </div>
        {clip._shared && clip.shareNote && (
          <div style={{marginTop:10,fontSize:13,color:TXT2,background:"rgba(255,255,255,.05)",borderLeft:"3px solid "+CLIP_COLOR,borderRadius:"0 8px 8px 0",padding:"7px 10px",lineHeight:1.5}}>“{clip.shareNote}”</div>
        )}
      </div>

      <div style={{flex:1,overflowY:"auto",padding:compact ? "14px 18px 22px" : "16px 20px 22px"}}>
        {/* Player */}
        <div style={{background:"rgba(255,255,255,.035)",border:"1px solid "+color+"33",borderRadius:16,padding:"14px 16px"}}>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <button onClick={ctl.toggle} disabled={ctl.state !== "ready"} aria-label={ctl.playing ? "Pause" : "Play"}
              style={{width:54,height:54,borderRadius:"50%",border:"none",background:ctl.state === "ready" ? color : "rgba(255,255,255,.1)",color:"#000",fontSize:18,fontWeight:900,cursor:ctl.state === "ready" ? "pointer" : "default",flexShrink:0,boxShadow:ctl.playing ? "0 0 0 6px " + color + "26" : "none",transition:"box-shadow .2s"}}>
              {ctl.state === "loading" ? "…" : ctl.playing ? "❚❚" : "▶"}
            </button>
            <div style={{flex:1,minWidth:0}}>
              {ctl.state === "error" ? (
                <div style={{fontSize:13,color:"#EF8070"}}>This clip couldn't be played in this browser.</div>
              ) : (
                <ClipWave ctl={ctl} color={color} seed={clip.id} height={48}/>
              )}
              <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:TXT3,fontVariantNumeric:"tabular-nums",marginTop:4}}>
                <span>{mmss(ctl.currentMs)}</span><span>{mmss(ctl.durationMs)}</span>
              </div>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginTop:12}}>
            <button onClick={function(){ ctl.skip(-5000); }} style={ghostSm({fontSize:12,padding:"4px 10px"})} aria-label="Back 5 seconds">−5s</button>
            <button onClick={function(){ ctl.skip(5000); }} style={ghostSm({fontSize:12,padding:"4px 10px"})} aria-label="Forward 5 seconds">+5s</button>
            <button onClick={function(){ ctl.setRate(RATES[(RATES.indexOf(ctl.rate) + 1) % RATES.length]); }} title="Playback speed"
              style={ghostSm({fontSize:12,padding:"4px 10px",color:ctl.rate !== 1 ? SESS_COLOR : TXT2,minWidth:44})}>{ctl.rate}×</button>
            <NoiseToggle ctl={ctl} f={{ xs: 12 }} compact={compact}/>
          </div>
        </div>

        {/* Session details */}
        <div style={{display:"flex",alignItems:"center",gap:8,margin:"18px 0 8px"}}>
          <span style={{fontSize:11,fontWeight:700,letterSpacing:.9,textTransform:"uppercase",color:TXT3,flex:1}}>From the call</span>
          {oc && <span style={{fontSize:11,fontWeight:700,color:oc.color,background:oc.color+"1c",border:"1px solid "+oc.color+"55",borderRadius:99,padding:"2px 9px"}}>{oc.label}</span>}
          {m.highlight && <span style={{fontSize:11,fontWeight:700,color:HL_COLOR,background:HL_COLOR+"1c",border:"1px solid "+HL_COLOR+"55",borderRadius:99,padding:"2px 9px"}}>★ Highlight</span>}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"auto minmax(0,1fr)",columnGap:14,rowGap:7,fontSize:13}}>
          {rows.map(function(r) {
            return [
              <span key={r[0] + "k"} style={{color:TXT3}}>{r[0]}</span>,
              <span key={r[0] + "v"} style={{color:TXT,overflowWrap:"anywhere"}}>{r[1]}</span>,
            ];
          })}
        </div>
        {m.highlight && m.highlight.note && (
          <div style={{marginTop:12,fontSize:13,color:TXT2,background:HL_COLOR+"12",borderLeft:"3px solid "+HL_COLOR,borderRadius:"0 8px 8px 0",padding:"7px 10px",lineHeight:1.5}}>★ {m.highlight.note}</div>
        )}
        {(m.notes || []).length > 0 && (
          <div style={{marginTop:14}}>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:.9,textTransform:"uppercase",color:TXT3,marginBottom:6}}>Rep's notes on this card</div>
            {(m.notes || []).map(function(n, i) {
              return <div key={i} style={{fontSize:13,color:TXT2,lineHeight:1.5,padding:"6px 0",borderTop:i ? "1px solid "+LINE : "none"}}>📝 {n.text}</div>;
            })}
          </div>
        )}
        {!clip.sessionId && <div style={{marginTop:12,fontSize:12,color:TXT3}}>The original session was deleted — this clip and its details are kept.</div>}

        {err && <div role="alert" style={{marginTop:12,fontSize:13,color:"#EF8070"}}>{err}</div>}

        {/* Actions */}
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:18}}>
          {canManage && !sharing && <button onClick={function(){ setSharing(true); }} style={Object.assign({}, solidBtn(CLIP_COLOR), {padding:"8px 16px",fontSize:13})}>↗ Share</button>}
          {isMine && !editing && <button onClick={function(){ setEditing(true); }} style={ghostSm({fontSize:13,padding:"8px 14px"})}>✎ Rename</button>}
          {canOpenSession && <button onClick={function(){ onOpenSession(clip.sessionId, m.deckId); }} style={ghostSm({fontSize:13,padding:"8px 14px"})}>Open session ›</button>}
          <div style={{flex:1}}/>
          {canManage && <button onClick={remove} style={ghostSm({fontSize:13,padding:"8px 14px",color:"#EF5350",borderColor:"rgba(239,83,80,.35)"})}>Delete</button>}
        </div>
        {sharing && <ClipSharePanel clip={clip} authUser={authUser} onDone={function(){ setSharing(false); }}/>}
      </div>
    </div>
  );
}

// ─── LIST ROWS ────────────────────────────────────────────────────────────────
function ClipRow({ clip, active, onOpen }) {
  var m = clip.meta || {};
  var color = cardColor(m);
  return (
    <button onClick={onOpen} aria-current={active ? "true" : undefined}
      style={{display:"flex",alignItems:"center",gap:12,width:"100%",textAlign:"left",background:active ? color + "18" : "rgba(255,255,255,.03)",
        border:"1px solid "+(active ? color + "66" : LINE),borderRadius:13,padding:"10px 12px",cursor:"pointer",fontFamily:"inherit",transition:"background .15s,border-color .15s"}}>
      <span style={{width:38,height:38,borderRadius:11,background:color+"22",border:"1px solid "+color+"55",color:color,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:12,fontWeight:800,fontVariantNumeric:"tabular-nums"}}>
        {mmss(clip.durationMs)}
      </span>
      <span style={{flex:1,minWidth:0}}>
        <span style={{display:"block",fontSize:14,fontWeight:700,color:TXT,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{clip.title}</span>
        <span style={{display:"block",fontSize:12,color:TXT3,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
          {(m.isObjCard ? "🛡 " : "") + (m.cardTitle || "Part of a call")} · {m.repName || "Former member"} · {fmtDate(m.startTs || clip.createdAt)}
        </span>
        {clip._shared && <span style={{display:"block",fontSize:11,color:CLIP_COLOR,marginTop:2}}>↗ from {clip.sharedByName || clip.ownerName || "a teammate"}</span>}
      </span>
      {m.deckIcon && <span title={m.deckName || ""} style={{fontSize:16,flexShrink:0,opacity:.85}}>{m.deckIcon}</span>}
    </button>
  );
}

function HighlightRow({ s, onOpen }) {
  var h = s.highlight || {};
  return (
    <button onClick={onOpen}
      style={{display:"flex",alignItems:"center",gap:12,width:"100%",textAlign:"left",background:"rgba(255,255,255,.03)",border:"1px solid "+LINE,borderRadius:13,padding:"10px 12px",cursor:"pointer",fontFamily:"inherit"}}>
      <span style={{width:38,height:38,borderRadius:11,background:HL_COLOR+"22",border:"1px solid "+HL_COLOR+"55",color:HL_COLOR,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:17}}>★</span>
      <span style={{flex:1,minWidth:0}}>
        <span style={{display:"block",fontSize:14,fontWeight:700,color:TXT,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name || "Untitled call"}</span>
        <span style={{display:"block",fontSize:12,color:TXT3,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
          {s.userName || "Former member"} · {s.deckName || ""} · {fmtDate(s.startTs)}{h.scope === "team" ? " · team" : ""}
        </span>
        {h.note && <span style={{display:"block",fontSize:12,color:TXT2,marginTop:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>“{h.note}”</span>}
      </span>
      <span style={{color:TXT3,fontSize:18,flexShrink:0}}>›</span>
    </button>
  );
}

// ─── LIBRARY SHEET ────────────────────────────────────────────────────────────
// request: { tab: "clips"|"highlights", clipId?, nonce } (lib/library.js openLibrary)
export function LibrarySheet({ authUser, request, onClose, onOpenHighlight, onOpenSession }) {
  var desktop = useContext(DesktopCtx);
  var wide = !!desktop.isDesktop && !(desktop.isTablet && !desktop.splitPanes);
  var [tab, setTab] = useState((request && request.tab) || "clips");
  var [view, setView] = useState("mine");          // mine | shared
  var [q, setQ] = useState("");
  var [deckF, setDeckF] = useState("");
  var [openId, setOpenId] = useState((request && request.clipId) || null);
  var mine = useCachedGet("/clips?view=mine");
  var shared = useCachedGet("/clips?view=shared");
  var highlights = useCachedGet("/sessions/highlights");

  // A request while open (a notification, another save) jumps to it
  useEffect(function() {
    if (!request) return;
    if (request.tab) setTab(request.tab);
    if (request.clipId) setOpenId(request.clipId);
  }, [request && request.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  // Esc closes the open clip, then the Library
  useEffect(function() {
    function onKey(e) {
      if (e.key !== "Escape") return;
      var t = e.target && e.target.tagName;
      if (t === "INPUT" || t === "TEXTAREA") return;
      if (openId && !wide) setOpenId(null); else onClose();
    }
    document.addEventListener("keydown", onKey);
    return function() { document.removeEventListener("keydown", onKey); };
  }, [openId, wide, onClose]);
  useEffect(function() { return onLive("clip.changed", function(d) { if (d && d.deleted && d.clipId === openId) setOpenId(null); }); }, [openId]);

  var mineList = (mine.data || []).map(function(c) { return c; });
  var sharedList = (shared.data || []).map(function(c) { return Object.assign({ _shared: true }, c); });
  // Opening a shared clip from a notification lands on the right list
  useEffect(function() {
    if (!openId || tab !== "clips") return;
    if (sharedList.some(function(c) { return c.id === openId; }) && !mineList.some(function(c) { return c.id === openId; })) setView("shared");
  }, [openId, shared.data, mine.data]); // eslint-disable-line react-hooks/exhaustive-deps

  var source = view === "shared" ? sharedList : mineList;
  var decks = {};
  source.forEach(function(c) { var m = c.meta || {}; if (m.deckId) decks[m.deckId] = (m.deckIcon ? m.deckIcon + " " : "") + (m.deckName || "Deck"); });
  var ql = q.trim().toLowerCase();
  var clips = source.filter(function(c) {
    var m = c.meta || {};
    if (deckF && m.deckId !== deckF) return false;
    if (!ql) return true;
    return [c.title, m.cardTitle, m.repName, m.sessionName, m.deckName, m.account, m.contact, m.stackLabel].some(function(x) { return x && String(x).toLowerCase().indexOf(ql) > -1; });
  });
  var hls = (highlights.data || []).filter(function(s) {
    if (!ql) return true;
    return [s.name, s.userName, s.deckName, s.highlight && s.highlight.note].some(function(x) { return x && String(x).toLowerCase().indexOf(ql) > -1; });
  });
  var openClip = openId ? mineList.concat(sharedList).find(function(c) { return c.id === openId; }) : null;
  var loading = tab === "clips" ? (view === "mine" ? mine.loading : shared.loading) : highlights.loading;

  function seg(on, label, onClick, count) {
    return (
      <button key={label} onClick={onClick} aria-pressed={on}
        style={{flex:1,background:on?"rgba(255,255,255,.13)":"transparent",border:"none",borderRadius:9,padding:wide?"8px 12px":"8px 6px",fontSize:13,fontWeight:on?700:500,color:on?TXT:TXT3,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
        {label}{count != null ? <span style={{marginLeft:6,fontSize:11,color:on?TXT2:TXT3}}>{count}</span> : null}
      </button>
    );
  }

  var listPane = (
    <div style={{display:"flex",flexDirection:"column",minHeight:0,height:"100%"}}>
      <div style={{padding:wide?"14px 16px 10px":"4px 16px 10px",flexShrink:0,display:"flex",flexDirection:"column",gap:10}}>
        <div style={{display:"flex",background:"rgba(255,255,255,.05)",borderRadius:11,padding:3,gap:2}}>
          {seg(tab === "clips", "♥ Clips", function(){ setTab("clips"); }, mineList.length + sharedList.length)}
          {seg(tab === "highlights", "★ Highlights", function(){ setTab("highlights"); setOpenId(null); }, (highlights.data || []).length)}
        </div>
        {tab === "clips" && (
          <div style={{display:"flex",gap:6}}>
            {[["mine","Saved by me",mineList.length],["shared","Shared with me",sharedList.length]].map(function(v) {
              var on = view === v[0];
              return (
                <button key={v[0]} onClick={function(){ setView(v[0]); setDeckF(""); }} aria-pressed={on}
                  style={{background:on?clipTint(.15):"transparent",border:"1px solid "+(on?clipTint(.5):"rgba(255,255,255,.12)"),color:on?CLIP_COLOR:TXT3,borderRadius:99,padding:"5px 12px",fontSize:12,fontWeight:on?700:500,cursor:"pointer",fontFamily:"inherit"}}>
                  {v[1]} · {v[2]}
                </button>
              );
            })}
          </div>
        )}
        <div style={{display:"flex",gap:8}}>
          <input value={q} onChange={function(e){ setQ(e.target.value); }} placeholder={tab === "clips" ? "Search clips, reps, cards…" : "Search highlights…"} aria-label="Search the library"
            style={Object.assign({}, inputSt({marginBottom:0,fontSize:14,height:38,padding:"0 12px"}), {flex:1,minWidth:0})}/>
          {tab === "clips" && Object.keys(decks).length > 1 && (
            <select value={deckF} onChange={function(e){ setDeckF(e.target.value); }} aria-label="Filter by deck"
              style={Object.assign({}, inputSt({marginBottom:0,fontSize:13,height:38,padding:"0 8px"}), {width:"auto",maxWidth:150,appearance:"auto"})}>
              <option value="">All decks</option>
              {Object.keys(decks).map(function(id) { return <option key={id} value={id}>{decks[id]}</option>; })}
            </select>
          )}
        </div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"0 16px 18px",display:"flex",flexDirection:"column",gap:7}}>
        {loading && <div style={{fontSize:13,color:TXT3,padding:"20px 0",textAlign:"center"}}>Loading…</div>}
        {tab === "clips" && !loading && clips.length === 0 && (
          <div style={{textAlign:"center",padding:"34px 12px",color:TXT3,fontSize:14,lineHeight:1.6}}>
            <div style={{color:CLIP_COLOR,display:"flex",justifyContent:"center",marginBottom:10}}><HeartIcon size={30}/></div>
            {source.length ? "No clips match." : view === "mine"
              ? <>No saved clips yet.<br/>Open a session's <strong style={{color:TXT2}}>Playback</strong> tab and tap <strong style={{color:CLIP_COLOR}}>♥</strong> on a card, or <strong style={{color:TXT2}}>Save a part…</strong> to pick any moment.</>
              : "Nobody has shared a clip with you yet."}
          </div>
        )}
        {tab === "clips" && clips.map(function(c) {
          return <ClipRow key={c.id} clip={c} active={c.id === openId} onOpen={function(){ setOpenId(c.id); }}/>;
        })}
        {tab === "highlights" && !loading && hls.length === 0 && (
          <div style={{textAlign:"center",padding:"34px 12px",color:TXT3,fontSize:14,lineHeight:1.6}}>
            <div style={{color:HL_COLOR,fontSize:28,marginBottom:6}}>★</div>
            {(highlights.data || []).length ? "No highlights match." : "No highlighted sessions yet. Admins mark great calls as highlights from a session's review."}
          </div>
        )}
        {tab === "highlights" && hls.map(function(s) {
          return <HighlightRow key={s.id} s={s} onOpen={function(){ onClose(); onOpenHighlight(s); }}/>;
        })}
      </div>
    </div>
  );

  var cardEl = openClip ? (
    <ClipCard key={openClip.id} clip={openClip} authUser={authUser} compact={!wide}
      onClose={wide ? null : function(){ setOpenId(null); }}
      onDeleted={function(){ setOpenId(null); }}
      onOpenSession={onOpenSession ? function(sid, deckId){ onClose(); onOpenSession(sid, deckId); } : null}/>
  ) : null;

  var title = (
    <span style={{display:"inline-flex",alignItems:"center",gap:9}}>
      <span style={{color:CLIP_COLOR}}><LibraryIcon size={18}/></span>Library
    </span>
  );

  if (wide) {
    return (
      <div onClick={function(e){ if (e.target === e.currentTarget) onClose(); }}
        style={{position:"fixed",inset:0,zIndex:520,background:"rgba(0,0,0,.72)",backdropFilter:"blur(12px)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
        <div role="dialog" aria-label="Library"
          style={{width:"min(1060px, 100%)",height:"min(760px, calc(var(--vvh, 100vh) - 48px))",display:"flex",flexDirection:"column",background:themed("#081428"),border:"1px solid rgba(255,255,255,.1)",borderRadius:20,boxShadow:"0 24px 80px rgba(0,0,0,.8)",overflow:"hidden",animation:"popIn .24s cubic-bezier(.22,1,.36,1) both"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:"1px solid "+LINE,flexShrink:0}}>
            <div style={{fontSize:17,fontWeight:700,color:TXT,fontFamily:"'Lora',serif"}}>{title}</div>
            <button onClick={onClose} aria-label="Close library" style={iconBtn()}>✕</button>
          </div>
          <div style={{flex:1,display:"flex",minHeight:0}}>
            <div style={{width:desktop.compact ? 340 : 400,flexShrink:0,borderRight:"1px solid "+LINE,minHeight:0}}>{listPane}</div>
            <div style={{flex:1,minWidth:0,minHeight:0,background:"rgba(255,255,255,.015)"}}>
              {cardEl || (
                <div style={{height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10,color:TXT3,fontSize:14,textAlign:"center",padding:24}}>
                  <span style={{color:tab === "highlights" ? HL_COLOR : CLIP_COLOR,opacity:.8}}>{tab === "highlights" ? <span style={{fontSize:34}}>★</span> : <HeartIcon size={34}/>}</span>
                  {tab === "highlights" ? "Open a highlighted session to review it." : "Pick a clip to play it and see the call it came from."}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Phone (and narrow tablets): full-screen sheet; the clip card slides up over the list
  return (
    <div style={Object.assign({}, overlayFill(520), {background:themed("#060d1a"),animation:"sheetUp .3s cubic-bezier(.22,1,.36,1) both"})} role="dialog" aria-label="Library">
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px 10px",flexShrink:0,paddingTop:"calc(12px + env(safe-area-inset-top,0px))"}}>
        <div style={{fontSize:18,fontWeight:700,color:TXT,fontFamily:"'Lora',serif"}}>{title}</div>
        <button onClick={onClose} aria-label="Close library" style={iconBtn()}>✕</button>
      </div>
      <div style={{flex:1,minHeight:0}}>{listPane}</div>
      {cardEl && (
        <div style={overlayFill(530)}>
          <div onClick={function(){ setOpenId(null); }} style={{flex:"0 0 auto",minHeight:"var(--sheet-gap, 48px)",background:"rgba(0,0,0,.55)",backdropFilter:"blur(6px)"}}/>
          <div style={{flex:1,minHeight:0,maxHeight:SHEET_MAX_H,background:themed("#0a1830"),borderRadius:"22px 22px 0 0",border:"1px solid rgba(255,255,255,.1)",borderBottom:"none",display:"flex",flexDirection:"column",overflow:"hidden",animation:"sheetUp .3s cubic-bezier(.22,1,.36,1) both",paddingBottom:"env(safe-area-inset-bottom,0px)"}}>
            <Handle/>
            <div style={{flex:1,minHeight:0}}>{cardEl}</div>
          </div>
        </div>
      )}
    </div>
  );
}
