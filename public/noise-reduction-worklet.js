// ─── NOISE GATE (AudioWorklet) ────────────────────────────────────────────────
// Adaptive downward expander used by src/lib/noiseReduction.js for recording and playback.
// It keeps a running estimate of the background-noise level (it falls quickly to quiet
// moments and creeps up slowly, so speech never raises it). Whenever the signal sits near
// that floor — the gaps between words, a silent prospect, a hissing line — it is turned
// down smoothly, by at most MAX_CUT_DB, so pauses stay natural and never clip a word.
// Served from /public so it loads from the app's own origin (CSP: script-src 'self').

var MAX_CUT_DB = 18;          // deepest reduction of pure background noise
var OPEN_RATIO = 3.2;         // speech must be ~10 dB above the noise floor to pass untouched
var ATTACK_MS  = 4;           // how fast the gate opens when speech starts
var RELEASE_MS = 140;         // how fast it closes after speech
var HOLD_MS    = 160;         // keep open briefly after a word so endings aren't cut
var FLOOR_MIN  = 0.00003;     // ~ -90 dBFS: never treat digital silence as the floor
var FLOOR_START = 0.003;

class NoiseGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: "enabled", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "k-rate" }];
  }

  constructor() {
    super();
    this.floor = FLOOR_START;
    this.gain = 1;
    this.hold = 0;
    this.minGain = Math.pow(10, -MAX_CUT_DB / 20);
    var sr = sampleRate;
    this.attack  = 1 - Math.exp(-1 / (sr * ATTACK_MS / 1000));
    this.release = 1 - Math.exp(-1 / (sr * RELEASE_MS / 1000));
    this.holdSamples = Math.round(sr * HOLD_MS / 1000);
    // The floor estimate: falls within ~0.1 s, rises over ~6 s (per 128-sample block)
    var blocksPerSec = sr / 128;
    this.floorDown = 1 - Math.exp(-1 / (blocksPerSec * 0.1));
    this.floorUp   = 1 - Math.exp(-1 / (blocksPerSec * 6));
  }

  process(inputs, outputs, parameters) {
    var input = inputs[0], output = outputs[0];
    if (!input || !input.length) return true;
    var n = input[0].length;
    var enabled = parameters.enabled[0] >= 0.5;

    // Block level (RMS across channels)
    var sum = 0;
    for (var c = 0; c < input.length; c++) {
      var ch = input[c];
      for (var i = 0; i < n; i++) sum += ch[i] * ch[i];
    }
    var rms = Math.sqrt(sum / (n * input.length));

    // Track the noise floor
    if (rms > FLOOR_MIN) {
      this.floor += (rms - this.floor) * (rms < this.floor ? this.floorDown : this.floorUp);
      if (this.floor < FLOOR_MIN) this.floor = FLOOR_MIN;
    }

    // Target gain for this block: unity well above the floor, expanded down near it
    var threshold = this.floor * OPEN_RATIO;
    var target;
    if (!enabled || rms >= threshold) { target = 1; this.hold = this.holdSamples; }
    else if (this.hold > 0) { target = 1; this.hold -= n; }
    else target = Math.max(this.minGain, (rms / threshold) * (rms / threshold));

    for (var k = 0; k < output.length; k++) {
      var src = input[Math.min(k, input.length - 1)], dst = output[k];
      var g = this.gain;
      for (var j = 0; j < n; j++) {
        g += (target - g) * (target > g ? this.attack : this.release);
        dst[j] = src[j] * g;
      }
      if (k === output.length - 1) this.gain = g;
    }
    return true;
  }
}

registerProcessor("overcard-noise-gate", NoiseGateProcessor);
