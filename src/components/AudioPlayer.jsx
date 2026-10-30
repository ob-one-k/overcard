import { useState, useEffect, useRef } from "react";
import { TM, OBJ_COLOR, SESS_COLOR } from "../lib/constants";
import { solidBtn, ghostSm } from "../lib/styles";
import { apiGetBlob } from "../lib/api";
import { getAudioBlob } from "../lib/audioStore";
import { useUploadStatus, retrySessionAudio } from "../lib/audioUpload";

// ─── SESSION AUDIO PLAYBACK ───────────────────────────────────────────────────
// useSessionAudio(session) owns ONE <audio> element per session review, so every tab
// (mini-bar, Playback, Path, Notes) controls the same player. Two ways to listen:
//   • full  — the whole recording, start to finish, seamlessly
//   • clip  — a single card's segment, out of context: stops automatically at the
//             segment's end ("Continue" resumes the full recording from there)
// Audio comes from the server (any device) with this device's local copy as a fallback
// (recordings made before server storage, or still uploading).

export function msToMmss(ms) {
  if (!ms || ms < 0) return "0:00";
  var totalSec = Math.floor(ms / 1000);
  var m = Math.floor(totalSec / 60);
  var s = totalSec % 60;
  return m + ":" + (s < 10 ? "0" : "") + s;
}

export function segColor(seg) {
  return seg.isObjCard ? OBJ_COLOR : (TM[seg.cardType] || TM.pitch).color;
}

// Older sessions stored segments without segId — derive one so lookups still work
function normalizeSegments(session) {
  return (session.audioSegments || []).map(function(sg, i) {
    return Object.assign({ segId: sg.segId != null ? sg.segId : "i" + i, segmentIndex: i }, sg);
  }).sort(function(a, b) { return a.startMs - b.startMs; });
}

// Visit events carry ts = wall-clock time the card was LEFT, matching segment endMs.
// Maps a wall-clock timestamp (a note, say) to a position in the recording.
export function wallClockToAudioMs(ts, segments) {
  for (var i = 0; i < segments.length; i++) {
    var sg = segments[i];
    if (typeof sg.segId !== "number") continue;
    var len = sg.endMs - sg.startMs;
    if (ts <= sg.segId && ts >= sg.segId - len) return sg.endMs - (sg.segId - ts);
  }
  return null;
}

