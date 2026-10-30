import { lsGet, lsSet } from "./api";

// ─── NOISE REDUCTION ──────────────────────────────────────────────────────────
// One standard clean-up chain for speech, used when recording (useRecorder) and on
// playback (AudioPlayer):
//   high-pass 85 Hz   — rumble, mains hum, desk knocks, handling noise
//   low-pass 7.5 kHz  — hiss and line noise above the speech band
//   noise gate        — adaptive: learns the background level and turns it down between
//                       words (public/noise-reduction-worklet.js)
// Recording also asks the browser for its own noise suppression (WebRTC) on every input.
// Where AudioWorklet isn't available the filters still run on their own.

var WORKLET_URL = "/noise-reduction-worklet.js";
var loaded = typeof WeakMap !== "undefined" ? new WeakMap() : null;   // AudioContext → Promise<boolean>

function loadWorklet(ctx) {
  if (!ctx.audioWorklet || typeof AudioWorkletNode === "undefined") return Promise.resolve(false);
  if (loaded && loaded.has(ctx)) return loaded.get(ctx);
  var p = ctx.audioWorklet.addModule(WORKLET_URL).then(function() { return true; }, function() { return false; });
  if (loaded) loaded.set(ctx, p);
  return p;
}

// Resolves { input, output, setEnabled(on), disconnect() }. Connect a source to input and
// output onward. setEnabled(false) bypasses everything (crossfaded, no click).
export function createNoiseReduction(ctx, opts) {
  var o = opts || {};
  return loadWorklet(ctx).then(function(hasGate) {
    var input = ctx.createGain(), output = ctx.createGain();
    var wet = ctx.createGain(), dry = ctx.createGain();
    var hp = ctx.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 85; hp.Q.value = 0.707;
    var lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = o.lowpassHz || 7500; lp.Q.value = 0.707;
    var gate = null;
    if (hasGate) {
      try { gate = new AudioWorkletNode(ctx, "overcard-noise-gate", { channelCountMode: "max" }); } catch (_) { gate = null; }
    }
    input.connect(hp); hp.connect(lp);
    if (gate) { lp.connect(gate); gate.connect(wet); } else lp.connect(wet);
    input.connect(dry);
    wet.connect(output); dry.connect(output);
    var on = o.enabled !== false;
    wet.gain.value = on ? 1 : 0;
    dry.gain.value = on ? 0 : 1;

    return {
      input: input, output: output, hasGate: !!gate,
      setEnabled: function(v) {
        var t = ctx.currentTime;
        wet.gain.setTargetAtTime(v ? 1 : 0, t, 0.03);
        dry.gain.setTargetAtTime(v ? 0 : 1, t, 0.03);
      },
      disconnect: function() {
        [input, hp, lp, gate, wet, dry, output].forEach(function(n) { if (n) { try { n.disconnect(); } catch (_) {} } });
      },
    };
  });
}

// ── Playback preference (per device). Noise reduction is on unless the listener turns it off.
var PREF_KEY = "overcard_noise_reduction";
export function playbackNoiseReduction() { return lsGet(PREF_KEY) !== "off"; }
export function setPlaybackNoiseReduction(on) { lsSet(PREF_KEY, on ? "on" : "off"); }
