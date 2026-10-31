// ─── ID GENERATORS ────────────────────────────────────────────────────────────
// A per-load counter keeps ids unique when many are minted in the same millisecond (bulk copy)
var idSeq = 0;
function idTail() { idSeq = (idSeq + 1) % 1296; return Date.now().toString(36) + idSeq.toString(36) + Math.random().toString(36).slice(2,6); }
export function uid()  { return "c"  + idTail(); }
export function aid()  { return "a"  + idTail(); }
export function osid() { return "os" + idTail(); }
export function sid()  { return "s"  + idTail(); }

// ─── TYPE METADATA ────────────────────────────────────────────────────────────
export var TM = {
  pitch:     { label:"Pitch",     color:"#F5A623", glow:"rgba(245,166,35,.22)",  icon:"💬" },
  discovery: { label:"Discovery", color:"#00B4FF", glow:"rgba(0,180,255,.22)",   icon:"🔍" },
  close:     { label:"Close",     color:"#66BB6A", glow:"rgba(102,187,106,.22)", icon:"🤝" },
  objection: { label:"Objection", color:"#EF5350", glow:"rgba(239,83,80,.22)",   icon:"🛡️" },
};
// ─── ROLES ────────────────────────────────────────────────────────────────────
// owner = the org's single super-admin; it has every admin power plus org settings and admin demotion
export var ROLE_META = {
  owner: { label:"Owner", color:"#FFB300", bg:"rgba(255,179,0,.15)",  border:"rgba(255,179,0,.35)" },
  admin: { label:"Admin", color:"#A8FF3E", bg:"rgba(168,255,62,.15)", border:"rgba(168,255,62,.3)" },
  user:  { label:"User",  color:"#00B4FF", bg:"rgba(0,180,255,.1)",   border:"rgba(0,180,255,.2)" },
};
export function isAdminRole(role) { return role === "admin" || role === "owner"; }
// Role colours are fixed (owner amber, admin green, user blue) — they never follow the org accent
export function roleMeta(role) { return ROLE_META[role] || ROLE_META.user; }

export var OBJ_COLOR  = "#EF5350";
// ─── ORG ACCENT (theme) ───────────────────────────────────────────────────────
// SESS_COLOR is the app's primary accent. It's an ES live binding: setAccentColor() reassigns it
// at login from the org's chosen colour and every component reads the new value on its next render.
// Semantic colours (card types, Live/Practice, outcomes) are deliberately NOT themed.
export var DEFAULT_ACCENT = "#A8FF3E";
export var SESS_COLOR = DEFAULT_ACCENT;

function hexToRgb(hex) {
  var h = String(hex || "").replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function luminance(rgb) {
  var c = rgb.map(function(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
// The UI is dark: lift accents that would be unreadable on navy by mixing toward white
export function normalizeAccent(hex) {
  var rgb = hexToRgb(hex);
  if (!rgb) return DEFAULT_ACCENT;
  for (var i = 0; i < 10 && luminance(rgb) < 0.18; i++) rgb = rgb.map(function(v) { return Math.round(v + (255 - v) * 0.15); });
  return "#" + rgb.map(function(v) { return ("0" + v.toString(16)).slice(-2); }).join("").toUpperCase();
}
export function setAccentColor(hex) {
  var next = hex ? normalizeAccent(hex) : DEFAULT_ACCENT;
  // Surfaces take the chosen colour's own hue/saturation (not the lifted one, which greys dark accents)
  var hue = hex ? rgbToHsl(hexToRgb(hex) || hexToRgb(next)) : null;
  SESS_COLOR = next;
  if (String(hue) === String(SURFACE_HUE)) return;   // called on every render — only act on a change
  SURFACE_HUE = hue;
  themedCache = {};
  // The page behind the app (overscroll, browser chrome) follows the surface too
  if (typeof document !== "undefined") {
    document.body.style.background = themed("#060d1a");
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", themed("#090c18"));
  }
}

// ─── SURFACES (backgrounds, panels, sheets) ───────────────────────────────────
// The dark navy surfaces take the org accent's hue once an org has chosen one, so the app reads
// as a dark version of the accent. No accent chosen = the original navy, untouched.
// themed() rewrites every navy colour (#rrggbb or rgb/rgba) inside a style string, e.g.
//   background: themed("linear-gradient(180deg, #060d1a 0%, #071025 100%)")
// Lightness and alpha are kept; only hue (and saturation, capped by the accent's) change.
var SURFACE_HUE = null;   // [hue, saturation] of the org accent, or null for default navy
var themedCache = {};

function rgbToHsl(rgb) {
  var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
  var max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  var s = d / (1 - Math.abs(2 * l - 1));
  var h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}
function hslToRgb(h, s, l) {
  var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  var p = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return p.map(function(v) { return Math.round((v + m) * 255); });
}
// Dark and blue-leaning = one of the app's navy surfaces (bright blues like #00B4FF are accents, not surfaces)
function isNavy(rgb) { return Math.max(rgb[0], rgb[1], rgb[2]) <= 72 && rgb[2] > rgb[0] + 6 && rgb[2] >= rgb[1]; }
function tintRgb(rgb) {
  var hsl = rgbToHsl(rgb);
  return hslToRgb(SURFACE_HUE[0], Math.min(hsl[1], SURFACE_HUE[1]), hsl[2]);
}
export function themed(str) {
  if (!SURFACE_HUE) return str;
  if (themedCache[str]) return themedCache[str];
  var out = String(str)
    .replace(/#([0-9a-f]{6})\b/gi, function(all) {
      var rgb = hexToRgb(all);
      if (!isNavy(rgb)) return all;
      return "#" + tintRgb(rgb).map(function(v) { return ("0" + v.toString(16)).slice(-2); }).join("");
    })
    .replace(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(,[^)]*)?\)/gi, function(all, r, g, b, a) {
      var rgb = [+r, +g, +b];
      if (!isNavy(rgb)) return all;
      var t = tintRgb(rgb);
      return a ? "rgba(" + t.join(",") + a + ")" : "rgb(" + t.join(",") + ")";
    });
  themedCache[str] = out;
  return out;
}
// rgba() of the current accent — replaces the old hard-coded rgba(168,255,62,a)
export function accentA(alpha) {
  var rgb = hexToRgb(SESS_COLOR) || [168, 255, 62];
  return "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + alpha + ")";
}
// Black or white text, whichever reads better on a solid background of this colour
export function inkOn(hex) {
  var rgb = hexToRgb(hex);
  return rgb && luminance(rgb) > 0.32 ? "#000" : "#fff";
}
export var STYPE = {
  live:     { label:"Live",     color:"#A8FF3E", bg:"rgba(168,255,62,.09)", border:"rgba(168,255,62,.28)" },
  practice: { label:"Practice", color:"#00B4FF", bg:"rgba(0,180,255,.08)",   border:"rgba(0,180,255,.25)"   },
};
export var DECK_COLORS = ["#F5A623","#00B4FF","#66BB6A","#FFD54F","#4DB6AC","#FF8A65","#29B6F6","#80DEEA","#7C4DFF","#00BCD4"];
export var DECK_ICONS  = [
  "💼","📊","📞","💡","🏆","💰","🔑","🚀","🌐","🏢",
  "👔","📣","🎤","🔒","💎","📝","⚙️","🔥","🌟","📋",
  "✅","🎪","🏅","🎁","🧭","📌","🧩","📡","🏗️","🎖️"
];
export var OBJ_ICONS = [
  "⚔️","🛡️","💰","📉","⏳","🔄","🏛️","⚡","🎭","🧱",
  "🪤","🔮","💭","🗣️","❓","🛑","💸","🚫","🔥","📋",
  "🤔","😒","😑","🙅","🤦","😤","😶","🤐","😬","😮",
];