export function useSessionAudio(session) {
  var [url,       setUrl]       = useState(null);
  var [state,     setState]     = useState("loading");   // loading | ready | none | error
  var [source,    setSource]    = useState(null);        // "server" | "device"
  var [mime,      setMime]      = useState("");
  var [playing,   setPlaying]   = useState(false);
  var [currentMs, setCurrentMs] = useState(0);
  var [mediaDur,  setMediaDur]  = useState(0);
  var [rate,      setRateSt]    = useState(1);
  var [clip,      setClip]      = useState(null);        // segment being played out of context
  var [reloadKey, setReloadKey] = useState(0);
  var audioRef = useRef(null);
  var urlRef   = useRef(null);
  var clipRef  = useRef(null);
  var rafRef   = useRef(null);
  var fixDurRef = useRef(false);
  var upload   = useUploadStatus(session.id);

  var segments = normalizeSegments(session);
  var lastSegEnd = segments.length ? segments[segments.length - 1].endMs : 0;
  var durationMs = mediaDur || session.audioDurationMs || lastSegEnd || 0;

  // Re-fetch once a background upload for this session finishes
  var uploadDone = upload && upload.state === "done";
  // (unless it's already playing from this device's copy — don't interrupt the listener)
  useEffect(function() { if (uploadDone && state !== "ready") setReloadKey(function(k) { return k + 1; }); }, [uploadDone]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(function() {
    var cancelled = false;
    setState("loading"); setUrl(null); setPlaying(false); setCurrentMs(0); setMediaDur(0); setClip(null);
    clipRef.current = null;
    function useBlob(blob, src) {
      if (cancelled || !blob) return false;
      var u = URL.createObjectURL(blob);
      urlRef.current = u; setUrl(u); setSource(src); setMime(blob.type || ""); setState("ready");
      return true;
    }
    function fromServer() {
      return apiGetBlob("/sessions/" + encodeURIComponent(session.id) + "/audio")
        .then(function(res) { return useBlob(res.blob, "server"); })
        .catch(function() { return false; });
    }
    function fromDevice() {
      return getAudioBlob(session.id)
        .then(function(r) { return useBlob(r && r.blob, "device"); })
        .catch(function() { return false; });
    }
    // Uploaded sessions come from the server; a session that was recorded but whose list entry
    // predates the upload (or whose upload failed) is checked on this device first, then the server.
    // Sessions never recorded skip both lookups.
    var recorded = session.hasAudio || uploadDone || !!session.audioDurationMs || !!(session.audioSegments && session.audioSegments.length);
    var order = (session.hasAudio || uploadDone) ? [fromServer, fromDevice] : recorded ? [fromDevice, fromServer] : [fromDevice];
    order.reduce(function(p, fn) {
      return p.then(function(done) { return done || cancelled ? done : fn(); });
    }, Promise.resolve(false)).then(function(done) {
      if (!done && !cancelled) setState("none");
    });
    return function() {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
    };
  }, [session.id, session.hasAudio, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Precise clip end: poll every frame while a clip plays (timeupdate only fires ~4×/s)
  function watchClip() {
    cancelAnimationFrame(rafRef.current);
    function tick() {
      var a = audioRef.current, c = clipRef.current;
      if (!a || !c) return;
      if (a.currentTime * 1000 >= c.endMs) {
        a.pause();
        a.currentTime = c.endMs / 1000;
        setCurrentMs(c.endMs);
        return;
      }
      if (!a.paused) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  function setClipSeg(seg) { clipRef.current = seg; setClip(seg); }

  function playAt(ms) {
    var a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.max(0, ms) / 1000;
    a.play().catch(function() {});
  }

  var ctl = {
    state: state, source: source, url: url, upload: upload,
    fileExt: /mp4|aac|m4a/.test(mime) ? ".m4a" : /ogg/.test(mime) ? ".ogg" : ".webm",
    playing: playing, currentMs: currentMs, durationMs: durationMs, rate: rate, clip: clip,
    segments: segments,
    activeSeg: (function() {
      for (var i = 0; i < segments.length; i++) {
        if (currentMs >= segments[i].startMs && currentMs < segments[i].endMs) return segments[i];
      }
      return null;
    })(),
    // Full recording from a position (in context)
    playFrom: function(ms) { setClipSeg(null); playAt(ms); },
    // One card's segment, out of context — stops at its end
    playClip: function(seg) { setClipSeg(seg); playAt(seg.startMs); watchClip(); },
    // Leave clip mode and keep listening from the current position
    continueFull: function() { setClipSeg(null); var a = audioRef.current; if (a) a.play().catch(function() {}); },
    toggle: function() {
      var a = audioRef.current;
      if (!a) return;
      if (!a.paused) { a.pause(); return; }
      var c = clipRef.current;
      // Replaying a finished clip starts it over
      if (c && a.currentTime * 1000 >= c.endMs - 50) a.currentTime = c.startMs / 1000;
      a.play().catch(function() {});
      if (c) watchClip();
    },
    seek: function(ms) {
      var a = audioRef.current;
      if (!a) return;
      var c = clipRef.current;
      if (c && (ms < c.startMs || ms > c.endMs)) setClipSeg(null);   // seeking outside the clip = full mode
      a.currentTime = Math.max(0, Math.min(ms, durationMs || ms)) / 1000;
      setCurrentMs(a.currentTime * 1000);
    },
    skip: function(delta) { ctl.seek((audioRef.current ? audioRef.current.currentTime * 1000 : 0) + delta); },
    setRate: function(r) { setRateSt(r); if (audioRef.current) audioRef.current.playbackRate = r; },
    retryUpload: function() { return retrySessionAudio(session.id); },
    reload: function() { setReloadKey(function(k) { return k + 1; }); },
  };

  ctl.element = url ? (
    <audio
      ref={audioRef}
      src={url}
      preload="auto"
      style={{display:"none"}}
      onLoadedMetadata={function() {
        var a = audioRef.current;
        if (!a) return;
        a.playbackRate = rate;
        if (isFinite(a.duration) && a.duration > 0) { setMediaDur(a.duration * 1000); return; }
        // MediaRecorder WebM has no duration header — seeking far ahead makes Chrome compute it
        fixDurRef.current = true;
        a.currentTime = 1e7;
      }}
      onDurationChange={function() {
        var a = audioRef.current;
        if (a && isFinite(a.duration) && a.duration > 0) {
          setMediaDur(a.duration * 1000);
          if (fixDurRef.current) { fixDurRef.current = false; a.currentTime = 0; }
        }
      }}
      onSeeked={function() {
        var a = audioRef.current;
        if (a && fixDurRef.current && isFinite(a.duration)) { fixDurRef.current = false; a.currentTime = 0; }
      }}
      onTimeUpdate={function() {
        var a = audioRef.current;
        if (!a || fixDurRef.current) return;
        var ms = a.currentTime * 1000;
        var c = clipRef.current;
        if (c && ms >= c.endMs) { a.pause(); ms = c.endMs; }
        setCurrentMs(ms);
      }}
      onPlay={function() { setPlaying(true); }}
      onPause={function() { setPlaying(false); }}
      onEnded={function() { setPlaying(false); }}
      onError={function() { setState("error"); }}
    />
  ) : null;

  return ctl;
}

// ─── SHARED BITS ──────────────────────────────────────────────────────────────
function scale(size) {
  return size === "lg" ? { xs:12, sm:13, md:14, lg:16, btn:"8px 14px" } : { xs:9, sm:10, md:12, lg:13, btn:"6px 10px" };
}

var RATES = [1, 1.25, 1.5, 2];

// Click/drag-free progress track with segment blocks coloured by card type
function SegmentTrack({ ctl, height, onHoverSeg }) {
  var total = ctl.durationMs || 1;
  var pct = Math.min(100, (ctl.currentMs / total) * 100);
  function click(e) {
    var r = e.currentTarget.getBoundingClientRect();
    ctl.seek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * total);
  }
  return (
    <div onClick={click} role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(total / 1000)} aria-valuenow={Math.round(ctl.currentMs / 1000)}
      style={{position:"relative",height:height,borderRadius:6,background:"rgba(255,255,255,.07)",cursor:"pointer",overflow:"hidden",userSelect:"none"}}>
      {ctl.segments.map(function(sg) {
        var on = ctl.activeSeg && ctl.activeSeg.segId === sg.segId;
        return (
          <div key={sg.segId}
            onMouseEnter={onHoverSeg ? function(){ onHoverSeg(sg); } : undefined}
            onMouseLeave={onHoverSeg ? function(){ onHoverSeg(null); } : undefined}
            title={sg.cardTitle + " · " + msToMmss(sg.startMs) + "–" + msToMmss(sg.endMs)}
            style={{position:"absolute",top:0,bottom:0,left:(sg.startMs / total * 100) + "%",width:Math.max(0.3, (sg.endMs - sg.startMs) / total * 100) + "%",
              background:segColor(sg),opacity:on?.75:.32,borderRight:"1px solid rgba(6,13,26,.9)",transition:"opacity .15s"}}/>
        );
      })}
      {ctl.clip && (
        <div style={{position:"absolute",top:0,bottom:0,left:(ctl.clip.startMs / total * 100) + "%",width:((ctl.clip.endMs - ctl.clip.startMs) / total * 100) + "%",
          boxShadow:"inset 0 0 0 2px #fff",borderRadius:3,pointerEvents:"none"}}/>
      )}
      <div style={{position:"absolute",top:0,bottom:0,left:0,width:pct+"%",background:"rgba(255,255,255,.18)",pointerEvents:"none"}}/>
      <div style={{position:"absolute",top:0,bottom:0,left:pct+"%",width:2,marginLeft:-1,background:"#fff",boxShadow:"0 0 6px rgba(255,255,255,.8)",pointerEvents:"none"}}/>
    </div>
  );
}

// Upload progress / failure, shown to the session owner right after a session
export function UploadNotice({ ctl, size }) {
  var f = scale(size);
  var u = ctl.upload;
  if (!u || u.state === "done") return null;
  if (u.state === "uploading") {
    return (
      <div style={{display:"flex",alignItems:"center",gap:8,fontSize:f.sm,color:"rgba(255,255,255,.6)",background:"rgba(0,180,255,.08)",border:"1px solid rgba(0,180,255,.25)",borderRadius:10,padding:"7px 11px"}}>
        <span>⬆ Uploading recording…</span>
        <div style={{flex:1,height:4,background:"rgba(255,255,255,.1)",borderRadius:99,overflow:"hidden"}}>
          <div style={{width:Math.round((u.progress || 0) * 100) + "%",height:"100%",background:"#00B4FF"}}/>
        </div>
        <span style={{fontVariantNumeric:"tabular-nums"}}>{Math.round((u.progress || 0) * 100)}%</span>
      </div>
    );
  }
  return (
    <div role="alert" style={{display:"flex",alignItems:"center",gap:8,fontSize:f.sm,color:"#EF8070",background:"rgba(239,83,80,.08)",border:"1px solid rgba(239,83,80,.3)",borderRadius:10,padding:"7px 11px"}}>
      <span style={{flex:1}}>⚠ Recording not uploaded yet — only playable on this device. {u.error ? "(" + u.error + ")" : ""}</span>
      <button onClick={ctl.retryUpload} style={ghostSm({fontSize:f.sm,color:"#fff"})}>Retry upload</button>
    </div>
  );
}

// ─── MINI PLAYER BAR (docked in the review on every tab) ─────────────────────
export function AudioMiniBar({ ctl, size }) {
  var f = scale(size);
  var lg = size === "lg";
  if (ctl.state !== "ready") return null;
  var seg = ctl.clip || ctl.activeSeg;
  var c = seg ? segColor(seg) : SESS_COLOR;
  return (
    <div style={{display:"flex",alignItems:"center",gap:lg?12:8,padding:lg?"10px 16px":"7px 12px",background:"rgba(8,20,48,.92)",borderBottom:"1px solid rgba(255,255,255,.07)",flexShrink:0}}>
      <button onClick={ctl.toggle} aria-label={ctl.playing ? "Pause" : "Play"}
        style={{width:lg?38:30,height:lg?38:30,borderRadius:"50%",border:"none",background:SESS_COLOR,color:"#000",fontSize:lg?15:12,fontWeight:800,cursor:"pointer",flexShrink:0}}>
        {ctl.playing ? "❚❚" : "▶"}
      </button>
      <div style={{minWidth:0,flex:lg?"0 0 220px":"0 1 120px"}}>
        <div style={{fontSize:f.xs,fontWeight:700,color:c,textTransform:"uppercase",letterSpacing:.5,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
          {ctl.clip ? "Clip · out of context" : seg ? (seg.isObjCard ? "🛡 " + (seg.stackLabel || "Objection") : (TM[seg.cardType] || TM.pitch).label) : "Full recording"}
        </div>
        <div style={{fontSize:f.md,color:"#fff",fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{seg ? seg.cardTitle : "Session audio"}</div>
      </div>
      <div style={{flex:1,minWidth:60}}>
        <SegmentTrack ctl={ctl} height={lg?10:8}/>
      </div>
      <span style={{fontSize:f.sm,color:"rgba(255,255,255,.55)",fontVariantNumeric:"tabular-nums",flexShrink:0}}>
        {msToMmss(ctl.currentMs)}<span style={{color:"rgba(255,255,255,.3)"}}> / {msToMmss(ctl.durationMs)}</span>
      </span>
      {ctl.clip && (
        <button onClick={ctl.continueFull} title="Keep listening to the full recording from here"
          style={ghostSm({fontSize:f.xs,padding:"4px 9px",color:SESS_COLOR,borderColor:"rgba(168,255,62,.35)"})}>Continue ▸</button>
      )}
      {lg && <button onClick={function(){ ctl.skip(-15000); }} style={ghostSm({fontSize:f.xs,padding:"4px 8px"})} aria-label="Back 15 seconds">−15</button>}
      {lg && <button onClick={function(){ ctl.skip(15000); }} style={ghostSm({fontSize:f.xs,padding:"4px 8px"})} aria-label="Forward 15 seconds">+15</button>}
      <button onClick={function(){ ctl.setRate(RATES[(RATES.indexOf(ctl.rate) + 1) % RATES.length]); }} title="Playback speed"
        style={ghostSm({fontSize:f.xs,padding:"4px 8px",color:ctl.rate !== 1 ? SESS_COLOR : "rgba(255,255,255,.7)",minWidth:lg?44:36})}>
        {ctl.rate}×
      </button>
    </div>
  );
}

// ─── PLAYBACK TAB ─────────────────────────────────────────────────────────────
export function AudioPlayback({ ctl, size, canDownload, sessionName }) {
  var f = scale(size);
  var lg = size === "lg";
  var [grouped, setGrouped] = useState(false);
  var [hoverSeg, setHoverSeg] = useState(null);

  // Keyboard: space play/pause, ←/→ ±5s, J/L ±15s (ignored while typing)
  useEffect(function() {
    if (ctl.state !== "ready") return;
    function onKey(e) {
      var t = e.target, tag = t && t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === " ") { e.preventDefault(); ctl.toggle(); }
      else if (e.key === "ArrowLeft")  { e.preventDefault(); ctl.skip(-5000); }
      else if (e.key === "ArrowRight") { e.preventDefault(); ctl.skip(5000); }
      else if (e.key === "j" || e.key === "J") ctl.skip(-15000);
      else if (e.key === "l" || e.key === "L") ctl.skip(15000);
    }
    document.addEventListener("keydown", onKey);
    return function() { document.removeEventListener("keydown", onKey); };
  });

  if (ctl.state === "loading") {
    return <div style={{textAlign:"center",color:"rgba(255,255,255,.35)",padding:"48px 0",fontSize:f.md}}>Loading recording…</div>;
  }
  if (ctl.state !== "ready") {
    return (
      <div style={{textAlign:"center",padding:"48px 20px"}}>
        <div style={{fontSize:28,marginBottom:10}}>🎙️</div>
        <div style={{fontSize:f.lg,fontWeight:700,color:"rgba(255,255,255,.5)",marginBottom:6}}>
          {ctl.state === "error" ? "This recording couldn't be played" : "No recording for this session"}
        </div>
        <div style={{fontSize:f.sm,color:"rgba(255,255,255,.3)",lineHeight:1.6}}>
          {ctl.state === "error" ? "The audio file may be damaged or in a format this browser can't play." : "Turn on \"Record audio\" before starting a session to capture the call."}
        </div>
        {ctl.upload && ctl.upload.state === "failed" && <div style={{marginTop:14}}><UploadNotice ctl={ctl} size={size}/></div>}
      </div>
    );
  }

  // Per-card grouping: all visits to the same card together
  var groups = [];
  if (grouped) {
    var byCard = {};
    ctl.segments.forEach(function(sg) {
      var k = (sg.isObjCard ? "o:" : "c:") + sg.cardId;
      if (!byCard[k]) { byCard[k] = { key:k, first:sg, segs:[], total:0 }; groups.push(byCard[k]); }
      byCard[k].segs.push(sg); byCard[k].total += sg.endMs - sg.startMs;
    });
  }

  function segRow(sg, label) {
    var on = ctl.activeSeg && ctl.activeSeg.segId === sg.segId;
    var isClip = ctl.clip && ctl.clip.segId === sg.segId;
    var c = segColor(sg);
    var prog = on ? Math.min(1, (ctl.currentMs - sg.startMs) / Math.max(1, sg.endMs - sg.startMs)) : 0;
    return (
      <div key={sg.segId} onMouseEnter={function(){ setHoverSeg(sg); }} onMouseLeave={function(){ setHoverSeg(null); }}
        style={{position:"relative",display:"flex",alignItems:"center",gap:lg?10:8,borderRadius:10,padding:lg?"9px 12px":"7px 9px",
          background:on?"rgba(255,255,255,.08)":hoverSeg&&hoverSeg.segId===sg.segId?"rgba(255,255,255,.04)":"transparent",
          borderLeft:"3px solid "+(on?c:c+"55"),overflow:"hidden"}}>
        {on && <div style={{position:"absolute",left:0,bottom:0,height:2,width:(prog * 100)+"%",background:c}}/>}
        <span style={{fontSize:f.xs,color:"rgba(255,255,255,.35)",fontVariantNumeric:"tabular-nums",width:lg?44:34,flexShrink:0}}>{msToMmss(sg.startMs)}</span>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:f.md,color:on?"#fff":"rgba(255,255,255,.78)",fontWeight:on?700:500,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{label || sg.cardTitle}</div>
          {sg.isObjCard && sg.stackLabel && <div style={{fontSize:f.xs,color:OBJ_COLOR}}>🛡 {sg.stackLabel}</div>}
        </div>
        <span style={{fontSize:f.xs,color:"rgba(255,255,255,.4)",fontVariantNumeric:"tabular-nums",flexShrink:0}}>{msToMmss(sg.endMs - sg.startMs)}</span>
        <button onClick={function(){ isClip && ctl.playing ? ctl.toggle() : ctl.playClip(sg); }} title="Play only this card's audio"
          style={ghostSm({fontSize:f.xs,padding:lg?"5px 10px":"4px 8px",color:isClip?"#000":c,background:isClip?c:"transparent",borderColor:c+"66"})}>
          {isClip && ctl.playing ? "❚❚ Clip" : "▶ Clip"}
        </button>
        <button onClick={function(){ ctl.playFrom(sg.startMs); }} title="Play the full recording from here"
          style={ghostSm({fontSize:f.xs,padding:lg?"5px 10px":"4px 8px"})}>
          From here
        </button>
      </div>
    );
  }

  var curSeg = ctl.clip || ctl.activeSeg;
  var transport = (
    <div>
      <div style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)",borderLeft:"3px solid "+(curSeg ? segColor(curSeg) : "rgba(255,255,255,.2)"),borderRadius:"0 12px 12px 0",padding:lg?"12px 14px":"9px 12px",marginBottom:14,minHeight:lg?58:44}}>
        {curSeg ? (
          <div>
            <div style={{fontSize:f.xs,fontWeight:700,color:segColor(curSeg),textTransform:"uppercase",letterSpacing:.5}}>
              {ctl.clip ? "Playing clip only" : "Now playing"} · {curSeg.isObjCard ? "🛡 " + (curSeg.stackLabel || "Objection") : (TM[curSeg.cardType] || TM.pitch).label}
            </div>
            <div style={{fontSize:f.lg,color:"#fff",fontWeight:700,marginTop:2}}>{curSeg.cardTitle}</div>
          </div>
        ) : (
          <div style={{fontSize:f.md,color:"rgba(255,255,255,.4)",lineHeight:lg?2.3:1.8}}>{ctl.playing ? "Between cards" : "Press play to listen to the full call"}</div>
        )}
      </div>
      <SegmentTrack ctl={ctl} height={lg?28:22} onHoverSeg={setHoverSeg}/>
      <div style={{display:"flex",justifyContent:"space-between",marginTop:6,marginBottom:14,fontSize:f.xs,color:"rgba(255,255,255,.4)",fontVariantNumeric:"tabular-nums"}}>
        <span>{msToMmss(ctl.currentMs)}</span>
        <span style={{color:"rgba(255,255,255,.6)"}}>{hoverSeg ? hoverSeg.cardTitle : ""}</span>
        <span>{msToMmss(ctl.durationMs)}</span>
      </div>
      <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:lg?12:8,flexWrap:"wrap"}}>
        <button onClick={function(){ ctl.skip(-15000); }} style={ghostSm({fontSize:f.sm,padding:f.btn})}>−15s</button>
        <button onClick={ctl.toggle} style={Object.assign({}, solidBtn(SESS_COLOR), {padding:lg?"11px 28px":"9px 22px",fontSize:f.lg,borderRadius:99,minWidth:lg?130:100})}>
          {ctl.playing ? "❚❚ Pause" : ctl.clip ? "▶ Replay clip" : "▶ Play"}
        </button>
        <button onClick={function(){ ctl.skip(15000); }} style={ghostSm({fontSize:f.sm,padding:f.btn})}>+15s</button>
      </div>
      <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:6,marginTop:12,flexWrap:"wrap"}}>
        {RATES.map(function(r) {
          var on = ctl.rate === r;
          return <button key={r} onClick={function(){ ctl.setRate(r); }}
            style={ghostSm({fontSize:f.xs,padding:"4px 10px",color:on?SESS_COLOR:"rgba(255,255,255,.45)",borderColor:on?"rgba(168,255,62,.4)":"rgba(255,255,255,.12)"})}>{r}×</button>;
        })}
        {ctl.clip && <button onClick={ctl.continueFull} style={ghostSm({fontSize:f.xs,padding:"4px 10px",color:SESS_COLOR,borderColor:"rgba(168,255,62,.35)"})}>Continue full call ▸</button>}
        {canDownload && (
          <a href={ctl.url} download={(sessionName || "session").replace(/[\\/:*?"<>|]+/g, "-") + ctl.fileExt}
            style={Object.assign({}, ghostSm({fontSize:f.xs,padding:"4px 10px"}), {textDecoration:"none"})}>⬇ Download</a>
        )}
      </div>
      <div style={{fontSize:f.xs,color:"rgba(255,255,255,.3)",textAlign:"center",marginTop:12}}>
        {ctl.source === "device" ? "Playing this device's copy" : "Stored with the session"}{lg ? " · Space play/pause · ←/→ 5s · J/L 15s" : ""}
      </div>
    </div>
  );

  var list = (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
        <div style={{fontSize:f.xs,color:"rgba(255,255,255,.4)",textTransform:"uppercase",letterSpacing:.8,fontWeight:700}}>
          {ctl.segments.length} card segment{ctl.segments.length !== 1 ? "s" : ""}
        </div>
        {ctl.segments.length > 1 && (
          <div style={{display:"flex",background:"rgba(255,255,255,.05)",borderRadius:8,padding:2}}>
            {[[false,"In order"],[true,"By card"]].map(function(o) {
              var on = grouped === o[0];
              return <button key={o[1]} onClick={function(){ setGrouped(o[0]); }}
                style={{background:on?"rgba(255,255,255,.12)":"transparent",border:"none",borderRadius:6,padding:"4px 10px",fontSize:f.xs,color:on?"#fff":"rgba(255,255,255,.45)",cursor:"pointer",fontFamily:"inherit",fontWeight:on?700:500}}>{o[1]}</button>;
            })}
          </div>
        )}
      </div>
      {ctl.segments.length === 0 && (
        <div style={{fontSize:f.sm,color:"rgba(255,255,255,.35)",padding:"14px 0"}}>This recording has no per-card segments — use the full recording above.</div>
      )}
      <div style={{display:"flex",flexDirection:"column",gap:3}}>
        {!grouped && ctl.segments.map(function(sg) { return segRow(sg); })}
        {grouped && groups.map(function(g) {
          return (
            <div key={g.key} style={{marginBottom:8}}>
              <div style={{display:"flex",alignItems:"center",gap:8,padding:"4px 4px 6px"}}>
                <span style={{width:8,height:8,borderRadius:"50%",background:segColor(g.first),flexShrink:0}}/>
                <span style={{fontSize:f.md,fontWeight:700,color:"#fff",flex:1}}>{g.first.cardTitle}</span>
                <span style={{fontSize:f.xs,color:"rgba(255,255,255,.4)"}}>{g.segs.length} visit{g.segs.length !== 1 ? "s" : ""} · {msToMmss(g.total)}</span>
              </div>
              {g.segs.map(function(sg, i) { return segRow(sg, "Visit " + (i + 1)); })}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div style={{paddingBottom:24}}>
      <UploadNotice ctl={ctl} size={size}/>
      {lg ? (
        <div style={{display:"grid",gridTemplateColumns:"minmax(320px,1fr) minmax(320px,1fr)",gap:24,alignItems:"start",marginTop:ctl.upload && ctl.upload.state !== "done" ? 12 : 0}}>
          <div style={{position:"sticky",top:0}}>{transport}</div>
          {list}
        </div>
      ) : (
        <div style={{marginTop:ctl.upload && ctl.upload.state !== "done" ? 10 : 0}}>
          {transport}
          <div style={{height:18}}/>
          {list}
        </div>
      )}
    </div>
  );
}
