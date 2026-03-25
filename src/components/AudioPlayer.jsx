import { useState, useEffect, useRef } from "react";
import { TM, OBJ_COLOR, SESS_COLOR } from "../lib/constants";
import { solidBtn, ghostSm } from "../lib/styles";

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function msToMmss(ms) {
  if (!ms || ms < 0) return "0:00";
  var totalSec = Math.floor(ms / 1000);
  var m = Math.floor(totalSec / 60);
  var s = totalSec % 60;
  return m + ":" + (s < 10 ? "0" : "") + s;
}

// ─── AUDIO PLAYER ─────────────────────────────────────────────────────────────
// Custom playback engine for per-card-segmented session recordings.
//
// Props:
//   session   — full session object (needs session.id and session.audioSegments)
//   seekRef   — React ref whose .current is set to function(ms) for external seeks
//               (used by the Path tab "▶ Segment" button)
export function AudioPlayer({ session, seekRef }) {
  var [audioUrl,     setAudioUrl]     = useState(null);
  var [loading,      setLoading]      = useState(true);
  var [notFound,     setNotFound]     = useState(false);
  var [playing,      setPlaying]      = useState(false);
  var [currentMs,    setCurrentMs]    = useState(0);
  var [durationMs,   setDurationMs]   = useState(0);
  var [playbackRate, setPlaybackRate] = useState(1);
  var [activeSeg,    setActiveSeg]    = useState(-1);
  var audioRef   = useRef(null);
  var urlRef     = useRef(null); // track object URL for cleanup

  var segments = session.audioSegments || [];

  // Load audio blob from IndexedDB on mount / session change
  useEffect(function() {
    setLoading(true);
    setNotFound(false);
    setCurrentMs(0);
    setDurationMs(0);
    setPlaying(false);
    setActiveSeg(-1);

    import("../lib/audioStore.js").then(function(mod) {
      mod.getAudioBlob(session.id).then(function(result) {
        if (!result || !result.blob) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        var url = URL.createObjectURL(result.blob);
        urlRef.current = url;
        setAudioUrl(url);
        setLoading(false);
      }).catch(function() {
        setNotFound(true);
        setLoading(false);
      });
    }).catch(function() {
      setNotFound(true);
      setLoading(false);
    });

    return function() {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [session.id]);

  // Wire seekRef so Path tab can jump to a segment
  useEffect(function() {
    if (!seekRef) return;
    seekRef.current = function(ms) {
      if (!audioRef.current) return;
      audioRef.current.currentTime = ms / 1000;
      audioRef.current.play().catch(function(){});
      setPlaying(true);
    };
  }, [seekRef]);

  // ── Audio element event handlers ──────────────────────────────────────────
  function handleTimeUpdate() {
    if (!audioRef.current) return;
    var ms = audioRef.current.currentTime * 1000;
    setCurrentMs(ms);
    // Find which segment contains current time
    var idx = segments.findIndex(function(s) { return ms >= s.startMs && ms < s.endMs; });
    setActiveSeg(idx);
  }

  function handleDurationChange() {
    if (!audioRef.current) return;
    var d = audioRef.current.duration;
    if (d && isFinite(d)) setDurationMs(d * 1000);
  }

  function handleBarClick(e) {
    if (!audioRef.current || !durationMs) return;
    var rect = e.currentTarget.getBoundingClientRect();
    var pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioRef.current.currentTime = (pct * durationMs) / 1000;
  }

  function togglePlay() {
    if (!audioRef.current) return;
    if (playing) { audioRef.current.pause(); }
    else          { audioRef.current.play().catch(function(){}); }
  }

  function skip(deltaMs) {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime + deltaMs / 1000);
  }

  function setSpeed(rate) {
    setPlaybackRate(rate);
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }

  function jumpToSegment(seg) {
    if (!audioRef.current) return;
    audioRef.current.currentTime = seg.startMs / 1000;
    audioRef.current.play().catch(function(){});
    setPlaying(true);
  }

  // ── "No recording" state ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{textAlign:"center",color:"rgba(255,255,255,.3)",padding:"48px 0",fontSize:13}}>
        Loading recording…
      </div>
    );
  }

  if (notFound || !audioUrl || segments.length === 0) {
    return (
      <div style={{textAlign:"center",padding:"48px 20px"}}>
        <div style={{fontSize:28,marginBottom:10}}>🎙️</div>
        <div style={{fontSize:13,fontWeight:700,color:"rgba(255,255,255,.45)",marginBottom:6}}>No recording available</div>
        <div style={{fontSize:11,color:"rgba(255,255,255,.25)",lineHeight:1.6}}>
          This session was not recorded,<br/>or was recorded on another device.
        </div>
      </div>
    );
  }

  // ── Current segment label ─────────────────────────────────────────────────
  var curSeg  = activeSeg >= 0 ? segments[activeSeg] : null;
  var segColor = curSeg
    ? (curSeg.isObjCard ? OBJ_COLOR : (TM[curSeg.cardType] || TM.pitch).color)
    : "rgba(255,255,255,.3)";

  var progressPct = durationMs > 0 ? Math.min(100, (currentMs / durationMs) * 100) : 0;

  return (
    <div style={{paddingBottom:24}}>
      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        src={audioUrl}
        style={{display:"none"}}
        onTimeUpdate={handleTimeUpdate}
        onDurationChange={handleDurationChange}
        onPlay={function(){ setPlaying(true); }}
        onPause={function(){ setPlaying(false); }}
        onEnded={function(){ setPlaying(false); setCurrentMs(0); setActiveSeg(-1); }}
      />

      {/* ── Header row ─────────────────────────────────────────────────────── */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{display:"flex",alignItems:"center",gap:7}}>
          <span style={{fontSize:14}}>🎙️</span>
          <span style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,.75)"}}>Recording</span>
          <span style={{fontSize:10,color:"rgba(255,255,255,.3)"}}>· {segments.length} segments</span>
        </div>
        <div style={{display:"flex",gap:5}}>
          {[1, 1.5, 2].map(function(rate) {
            var on = playbackRate === rate;
            return (
              <button key={rate} onClick={function(){ setSpeed(rate); }}
                style={Object.assign({}, ghostSm({fontSize:10,padding:"3px 8px"}), {
                  color: on ? SESS_COLOR : "rgba(255,255,255,.4)",
                  borderColor: on ? "rgba(168,255,62,.4)" : "rgba(255,255,255,.12)",
                })}>
                {rate}×
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Current segment label ────────────────────────────────────────────── */}
      <div style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)",borderLeft:"3px solid "+segColor,borderRadius:"0 10px 10px 0",padding:"8px 12px",marginBottom:14,minHeight:34,transition:"border-color .2s"}}>
        {curSeg ? (
          <div>
            <div style={{fontSize:11,fontWeight:700,color:segColor,marginBottom:1}}>
              {curSeg.isObjCard ? "🛡️ " + (curSeg.stackLabel || "Objection") : (TM[curSeg.cardType]||TM.pitch).icon + " " + (TM[curSeg.cardType]||TM.pitch).label}
            </div>
            <div style={{fontSize:13,color:"#fff",fontWeight:600}}>{curSeg.cardTitle}</div>
          </div>
        ) : (
          <div style={{fontSize:12,color:"rgba(255,255,255,.3)",fontStyle:"italic",lineHeight:2}}>Not playing</div>
        )}
      </div>

      {/* ── Progress bar ────────────────────────────────────────────────────── */}
      <div
        onClick={handleBarClick}
        style={{position:"relative",height:6,background:"rgba(255,255,255,.1)",borderRadius:99,cursor:"pointer",marginBottom:5,userSelect:"none"}}>
        {/* Filled */}
        <div style={{position:"absolute",left:0,top:0,height:"100%",background:SESS_COLOR,borderRadius:99,width:progressPct+"%",transition:"width .1s linear",pointerEvents:"none"}}/>
        {/* Segment markers */}
        {durationMs > 0 && segments.map(function(seg, i) {
          if (seg.startMs <= 0) return null;
          var leftPct = Math.min(99.5, (seg.startMs / durationMs) * 100);
          var isActive = i === activeSeg;
          return (
            <div key={i} style={{position:"absolute",left:leftPct+"%",top:-4,bottom:-4,width:2,background:isActive?SESS_COLOR:"rgba(255,255,255,.3)",borderRadius:1,pointerEvents:"none",transition:"background .15s"}}/>
          );
        })}
        {/* Playhead knob */}
        <div style={{position:"absolute",top:"50%",left:progressPct+"%",transform:"translate(-50%,-50%)",width:12,height:12,borderRadius:"50%",background:SESS_COLOR,boxShadow:"0 0 0 2px rgba(0,0,0,.5)",pointerEvents:"none"}}/>
      </div>

      {/* Time labels */}
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}>
        <span style={{fontSize:10,color:"rgba(255,255,255,.3)"}}>{msToMmss(currentMs)}</span>
        <span style={{fontSize:10,color:"rgba(255,255,255,.3)"}}>{msToMmss(durationMs)}</span>
      </div>

      {/* ── Transport controls ────────────────────────────────────────────────── */}
      <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:10,marginBottom:18}}>
        <button onClick={function(){ skip(-15000); }} style={ghostSm({fontSize:11,padding:"7px 11px"})}>−15s</button>
        <button onClick={togglePlay}
          style={Object.assign({}, solidBtn(SESS_COLOR), {padding:"9px 22px",fontSize:13,borderRadius:99,minWidth:90})}>
          {playing ? "⏸ Pause" : "▶ Play"}
        </button>
        <button onClick={function(){ skip(15000); }} style={ghostSm({fontSize:11,padding:"7px 11px"})}>+15s</button>
      </div>

      {/* ── Segment list ─────────────────────────────────────────────────────── */}
      <div style={{fontSize:10,color:"rgba(255,255,255,.3)",textTransform:"uppercase",letterSpacing:.7,marginBottom:8,fontWeight:700}}>Segments</div>
      <div style={{display:"flex",flexDirection:"column",gap:3}}>
        {segments.map(function(seg, i) {
          var isActive = i === activeSeg;
          var segColor2 = seg.isObjCard ? OBJ_COLOR : (TM[seg.cardType]||TM.pitch).color;
          return (
            <div key={i}
              onClick={function(){ jumpToSegment(seg); }}
              style={{display:"flex",alignItems:"center",gap:9,cursor:"pointer",borderRadius:9,padding:"7px 9px",background:isActive?"rgba(168,255,62,.08)":"transparent",borderLeft:"2px solid "+(isActive?SESS_COLOR:segColor2+"55"),transition:"background .12s"}}>
              <div style={{flexShrink:0,width:8,height:8,borderRadius:"50%",background:isActive?SESS_COLOR:segColor2}}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,color:isActive?"#fff":"rgba(255,255,255,.7)",fontWeight:isActive?700:400,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{seg.cardTitle}</div>
                {seg.isObjCard && seg.stackLabel && (
                  <div style={{fontSize:9,color:OBJ_COLOR}}>{seg.stackLabel}</div>
                )}
              </div>
              <span style={{fontSize:10,color:"rgba(255,255,255,.3)",flexShrink:0,fontVariantNumeric:"tabular-nums"}}>
                {msToMmss(seg.startMs)}
              </span>
              <button
                onClick={function(e){ e.stopPropagation(); jumpToSegment(seg); }}
                style={Object.assign({}, ghostSm({fontSize:10,padding:"3px 8px",color:isActive?SESS_COLOR:"rgba(255,255,255,.4)",borderColor:isActive?"rgba(168,255,62,.35)":"rgba(255,255,255,.1)"}), {flexShrink:0})}>
                ▶
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