// ─── INFLECTION SYSTEM ────────────────────────────────────────────────────────
export var INFLECTIONS = [
  { id:"pause",      label:"Pause",       cue:"2–3 seconds of deliberate silence. Let it land.",             icon:"⏸️", cat:"Pace"      },
  { id:"slow",       label:"Slow Down",   cue:"Half your normal pace. Every word counts.",                   icon:"🐢", cat:"Pace"      },
  { id:"speed",      label:"Speed Up",    cue:"Faster tempo — excitement, energy, momentum.",                icon:"⚡", cat:"Pace"      },
  { id:"raise",      label:"Raise Tone",  cue:"Voice pitch rises — curiosity, energy, enthusiasm.",          icon:"📈", cat:"Tone"      },
  { id:"lower",      label:"Lower Tone",  cue:"Drop the pitch — gravitas, weight, seriousness.",             icon:"📉", cat:"Tone"      },
  { id:"question",   label:"Question",    cue:"Lift at the end as if genuinely asking.",                     icon:"❓", cat:"Tone"      },
  { id:"hushed",     label:"Hushed",      cue:"Drop volume and pull them in. Intimate.",                     icon:"🤫", cat:"Tone"      },
  { id:"confident",  label:"Confident",   cue:"Firm. No upward inflection. You own this room.",              icon:"🧱", cat:"Attitude"  },
  { id:"empathy",    label:"Empathetic",  cue:"Warm, measured. 'I hear you and I get it.'",                 icon:"🫂", cat:"Attitude"  },
  { id:"sincere",    label:"Sincere",     cue:"Drop any sales energy. Be genuinely human here.",             icon:"💙", cat:"Attitude"  },
  { id:"warm",       label:"Warm",        cue:"Smile in your voice. Open, welcoming, friendly.",             icon:"☀️", cat:"Attitude"  },
  { id:"urgent",     label:"Urgent",      cue:"Slightly faster, higher stakes. This matters now.",           icon:"🚨", cat:"Attitude"  },
  { id:"casual",     label:"Casual",      cue:"Relax completely. Like talking to a friend.",                 icon:"😎", cat:"Attitude"  },
  { id:"cautious",   label:"Cautious",    cue:"Measured, careful. Don't overpromise here.",                  icon:"🐚", cat:"Attitude"  },
  { id:"emphasis",   label:"Emphasize",   cue:"Hit this word hard. Maximum weight.",                         icon:"💥", cat:"Rhetorical"},
  { id:"contrast",   label:"Contrast",    cue:"Play this word against the last. Punch the difference.",      icon:"⚖️", cat:"Rhetorical"},
  { id:"rhetorical", label:"Rhetorical",  cue:"Not waiting for an answer — let it hang briefly.",            icon:"🎭", cat:"Rhetorical"},
  { id:"joking",     label:"Joking",      cue:"Light, playful, self-aware. Smile in the delivery.",          icon:"😄", cat:"Personality"},
  { id:"dry",        label:"Dry Humor",   cue:"Deadpan. Deliver it straight-faced with a beat after.",       icon:"🏜️", cat:"Personality"},
  { id:"indifferent",label:"Indifferent", cue:"Deliberately low energy — like you don't need this deal.",    icon:"🌊", cat:"Personality"},
  { id:"disarming",  label:"Disarming",   cue:"Catch them off guard — honest, self-deprecating, real.",      icon:"🕊️", cat:"Personality"},
];
export var INFL_MAP = {};
INFLECTIONS.forEach(function(inf) { INFL_MAP[inf.label] = inf; });
export var INFL_CATS = [];
INFLECTIONS.forEach(function(inf) { if (!INFL_CATS.includes(inf.cat)) INFL_CATS.push(inf.cat); });
