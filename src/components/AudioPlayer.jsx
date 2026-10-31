import { useState, useEffect, useRef } from "react";
import { TM, OBJ_COLOR, SESS_COLOR, accentA, themed } from "../lib/constants";
import { solidBtn, ghostSm } from "../lib/styles";
import { apiGetBlob } from "../lib/api";
import { getAudioBlob } from "../lib/audioStore";
import { useUploadStatus, retrySessionAudio } from "../lib/audioUpload";
import { createNoiseReduction, playbackNoiseReduction, setPlaybackNoiseReduction } from "../lib/noiseReduction";
import { SaveClipDialog, useSavedSegments, HeartIcon, CLIP_COLOR, clipTint } from "./ClipSave";

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

// ─── PLAYBACK NOISE REDUCTION ────────────────────────────────────────────────
// Every recording (old ones too) plays through the standard noise reduction. One shared
// AudioContext for all players; each <audio> element gets a MediaElementSource the first
// time it plays (inside the click, so the context may start).
var playCtx = null;
function getPlayCtx() {
  if (playCtx) return playCtx;
  var Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  try { playCtx = new Ctx(); } catch (_) { playCtx = null; }
  return playCtx;
}

// Noise-reduction routing for one <audio> element (audioRef), rebuilt when url changes.
// ensureGraph() must run inside a user gesture (a play click) the first time.
export function useNoiseGraph(audioRef, url) {
  var [nrOn, setNrOn] = useState(playbackNoiseReduction);
  var nrOnRef = useRef(nrOn);
  nrOnRef.current = nrOn;
  var graphRef = useRef(null);    // { el, source, nr }

  // Route the <audio> element through noise reduction (once per element). Until the chain
  // has loaded the element plays straight to the speakers, so the first play is never silent.
  function ensureGraph() {
    var a = audioRef.current;
    if (!a) return;
    var ctx = getPlayCtx();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(function() {});
    var g = graphRef.current;
    if (g && g.el === a) return;
    var source;
    try { source = ctx.createMediaElementSource(a); } catch (_) { return; }   // already bound / unsupported
    source.connect(ctx.destination);
    var graph = { el: a, source: source, nr: null };
    graphRef.current = graph;
    createNoiseReduction(ctx, { enabled: nrOnRef.current }).then(function(nr) {
      if (graphRef.current !== graph) { nr.disconnect(); return; }
      graph.nr = nr;
      source.disconnect();
      source.connect(nr.input);
      nr.output.connect(ctx.destination);
    }).catch(function() {});
  }
  // A new recording (new element) or leaving: release this element's nodes
  useEffect(function() {
    return function() {
      var g = graphRef.current;
      graphRef.current = null;
      if (g) { try { g.source.disconnect(); } catch (_) {} if (g.nr) g.nr.disconnect(); }
    };
  }, [url]);

  return {
    ensureGraph: ensureGraph,
    noiseReduction: nrOn,
    setNoiseReduction: function(on) {
      setNrOn(on); setPlaybackNoiseReduction(on);
      var g = graphRef.current;
      if (g && g.nr) g.nr.setEnabled(on);
    },
  };
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
  var queueRef = useRef([]);      // further clips to play after the current one (Play all visits)
  var rafRef   = useRef(null);
  var fixDurRef = useRef(false);
  var upload   = useUploadStatus(session.id);
  var nr = useNoiseGraph(audioRef, url);
  var ensureGraph = nr.ensureGraph;

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

  // A clip reached its end: jump to the next queued clip, or stop
  function clipEnded(a, c) {
    var next = queueRef.current.shift();
    if (next) {
      setClipSeg(next);
      a.currentTime = next.startMs / 1000;
      return true;   // keep playing
    }
    a.pause();
    a.currentTime = c.endMs / 1000;
    setCurrentMs(c.endMs);
    return false;
  }

  // Precise clip end: poll every frame while a clip plays (timeupdate only fires ~4×/s)
  function watchClip() {
    cancelAnimationFrame(rafRef.current);
    function tick() {
      var a = audioRef.current, c = clipRef.current;
      if (!a || !c) return;
      if (a.currentTime * 1000 >= c.endMs && !clipEnded(a, c)) return;
      if (!a.paused) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  function setClipSeg(seg) { clipRef.current = seg; setClip(seg); if (!seg) queueRef.current = []; }

  function playAt(ms) {
    var a = audioRef.current;
    if (!a) return;
    ensureGraph();
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
    playClip: function(seg) { setClipSeg(seg); queueRef.current = []; playAt(seg.startMs); watchClip(); },
    // Several clips back to back (every visit to one card), skipping the audio in between
    playClips: function(segs) {
      if (!segs || !segs.length) return;
      setClipSeg(segs[0]); queueRef.current = segs.slice(1);
      playAt(segs[0].startMs); watchClip();
    },
    queued: queueRef.current.length,
    // Leave clip mode and keep listening from the current position
    continueFull: function() { setClipSeg(null); var a = audioRef.current; if (a) { ensureGraph(); a.play().catch(function() {}); } },
    toggle: function() {
      var a = audioRef.current;
      if (!a) return;
      if (!a.paused) { a.pause(); return; }
      var c = clipRef.current;
      // Replaying a finished clip starts it over
      if (c && a.currentTime * 1000 >= c.endMs - 50) a.currentTime = c.startMs / 1000;
      ensureGraph();
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
    // Noise reduction on playback (remembered on this device; downloads stay the original file)
    noiseReduction: nr.noiseReduction,
    setNoiseReduction: nr.setNoiseReduction,
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
        if (c && ms >= c.endMs) { clipEnded(a, c); ms = a.currentTime * 1000; }
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

// Noise reduction on/off. Shown everywhere a player is, so a listener can compare.
export function NoiseToggle({ ctl, f, compact }) {
  var on = ctl.noiseReduction;
  return (
    <button onClick={function(){ ctl.setNoiseReduction(!on); }} aria-pressed={on}
      title={on ? "Noise reduction is on — background noise, hum and hiss are reduced. Click to hear the original." : "Noise reduction is off — click to reduce background noise"}
      style={ghostSm({fontSize:f.xs,padding:"4px 9px",color:on?SESS_COLOR:"rgba(255,255,255,.45)",borderColor:on?accentA(.4):"rgba(255,255,255,.12)",flexShrink:0,whiteSpace:"nowrap"})}>
      {compact ? (on ? "NR on" : "NR off") : (on ? "✓ Noise reduction" : "Noise reduction off")}
    </button>
  );
}

// Progress track with segment blocks coloured by card type; click to seek.
// range + onRange (clip saving): a picked [startMs, endMs] with drag handles (pointer, or
// ←/→ on a focused handle) — kept at least 1 s and at most 10 min long.
var MIN_RANGE = 1000, MAX_RANGE = 10 * 60 * 1000;
function SegmentTrack({ ctl, height, onHoverSeg, range, onRange }) {
  var total = ctl.durationMs || 1;
  var pct = Math.min(100, (ctl.currentMs / total) * 100);
  var trackRef = useRef(null);
  var dragRef = useRef(null);
  function msAt(clientX) {
    var r = trackRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * total;
  }
  function click(e) {
    if (dragRef.current) return;
    ctl.seek(msAt(e.clientX));
  }
  function setEdge(which, ms) {
    if (!range || !onRange) return;
    var st = range.startMs, en = range.endMs;
    if (which === "start") st = Math.max(0, Math.min(ms, en - MIN_RANGE, total), en - MAX_RANGE);
    else en = Math.min(total, Math.max(ms, st + MIN_RANGE), st + MAX_RANGE);
    onRange({ startMs: Math.round(st), endMs: Math.round(en) });
  }
  function handle(which) {
    var ms = which === "start" ? range.startMs : range.endMs;
    return (
      <div key={which} role="slider" tabIndex={0} aria-label={which === "start" ? "Clip start" : "Clip end"}
        aria-valuemin={0} aria-valuemax={Math.round(total / 1000)} aria-valuenow={Math.round(ms / 1000)} aria-valuetext={msToMmss(ms)}
        onPointerDown={function(e){ e.stopPropagation(); e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); dragRef.current = which; }}
        onPointerMove={function(e){ if (dragRef.current === which) setEdge(which, msAt(e.clientX)); }}
        onPointerUp={function(){ setTimeout(function(){ dragRef.current = null; }, 0); }}
        onPointerCancel={function(){ dragRef.current = null; }}
        onClick={function(e){ e.stopPropagation(); }}
        onKeyDown={function(e){
          var step = e.shiftKey ? 5000 : 1000;
          if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); setEdge(which, ms - step); }
          else if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); setEdge(which, ms + step); }
        }}
        style={{position:"absolute",top:-5,bottom:-5,left:(ms / total * 100) + "%",width:14,marginLeft:-7,cursor:"ew-resize",touchAction:"none",zIndex:3,display:"flex",alignItems:"center",justifyContent:"center",outlineOffset:2}}>
        <div style={{width:6,height:"100%",borderRadius:3,background:CLIP_COLOR,boxShadow:"0 0 0 2px rgba(0,0,0,.55), 0 0 10px "+clipTint(.7)}}/>
      </div>
    );
  }
  return (
    <div ref={trackRef} onClick={click} role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(total / 1000)} aria-valuenow={Math.round(ctl.currentMs / 1000)}
      style={{position:"relative",height:height,borderRadius:6,background:"rgba(255,255,255,.07)",cursor:"pointer",overflow:range ? "visible" : "hidden",userSelect:"none",touchAction:range ? "none" : undefined}}>
      {ctl.segments.map(function(sg) {
        var on = ctl.activeSeg && ctl.activeSeg.segId === sg.segId;
        return (
          <div key={sg.segId}
            onMouseEnter={onHoverSeg ? function(){ onHoverSeg(sg); } : undefined}
            onMouseLeave={onHoverSeg ? function(){ onHoverSeg(null); } : undefined}
            title={sg.cardTitle + " · " + msToMmss(sg.startMs) + "–" + msToMmss(sg.endMs)}
            style={{position:"absolute",top:0,bottom:0,left:(sg.startMs / total * 100) + "%",width:Math.max(0.3, (sg.endMs - sg.startMs) / total * 100) + "%",
              background:segColor(sg),opacity:on?.75:.32,borderRight:themed("1px solid rgba(6,13,26,.9)"),transition:"opacity .15s"}}/>
        );
      })}
      {ctl.clip && (
        <div style={{position:"absolute",top:0,bottom:0,left:(ctl.clip.startMs / total * 100) + "%",width:((ctl.clip.endMs - ctl.clip.startMs) / total * 100) + "%",
          boxShadow:"inset 0 0 0 2px #fff",borderRadius:3,pointerEvents:"none"}}/>
      )}
      <div style={{position:"absolute",top:0,bottom:0,left:0,width:pct+"%",background:"rgba(255,255,255,.18)",pointerEvents:"none"}}/>
      {range && (
        <div style={{position:"absolute",top:0,bottom:0,left:(range.startMs / total * 100) + "%",width:((range.endMs - range.startMs) / total * 100) + "%",
          background:clipTint(.22),boxShadow:"inset 0 0 0 2px "+CLIP_COLOR,pointerEvents:"none",zIndex:2}}/>
      )}
      <div style={{position:"absolute",top:0,bottom:0,left:pct+"%",width:2,marginLeft:-1,background:"#fff",boxShadow:"0 0 6px rgba(255,255,255,.8)",pointerEvents:"none",zIndex:2}}/>
      {range && onRange && handle("start")}
      {range && onRange && handle("end")}
    </div>
  );
}

