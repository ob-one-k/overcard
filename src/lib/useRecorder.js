import { useState, useEffect, useRef } from "react";
import { createNoiseReduction } from "./noiseReduction";
import { lsGet, lsSet } from "./api";

// ─── SESSION AUDIO RECORDER ───────────────────────────────────────────────────
// One hook drives recording for both Play layouts:
//   • lists every audio input (built-in, headset, USB, Bluetooth) and refreshes on plug/unplug
//   • optional "call audio": on desktop Chrome/Edge the rep can share a tab/screen with audio
//     (e.g. a Zoom or softphone tab) and it is mixed with the mic into one recording
//   • live input level for meters, a 3-second test recording, and surfaced errors
//   • offsetMs() gives the position in the recording, used to cut per-card segments
//
// Recording is mono Opus/AAC at 32 kbps (~0.24 MB/min) so it fits comfortably in the database.

var MIC_KEY = "overcard_mic";
var BITRATE = 32000;

export function recorderSupported() {
  return typeof window !== "undefined" && typeof window.MediaRecorder !== "undefined" &&
    !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

// Tab/system audio capture only exists on desktop browsers (getDisplayMedia is absent or video-only on mobile)
export function callAudioSupported() {
  if (!recorderSupported() || !navigator.mediaDevices.getDisplayMedia) return false;
  try { return !window.matchMedia("(pointer: coarse)").matches; } catch (_) { return true; }
}

// First container the browser can actually record — Safari/iOS only do audio/mp4
export function pickMimeType() {
  var prefs = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/ogg;codecs=opus"];
  for (var i = 0; i < prefs.length; i++) {
    try { if (MediaRecorder.isTypeSupported(prefs[i])) return prefs[i]; } catch (_) {}
  }
  return ""; // let the browser choose
}

function micConstraints(deviceId) {
  var a = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
  if (deviceId) a.deviceId = { exact: deviceId };
  return { audio: a };
}

function describeError(err) {
  var n = err && err.name;
  if (n === "NotAllowedError" || n === "SecurityError") return "Microphone access was blocked. Allow it in your browser's site settings.";
  if (n === "NotFoundError" || n === "OverconstrainedError") return "That microphone isn't available any more. Pick another input.";
  if (n === "NotReadableError" || n === "AbortError") return "The microphone is in use by another app or couldn't start.";
  return "Recording couldn't start" + (err && err.message ? ": " + err.message : ".");
}

function stopStream(s) {
  if (s) s.getTracks().forEach(function(t) { try { t.stop(); } catch (_) {} });
}

// RMS of the analyser's waveform, scaled so normal speech sits around 0.3–0.7
function readLevel(analyser, buf) {
  analyser.getByteTimeDomainData(buf);
  var sum = 0;
  for (var i = 0; i < buf.length; i++) { var v = (buf[i] - 128) / 128; sum += v * v; }
  return Math.min(1, Math.sqrt(sum / buf.length) * 4);
}

export function useRecorder() {
  var supported = recorderSupported();
  var [devices,    setDevices]    = useState([]);
  var [deviceId,   setDeviceIdSt] = useState(function() { return lsGet(MIC_KEY) || ""; });
  var [permission, setPermission] = useState("unknown");   // unknown | prompt | granted | denied
  var [includeCallAudio, setIncludeCallAudio] = useState(false);
  var [status,     setStatus]     = useState("idle");      // idle | starting | recording | stopping
  var [level,      setLevel]      = useState(0);
  var [error,      setError]      = useState(null);
  var [notice,     setNotice]     = useState(null);
  var [monitoring, setMonitoring] = useState(false);

  var recRef      = useRef(null);   // MediaRecorder
  var chunksRef   = useRef([]);
  var startedRef  = useRef(null);   // Date.now() when the recorder actually started
  var streamsRef  = useRef([]);     // every MediaStream we opened (mic, display, mixed)
  var ctxRef      = useRef(null);   // AudioContext used for mixing + metering
  var meterRef    = useRef(null);   // interval id
  var forRef      = useRef(null);   // session id of the pending/active recording
  var monitorRef  = useRef(null);   // { stream, ctx, timer } for the pre-session meter
  var mountedRef  = useRef(true);

  function setDeviceId(id) { setDeviceIdSt(id || ""); lsSet(MIC_KEY, id || null); }

  // ── device list ──────────────────────────────────────────────────────────
  function refreshDevices() {
    if (!supported || !navigator.mediaDevices.enumerateDevices) return Promise.resolve([]);
    return navigator.mediaDevices.enumerateDevices().then(function(all) {
      // Before permission, browsers return inputs with blank ids/labels — treat those as "default"
      var mics = all.filter(function(d) { return d.kind === "audioinput"; });
      var labelled = mics.some(function(d) { return !!d.label; });
      if (labelled) setPermission("granted");
      var real = mics.filter(function(d) { return d.deviceId; });
      if (!mountedRef.current) return real;
      setDevices(real);
      setDeviceIdSt(function(cur) {
        if (cur && real.some(function(d) { return d.deviceId === cur; })) return cur;
        return "";   // fall back to the system default input
      });
      return real;
    }).catch(function() { return []; });
  }

  function requestPermission() {
    if (!supported) return Promise.resolve(false);
    setError(null);
    return navigator.mediaDevices.getUserMedia({ audio: true })
      .then(function(s) { stopStream(s); setPermission("granted"); return refreshDevices().then(function() { return true; }); })
      .catch(function(err) {
        setPermission(err && err.name === "NotAllowedError" ? "denied" : "prompt");
        setError(describeError(err));
        return false;
      });
  }

  useEffect(function() {
    mountedRef.current = true;
    if (!supported) return function() { mountedRef.current = false; };
    refreshDevices();
    var md = navigator.mediaDevices;
    function onChange() { refreshDevices(); }
    if (md.addEventListener) md.addEventListener("devicechange", onChange);
    // Track permission changes made in browser settings while the page is open
    var permStatus = null;
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: "microphone" }).then(function(p) {
        permStatus = p;
        if (mountedRef.current) setPermission(p.state === "granted" ? "granted" : p.state === "denied" ? "denied" : "prompt");
        p.onchange = function() {
          if (!mountedRef.current) return;
          setPermission(p.state === "granted" ? "granted" : p.state === "denied" ? "denied" : "prompt");
          refreshDevices();
        };
      }).catch(function() {});
    }
    return function() {
      mountedRef.current = false;
      if (md.removeEventListener) md.removeEventListener("devicechange", onChange);
      if (permStatus) permStatus.onchange = null;
      // Release the mic if we unmount mid-recording (logout, 401, navigation)
      forRef.current = null;
      teardown();
      stopMonitor();
    };
  }, []);

  // ── pre-session level meter ──────────────────────────────────────────────
  function stopMonitor() {
    var m = monitorRef.current;
    monitorRef.current = null;
    if (!m) return;
    clearInterval(m.timer);
    stopStream(m.stream);
    if (m.ctx) m.ctx.close().catch(function() {});
  }

  useEffect(function() {
    if (!monitoring || permission !== "granted" || status !== "idle") { stopMonitor(); if (status === "idle") setLevel(0); return; }
    var cancelled = false;
    navigator.mediaDevices.getUserMedia(micConstraints(deviceId)).then(function(stream) {
      if (cancelled) { stopStream(stream); return; }
      var Ctx = window.AudioContext || window.webkitAudioContext;
      var ctx = Ctx ? new Ctx() : null;
      var timer = null;
      if (ctx) {
        var an = ctx.createAnalyser(); an.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(an);
        var buf = new Uint8Array(an.fftSize);
        timer = setInterval(function() { setLevel(readLevel(an, buf)); }, 100);
      }
      monitorRef.current = { stream: stream, ctx: ctx, timer: timer };
    }).catch(function(err) { if (!cancelled) setError(describeError(err)); });
    return function() { cancelled = true; stopMonitor(); };
  }, [monitoring, permission, deviceId, status]);

  // ── recording ────────────────────────────────────────────────────────────
  function teardown() {
    clearInterval(meterRef.current); meterRef.current = null;
    streamsRef.current.forEach(stopStream); streamsRef.current = [];
    if (ctxRef.current) { ctxRef.current.close().catch(function() {}); ctxRef.current = null; }
    if (mountedRef.current) setLevel(0);
  }

  // Must be called from a click handler: getDisplayMedia needs the user gesture.
  // Resolves true when recording is running, false when it couldn't start (error is set).
  function start(sessionId) {
    if (!supported) { setError("This browser can't record audio."); return Promise.resolve(false); }
    stopMonitor();
    forRef.current = sessionId;
    chunksRef.current = [];
    startedRef.current = null;
    setError(null); setNotice(null); setStatus("starting");

    // Kick off the screen-share prompt first, synchronously inside the click
    var displayP = (includeCallAudio && callAudioSupported())
      // Call audio gets the browser's noise suppression too (no echo cancellation/AGC: it is
      // the other party's voice, not our mic)
      ? navigator.mediaDevices.getDisplayMedia({ audio: { noiseSuppression: true, echoCancellation: false, autoGainControl: false }, video: true }).catch(function() { return null; })
      : Promise.resolve(null);
    var micP = navigator.mediaDevices.getUserMedia(micConstraints(deviceId));

    return Promise.all([micP, displayP]).then(function(res) {
      var mic = res[0], disp = res[1];
      if (forRef.current !== sessionId) { stopStream(mic); stopStream(disp); return false; }
      streamsRef.current = [mic].concat(disp ? [disp] : []);
      setPermission("granted");

      if (includeCallAudio && callAudioSupported()) {
        if (!disp) setNotice("Call audio wasn't shared — recording your microphone only.");
        else if (!disp.getAudioTracks().length) setNotice("The shared tab/screen had no audio (tick \"Share audio\") — recording your microphone only.");
      }
      if (disp) disp.getVideoTracks().forEach(function(t) { t.stop(); });

      // Clean up and mix every audio source into one stream, and meter what is recorded.
      // Each source goes through the standard noise reduction (lib/noiseReduction.js).
      var recordStream = mic;
      var Ctx = window.AudioContext || window.webkitAudioContext;
      var mixed = Promise.resolve(mic);
      if (Ctx) {
        mixed = (function() {
          var ctx;
          try { ctx = new Ctx(); } catch (_) { return Promise.resolve(mic); }
          ctxRef.current = ctx;
          if (ctx.state === "suspended") ctx.resume().catch(function() {});
          var dest = ctx.createMediaStreamDestination();
          var an = ctx.createAnalyser(); an.fftSize = 512;
          var sources = [mic, disp].filter(function(st) { return st && st.getAudioTracks().length; });
          return Promise.all(sources.map(function(st) {
            var src = ctx.createMediaStreamSource(st);
            return createNoiseReduction(ctx).then(function(nr) {
              src.connect(nr.input); nr.output.connect(dest); nr.output.connect(an);
            }, function() { src.connect(dest); src.connect(an); });
          })).then(function() {
            var buf = new Uint8Array(an.fftSize);
            meterRef.current = setInterval(function() { if (mountedRef.current) setLevel(readLevel(an, buf)); }, 120);
            return dest.stream;
          }).catch(function() { return mic; });
        })();
      }

      return mixed.then(function(stream) {
        if (forRef.current !== sessionId) { teardown(); return false; }
        recordStream = stream;
        var mime = pickMimeType();
        var opts = { audioBitsPerSecond: BITRATE };
        if (mime) opts.mimeType = mime;
        var rec;
        try { rec = new MediaRecorder(recordStream, opts); }
        catch (_) { rec = new MediaRecorder(recordStream); }   // some browsers reject the bitrate/mime pair
        rec.ondataavailable = function(e) { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
        rec.onerror = function(e) { setError("Recording stopped unexpectedly" + (e && e.error ? ": " + e.error.message : "")); };
        rec.onstart = function() { startedRef.current = Date.now(); };
        // If the mic disappears mid-call (unplugged headset) keep what we have and tell the rep
        mic.getAudioTracks().forEach(function(t) { t.onended = function() { if (forRef.current) setError("The microphone was disconnected — audio stopped at this point."); }; });
        recRef.current = rec;
        rec.start(1000);
        if (startedRef.current === null) startedRef.current = Date.now();
        setStatus("recording");
        return true;
      });
    }).catch(function(err) {
      if (forRef.current === sessionId) { setError(describeError(err)); setStatus("idle"); }
      teardown();
      return false;
    });
  }

  // Position in the current recording (ms), or null when not recording
  function offsetMs() {
    return startedRef.current !== null && recRef.current ? Date.now() - startedRef.current : null;
  }

  // Stops and resolves { blob, mimeType, durationMs } — or null if nothing was recorded
  function stop() {
    forRef.current = null;
    var rec = recRef.current;
    recRef.current = null;
    if (!rec || rec.state === "inactive") { teardown(); setStatus("idle"); return Promise.resolve(null); }
    setStatus("stopping");
    var durationMs = startedRef.current !== null ? Date.now() - startedRef.current : null;
    return new Promise(function(resolve) {
      rec.onstop = function() {
        teardown();
        if (mountedRef.current) setStatus("idle");
        var type = rec.mimeType || (chunksRef.current[0] && chunksRef.current[0].type) || "audio/webm";
        var blob = chunksRef.current.length ? new Blob(chunksRef.current, { type: type }) : null;
        chunksRef.current = [];
        resolve(blob && blob.size > 0 ? { blob: blob, mimeType: type, durationMs: durationMs } : null);
      };
      try { rec.stop(); } catch (_) { teardown(); resolve(null); }
    });
  }

  // Discard the current recording (deck switched mid-session, etc.)
  function abort() {
    forRef.current = null;
    var rec = recRef.current; recRef.current = null;
    if (rec && rec.state !== "inactive") { rec.onstop = teardown; try { rec.stop(); } catch (_) { teardown(); } }
    else teardown();
    chunksRef.current = [];
    setStatus("idle");
  }

  // Record a few seconds from the selected input and return an object URL to play back
  function testRecording(ms) {
    if (!supported) return Promise.reject(new Error("unsupported"));
    setError(null);
    return navigator.mediaDevices.getUserMedia(micConstraints(deviceId)).then(function(stream) {
      setPermission("granted");
      refreshDevices();
      // Same noise reduction as a real recording, so the test sounds like the call will
      var Ctx = window.AudioContext || window.webkitAudioContext;
      var ctx = null;
      var cleaned = Promise.resolve(stream);
      if (Ctx) {
        try {
          ctx = new Ctx();
          var dest = ctx.createMediaStreamDestination();
          var src = ctx.createMediaStreamSource(stream);
          cleaned = createNoiseReduction(ctx).then(function(nr) { src.connect(nr.input); nr.output.connect(dest); return dest.stream; },
            function() { return stream; });
        } catch (_) { ctx = null; }
      }
      function done() { stopStream(stream); if (ctx) ctx.close().catch(function() {}); }
      return cleaned.then(function(recStream) {
        return new Promise(function(resolve) {
          var mime = pickMimeType();
          var r = mime ? new MediaRecorder(recStream, { mimeType: mime }) : new MediaRecorder(recStream);
          var parts = [];
          r.ondataavailable = function(e) { if (e.data && e.data.size) parts.push(e.data); };
          r.onstop = function() { done(); resolve(URL.createObjectURL(new Blob(parts, { type: r.mimeType || mime }))); };
          r.start();
          setTimeout(function() { try { r.stop(); } catch (_) { done(); resolve(null); } }, ms || 3000);
        });
      });
    }).catch(function(err) { setError(describeError(err)); throw err; });
  }

  return {
    supported: supported,
    callAudioSupported: callAudioSupported(),
    devices: devices, deviceId: deviceId, setDeviceId: setDeviceId,
    permission: permission, requestPermission: requestPermission, refreshDevices: refreshDevices,
    includeCallAudio: includeCallAudio, setIncludeCallAudio: setIncludeCallAudio,
    monitoring: monitoring, setMonitoring: setMonitoring,
    status: status, level: level, error: error, notice: notice, clearError: function() { setError(null); },
    start: start, stop: stop, abort: abort, offsetMs: offsetMs, testRecording: testRecording,
  };
}

// Turns a session's visit events into playable per-card segments clamped to the recording length.
// Each segment keeps the visit's ts as a stable segId so Path/Notes can find it without index math.
export function buildAudioSegments(events, durationMs) {
  var max = durationMs && durationMs > 0 ? durationMs : Infinity;
  var segs = [];
  (events || []).forEach(function(ev) {
    if (ev.type !== "visit" || ev.audioStartMs == null || ev.audioEndMs == null) return;
    var s = Math.max(0, Math.min(ev.audioStartMs, max));
    var e = Math.max(s, Math.min(ev.audioEndMs, max));
    if (e - s < 50) return;   // sub-50ms blips (instant double-taps) aren't worth a segment
    segs.push({
      segId: ev.ts, cardId: ev.cardId, cardTitle: ev.cardTitle, cardType: ev.cardType,
      isObjCard: !!ev.isObjCard, stackLabel: ev.stackLabel || null, startMs: s, endMs: e,
    });
  });
  segs.sort(function(a, b) { return a.startMs - b.startMs; });
  segs.forEach(function(sg, i) { sg.segmentIndex = i; });
  return segs;
}