// Small ♥ button: save this segment as a clip (filled once saved)
function SaveHeart({ saved, onClick, f, lg }) {
  return (
    <button onClick={function(e){ e.stopPropagation(); onClick(); }} aria-label={saved ? "Saved to your Library — save again" : "Save this card's audio as a clip"}
      title={saved ? "Saved to your Library" : "Save as a clip"}
      style={ghostSm({fontSize:f.xs,padding:lg?"5px 9px":"4px 7px",color:saved?CLIP_COLOR:"rgba(255,255,255,.55)",borderColor:saved?clipTint(.5):"rgba(255,255,255,.14)",background:saved?clipTint(.12):"transparent",display:"inline-flex",alignItems:"center",flexShrink:0})}>
      <HeartIcon filled={saved} size={lg ? 14 : 12}/>
    </button>
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

// ─── CARD CLIP PLAYER ─────────────────────────────────────────────────────────
// Listening tools for the card you have open (Path tab expansion, Playback tab selection):
// every visit to that card as a clip with its own scrubber, "Play all visits" back to back,
// and "Play call from here" to hear it in context.
// onSave(seg) / saved {segId:true} (optional): a ♥ per visit to save it as a clip
export function CardClipPlayer({ ctl, segs, size, onSave, saved }) {
  var f = scale(size);
  var lg = size === "lg";
  if (ctl.state === "loading") return <div style={{fontSize:f.sm,color:"rgba(255,255,255,.35)"}}>Loading recording…</div>;
  if (ctl.state !== "ready") return <div style={{fontSize:f.sm,color:"rgba(255,255,255,.35)"}}>🎙️ No recording for this session.</div>;
  if (!segs || !segs.length) return <div style={{fontSize:f.sm,color:"rgba(255,255,255,.35)"}}>🎙️ No audio was captured on this card.</div>;
  var c = segColor(segs[0]);
  var total = segs.reduce(function(t, sg) { return t + (sg.endMs - sg.startMs); }, 0);
  return (
    <div style={{background:"rgba(255,255,255,.04)",border:"1px solid "+c+"33",borderRadius:12,padding:lg?"12px 14px":"10px 11px"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,flexWrap:"wrap"}}>
        <span style={{fontSize:f.xs,fontWeight:700,color:c,textTransform:"uppercase",letterSpacing:.6,flex:1,minWidth:120}}>
          🎧 Card audio · {segs.length} clip{segs.length !== 1 ? "s" : ""} · {msToMmss(total)}
        </span>
        {segs.length > 1 && (
          <button onClick={function(){ ctl.playClips(segs); }} style={ghostSm({fontSize:f.xs,padding:"4px 10px",color:c,borderColor:c+"66"})}>▶ Play all visits</button>
        )}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {segs.map(function(sg, i) {
          var isClip = ctl.clip && ctl.clip.segId === sg.segId;
          var len = Math.max(1, sg.endMs - sg.startMs);
          var inside = ctl.currentMs >= sg.startMs && ctl.currentMs <= sg.endMs;
          var pct = inside ? Math.min(100, (ctl.currentMs - sg.startMs) / len * 100) : 0;
          return (
            <div key={sg.segId} style={{display:"flex",alignItems:"center",gap:lg?10:8}}>
              <button onClick={function(){ if (isClip && ctl.playing) ctl.toggle(); else ctl.playClip(sg); }} aria-label={(isClip && ctl.playing ? "Pause" : "Play") + " clip " + (i + 1)}
                style={{width:lg?32:28,height:lg?32:28,borderRadius:"50%",border:"none",background:isClip?c:c+"26",color:isClip?"#000":c,fontSize:lg?12:11,fontWeight:800,cursor:"pointer",flexShrink:0}}>
                {isClip && ctl.playing ? "❚❚" : "▶"}
              </button>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:f.xs,color:"rgba(255,255,255,.5)",marginBottom:4,fontVariantNumeric:"tabular-nums"}}>
                  <span>{segs.length > 1 ? "Visit " + (i + 1) + " · " : ""}at {msToMmss(sg.startMs)}</span>
                  <span>{inside ? msToMmss(ctl.currentMs - sg.startMs) + " / " : ""}{msToMmss(len)}</span>
                </div>
                {/* Scrubber limited to this clip */}
                <div onClick={function(e){
                    var r = e.currentTarget.getBoundingClientRect();
                    var ms = sg.startMs + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * len;
                    if (!isClip) ctl.playClip(sg);
                    ctl.seek(ms);
                  }}
                  role="slider" aria-label={"Seek within clip " + (i + 1)} aria-valuemin={0} aria-valuemax={Math.round(len / 1000)} aria-valuenow={Math.round(inside ? (ctl.currentMs - sg.startMs) / 1000 : 0)}
                  style={{position:"relative",height:lg?8:7,background:"rgba(255,255,255,.1)",borderRadius:99,cursor:"pointer"}}>
                  <div style={{position:"absolute",left:0,top:0,bottom:0,width:pct+"%",background:c,borderRadius:99}}/>
                </div>
              </div>
              <button onClick={function(){ ctl.playFrom(sg.startMs); }} title="Hear it in context — keep playing the call from here"
                style={ghostSm({fontSize:f.xs,padding:lg?"5px 10px":"4px 8px",flexShrink:0})}>In context</button>
              {onSave && <SaveHeart saved={!!(saved && saved[String(sg.segId)])} onClick={function(){ onSave(sg); }} f={f} lg={lg}/>}
            </div>
          );
        })}
      </div>
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
    <div style={{display:"flex",alignItems:"center",gap:lg?12:8,padding:lg?"10px 16px":"7px 12px",background:themed("rgba(8,20,48,.92)"),borderBottom:"1px solid rgba(255,255,255,.07)",flexShrink:0}}>
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
          style={ghostSm({fontSize:f.xs,padding:"4px 9px",color:SESS_COLOR,borderColor:accentA(.35)})}>Continue ▸</button>
      )}
      {lg && <button onClick={function(){ ctl.skip(-15000); }} style={ghostSm({fontSize:f.xs,padding:"4px 8px"})} aria-label="Back 15 seconds">−15</button>}
      {lg && <button onClick={function(){ ctl.skip(15000); }} style={ghostSm({fontSize:f.xs,padding:"4px 8px"})} aria-label="Forward 15 seconds">+15</button>}
      <button onClick={function(){ ctl.setRate(RATES[(RATES.indexOf(ctl.rate) + 1) % RATES.length]); }} title="Playback speed"
        style={ghostSm({fontSize:f.xs,padding:"4px 8px",color:ctl.rate !== 1 ? SESS_COLOR : "rgba(255,255,255,.7)",minWidth:lg?44:36})}>
        {ctl.rate}×
      </button>
      {lg && <NoiseToggle ctl={ctl} f={f} compact/>}
    </div>
  );
}

// ─── PLAYBACK TAB ─────────────────────────────────────────────────────────────
// session + canClip: ♥ on each segment and "Save a part" (a dragged range) save clips
export function AudioPlayback({ ctl, size, canDownload, sessionName, session, canClip }) {
  var f = scale(size);
  var lg = size === "lg";
  var [grouped, setGrouped] = useState(false);
  var [saveTarget, setSaveTarget] = useState(null);   // what the Save clip dialog is saving
  var [range, setRange] = useState(null);             // picked part of the call (range mode)
  var saved = useSavedSegments(session ? session.id : null);
  var clipping = !!(canClip && session);
  function saveSeg(sg) {
    setSaveTarget({ startMs: sg.startMs, endMs: sg.endMs, segId: sg.segId, cardTitle: sg.cardTitle, cardType: sg.cardType, isObjCard: !!sg.isObjCard, stackLabel: sg.stackLabel || null });
  }
  function startRange() {
    var total = ctl.durationMs || 0;
    var st = Math.max(0, Math.min(ctl.currentMs, total - 1000));
    var en = Math.min(total, st + 15000);
    if (en - st < 1000) st = Math.max(0, en - 15000);
    setRange({ startMs: Math.round(st), endMs: Math.round(en) });
  }
  var [hoverSeg, setHoverSeg] = useState(null);
  var [selCard, setSelCard] = useState(null);   // { cardId, isObjCard } of the row clicked

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
        onClick={function(){ setSelCard({ cardId: sg.cardId, isObjCard: !!sg.isObjCard }); }}
        style={{position:"relative",display:"flex",alignItems:"center",gap:lg?10:8,borderRadius:10,padding:lg?"9px 12px":"7px 9px",cursor:"pointer",
          outline:selCard && selCard.cardId === sg.cardId && selCard.isObjCard === !!sg.isObjCard ? "1px solid " + segColor(sg) + "66" : "none",
          background:on?"rgba(255,255,255,.08)":hoverSeg&&hoverSeg.segId===sg.segId?"rgba(255,255,255,.04)":"transparent",
          borderLeft:"3px solid "+(on?c:c+"55"),overflow:"hidden"}}>
        {on && <div style={{position:"absolute",left:0,bottom:0,height:2,width:(prog * 100)+"%",background:c}}/>}
        <span style={{fontSize:f.xs,color:"rgba(255,255,255,.35)",fontVariantNumeric:"tabular-nums",width:lg?44:34,flexShrink:0}}>{msToMmss(sg.startMs)}</span>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:f.md,color:on?"#fff":"rgba(255,255,255,.78)",fontWeight:on?700:500,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{label || sg.cardTitle}</div>
          {sg.isObjCard && sg.stackLabel && <div style={{fontSize:f.xs,color:OBJ_COLOR}}>🛡 {sg.stackLabel}</div>}
        </div>
        <span style={{fontSize:f.xs,color:"rgba(255,255,255,.4)",fontVariantNumeric:"tabular-nums",flexShrink:0}}>{msToMmss(sg.endMs - sg.startMs)}</span>
        <button onClick={function(e){ e.stopPropagation(); isClip && ctl.playing ? ctl.toggle() : ctl.playClip(sg); }} title="Play only this card's audio"
          style={ghostSm({fontSize:f.xs,padding:lg?"5px 10px":"4px 8px",color:isClip?"#000":c,background:isClip?c:"transparent",borderColor:c+"66"})}>
          {isClip && ctl.playing ? "❚❚ Clip" : "▶ Clip"}
        </button>
        <button onClick={function(e){ e.stopPropagation(); ctl.playFrom(sg.startMs); }} title="Play the full recording from here"
          style={ghostSm({fontSize:f.xs,padding:lg?"5px 10px":"4px 8px"})}>
          From here
        </button>
        {clipping && <SaveHeart saved={!!saved[String(sg.segId)]} onClick={function(){ saveSeg(sg); }} f={f} lg={lg}/>}
      </div>
    );
  }

  var curSeg = ctl.clip || ctl.activeSeg;
  var selSegs = selCard ? ctl.segments.filter(function(sg) { return sg.cardId === selCard.cardId && !!sg.isObjCard === selCard.isObjCard; }) : [];
  var transport = (
    <div>
      {selSegs.length > 0 && (
        <div style={{marginBottom:14}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
            <span style={{fontSize:f.md,fontWeight:700,color:"#fff"}}>{selSegs[0].cardTitle}</span>
            <button onClick={function(){ setSelCard(null); }} aria-label="Close card audio" style={ghostSm({fontSize:f.xs,padding:"2px 8px"})}>✕</button>
          </div>
          <CardClipPlayer ctl={ctl} segs={selSegs} size={size} onSave={clipping ? saveSeg : null} saved={saved}/>
        </div>
      )}
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
      <SegmentTrack ctl={ctl} height={lg?28:22} onHoverSeg={setHoverSeg} range={range} onRange={setRange}/>
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
            style={ghostSm({fontSize:f.xs,padding:"4px 10px",color:on?SESS_COLOR:"rgba(255,255,255,.45)",borderColor:on?accentA(.4):"rgba(255,255,255,.12)"})}>{r}×</button>;
        })}
        <NoiseToggle ctl={ctl} f={f}/>
        {ctl.clip && <button onClick={ctl.continueFull} style={ghostSm({fontSize:f.xs,padding:"4px 10px",color:SESS_COLOR,borderColor:accentA(.35)})}>Continue full call ▸</button>}
        {canDownload && (
          <a href={ctl.url} download={(sessionName || "session").replace(/[\\/:*?"<>|]+/g, "-") + ctl.fileExt}
            style={Object.assign({}, ghostSm({fontSize:f.xs,padding:"4px 10px"}), {textDecoration:"none"})}>⬇ Download</a>
        )}
        {clipping && !range && (
          <button onClick={startRange} title="Pick any part of the call and save it as a clip"
            style={ghostSm({fontSize:f.xs,padding:"4px 10px",color:CLIP_COLOR,borderColor:clipTint(.45),display:"inline-flex",alignItems:"center",gap:5})}>
            <HeartIcon size={12}/> Save a part…
          </button>
        )}
      </div>
      {clipping && range && (
        <div style={{marginTop:14,background:clipTint(.07),border:"1px solid "+clipTint(.35),borderRadius:12,padding:lg?"12px 14px":"10px 12px",animation:"fadeIn .15s ease both"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
            <span style={{color:CLIP_COLOR}}><HeartIcon size={14}/></span>
            <span style={{fontSize:f.md,fontWeight:700,color:"#fff",flex:1}}>Save a part of the call</span>
            <span style={{fontSize:f.sm,color:"rgba(255,255,255,.6)",fontVariantNumeric:"tabular-nums"}}>{msToMmss(range.endMs - range.startMs)}</span>
          </div>
          <div style={{fontSize:f.xs,color:"rgba(255,255,255,.45)",marginBottom:10,lineHeight:1.5}}>Drag the pink handles on the timeline, or set them from where you are now.</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
            {[["start","Start",range.startMs],["end","End",range.endMs]].map(function(e) {
              return (
                <div key={e[0]} style={{display:"flex",alignItems:"center",gap:6,background:"rgba(255,255,255,.04)",borderRadius:9,padding:"6px 8px"}}>
                  <span style={{fontSize:f.xs,color:"rgba(255,255,255,.45)",width:lg?34:28}}>{e[1]}</span>
                  <span style={{fontSize:f.md,fontWeight:700,color:"#fff",fontVariantNumeric:"tabular-nums",flex:1}}>{msToMmss(e[2])}</span>
                  <button onClick={function(){
                      var now = Math.round(ctl.currentMs);
                      setRange(function(r) {
                        var st = r.startMs, en = r.endMs;
                        if (e[0] === "start") { st = now; if (en - st < MIN_RANGE || en - st > MAX_RANGE) en = Math.min(ctl.durationMs || now + 15000, st + 15000); }
                        else { en = now; if (en - st < MIN_RANGE || en - st > MAX_RANGE) st = Math.max(0, en - 15000); }
                        return { startMs: st, endMs: Math.max(en, st + MIN_RANGE) };
                      });
                    }}
                    style={ghostSm({fontSize:f.xs,padding:"3px 8px"})}>Now</button>
                </div>
              );
            })}
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <button onClick={function(){ ctl.playClip({ segId: "__range", startMs: range.startMs, endMs: range.endMs, cardTitle: "Your selection" }); }}
              style={ghostSm({fontSize:f.sm,padding:f.btn})}>{ctl.clip && ctl.clip.segId === "__range" && ctl.playing ? "❚❚ Previewing" : "▶ Preview"}</button>
            <button onClick={function(){
                var seg = ctl.segments.find(function(sg) { return range.startMs >= sg.startMs && range.startMs < sg.endMs; });
                setSaveTarget({ startMs: range.startMs, endMs: range.endMs, cardTitle: seg ? seg.cardTitle : null });
              }}
              style={Object.assign({}, solidBtn(CLIP_COLOR), {padding:f.btn,fontSize:f.sm,flex:1,minWidth:120})}>♥ Save clip…</button>
            <button onClick={function(){ setRange(null); if (ctl.clip && ctl.clip.segId === "__range") ctl.continueFull(); }}
              style={ghostSm({fontSize:f.sm,padding:f.btn})}>Cancel</button>
          </div>
        </div>
      )}
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
      {saveTarget && session && (
        <SaveClipDialog session={session} target={saveTarget}
          onClose={function(){ setSaveTarget(null); }}
          onSaved={function(){ if (saveTarget.segId == null) setRange(null); }}/>
      )}
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
