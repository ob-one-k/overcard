import { useState, useEffect, useRef, createContext, useContext } from "react";

// ─── ID GENERATORS ────────────────────────────────────────────────────────────
function uid()  { return "c"  + Date.now().toString(36) + Math.random().toString(36).slice(2,5); }
function aid()  { return "a"  + Date.now().toString(36) + Math.random().toString(36).slice(2,5); }
function osid() { return "os" + Date.now().toString(36) + Math.random().toString(36).slice(2,5); }
function sid()  { return "s"  + Date.now().toString(36) + Math.random().toString(36).slice(2,5); }

// ─── TYPE METADATA ────────────────────────────────────────────────────────────
var TM = {
  pitch:     { label:"Pitch",     color:"#F5A623", glow:"rgba(245,166,35,.22)",  icon:"💬" },
  discovery: { label:"Discovery", color:"#00B4FF", glow:"rgba(0,180,255,.22)",   icon:"🔍" },
  close:     { label:"Close",     color:"#66BB6A", glow:"rgba(102,187,106,.22)", icon:"🤝" },
  objection: { label:"Objection", color:"#EF5350", glow:"rgba(239,83,80,.22)",   icon:"🛡️" },
};
var OBJ_COLOR  = "#EF5350";
var SESS_COLOR = "#A8FF3E";
var STYPE = {
  live:     { label:"Live",     color:"#A8FF3E", bg:"rgba(168,255,62,.09)", border:"rgba(168,255,62,.28)" },
  practice: { label:"Practice", color:"#00B4FF", bg:"rgba(0,180,255,.08)",   border:"rgba(0,180,255,.25)"   },
};
var DECK_COLORS = ["#F5A623","#00B4FF","#66BB6A","#FFD54F","#4DB6AC","#FF8A65","#29B6F6","#80DEEA","#7C4DFF","#00BCD4"];
var DECK_ICONS  = [
  "💼","📊","📞","💡","🏆","💰","🔑","🚀","🌐","🏢",
  "👔","📣","🎤","🔒","💎","📝","⚙️","🔥","🌟","📋",
  "✅","🎪","🏅","🎁","🧭","📌","🧩","📡","🏗️","🎖️"
];
var OBJ_ICONS = [
  "⚔️","🛡️","💰","📉","⏳","🔄","🏛️","⚡","🎭","🧱",
  "🪤","🔮","💭","🗣️","❓","🛑","💸","🚫","🔥","📋",
  "🤔","😒","😑","🙅","🤦","😤","😶","🤐","😬","😮",
];

// ─── INFLECTION SYSTEM ────────────────────────────────────────────────────────
var INFLECTIONS = [
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
var INFL_MAP = {};
INFLECTIONS.forEach(function(inf) { INFL_MAP[inf.label] = inf; });
var INFL_CATS = [];
INFLECTIONS.forEach(function(inf) { if (!INFL_CATS.includes(inf.cat)) INFL_CATS.push(inf.cat); });

// ─── RICH TEXT ────────────────────────────────────────────────────────────────
function parseRichText(raw) {
  if (!raw) return [];
  var segs = [], re = /\*\*(.+?)\*\*|\*(.+?)\*\[([^\]]+)\]|\*(.+?)\*/g, last = 0, m;
  while ((m = re.exec(raw)) !== null) {
    if (m.index > last) segs.push({ type:"text", content: raw.slice(last, m.index) });
    if (m[1] !== undefined)      segs.push({ type:"bold",   content: m[1] });
    else if (m[2] !== undefined) segs.push({ type:"italic", content: m[2], inflection: m[3] });
    else                         segs.push({ type:"italic", content: m[4], inflection: null });
    last = re.lastIndex;
  }
  if (last < raw.length) segs.push({ type:"text", content: raw.slice(last) });
  return segs;
}
function stripMarkup(raw) {
  if (!raw) return "";
  return raw.replace(/\*\*(.+?)\*\*/g,"$1").replace(/\*(.+?)\*\[([^\]]+)\]/g,"$1").replace(/\*(.+?)\*/g,"$1");
}

// ─── API LAYER ────────────────────────────────────────────────────────────────
var API_BASE = "/api";
var SAVE_DELAY = 800;

var _onUnauth = null; // set by App shell to redirect to login on 401
function setUnauthHandler(fn) { _onUnauth = fn; }

async function apiGet(path) {
  const r = await fetch(API_BASE + path, { credentials:"include" });
  if (r.status === 401) { if (_onUnauth) _onUnauth(); throw new Error("401"); }
  if (!r.ok) throw new Error("API " + r.status);
  return r.json();
}
async function apiPut(path, body) {
  const r = await fetch(API_BASE + path, {
    method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body), credentials:"include"
  });
  if (r.status === 401) { if (_onUnauth) _onUnauth(); throw new Error("401"); }
  if (!r.ok) throw new Error("API " + r.status);
  return r.json();
}
async function apiPost(path, body) {
  const r = await fetch(API_BASE + path, {
    method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body), credentials:"include"
  });
  if (r.status === 401) { if (_onUnauth) _onUnauth(); throw new Error("401"); }
  if (!r.ok) throw new Error("API " + r.status);
  return r.json();
}
async function apiDel(path) {
  const r = await fetch(API_BASE + path, { method:"DELETE", credentials:"include" });
  if (r.status === 401) { if (_onUnauth) _onUnauth(); throw new Error("401"); }
  if (!r.ok) throw new Error("API " + r.status);
  return r.json();
}

// ─── STYLE HELPERS ────────────────────────────────────────────────────────────
function solidBtn(color) {
  var lightColors = ["#F5A623","#FFD54F","#66BB6A","#00B4FF","#A8FF3E"];
  var tc = lightColors.includes(color) ? "#000" : "#fff";
  return { background:color, border:"none", borderRadius:14, color:tc, fontSize:14, fontWeight:700, padding:"12px 20px", cursor:"pointer", fontFamily:"inherit", textAlign:"center", display:"inline-flex", alignItems:"center", justifyContent:"center", gap:6 };
}
function ghostBtn() {
  return { background:"transparent", border:"1.5px solid rgba(255,255,255,.15)", borderRadius:14, color:"rgba(255,255,255,.6)", fontSize:14, padding:"12px", cursor:"pointer", fontFamily:"inherit", textAlign:"center" };
}
function ghostSm(extra) {
  var b = { background:"transparent", border:"1px solid rgba(255,255,255,.15)", borderRadius:99, color:"rgba(255,255,255,.5)", fontSize:12, padding:"6px 13px", cursor:"pointer", fontFamily:"inherit", flexShrink:0 };
  return extra ? Object.assign({}, b, extra) : b;
}
function iconBtn() {
  return { background:"rgba(255,255,255,.07)", border:"1px solid rgba(255,255,255,.1)", borderRadius:10, color:"rgba(255,255,255,.6)", cursor:"pointer", fontSize:13, padding:"6px 10px", fontFamily:"inherit" };
}
function labelSt() {
  return { display:"block", fontSize:10, fontWeight:700, letterSpacing:1.5, color:"rgba(255,255,255,.35)", textTransform:"uppercase", marginBottom:7 };
}
function inputSt(extra) {
  var b = { display:"block", width:"100%", background:"rgba(8,25,60,.5)", border:"1.5px solid rgba(255,255,255,.1)", borderRadius:12, color:"#fff", fontSize:14, padding:"11px 14px", fontFamily:"inherit", outline:"none", boxSizing:"border-box" };
  return extra ? Object.assign({}, b, extra) : b;
}
function cardBg(extra) {
  var b = { background:"rgba(255,255,255,.07)", border:"1px solid rgba(255,255,255,.08)", borderRadius:12, padding:"12px 14px" };
  return extra ? Object.assign({}, b, extra) : b;
}
function badgeSt(color, bg) {
  return { fontSize:9, padding:"1px 7px", borderRadius:99, border:"1px solid " + (color || "rgba(255,255,255,.15)"), color: color || "rgba(255,255,255,.5)", background: bg || "transparent", whiteSpace:"nowrap" };
}
function dividerV(h) {
  return { width:1, height: h || 24, background:"rgba(255,255,255,.07)", flexShrink:0 };
}

// ─── TINY COMPONENTS ──────────────────────────────────────────────────────────
function TypeBadge({ type, small }) {
  var m = TM[type] || TM.pitch, s = small;
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:s?3:4, background:m.color+"22", border:"1px solid "+m.color+"44", color:m.color, borderRadius:99, fontSize:s?9:11, fontWeight:700, letterSpacing:.7, padding:s?"2px 7px":"3px 10px", textTransform:"uppercase", flexShrink:0 }}>
      <span style={{fontSize:s?9:11}}>{m.icon}</span>{m.label}
    </span>
  );
}
function Handle() {
  return <div style={{display:"flex",justifyContent:"center",padding:"12px 0 4px"}}><div style={{width:38,height:4,borderRadius:99,background:"rgba(255,255,255,.15)"}}/></div>;
}
function IntendedBadge() {
  return <span style={{display:"inline-flex",alignItems:"center",gap:3,background:"rgba(102,187,106,.15)",border:"1px solid rgba(102,187,106,.3)",color:"#66BB6A",borderRadius:99,fontSize:9,fontWeight:700,padding:"2px 7px",letterSpacing:.5,textTransform:"uppercase",flexShrink:0}}>★ intended</span>;
}
function SectionHdr({ children, style }) {
  return <div style={Object.assign({fontSize:10,fontWeight:700,color:"rgba(255,255,255,.3)",letterSpacing:1.5,textTransform:"uppercase",marginBottom:8},style)}>{children}</div>;
}
function StatBox({ value, label, color }) {
  return (
    <div style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.08)",borderRadius:12,padding:"12px 14px"}}>
      <div style={{fontSize:22,fontWeight:700,color:color||"rgba(255,255,255,.7)",marginBottom:3,lineHeight:1}}>{value}</div>
      <div style={{fontSize:9,color:"rgba(255,255,255,.3)",textTransform:"uppercase",letterSpacing:.7}}>{label}</div>
    </div>
  );
}
function BarRow({ label, value, denom, color }) {
  var pct = denom > 0 ? Math.round(value / denom * 100) : 0;
  return (
    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:7}}>
      <div style={{fontSize:11,color:"rgba(255,255,255,.55)",minWidth:110}}>{label}</div>
      <div style={{flex:1}}><div style={{height:4,background:"rgba(255,255,255,.07)",borderRadius:99,overflow:"hidden"}}><div style={{height:"100%",background:color,borderRadius:99,width:pct+"%",transition:"width .4s"}}/></div></div>
      <div style={{fontSize:12,fontWeight:700,color:color,minWidth:36,textAlign:"right"}}>{pct}%</div>
    </div>
  );
}

// ─── GLOBAL INFLECTION TOOLTIP CONTEXT ───────────────────────────────────────
// Single tooltip rendered at App root — outside all animated/transformed ancestors.
// CSS animations create stacking contexts that trap position:fixed children.
// Hoisting to root ensures tooltips always render relative to the viewport.
var TipCtx = createContext({ activeTip:null, setActiveTip:function(){} });

function GlobalInflTooltip() {
  var { activeTip } = useContext(TipCtx);
  if (!activeTip) return null;
  var { inf, accent, cx, btm } = activeTip;
  var W = 210, vw = typeof window !== "undefined" ? window.innerWidth : 390;
  var safeL = Math.max(10, Math.min(cx - W/2, vw - W - 10));
  var caretOff = Math.max(10, Math.min(cx - safeL, W - 16));
  return (
    <span style={{ position:"fixed", bottom:btm, left:safeL, width:W, background:"#1b1c2a", border:"1px solid "+accent+"66", borderRadius:14, padding:"12px 14px", zIndex:99999, boxShadow:"0 16px 48px rgba(0,0,0,.95)", pointerEvents:"none", display:"block" }}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
        <span style={{fontSize:17}}>{inf.icon}</span>
        <span style={{fontSize:12,fontWeight:700,color:accent,fontFamily:"inherit"}}>{inf.label}</span>
      </div>
      <div style={{fontSize:11,color:"rgba(255,255,255,.6)",lineHeight:1.6,fontFamily:"inherit"}}>{inf.cue}</div>
      <span style={{position:"absolute",bottom:-5,left:caretOff,width:8,height:8,background:"#1b1c2a",border:"1px solid "+accent+"66",borderTop:"none",borderLeft:"none",display:"block",transform:"rotate(45deg)"}}/>
    </span>
  );
}

function InflWord({ seg, accent }) {
  var inf = seg.inflection ? INFL_MAP[seg.inflection] : null;
  var { activeTip, setActiveTip } = useContext(TipCtx);
  var ref = useRef(null);
  var myId = useRef(seg.inflection + "_" + seg.content);
  if (!inf) return <em style={{fontStyle:"italic"}}>{seg.content}</em>;
  var isOpen = activeTip && activeTip.id === myId.current;
  function calcPos() {
    if (!ref.current) return null;
    var r = ref.current.getBoundingClientRect();
    return { cx: r.left + r.width/2, btm: window.innerHeight - r.top + 12 };
  }
  function open(e) {
    e.stopPropagation();
    var p = calcPos();
    if (!p) return;
    setActiveTip(isOpen ? null : { id:myId.current, inf, accent, cx:p.cx, btm:p.btm });
  }
  return (
    <span style={{display:"inline"}}>
      <em ref={ref}
        onPointerEnter={function(e) { if (e.pointerType==="mouse") { var p=calcPos(); if(p) setActiveTip({id:myId.current,inf,accent,cx:p.cx,btm:p.btm}); }}}
        onPointerLeave={function(e) { if (e.pointerType==="mouse") setActiveTip(null); }}
        onClick={open}
        style={{ fontStyle:"italic", color:accent, borderBottom:"1.5px dashed "+accent+"80", cursor:"pointer", paddingBottom:1, userSelect:"none", WebkitUserSelect:"none" }}
      >{seg.content}</em>
    </span>
  );
}

function RichPromptDisplay({ text, accentColor }) {
  return (
    <span>
      {parseRichText(text || "").map(function(seg, i) {
        if (seg.type === "bold")   return <strong key={i} style={{fontWeight:800,color:"#fff",fontStyle:"normal"}}>{seg.content}</strong>;
        if (seg.type === "italic") return <InflWord key={i} seg={seg} accent={accentColor} />;
        return <span key={i}>{seg.content}</span>;
      })}
    </span>
  );
}

// ─── OVERVIEW DISPLAY ─────────────────────────────────────────────────────────
function OverviewDisplay({ bullets, color }) {
  var valid = (bullets || []).filter(function(b) { return b && b.trim(); });
  if (!valid.length) return null;
  return (
    <div style={{margin:"0 14px 10px",padding:"11px 14px",background:"rgba(255,255,255,.07)",borderRadius:12,borderLeft:"3px solid "+color+"88"}}>
      {valid.map(function(b, i) {
        return (
          <div key={i} style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:i<valid.length-1?5:0}}>
            <span style={{color:color,fontSize:9,marginTop:3,flexShrink:0}}>◆</span>
            <span style={{fontSize:12,color:"rgba(255,255,255,.82)",lineHeight:1.5,fontFamily:"inherit"}}>{b}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── OVERVIEW EDITOR ──────────────────────────────────────────────────────────
function OverviewEditor({ bullets, onChange, accent }) {
  var padded = (bullets || []).concat(["","",""]).slice(0,3);
  function setB(i, v) {
    var arr = padded.map(function(x) { return x; });
    arr[i] = v;
    onChange(arr.filter(function(_, j) { return j < 3; }));
  }
  return (
    <div>
      {padded.map(function(b, i) {
        return (
          <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
            <span style={{color:accent,fontSize:10,flexShrink:0,width:16,textAlign:"center"}}>◆</span>
            <input value={b} onChange={function(e) { setB(i, e.target.value); }}
              placeholder={"Bullet "+(i+1)+" (optional)"}
              style={inputSt({margin:0,fontSize:13})} />
          </div>
        );
      })}
      <div style={{fontSize:10,color:"rgba(255,255,255,.2)",marginTop:4}}>1–3 bullets shown above the script in Play &amp; Cards</div>
    </div>
  );
}

// ─── RICH PROMPT EDITOR ───────────────────────────────────────────────────────
// contentEditable-based editor — renders formatted text inline, no raw markup.
// Stores/loads our markdown format (*text*[Label], **text**) behind the scenes.
function RichPromptEditor({ value, onChange, accentColor }) {
  var editorRef      = useRef(null);
  var isInternal     = useRef(false);
  var editNodeRef    = useRef(null); // <em> node being re-inflected
  var [showPicker,   setShowPicker]   = useState(false);
  var [selRange,     setSelRange]     = useState(null);
  var [hasSel,       setHasSel]       = useState(false);
  var [cursorInFmt,  setCursorInFmt]  = useState(null); // { node, inf:string|null, isBold:bool }
  var [pickerMode,   setPickerMode]   = useState("new"); // "new" | "edit"

  function escH(s) { return (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

  function mdToHtml(md) {
    if (!md) return "";
    return parseRichText(md).map(function(seg) {
      if (seg.type === "bold")
        return "<strong style=\"font-weight:800;font-style:normal;color:#fff\">"+escH(seg.content)+"</strong>";
      if (seg.type === "italic" && seg.inflection)
        return "<em data-inf=\""+escH(seg.inflection)+"\" style=\"color:"+accentColor+";border-bottom:1.5px dashed "+accentColor+"80;cursor:pointer;font-style:italic\">"+escH(seg.content)+"</em>";
      if (seg.type === "italic")
        return "<em style=\"font-style:italic;color:rgba(255,255,255,.75)\">"+escH(seg.content)+"</em>";
      return escH(seg.content).replace(/\n/g,"<br>");
    }).join("");
  }

  function nodeToMd(node) {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1) return "";
    var tag = node.tagName.toLowerCase();
    var inner = Array.from(node.childNodes).map(nodeToMd).join("");
    if (tag === "strong" || tag === "b") return "**"+inner+"**";
    if (tag === "em" || tag === "i") {
      var inf = node.getAttribute ? node.getAttribute("data-inf") : null;
      return inf ? "*"+inner+"*["+inf+"]" : "*"+inner+"*";
    }
    if (tag === "br") return "\n";
    if (tag === "div" || tag === "p") {
      if (!inner || inner === "\n") return "\n";
      return inner.replace(/\n+$/,"") + "\n";
    }
    return inner;
  }
  function elToMd(el) { return nodeToMd(el).replace(/\n+$/,""); }

  useEffect(function() {
    var el = editorRef.current; if (!el) return;
    if (!isInternal.current) el.innerHTML = mdToHtml(value) || "";
  }, [value, accentColor]);

  useEffect(function() {
    var el = editorRef.current; if (el) el.innerHTML = mdToHtml(value) || "";
  }, []); // eslint-disable-line

  function handleInput() {
    var el = editorRef.current; if (!el) return;
    isInternal.current = true;
    onChange(elToMd(el));
    requestAnimationFrame(function() { isInternal.current = false; });
  }
  function handlePaste(e) {
    e.preventDefault();
    var text = (e.clipboardData||window.clipboardData).getData("text/plain");
    document.execCommand("insertText", false, text);
  }

  // Walk up from a DOM node to find the nearest formatting ancestor inside editor
  function findFmtAncestor(startNode) {
    var el = editorRef.current;
    var node = startNode;
    while (node && node !== el) {
      if (node.nodeType === 1) {
        if (node.tagName === "EM" || node.tagName === "I")
          return { node: node, inf: node.getAttribute("data-inf"), isBold: false };
        if (node.tagName === "STRONG" || node.tagName === "B")
          return { node: node, inf: null, isBold: true };
      }
      node = node.parentNode;
    }
    return null;
  }

  function checkSel() {
    var sel = window.getSelection(), el = editorRef.current;
    var hasSel_ = !!(sel && !sel.isCollapsed && el && el.contains(sel.anchorNode));
    setHasSel(hasSel_);
    if (!hasSel_ && sel && sel.isCollapsed && el && el.contains(sel.anchorNode)) {
      setCursorInFmt(findFmtAncestor(sel.anchorNode));
    } else {
      setCursorInFmt(null);
    }
  }

  function handleMouseUp(e) {
    // If user clicked directly on an <em data-inf> node, treat it as cursor-in-fmt
    var target = e.target;
    if (target && target.tagName === "EM" && target.getAttribute && target.getAttribute("data-inf")) {
      setCursorInFmt({ node: target, inf: target.getAttribute("data-inf"), isBold: false });
      setHasSel(false);
      return;
    }
    checkSel();
  }

  function captureRange() {
    var sel = window.getSelection(), el = editorRef.current;
    if (sel && !sel.isCollapsed && el && el.contains(sel.anchorNode))
      return sel.getRangeAt(0).cloneRange();
    return null;
  }

  // Replace a formatted DOM node with its plain text content
  function removeNodeFormatting(fmtNode) {
    var el = editorRef.current;
    if (!fmtNode || !fmtNode.parentNode || !el || !el.contains(fmtNode)) return;
    var text = document.createTextNode(fmtNode.textContent);
    fmtNode.parentNode.replaceChild(text, fmtNode);
    var sel = window.getSelection();
    if (sel) {
      try {
        var nr = document.createRange(); nr.setStartAfter(text); nr.collapse(true);
        sel.removeAllRanges(); sel.addRange(nr);
      } catch(e) {} // eslint-disable-line
    }
    setCursorInFmt(null); setHasSel(false);
    el.normalize();
    handleInput();
  }

  function applyBold() {
    var el = editorRef.current; if (!el) return;
    el.focus();
    var sel = window.getSelection(); if (!sel||sel.isCollapsed) return;
    var r = sel.getRangeAt(0), text = r.toString(); if (!text) return;
    var node = document.createElement("strong");
    node.style.fontWeight="800"; node.style.fontStyle="normal"; node.style.color="#fff";
    node.textContent = text;
    r.deleteContents(); r.insertNode(node);
    var nr = document.createRange(); nr.setStartAfter(node); nr.collapse(true);
    sel.removeAllRanges(); sel.addRange(nr);
    setHasSel(false); handleInput();
  }

  function openInflPicker() {
    var r = captureRange(); if (!r) return;
    editNodeRef.current = null;
    setSelRange(r); setPickerMode("new"); setShowPicker(true);
  }
  function openInflPickerForNode(fmtNode) {
    editNodeRef.current = fmtNode;
    setSelRange(null); setPickerMode("edit"); setShowPicker(true);
  }
  function closePicker() {
    setShowPicker(false); setSelRange(null); editNodeRef.current = null;
  }

  function applyInflection(inf) {
    setShowPicker(false);
    var el = editorRef.current; if (!el) return;

    // Mode: editing an existing em node
    if (editNodeRef.current && el.contains(editNodeRef.current)) {
      var node = editNodeRef.current;
      if (inf) {
        node.setAttribute("data-inf", inf.label);
        node.style.color = accentColor;
        node.style.borderBottom = "1.5px dashed "+accentColor+"80";
        node.style.cursor = "pointer";
        node.style.fontStyle = "italic";
        setCursorInFmt({ node: node, inf: inf.label, isBold: false });
      } else {
        node.removeAttribute("data-inf");
        node.style.color = "rgba(255,255,255,.75)";
        node.style.borderBottom = "none";
        node.style.cursor = "";
        setCursorInFmt({ node: node, inf: null, isBold: false });
      }
      editNodeRef.current = null; setSelRange(null);
      handleInput(); return;
    }

    // Mode: new inflection wrapping a selection
    if (!selRange) return;
    el.focus();
    var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(selRange);
    var text = selRange.toString(); if (!text) { setSelRange(null); return; }
    var em = document.createElement("em");
    if (inf) {
      em.setAttribute("data-inf", inf.label);
      em.style.color = accentColor;
      em.style.borderBottom = "1.5px dashed "+accentColor+"80";
      em.style.cursor = "pointer";
    } else {
      em.style.color = "rgba(255,255,255,.75)";
    }
    em.style.fontStyle = "italic";
    em.textContent = text;
    selRange.deleteContents(); selRange.insertNode(em);
    var nr = document.createRange(); nr.setStartAfter(em); nr.collapse(true);
    sel.removeAllRanges(); sel.addRange(nr);
    setSelRange(null); setHasSel(false); handleInput();
  }

  function applyQuickInfl(lbl) {
    var r = captureRange(); if (!r) return;
    var el = editorRef.current; if (!el) return;
    el.focus();
    var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    var text = r.toString(); if (!text) return;
    var em = document.createElement("em");
    em.setAttribute("data-inf", lbl);
    em.style.color = accentColor;
    em.style.borderBottom = "1.5px dashed "+accentColor+"80";
    em.style.cursor = "pointer";
    em.style.fontStyle = "italic";
    em.textContent = text;
    r.deleteContents(); r.insertNode(em);
    var nr = document.createRange(); nr.setStartAfter(em); nr.collapse(true);
    sel.removeAllRanges(); sel.addRange(nr);
    setHasSel(false); handleInput();
  }

  function stripFormatting() {
    var el = editorRef.current; if (!el) return;

    // Case 1: cursor is inside a formatted node — unwrap it directly
    if (cursorInFmt && cursorInFmt.node && el.contains(cursorInFmt.node)) {
      removeNodeFormatting(cursorInFmt.node);
      return;
    }

    // Case 2: active text selection — extract as plain text and re-insert
    el.focus();
    var sel = window.getSelection(); if (!sel || sel.isCollapsed) return;
    var r = sel.getRangeAt(0);
    var plainText = r.toString(); if (!plainText) return;
    // Delete the range contents (removes all nodes within selection)
    r.deleteContents();
    var textNode = document.createTextNode(plainText);
    r.insertNode(textNode);
    // If the new text node ended up inside a formatting element, unwrap that element
    var parent = textNode.parentNode;
    while (parent && parent !== el) {
      if (parent.tagName === "EM" || parent.tagName === "I" ||
          parent.tagName === "STRONG" || parent.tagName === "B") {
        var gp = parent.parentNode;
        while (parent.firstChild) gp.insertBefore(parent.firstChild, parent);
        gp.removeChild(parent);
        break;
      }
      parent = parent.parentNode;
    }
    el.normalize();
    // Restore cursor after the inserted text node
    var newSel = window.getSelection();
    var nr2 = document.createRange();
    try { nr2.setStartAfter(textNode); nr2.collapse(true); } catch(e2) { nr2.selectNodeContents(el); nr2.collapse(false); }
    newSel.removeAllRanges(); newSel.addRange(nr2);
    setHasSel(false); setCursorInFmt(null); handleInput();
  }

  // Derive a summary of all formatted spans from the current value for the panel
  var inflSummary = value ? parseRichText(value).filter(function(s) {
    return (s.type === "italic" || s.type === "bold") && s.content.trim();
  }) : [];

  var curFmt = cursorInFmt;
  var curInfl = curFmt && curFmt.inf ? INFL_MAP[curFmt.inf] : null;
  var isEmpty = !value || value.trim() === "";

  return (
    <div>
      {/* ── Editable area ── */}
      <div style={{position:"relative"}}>
        {isEmpty && (
          <div style={{position:"absolute",top:0,left:0,right:0,padding:"13px 14px 13px 18px",fontSize:14,lineHeight:1.8,fontFamily:"'Lora',Georgia,serif",fontStyle:"italic",color:"rgba(255,255,255,.2)",pointerEvents:"none",userSelect:"none",WebkitUserSelect:"none"}}>
            Type what the rep says…
          </div>
        )}
        <div
          ref={editorRef}
          contentEditable={true}
          suppressContentEditableWarning={true}
          onInput={handleInput}
          onPaste={handlePaste}
          onMouseUp={handleMouseUp}
          onKeyUp={checkSel}
          onBlur={function() { setHasSel(false); setCursorInFmt(null); }}
          style={{minHeight:130,padding:"13px 14px 13px 18px",background:"rgba(255,255,255,.06)",border:"1.5px solid rgba(255,255,255,.1)",borderLeft:"3px solid "+accentColor,borderRadius:12,color:"rgba(255,255,255,.92)",fontSize:15,lineHeight:1.8,fontFamily:"'Lora',Georgia,serif",outline:"none",cursor:"text",wordBreak:"break-word",whiteSpace:"pre-wrap"}}
        />
      </div>

      {/* ── Formatting toolbar ── */}
      <div style={{position:"sticky",bottom:0,zIndex:10,marginTop:8}}>
        <div style={{background:"rgba(5,14,38,.97)",border:"1px solid rgba(255,255,255,.1)",borderRadius:12,padding:"8px 12px",backdropFilter:"blur(12px)"}}>

          {/* Context mode: cursor is inside a formatted span */}
          {curFmt && !hasSel ? (
            <div>
              <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:6}}>
                <div style={{flex:1,display:"flex",alignItems:"center",gap:8,background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.12)",borderRadius:9,padding:"6px 10px",minWidth:0,overflow:"hidden"}}>
                  {curFmt.isBold
                    ? <span style={{fontWeight:800,color:"#fff",fontSize:13,fontFamily:"'Lora',serif",flexShrink:0}}>B</span>
                    : curInfl
                      ? <span style={{fontSize:15,flexShrink:0}}>{curInfl.icon}</span>
                      : <span style={{fontStyle:"italic",color:"rgba(255,255,255,.45)",fontSize:13,flexShrink:0}}>i</span>
                  }
                  <div style={{minWidth:0,overflow:"hidden"}}>
                    <div style={{fontSize:11,fontWeight:700,color:curFmt.isBold?"#fff":accentColor,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                      {curFmt.isBold ? "Bold" : curInfl ? curInfl.label : "Plain italic"}
                    </div>
                    {!curFmt.isBold && curInfl && (
                      <div style={{fontSize:10,color:"rgba(255,255,255,.3)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{curInfl.cue}</div>
                    )}
                  </div>
                </div>
                {!curFmt.isBold && (
                  <button onMouseDown={function(e){e.preventDefault();openInflPickerForNode(curFmt.node);}}
                    style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.14)",borderRadius:8,padding:"6px 11px",fontSize:11,color:"rgba(255,255,255,.7)",cursor:"pointer",fontFamily:"inherit",flexShrink:0,fontWeight:600,whiteSpace:"nowrap"}}>
                    ↺ Change
                  </button>
                )}
                <button onMouseDown={function(e){e.preventDefault();stripFormatting();}}
                  style={{background:"rgba(239,83,80,.1)",border:"1px solid rgba(239,83,80,.3)",borderRadius:8,padding:"6px 11px",fontSize:11,color:"#EF5350",cursor:"pointer",fontFamily:"inherit",flexShrink:0,fontWeight:600,whiteSpace:"nowrap"}}>
                  ✕ Remove
                </button>
              </div>
              <div style={{fontSize:9,color:"rgba(255,255,255,.2)",letterSpacing:.3}}>
                Cursor inside formatted span · click elsewhere or select text to format new words
              </div>
            </div>
          ) : (
            /* Default toolbar */
            <div>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:hasSel?8:0}}>
                <button onMouseDown={function(e){e.preventDefault();applyBold();}} onTouchEnd={function(e){e.preventDefault();applyBold();}}
                  title="Bold (select text first)"
                  style={{background:hasSel?"rgba(255,255,255,.2)":"rgba(255,255,255,.08)",border:"1px solid "+(hasSel?"rgba(255,255,255,.4)":"rgba(255,255,255,.12)"),borderRadius:8,width:36,height:36,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Lora',serif",fontSize:15,fontWeight:800,fontStyle:"normal",color:"#fff",flexShrink:0,transition:"all .15s"}}>B</button>
                <button onMouseDown={function(e){e.preventDefault();openInflPicker();}} onTouchEnd={function(e){e.preventDefault();openInflPicker();}}
                  title="Add inflection (select text first)"
                  style={{background:hasSel?"rgba(255,255,255,.2)":"rgba(255,255,255,.08)",border:"1px solid "+(hasSel?"rgba(255,255,255,.4)":"rgba(255,255,255,.12)"),borderRadius:8,width:36,height:36,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Lora',serif",fontSize:15,fontStyle:"italic",fontWeight:700,color:accentColor,flexShrink:0,transition:"all .15s"}}>I</button>
                <button onMouseDown={function(e){e.preventDefault();stripFormatting();}} onTouchEnd={function(e){e.preventDefault();stripFormatting();}}
                  title="Remove formatting from selection"
                  style={{background:hasSel?"rgba(239,83,80,.18)":"rgba(255,255,255,.07)",border:"1px solid "+(hasSel?"rgba(239,83,80,.4)":"rgba(255,255,255,.08)"),borderRadius:8,width:36,height:36,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,color:hasSel?"#EF5350":"rgba(255,255,255,.2)",flexShrink:0,transition:"all .15s"}}>✕</button>
                <div style={{width:1,height:20,background:"rgba(255,255,255,.1)",flexShrink:0}}/>
                <div style={{flex:1,fontSize:11,color:hasSel?"rgba(255,255,255,.55)":"rgba(255,255,255,.25)",lineHeight:1.4,transition:"color .15s"}}>
                  {hasSel
                    ? <span style={{color:accentColor,fontWeight:700}}>Apply to selection ↑</span>
                    : <span>Select text to format · click an inflected word to edit it</span>}
                </div>
              </div>
              {hasSel && (
                <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                  {["Pause","Emphasize","Confident","Warm","Slow Down","Question"].map(function(lbl) {
                    var inf = INFL_MAP[lbl]; if (!inf) return null;
                    return (
                      <button key={lbl} onMouseDown={function(e){e.preventDefault();applyQuickInfl(lbl);}}
                        style={{background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.11)",borderRadius:99,padding:"4px 9px",fontSize:10,cursor:"pointer",fontFamily:"inherit",color:"rgba(255,255,255,.6)",display:"flex",alignItems:"center",gap:3}}>
                        <span>{inf.icon}</span><span>{lbl}</span>
                      </button>
                    );
                  })}
                  <button onMouseDown={function(e){e.preventDefault();openInflPicker();}}
                    style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.11)",borderRadius:99,padding:"4px 9px",fontSize:10,cursor:"pointer",fontFamily:"inherit",color:accentColor,display:"flex",alignItems:"center",gap:3}}>
                    <span>＋</span><span>More…</span>
                  </button>
                  <button onMouseDown={function(e){e.preventDefault();stripFormatting();}}
                    style={{background:"rgba(239,83,80,.08)",border:"1px solid rgba(239,83,80,.2)",borderRadius:99,padding:"4px 9px",fontSize:10,cursor:"pointer",fontFamily:"inherit",color:"rgba(239,83,80,.7)",display:"flex",alignItems:"center",gap:3}}>
                    <span>✕</span><span>Remove</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Formatted phrases summary panel ── */}
      {inflSummary.length > 0 && (
        <div style={{marginTop:8,background:"rgba(255,255,255,.02)",border:"1px solid rgba(255,255,255,.06)",borderRadius:10,padding:"8px 12px"}}>
          <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,.25)",letterSpacing:1.4,textTransform:"uppercase",marginBottom:7}}>Formatted Phrases</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
            {inflSummary.map(function(seg, i) {
              var inf = seg.inflection ? INFL_MAP[seg.inflection] : null;
              return (
                <span key={i} title={inf ? inf.cue : seg.type} style={{display:"inline-flex",alignItems:"center",gap:4,background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",borderRadius:99,padding:"3px 8px",fontSize:10,maxWidth:200,overflow:"hidden"}}>
                  {seg.type==="bold"
                    ? <span style={{fontWeight:800,color:"#fff",fontSize:10,fontFamily:"'Lora',serif",flexShrink:0}}>B</span>
                    : inf
                      ? <span style={{fontSize:11,flexShrink:0}}>{inf.icon}</span>
                      : <span style={{fontStyle:"italic",color:"rgba(255,255,255,.4)",fontSize:10,flexShrink:0}}>i</span>
                  }
                  <em style={{fontStyle:seg.type==="italic"?"italic":"normal",color:seg.type==="bold"?"#fff":accentColor,fontSize:10,fontWeight:seg.type==="bold"?700:400,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",display:"block"}}>{seg.content}</em>
                  {inf && <span style={{fontSize:9,color:"rgba(255,255,255,.3)",flexShrink:0}}>{inf.label}</span>}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Inflection picker bottom sheet ── */}
      {showPicker && (
        <div style={{position:"fixed",inset:0,zIndex:600,display:"flex",flexDirection:"column"}}>
          <div onClick={closePicker} style={{flex:1,background:"rgba(0,0,0,.7)",backdropFilter:"blur(6px)"}}/>
          <div style={{background:"#081428",borderRadius:"24px 24px 0 0",border:"1px solid rgba(255,255,255,.1)",borderBottom:"none",maxHeight:"82vh",display:"flex",flexDirection:"column"}}>
            <Handle/>
            <div style={{padding:"0 20px 12px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid rgba(255,255,255,.07)"}}>
              <div>
                <div style={{fontSize:15,fontWeight:700,color:"#fff",fontFamily:"'Lora',serif"}}>
                  {pickerMode==="edit" && editNodeRef.current
                    ? <em style={{color:accentColor}}>"{editNodeRef.current.textContent.length>26?editNodeRef.current.textContent.slice(0,25)+"…":editNodeRef.current.textContent}"</em>
                    : selRange
                      ? <em style={{color:accentColor}}>"{selRange.toString().length>26?selRange.toString().slice(0,25)+"…":selRange.toString()}"</em>
                      : "Choose Inflection"}
                </div>
                <div style={{fontSize:11,color:"rgba(255,255,255,.3)",marginTop:3}}>
                  {pickerMode==="edit" ? "Change delivery cue for this phrase" : "How should the rep deliver this?"}
                </div>
              </div>
              <button onClick={closePicker} style={iconBtn()}>✕</button>
            </div>
            <div style={{overflowY:"auto",flex:1,padding:"12px 16px 32px"}}>
              {/* Remove option shown only in edit mode */}
              {pickerMode==="edit" && (
                <button onMouseDown={function(e){
                  e.preventDefault();
                  setShowPicker(false);
                  var node = editNodeRef.current; editNodeRef.current = null;
                  if (node && editorRef.current && editorRef.current.contains(node)) removeNodeFormatting(node);
                }}
                  style={{display:"flex",alignItems:"center",gap:12,background:"rgba(239,83,80,.07)",border:"1px solid rgba(239,83,80,.2)",borderRadius:14,padding:"11px 13px",cursor:"pointer",fontFamily:"inherit",textAlign:"left",width:"100%",marginBottom:14}}>
                  <span style={{fontSize:19,width:30,textAlign:"center",flexShrink:0}}>✕</span>
                  <div>
                    <div style={{fontSize:13,fontWeight:700,color:"#EF5350",marginBottom:2}}>Remove formatting</div>
                    <div style={{fontSize:11,color:"rgba(255,255,255,.3)"}}>Strip this phrase back to plain text</div>
                  </div>
                </button>
              )}
              {INFL_CATS.map(function(cat) {
                return (
                  <div key={cat} style={{marginBottom:20}}>
                    <SectionHdr>{cat}</SectionHdr>
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      {INFLECTIONS.filter(function(inf) { return inf.cat===cat; }).map(function(inf) {
                        var isCurrent = pickerMode==="edit" && editNodeRef.current
                          && editNodeRef.current.getAttribute && editNodeRef.current.getAttribute("data-inf")===inf.label;
                        return (
                          <button key={inf.id} onClick={function(){applyInflection(inf);}}
                            style={{display:"flex",alignItems:"center",gap:12,background:isCurrent?"rgba(255,255,255,.09)":"rgba(255,255,255,.07)",border:"1px solid "+(isCurrent?accentColor+"55":"rgba(255,255,255,.08)"),borderRadius:14,padding:"11px 13px",cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}>
                            <span style={{fontSize:19,width:30,textAlign:"center",flexShrink:0}}>{inf.icon}</span>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontSize:13,fontWeight:700,color:isCurrent?accentColor:"rgba(255,255,255,.8)",marginBottom:2}}>
                                {inf.label}{isCurrent ? " ✓" : ""}
                              </div>
                              <div style={{fontSize:11,color:"rgba(255,255,255,.4)",lineHeight:1.4}}>{inf.cue}</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <button onClick={function(){applyInflection(null);}}
                style={{display:"flex",alignItems:"center",gap:12,background:"rgba(255,255,255,.05)",border:"1px dashed rgba(255,255,255,.1)",borderRadius:14,padding:"11px 13px",cursor:"pointer",fontFamily:"inherit",textAlign:"left",width:"100%"}}>
                <span style={{fontSize:19,width:30,textAlign:"center",flexShrink:0}}>✏️</span>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:"rgba(255,255,255,.45)",marginBottom:2}}>Plain italic</div>
                  <div style={{fontSize:11,color:"rgba(255,255,255,.3)"}}>Style only, no coaching cue</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CARD EDITOR SHEET ────────────────────────────────────────────────────────
function CardEditorSheet({ card, allCards, accentColor, lockedType, onSave, onDelete, onClose }) {
  var isBlank = !card.prompt && !card.title;
  var [form, setForm] = useState({
    id: card.id || uid(),
    title: card.title || "",
    type: lockedType || card.type || "pitch",
    overview: card.overview || [],
    intendedPath: card.intendedPath === undefined ? false : card.intendedPath,
    prompt: card.prompt || "",
    answers: card.answers && card.answers.length ? card.answers.map(function(a){ return Object.assign({}, a); }) : [{id:aid(),label:"",next:null}]
  });
  var [linkIdx, setLinkIdx] = useState(null);
  var [previewCardId, setPreviewCardId] = useState(null);
  var lastTouchId = useRef(null);
  var [errs, setErrs] = useState({});
  var [section, setSection] = useState("prompt");
  var [showOv, setShowOv] = useState(function() { return !!(card.overview && card.overview.some(function(b){return b&&b.trim();})); });

  function setField(k, v) { setForm(function(p) { return Object.assign({}, p, {[k]:v}); }); }
  function setAns(i, k, v) { setForm(function(p) { var arr=p.answers.map(function(a){return Object.assign({},a);}); arr[i]=Object.assign({},arr[i],{[k]:v}); return Object.assign({},p,{answers:arr}); }); }
  function addAns() { setForm(function(p) { return Object.assign({}, p, {answers:p.answers.concat([{id:aid(),label:"",next:null}])}); }); }
  function delAns(i) { setForm(function(p) { return Object.assign({}, p, {answers:p.answers.filter(function(_,j){return j!==i;})}); }); }
  function validate() {
    var e = {};
    if (!form.title.trim()) e.title = "Required";
    if (!form.prompt.trim()) e.prompt = "Required";
    if (form.answers.some(function(a) { return !a.label.trim(); })) e.answers = "All response labels required";
    setErrs(e);
    return Object.keys(e).length === 0;
  }
  var meta = TM[form.type] || TM.pitch;
  var ac = accentColor || meta.color;
  var availTypes = lockedType ? [lockedType] : ["pitch","discovery","close"];

  return (
    <div style={{position:"fixed",inset:0,zIndex:300,display:"flex",flexDirection:"column"}}>
      <div onClick={onClose} style={{flex:1,background:"rgba(0,0,0,.65)",backdropFilter:"blur(8px)"}}/>
      <div style={{background:"#081428",borderRadius:"24px 24px 0 0",border:"1px solid rgba(255,255,255,.1)",borderBottom:"none",maxHeight:"94vh",display:"flex",flexDirection:"column",animation:"sheetUp .3s cubic-bezier(.22,1,.36,1) both"}}>
        <Handle/>
        <div style={{padding:"8px 20px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid rgba(255,255,255,.07)"}}>
          <div>
            <div style={{fontSize:18,fontWeight:700,color:"#fff",fontFamily:"'Lora',serif"}}>{isBlank?"New Card":"Edit Card"}</div>
            {!isBlank && <div style={{fontSize:10,color:"rgba(255,255,255,.25)",marginTop:2}}>ID: {form.id}</div>}
          </div>
          <div style={{display:"flex",gap:8}}>
            {!isBlank && onDelete && <button onClick={function(){onDelete(form.id);}} style={ghostSm({color:"#EF5350",borderColor:"rgba(239,83,80,.3)"})}>Delete</button>}
            <button onClick={onClose} style={iconBtn()}>✕</button>
          </div>
        </div>
        <div style={{overflowY:"auto",flex:1,padding:"18px 20px"}}>
          {/* Card type */}
          {availTypes.length > 1 && (
            <div style={{marginBottom:18}}>
              <label style={labelSt()}>Card Type</label>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {availTypes.map(function(k) {
                  var v = TM[k];
                  return (
                    <button key={k} onClick={function(){setField("type",k);}}
                      style={{background:form.type===k?v.color+"25":"rgba(255,255,255,.05)",border:"1.5px solid "+(form.type===k?v.color:"rgba(255,255,255,.1)"),borderRadius:99,color:form.type===k?v.color:"rgba(255,255,255,.4)",fontSize:13,fontWeight:form.type===k?700:400,padding:"7px 15px",cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:4}}>
                      <span>{v.icon}</span>{v.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {/* Title */}
          <div style={{marginBottom:14}}>
            <label style={labelSt()}>Card Title</label>
            <input value={form.title} onChange={function(e){setField("title",e.target.value);}} placeholder="e.g. Opening Hook" style={inputSt({borderColor:errs.title?"#EF5350":"rgba(255,255,255,.1)"})}/>
            {errs.title && <div style={{fontSize:11,color:"#EF5350",marginTop:4}}>{errs.title}</div>}
          </div>
          {/* Intended path toggle */}
          <div style={{marginBottom:16,display:"flex",alignItems:"center",justifyContent:"space-between",background:"rgba(102,187,106,.07)",border:"1px solid rgba(102,187,106,.18)",borderRadius:12,padding:"11px 14px"}}>
            <div>
              <div style={{fontSize:12,fontWeight:700,color:"#66BB6A"}}>★ Intended Path</div>
              <div style={{fontSize:10,color:"rgba(255,255,255,.3)",marginTop:2}}>Mark as part of the ideal call flow for analytics</div>
            </div>
            <button onClick={function(){setField("intendedPath",!form.intendedPath);}}
              style={{width:44,height:26,borderRadius:99,background:form.intendedPath?"#66BB6A":"rgba(255,255,255,.1)",border:"none",cursor:"pointer",position:"relative",transition:"background .2s",flexShrink:0}}>
              <div style={{position:"absolute",top:3,left:form.intendedPath?20:3,width:20,height:20,borderRadius:"50%",background:"#fff",transition:"left .2s"}}/>
            </button>
          </div>
          {/* Section tabs */}
          <div style={{display:"flex",background:"rgba(255,255,255,.05)",borderRadius:10,padding:2,gap:1,marginBottom:14}}>
            {["prompt","overview"].map(function(sec) {
              var on = section === sec;
              var ovCount = form.overview ? form.overview.filter(function(b){return b&&b.trim();}).length : 0;
              return (
                <button key={sec} onClick={function(){setSection(sec);}}
                  style={{flex:1,background:on?"rgba(255,255,255,.12)":"transparent",border:"none",borderRadius:8,padding:"7px",cursor:"pointer",color:on?"#fff":"rgba(255,255,255,.4)",fontSize:12,fontFamily:"inherit",fontWeight:on?700:400}}>
                  {sec === "overview" ? ("◆ Overview" + (ovCount > 0 ? " ("+ovCount+")" : "")) : "✍ Script"}
                </button>
              );
            })}
          </div>
          {section === "overview" && (
            <div style={{marginBottom:18}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                <label style={Object.assign({},labelSt(),{marginBottom:0})}>Overview</label>
                <button onClick={function(){if(showOv)setField("overview",[]); setShowOv(function(p){return !p;});}}
                  style={{width:44,height:26,borderRadius:99,background:showOv?ac:"rgba(255,255,255,.1)",border:"none",cursor:"pointer",position:"relative",transition:"background .2s",flexShrink:0}}>
                  <div style={{position:"absolute",top:3,left:showOv?20:3,width:20,height:20,borderRadius:"50%",background:"#fff",transition:"left .2s"}}/>
                </button>
              </div>
              {showOv ? (
                <OverviewEditor bullets={form.overview} onChange={function(v){setField("overview",v);}} accent={ac}/>
              ) : (
                <div style={{fontSize:11,color:"rgba(255,255,255,.3)",padding:"10px 0",lineHeight:1.6}}>Toggle on to add 1–3 bullet points shown above the script in play mode.</div>
              )}
            </div>
          )}
          {section === "prompt" && (
            <div style={{marginBottom:18}}>
              <label style={labelSt()}>Script Prompt</label>
              <RichPromptEditor value={form.prompt} onChange={function(v){setField("prompt",v);}} accentColor={ac}/>
              {errs.prompt && <div style={{fontSize:11,color:"#EF5350",marginTop:4}}>{errs.prompt}</div>}
            </div>
          )}
          {/* Response options */}
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <label style={Object.assign({},labelSt(),{marginBottom:0})}>Response Options</label>
              <button onClick={addAns} style={ghostSm({color:ac,borderColor:ac+"44"})}>+ Add</button>
            </div>
            {errs.answers && <div style={{fontSize:11,color:"#EF5350",marginBottom:8}}>{errs.answers}</div>}
            {form.answers.map(function(ans, i) {
              return (
                <div key={ans.id} style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.07)",borderRadius:14,padding:"13px",marginBottom:8}}>
                  <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}>
                    <span style={{width:24,height:24,borderRadius:"50%",background:ac+"22",border:"1.5px solid "+ac+"55",color:ac,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,flexShrink:0}}>{i+1}</span>
                    <input value={ans.label} onChange={function(e){setAns(i,"label",e.target.value);}} placeholder="Prospect says..." style={inputSt({margin:0,flex:1})}/>
                    <button onClick={function(){delAns(i);}} style={Object.assign({},iconBtn(),{flexShrink:0})}>🗑</button>
                  </div>
                  <button onClick={function(){setLinkIdx(linkIdx===i?null:i);}}
                    style={{background:"none",border:"none",cursor:"pointer",padding:"2px 0",display:"flex",alignItems:"center",gap:6,fontFamily:"inherit"}}>
                    <span style={{fontSize:13}}>🔗</span>
                    <span style={{fontSize:12,color:ans.next?ac:"rgba(255,255,255,.28)"}}>
                      {ans.next ? ("→ " + (allCards[ans.next] ? allCards[ans.next].title : ans.next)) : (lockedType==="objection" ? "End — returns to pitch" : "End of path")}
                    </span>
                    <span style={{fontSize:10,color:"rgba(255,255,255,.25)"}}>▾</span>
                  </button>
                  {linkIdx === i && (
                    <div style={{marginTop:8,background:"#0c0d13",border:"1px solid rgba(255,255,255,.12)",borderRadius:12,overflow:"hidden",maxHeight:320,overflowY:"auto"}}>
                      <button onClick={function(){setAns(i,"next",null);setLinkIdx(null);setPreviewCardId(null);lastTouchId.current=null;}}
                        style={{display:"flex",alignItems:"center",gap:8,width:"100%",background:ans.next===null?"rgba(255,255,255,.08)":"transparent",border:"none",borderBottom:"1px solid rgba(255,255,255,.05)",color:"rgba(255,255,255,.4)",fontSize:13,padding:"11px 14px",cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}>
                        <span>— {lockedType==="objection" ? "End / return to pitch" : "End of path"}</span>
                        {ans.next === null && <span style={{marginLeft:"auto",color:ac}}>✓</span>}
                      </button>
                      {Object.values(allCards).filter(function(c) { return c.id !== form.id; }).map(function(c) {
                        var m2 = TM[c.type] || TM.pitch;
                        var isPreviewing = previewCardId === c.id;
                        var bullets = (c.overview||[]).filter(function(b){return b&&b.trim();});
                        return (
                          <div key={c.id}>
                            <button
                              onMouseEnter={function(){setPreviewCardId(c.id);}}
                              onMouseLeave={function(){setPreviewCardId(null);}}
                              onTouchStart={function(e){
                                if (lastTouchId.current !== c.id) {
                                  e.preventDefault();
                                  lastTouchId.current = c.id;
                                  setPreviewCardId(c.id);
                                }
                              }}
                              onClick={function(){setAns(i,"next",c.id);setLinkIdx(null);setPreviewCardId(null);lastTouchId.current=null;}}
                              style={{display:"flex",alignItems:"center",gap:8,width:"100%",background:ans.next===c.id?"rgba(255,255,255,.08)":isPreviewing?"rgba(255,255,255,.07)":"transparent",border:"none",borderBottom:isPreviewing?"none":"1px solid rgba(255,255,255,.05)",color:"rgba(255,255,255,.75)",fontSize:13,padding:"11px 14px",cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}>
                              <span style={{color:m2.color,fontSize:12}}>{m2.icon}</span>
                              <span style={{flex:1}}>{c.title}</span>
                              {isPreviewing && <span style={{fontSize:9,color:"rgba(255,255,255,.25)",flexShrink:0}}>tap again to select</span>}
                              {ans.next === c.id && <span style={{color:ac,flexShrink:0}}>✓</span>}
                            </button>
                            {isPreviewing && (
                              <div style={{background:"rgba(255,255,255,.07)",borderBottom:"1px solid rgba(255,255,255,.07)",padding:"9px 14px 11px",borderLeft:"2px solid "+m2.color}}>
                                <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:bullets.length>0||c.prompt?6:0}}>
                                  <TypeBadge type={c.type} small/>
                                  {c.intendedPath && <IntendedBadge/>}
                                </div>
                                {bullets.length > 0 && (
                                  <div style={{marginBottom:c.prompt?5:0}}>
                                    {bullets.map(function(b,bi){return(
                                      <div key={bi} style={{display:"flex",alignItems:"flex-start",gap:5,marginBottom:2}}>
                                        <span style={{color:m2.color,fontSize:8,marginTop:3,flexShrink:0}}>◆</span>
                                        <span style={{fontSize:10,color:"rgba(255,255,255,.55)",lineHeight:1.4,fontFamily:"inherit"}}>{b}</span>
                                      </div>
                                    );})}
                                  </div>
                                )}
                                {c.prompt && (
                                  <div style={{fontSize:11,color:"rgba(255,255,255,.4)",lineHeight:1.5,fontFamily:"'Lora',Georgia,serif",fontStyle:"italic",overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>
                                    {stripMarkup(c.prompt).slice(0,130)}{stripMarkup(c.prompt).length>130?"…":""}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{height:80}}/>
        </div>
        <div style={{padding:"14px 20px",borderTop:"1px solid rgba(255,255,255,.07)",display:"flex",gap:10}}>
          <button onClick={onClose} style={Object.assign({},ghostBtn(),{flex:1})}>Cancel</button>
          <button onClick={function(){if(validate())onSave(form);}} style={Object.assign({},solidBtn(ac),{flex:2})}>{isBlank?"Create Card":"Save Changes"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── OBJECTION PICKER (in-session sheet) ──────────────────────────────────────
function ObjPicker({ stacks, onSelect, onClose, deckCards }) {
  return (
    <div style={{position:"fixed",inset:0,zIndex:250,display:"flex",flexDirection:"column"}}>
      <div onClick={onClose} style={{flex:1,background:"rgba(0,0,0,.55)",backdropFilter:"blur(6px)"}}/>
      <div style={{background:"#081428",borderRadius:"24px 24px 0 0",border:"1px solid rgba(239,83,80,.25)",borderBottom:"none",padding:"0 20px 0",animation:"sheetUp .28s cubic-bezier(.22,1,.36,1) both"}}>
        <Handle/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,paddingTop:4}}>
          <div>
            <div style={{fontSize:16,fontWeight:700,color:"#fff",fontFamily:"'Lora',serif"}}>Handle an Objection</div>
            <div style={{fontSize:11,color:"rgba(255,255,255,.3)",marginTop:2}}>Select a stack to handle the objection</div>
          </div>
          <button onClick={onClose} style={iconBtn()}>✕</button>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:8,paddingBottom:28,maxHeight:"62vh",overflowY:"auto"}}>
          {stacks.length === 0 && <div style={{textAlign:"center",color:"rgba(255,255,255,.3)",padding:"28px 0",fontSize:14}}>No objection stacks yet.</div>}
          {stacks.map(function(stack, i) {
            return (
              <button key={stack.id} onClick={function(){onSelect(stack);}}
                style={{background:"rgba(239,83,80,.06)",border:"1.5px solid rgba(239,83,80,.18)",borderRadius:16,padding:"15px 17px",cursor:"pointer",textAlign:"left",fontFamily:"inherit",display:"flex",alignItems:"center",gap:14,animation:"answerItem .3s cubic-bezier(.22,1,.36,1) "+(i*.06)+"s both"}}>
                <div style={{width:44,height:44,borderRadius:14,background:"rgba(239,83,80,.15)",border:"1px solid rgba(239,83,80,.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>{stack.icon}</div>
                <div>
                  <div style={{fontSize:15,fontWeight:700,color:"#fff",marginBottom:2}}>{stack.label}</div>
                  <div style={{fontSize:11,color:"rgba(255,255,255,.3)",marginBottom:2}}>{Object.keys(stack.cards).length} response paths</div>
                  {stack.targetCard && stack.targetCard !== "__pick" && deckCards && deckCards[stack.targetCard]
                    ? <div style={{fontSize:10,color:"rgba(239,83,80,.55)"}}>→ then: {deckCards[stack.targetCard].title}</div>
                    : <div style={{fontSize:10,color:"rgba(255,255,255,.22)"}}>↩ returns to current card</div>
                  }
                </div>
                <span style={{marginLeft:"auto",color:"rgba(239,83,80,.6)",fontSize:18}}>›</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── NAVIGATOR ────────────────────────────────────────────────────────────────
// Core card navigator — used inside active Play sessions.
// sessionMode=true records visit events and shows the + Note button.
// cardEnterTime tracks dwell time per card.
function Navigator({ deck, sessionMode, onEvent }) {
  var [pitchHist, setPitchHist] = useState(deck.rootCard ? [deck.rootCard] : []);
  var [objMode,   setObjMode]   = useState(null);
  var [showPicker, setShowPicker] = useState(false);
  var [animKey, setAnimKey] = useState(0);
  var [dir, setDir] = useState(1);
  var [showNote, setShowNote] = useState(false);
  var [noteText, setNoteText] = useState("");
  var cardEnterTime = useRef(Date.now());

  useEffect(function() {
    setPitchHist(deck.rootCard ? [deck.rootCard] : []);
    setObjMode(null);
    setAnimKey(function(k) { return k + 1; });
  }, [deck.id, deck.rootCard]);

  var inObj = !!objMode;
  var curCards = inObj ? objMode.stack.cards : deck.cards;
  var curId = inObj ? objMode.history[objMode.history.length-1] : pitchHist[pitchHist.length-1];
  var card = curId ? curCards[curId] : null;
  var meta = card ? (TM[card.type] || TM.pitch) : TM.pitch;

  function emitVisit(c, dur) {
    if (!sessionMode || !onEvent) return;
    onEvent({ type:"visit", cardId:c.id, cardTitle:c.title, cardType:c.type, isObjCard:inObj, stackLabel:inObj&&objMode?objMode.stack.label:null, intendedPath:!!c.intendedPath, ts:Date.now(), durationMs:dur });
  }

  function navigate(nextCardId, isObj, newObjMode) {
    var dur = Date.now() - cardEnterTime.current;
    if (card) emitVisit(card, dur);
    cardEnterTime.current = Date.now();
    setDir(1); setAnimKey(function(k) { return k + 1; });
    if (isObj) { setObjMode(newObjMode); }
    else if (nextCardId) { setPitchHist(function(h) { return h.concat([nextCardId]); }); }
  }

  function goAnswer(ans) {
    if (inObj) {
      var dur = Date.now() - cardEnterTime.current;
      if (card) emitVisit(card, dur);
      cardEnterTime.current = Date.now();
      if (!ans.next) {
        setDir(-1); setAnimKey(function(k) { return k+1; });
        var tc = objMode && objMode.stack && objMode.stack.targetCard;
        var validTc = tc && tc !== "__pick" && deck.cards[tc];
        setTimeout(function() {
          if (validTc) setPitchHist(function(h) { return h.concat([tc]); });
          setObjMode(null);
        }, 30);
      } else {
        setDir(1); setAnimKey(function(k) { return k+1; });
        setObjMode(function(o) { return Object.assign({}, o, {history: o.history.concat([ans.next])}); });
      }
    } else {
      if (!ans.next) return;
      navigate(ans.next, false, null);
    }
  }

  function goBack() {
    setDir(-1); setAnimKey(function(k) { return k+1; });
    if (inObj) {
      if (objMode.history.length <= 1) setTimeout(function() { setObjMode(null); }, 30);
      else setObjMode(function(o) { return Object.assign({}, o, {history: o.history.slice(0,-1)}); });
    } else {
      if (pitchHist.length > 1) setPitchHist(function(h) { return h.slice(0,-1); });
    }
  }
  function jumpTo(idx) { setDir(-1); setAnimKey(function(k){return k+1;}); setPitchHist(function(h){return h.slice(0,idx+1);}); }
  function openStack(stack) { setShowPicker(false); navigate(null, true, {stack, history:[stack.rootCard], returnCard:curId}); }
  function exitObj() { setDir(-1); setAnimKey(function(k){return k+1;}); setTimeout(function(){setObjMode(null);},30); }
  function restart() { setDir(-1); setAnimKey(function(k){return k+1;}); setTimeout(function(){setPitchHist(deck.rootCard?[deck.rootCard]:[]);},30); }

  function submitNote() {
    if (!noteText.trim()) return;
    if (sessionMode && onEvent && card) {
      onEvent({ type:"note", cardId:card.id, cardTitle:card.title, text:noteText.trim(), ts:Date.now() });
    }
    setNoteText(""); setShowNote(false);
  }

  if (!deck.rootCard || !card) {
    return (
      <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:32,gap:16}}>
        <div style={{fontSize:52}}>📭</div>
        <div style={{color:"rgba(255,255,255,.4)",fontSize:15,textAlign:"center",lineHeight:1.6}}>No cards yet.<br/>Go to <strong style={{color:"#fff"}}>Cards</strong> to build your deck.</div>
      </div>
    );
  }

  var isEnd = !inObj && card.answers.every(function(a) { return !a.next; });
  var animName = dir > 0 ? "cardIn" : "cardBack";

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflowY:"auto",position:"relative"}}>
      {/* Objection mode banner */}
      {inObj && (
        <div style={{margin:"12px 16px 0",padding:"10px 16px",background:"rgba(239,83,80,.1)",border:"1px solid rgba(239,83,80,.25)",borderRadius:14,display:"flex",justifyContent:"space-between",alignItems:"center",animation:"fadeIn .2s ease both"}}>
          <div>
            <div style={{fontSize:11,color:OBJ_COLOR,fontWeight:700,letterSpacing:.7,textTransform:"uppercase"}}>🛡️ {objMode.stack.label}</div>
            <div style={{fontSize:11,color:"rgba(255,255,255,.3)",marginTop:2}}>Returns to: <span style={{color:"rgba(255,255,255,.55)"}}>{deck.cards[objMode.returnCard]?deck.cards[objMode.returnCard].title:""}</span></div>
          </div>
          <button onClick={exitObj} style={ghostSm({color:OBJ_COLOR,borderColor:"rgba(239,83,80,.3)"})}>Exit</button>
        </div>
      )}
      {/* Breadcrumb + nav controls */}
      {!inObj && pitchHist.length > 0 && (
        <div style={{padding:"12px 20px 0",display:"flex",flexDirection:"column",gap:8}}>
          <div style={{display:"flex",gap:4,alignItems:"center",overflowX:"auto",paddingBottom:2}}>
            {pitchHist.map(function(hid, i) {
              var hc = deck.cards[hid]; var hm = hc ? (TM[hc.type]||TM.pitch) : TM.pitch; var isLast = i===pitchHist.length-1;
              return (
                <div key={hid+i} style={{display:"flex",alignItems:"center",gap:4,flexShrink:0}}>
                  <button onClick={function(){if(!isLast)jumpTo(i);}}
                    style={{width:isLast?30:20,height:isLast?30:20,borderRadius:"50%",border:"2px solid "+hm.color,background:isLast?hm.color+"33":"transparent",cursor:isLast?"default":"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:isLast?11:8,color:hm.color,transition:"all .2s",flexShrink:0}}>
                    {isLast ? hm.icon : "●"}
                  </button>
                  {i < pitchHist.length-1 && <div style={{width:14,height:1,background:"rgba(255,255,255,.12)",flexShrink:0}}/>}
                </div>
              );
            })}
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:10,color:"rgba(255,255,255,.25)",letterSpacing:.4}}>Step {pitchHist.length}</span>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <button onClick={function(){setShowPicker(true);}}
                style={{background:"rgba(239,83,80,.12)",border:"1px solid rgba(239,83,80,.35)",borderRadius:99,color:OBJ_COLOR,padding:"5px 13px",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700,display:"flex",alignItems:"center",gap:6}}>
                🛡️ Objection
                {deck.objStacks.length > 0 && <span style={{background:"rgba(239,83,80,.28)",borderRadius:99,fontSize:10,padding:"0 6px"}}>{deck.objStacks.length}</span>}
              </button>
              {pitchHist.length > 1 && <button onClick={goBack} style={ghostSm()}>← Back</button>}
            </div>
          </div>
        </div>
      )}
      {inObj && (
        <div style={{padding:"10px 20px 0",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:10,color:"rgba(239,83,80,.6)",letterSpacing:.4}}>Step {objMode.history.length}</span>
          <button onClick={goBack} style={ghostSm({borderColor:"rgba(239,83,80,.3)",color:"rgba(239,83,80,.7)"})}>← Back</button>
        </div>
      )}
      {/* Card */}
      <div key={animKey} style={{margin:"12px 16px 0",animation:animName+" .3s cubic-bezier(.22,1,.36,1) both"}}>
        <div style={{background:"linear-gradient(145deg,rgba(255,255,255,.07),rgba(255,255,255,.03))",border:"1px solid rgba(255,255,255,"+(inObj?".15":".1")+")",borderRadius:22,boxShadow:"0 0 40px "+meta.glow+",0 20px 50px rgba(0,0,0,.5)"}}>
          <div style={{height:3,background:"linear-gradient(90deg,"+meta.color+","+meta.color+"00)",borderRadius:"22px 22px 0 0"}}/>
          <div style={{padding:"14px 20px 8px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <TypeBadge type={card.type}/>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              {card.intendedPath && <IntendedBadge/>}
              {inObj && <span style={{fontSize:10,color:"rgba(239,83,80,.5)",background:"rgba(239,83,80,.1)",padding:"2px 8px",borderRadius:99}}>🛡️ objection</span>}
              {sessionMode && (
                <button onClick={function(){setShowNote(true);}}
                  style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.12)",borderRadius:8,padding:"4px 9px",cursor:"pointer",fontSize:10,color:"rgba(255,255,255,.5)",fontFamily:"inherit"}}>+ Note</button>
              )}
            </div>
          </div>
          <div style={{padding:"0 20px 10px"}}>
            <h2 style={{margin:0,fontSize:22,fontWeight:700,color:"#fff",lineHeight:1.25,fontFamily:"'Lora',Georgia,serif"}}>{card.title}</h2>
          </div>
          <OverviewDisplay bullets={card.overview} color={meta.color}/>
          <div style={{margin:"0 14px 16px",padding:"15px 17px",background:"rgba(0,0,0,.3)",borderRadius:14,borderLeft:"3px solid "+meta.color}}>
            <p style={{margin:0,fontSize:15,lineHeight:1.75,color:"rgba(255,255,255,.92)",fontFamily:"'Lora',Georgia,serif"}}>
              <RichPromptDisplay text={card.prompt} accentColor={meta.color}/>
            </p>
          </div>
        </div>
      </div>
      {/* Quick note input */}
      {showNote && sessionMode && (
        <div style={{margin:"10px 16px 0",background:"rgba(168,255,62,.08)",border:"1px solid rgba(168,255,62,.22)",borderRadius:14,padding:"12px 14px",animation:"fadeIn .15s ease both"}}>
          <div style={{fontSize:10,fontWeight:700,color:SESS_COLOR,letterSpacing:.7,textTransform:"uppercase",marginBottom:7}}>📝 Note on: {card.title}</div>
          <textarea value={noteText} onChange={function(e){setNoteText(e.target.value);}}
            placeholder="Type your note…" rows={2}
            style={Object.assign({},inputSt({resize:"none",fontSize:13,padding:"9px 12px"}),{marginBottom:8,minHeight:58})}
            autoFocus/>
          <div style={{display:"flex",gap:8}}>
            <button onClick={function(){setShowNote(false);setNoteText("");}} style={Object.assign({},ghostBtn(),{flex:1,padding:"8px",fontSize:12})}>Cancel</button>
            <button onClick={submitNote} style={Object.assign({},solidBtn(SESS_COLOR),{flex:2,padding:"8px",fontSize:12})}>Save Note</button>
          </div>
        </div>
      )}
      {/* Answer buttons */}
      <div key={animKey+"a"} style={{padding:"13px 16px 0",animation:"answersIn .35s cubic-bezier(.22,1,.36,1) .1s both"}}>
        <div style={{fontSize:10,fontWeight:700,letterSpacing:2,color:"rgba(255,255,255,.2)",textTransform:"uppercase",marginBottom:8,paddingLeft:2}}>
          {inObj ? "Navigate objection:" : "Prospect responds:"}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:7}}>
          {card.answers.map(function(ans, i) {
            var nextCard = ans.next ? curCards[ans.next] : null;
            var nm = nextCard ? (TM[nextCard.type] || TM.pitch) : null;
            var isTerminal = !ans.next;
            var isIntended = !inObj && nextCard && !!nextCard.intendedPath;
            return (
              <button key={ans.id} onClick={function(){goAnswer(ans);}}
                style={{background:isIntended?"rgba(102,187,106,.08)":"rgba(255,255,255,.05)",border:"1.5px solid "+(isIntended?"rgba(102,187,106,.35)":isTerminal?"rgba(255,255,255,.06)":"rgba(255,255,255,.11)"),borderRadius:14,padding:"14px 16px",cursor:isTerminal?"default":"pointer",textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center",fontFamily:"inherit",gap:10,animation:"answerItem .32s cubic-bezier(.22,1,.36,1) "+(.08+i*.05)+"s both",opacity:(isTerminal&&!inObj)?0.45:1}}>
                <div style={{display:"flex",alignItems:"center",gap:11,flex:1,minWidth:0}}>
                  <span style={{width:25,height:25,borderRadius:"50%",background:isIntended?"rgba(102,187,106,.2)":meta.color+"22",border:"1.5px solid "+(isIntended?"rgba(102,187,106,.5)":meta.color+"44"),color:isIntended?"#66BB6A":meta.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,flexShrink:0}}>{i+1}</span>
                  <span style={{color:isIntended?"rgba(255,255,255,.95)":"rgba(255,255,255,.85)",fontSize:14,lineHeight:1.4}}>{ans.label}</span>
                </div>
                {isIntended && <span style={{fontSize:10,color:"#66BB6A",flexShrink:0,fontWeight:700}}>★</span>}
                {inObj && isTerminal && <span style={{fontSize:10,color:"rgba(239,83,80,.5)",background:"rgba(239,83,80,.1)",padding:"2px 8px",borderRadius:99,flexShrink:0}}>↩ return</span>}
                {!inObj && isTerminal && <span style={{fontSize:10,color:"rgba(255,255,255,.2)",flexShrink:0}}>end</span>}
                {nm && <span style={{fontSize:10,color:isIntended?"#66BB6A":nm.color,background:isIntended?"rgba(102,187,106,.15)":nm.color+"18",padding:"2px 8px",borderRadius:99,flexShrink:0,border:"1px solid "+(isIntended?"rgba(102,187,106,.3)":nm.color+"30")}}>{nm.icon} {nextCard.title}</span>}
              </button>
            );
          })}
        </div>
      </div>
      {/* End of path */}
      {isEnd && (
        <div style={{margin:"18px 16px 0",padding:"18px",background:"rgba(102,187,106,.07)",border:"1px solid rgba(102,187,106,.2)",borderRadius:16,textAlign:"center"}}>
          <div style={{fontSize:26,marginBottom:6}}>✅</div>
          <div style={{color:"rgba(255,255,255,.6)",fontSize:13,marginBottom:14,lineHeight:1.5}}>End of this path.</div>
          <button onClick={restart} style={solidBtn("#66BB6A")}>↺ Restart</button>
        </div>
      )}
      <div style={{height:24}}/>
      {showPicker && <ObjPicker stacks={deck.objStacks} onSelect={openStack} onClose={function(){setShowPicker(false);}} deckCards={deck.cards}/>}
    </div>
  );
}

// ─── TREE VIEW ────────────────────────────────────────────────────────────────
var MIN_ZOOM = 0.45, MAX_ZOOM = 1.8;

function TreeView({ cards, rootCard, onEdit, onSetRoot }) {
  var [collapsed, setCollapsed] = useState({});
  var scrollRef = useRef(null);
  var [zoom, setZoom] = useState(1.0);
  var pinchRef = useRef(null);

  function toggleCollapse(id) { setCollapsed(function(p) { return Object.assign({}, p, {[id]:!p[id]}); }); }
  function getDist(e) { return Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY); }
  function onTouchStart(e) { if (e.touches.length===2) pinchRef.current={dist:getDist(e),zoom}; else pinchRef.current=null; }
  function onTouchMove(e) { if (e.touches.length===2&&pinchRef.current){e.preventDefault();setZoom(Math.min(MAX_ZOOM,Math.max(MIN_ZOOM,pinchRef.current.zoom*getDist(e)/pinchRef.current.dist)));}}
  function onTouchEnd(e) { if(e.touches.length<2) pinchRef.current=null; }
  function onWheel(e) { if(e.ctrlKey||e.metaKey){e.preventDefault();setZoom(function(z){return Math.min(MAX_ZOOM,Math.max(MIN_ZOOM,z*(1-e.deltaY*0.002)));});}}

  var inboundCount = {};
  Object.values(cards).forEach(function(c) { (c.answers||[]).forEach(function(a) { if(a && a.next) inboundCount[a.next]=(inboundCount[a.next]||0)+1; }); });
  var renderedOnce = new Set();

  function renderNode(cardId, depth, ansLabel) {
    if (!cardId || !cards[cardId]) return null;
    var card = cards[cardId]; var meta = TM[card.type]||TM.pitch;
    var isRoot = cardId===rootCard; var isMerge = (inboundCount[cardId]||0)>1;
    if (renderedOnce.has(cardId)) {
      return (
        <div key={"xlink-"+cardId+"-"+depth} style={{paddingLeft:depth*16,marginBottom:2}}>
          {ansLabel && <div style={{fontSize:9,color:"rgba(255,255,255,.18)",fontStyle:"italic",marginBottom:1,paddingLeft:26,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ansLabel}</div>}
          <div style={{display:"flex",alignItems:"center",gap:5,paddingLeft:16}}>
            <button onClick={function(){onEdit(card);}}
              style={{background:"rgba(255,167,38,.06)",border:"1px dashed rgba(255,167,38,.3)",borderRadius:7,padding:"4px 8px 4px 7px",cursor:"pointer",display:"flex",alignItems:"center",gap:5,fontFamily:"inherit",maxWidth:"100%"}}>
              <span style={{fontSize:10,color:"#FFA726",flexShrink:0}}>↻</span>
              <span style={{fontSize:10,color:meta.color,flexShrink:0}}>{meta.icon}</span>
              <span style={{fontSize:10,color:"rgba(255,167,38,.8)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:120}}>{card.title}</span>
              <span style={{fontSize:8,color:"rgba(255,255,255,.2)",flexShrink:0,borderLeft:"1px solid rgba(255,255,255,.1)",paddingLeft:5,marginLeft:1}}>loop back</span>
            </button>
          </div>
        </div>
      );
    }
    renderedOnce.add(cardId);
    var children = (card.answers||[]).filter(function(a){return a && a.next;}); var isCollapsed = collapsed[cardId];
    return (
      <div key={cardId+"-"+depth} style={{marginBottom:2}}>
        {ansLabel && depth>0 && <div style={{paddingLeft:depth*16+24,fontSize:9,color:"rgba(255,255,255,.2)",fontStyle:"italic",marginBottom:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ansLabel}</div>}
        <div style={{display:"flex",alignItems:"center",gap:4,paddingLeft:depth*16}}>
          {children.length > 0 ? (
            <button onClick={function(){toggleCollapse(cardId);}} style={{width:18,height:18,background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",borderRadius:4,cursor:"pointer",fontSize:8,color:"rgba(255,255,255,.45)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              {isCollapsed?"▶":"▼"}
            </button>
          ) : <div style={{width:18,height:18,flexShrink:0}}/>}
          <button onClick={function(){onEdit(card);}} style={{flex:1,background:card.intendedPath?"rgba(102,187,106,.06)":"rgba(255,255,255,.07)",border:"1px solid "+(card.intendedPath?"rgba(102,187,106,.18)":"rgba(255,255,255,.07)"),borderLeft:"2px solid "+(card.intendedPath?"#66BB6A":meta.color),borderRadius:8,padding:"6px 9px",cursor:"pointer",display:"flex",alignItems:"center",gap:6,fontFamily:"inherit",transition:"background .14s",textAlign:"left",minWidth:0}}>
            <span style={{fontSize:12,flexShrink:0}}>{meta.icon}</span>
            <span style={{fontSize:12,color:"#fff",fontWeight:500,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{card.title}</span>
            {isRoot && <span style={{fontSize:8,background:"rgba(255,255,255,.1)",color:"rgba(255,255,255,.4)",padding:"1px 5px",borderRadius:99,flexShrink:0,textTransform:"uppercase",letterSpacing:.4}}>root</span>}
            {card.intendedPath && <span style={{fontSize:9,color:"#66BB6A",flexShrink:0}}>★</span>}
            {isMerge && <span style={{fontSize:9,color:meta.color,flexShrink:0,opacity:.7}}>⊕</span>}
          </button>
          {!isRoot && onSetRoot && (
            <button onClick={function(e){e.stopPropagation();onSetRoot(cardId);}}
              title="Set as root"
              style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.07)",borderRadius:6,padding:"4px 6px",cursor:"pointer",fontSize:9,color:"rgba(255,255,255,.3)",flexShrink:0,fontFamily:"inherit"}}
            >⬆</button>
          )}
        </div>
        {children.length>0 && !isCollapsed && (
          <div style={{position:"relative",marginLeft:depth*16+9}}>
            <div style={{position:"absolute",left:9,top:0,bottom:6,width:1,background:"rgba(255,255,255,.06)"}}/>
            <div style={{paddingLeft:9}}>
              {children.map(function(ans) { return renderNode(ans.next, depth+1, ans.label); })}
            </div>
          </div>
        )}
      </div>
    );
  }

  var reachable = new Set();
  function collectR(id, seen) { if(!id||!cards[id]||seen.has(id))return; seen.add(id); (cards[id].answers||[]).forEach(function(a){ if(a) collectR(a.next,seen); }); }
  collectR(rootCard, reachable);
  var orphans = Object.values(cards).filter(function(c) { return !reachable.has(c.id); });

  var hasIntended = Object.values(cards).some(function(c){return c.intendedPath;});
  var hasLoops = (function(){var s=new Set(); var found=false; function walk(id){if(!id||!cards[id])return;if(s.has(id)){found=true;return;}s.add(id);(cards[id].answers||[]).forEach(function(a){if(a)walk(a.next);});} walk(rootCard); return found;})();
  var hasMerge = Object.keys(inboundCount).some(function(k){return inboundCount[k]>1;});

  return (
    <div style={{flex:1,position:"relative",overflow:"hidden",display:"flex",flexDirection:"column"}}>
      {/* Legend — bottom bar, only shows relevant symbols */}
      <div style={{flexShrink:0,borderBottom:"1px solid rgba(255,255,255,.06)",padding:"5px 12px",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",background:"rgba(4,10,28,.7)"}}>
        <span style={{fontSize:8,color:"rgba(255,255,255,.2)",textTransform:"uppercase",letterSpacing:.8,marginRight:2}}>Key</span>
        <span style={{fontSize:9,color:"rgba(255,255,255,.25)",display:"flex",alignItems:"center",gap:3}}>
          <span style={{display:"inline-block",width:8,height:14,borderLeft:"2px solid #66BB6A",marginRight:1}}/>
          <span style={{color:"#66BB6A"}}>★</span>
          <span style={{color:"rgba(255,255,255,.35)"}}>intended path</span>
        </span>
        {hasLoops && <span style={{fontSize:9,color:"rgba(255,167,38,.6)",display:"flex",alignItems:"center",gap:3}}>
          <span style={{border:"1px dashed rgba(255,167,38,.35)",borderRadius:3,padding:"0 3px",fontSize:8}}>↻</span>
          <span style={{color:"rgba(255,255,255,.35)"}}>loop back</span>
        </span>}
        {hasMerge && <span style={{fontSize:9,color:"rgba(255,255,255,.3)",display:"flex",alignItems:"center",gap:3}}>
          <span>⊕</span>
          <span>multiple paths in</span>
        </span>}
        <span style={{fontSize:9,color:"rgba(255,255,255,.2)",display:"flex",alignItems:"center",gap:3}}>
          <span style={{fontSize:8,background:"rgba(255,255,255,.1)",color:"rgba(255,255,255,.4)",padding:"0 4px",borderRadius:3,textTransform:"uppercase",letterSpacing:.3}}>root</span>
          <span>entry card</span>
        </span>
        {Math.abs(zoom-1) > 0.05 && (
          <span style={{marginLeft:"auto",fontSize:9,color:"rgba(255,255,255,.3)",fontFamily:"inherit"}}>{Math.round(zoom*100)}%</span>
        )}
      </div>
      <div ref={scrollRef} style={{flex:1,overflowY:"auto",overflowX:"auto"}}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onWheel={onWheel}>
        <div style={{padding:"10px 12px",zoom:zoom,minWidth:"min-content"}}>
          {rootCard ? renderNode(rootCard,0,null) : <div style={{textAlign:"center",color:"rgba(255,255,255,.25)",padding:"40px 0",fontSize:14}}>No root card set.</div>}
          {orphans.length > 0 && (
            <div style={{marginTop:16}}>
              <SectionHdr>Unconnected ({orphans.length})</SectionHdr>
              {orphans.map(function(c) { var m=TM[c.type]||TM.pitch; return (
                <div key={c.id} style={{display:"flex",alignItems:"center",gap:5,marginBottom:4}}>
                  <div style={{width:18,flexShrink:0}}/>
                  <button onClick={function(){onEdit(c);}} style={{flex:1,background:"rgba(255,255,255,.02)",border:"1px dashed rgba(255,255,255,.1)",borderLeft:"2px solid rgba(255,255,255,.12)",borderRadius:8,padding:"6px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:6,fontFamily:"inherit",textAlign:"left",opacity:.45}}>
                    <span style={{fontSize:12}}>{m.icon}</span>
                    <span style={{fontSize:11,color:"rgba(255,255,255,.55)",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.title}</span>
                    <span style={{fontSize:8,color:"rgba(255,255,255,.2)"}}>orphan</span>
                  </button>
                </div>
              );})}
            </div>
          )}
          <div style={{height:12}}/>
        </div>
      </div>
    </div>
  );
}

// ─── PLAY TAB ─────────────────────────────────────────────────────────────────
// Three sub-views: home (dashboard), active (live session), ended (auto-redirect)
// From home, user picks Live or Practice and fills in title + description.
// While active, navigation is locked — no tab switching until End or Sold.
// On finish, auto-portals the user to the Session review in Sessions tab.
function PlayTab({ deck, activeId, onPortalToReview, onSwitchDeck,
    playView, setPlayView, activeSession, setActiveSession, sessionEvents, setSessionEvents }) {
  var [pendingType, setPendingType]   = useState("live");
  var [newName, setNewName]           = useState("");
  var [newDesc, setNewDesc]           = useState("");
  var [saving, setSaving]             = useState(false);
  var [nameError, setNameError]       = useState(false);

  // Handle deck changes: deck switch is handled in MainApp's switchDeck, so this effect
  // only fires if deck.id changes while an active session exists (should not happen normally)
  useEffect(function() {
    if (playView === "active" && activeSession && activeSession.deckId !== deck.id) {
      var finished = Object.assign({}, activeSession, {
        endTs: Date.now(),
        status: "completed",
        outcome: "completed",
        events: sessionEvents,
      });
      apiPost("/sessions", finished).catch(function(e){ console.error("redcard:", e); });
      setActiveSession(null);
      setSessionEvents([]);
      setPlayView("home");
      setNewName(""); setNewDesc(""); setNameError(false);
    }
  }, [deck.id]);

  function startSession() {
    var trimmed = (newName || "").trim();
    if (!trimmed) { setNameError(true); return; }
    var s = {
      id: sid(), deckId: deck.id, deckName: deck.name,
      deckColor: deck.color, deckIcon: deck.icon,
      name: trimmed, description: (newDesc || "").trim(),
      sessionType: pendingType, mode: pendingType,
      startTs: Date.now(), endTs: null,
      status: "active", outcome: "in_progress",
      sold: false, soldCardId: null, soldCardTitle: null,
      events: [],
    };
    setActiveSession(s);
    setSessionEvents([]);
    setPlayView("active");
  }

  function handleEvent(ev) {
    setSessionEvents(function(prev) { return prev.concat([ev]); });
  }

  function finishSession(sold, soldCard) {
    setSaving(true);
    var finished = Object.assign({}, activeSession, {
      endTs: Date.now(),
      status: "completed",
      outcome: sold ? "sold" : "completed",
      sold: !!sold,
      soldCardId: sold && soldCard ? soldCard.id : null,
      soldCardTitle: sold && soldCard ? soldCard.title : null,
      events: sessionEvents,
    });
    apiPost("/sessions", finished)
      .then(function() {
        setSaving(false);
        setActiveSession(null);
        setSessionEvents([]);
        setPlayView("home");
        setNewName(""); setNewDesc(""); setNameError(false);
        onPortalToReview(finished.id);
      })
      .catch(function() {
        setSaving(false);
        setActiveSession(null);
        setSessionEvents([]);
        setPlayView("home");
        setNameError(false);
        onPortalToReview(null);
      });
  }

  if (playView === "active" && activeSession) {
    var st = STYPE[activeSession.sessionType] || STYPE.live;
    return (
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{padding:"9px 16px",background:st.bg,borderBottom:"1px solid "+st.border,display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
          <div>
            <div style={{fontSize:9,color:st.color,fontWeight:700,letterSpacing:.8,textTransform:"uppercase",marginBottom:1}}>● {st.label} · Recording</div>
            <div style={{fontSize:13,color:"#fff",fontWeight:700,lineHeight:1.2}}>{activeSession.name}</div>
            {activeSession.description && <div style={{fontSize:10,color:"rgba(255,255,255,.4)",marginTop:1}}>{activeSession.description}</div>}
          </div>
          <div style={{display:"flex",gap:7}}>
            <button onClick={function(){finishSession(true, null);}} disabled={saving}
              style={{background:"#66BB6A",border:"none",borderRadius:9,color:"#000",fontSize:11,fontWeight:700,padding:"7px 13px",cursor:"pointer",fontFamily:"inherit"}}>
              ✓ Sold
            </button>
            <button onClick={function(){finishSession(false, null);}} disabled={saving}
              style={{background:"rgba(255,255,255,.1)",border:"1px solid rgba(255,255,255,.15)",borderRadius:9,color:"#fff",fontSize:11,fontWeight:700,padding:"7px 13px",cursor:"pointer",fontFamily:"inherit"}}>
              {saving ? "Saving…" : "End"}
            </button>
          </div>
        </div>
        <Navigator deck={deck} sessionMode={true} onEvent={handleEvent}/>
      </div>
    );
  }

  // Home dashboard
  var st2 = STYPE[pendingType] || STYPE.live;

  return (
    <div style={{flex:1,overflowY:"auto"}}>
      <div style={{padding:"14px 16px 0"}}>
        {/* Deck quick stats box */}
        <div style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.08)",borderLeft:"3px solid "+deck.color,borderRadius:"0 14px 14px 0",padding:"14px 16px",marginBottom:16}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
            <div style={{width:36,height:36,borderRadius:10,background:deck.color+"22",border:"1.5px solid "+deck.color+"44",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17}}>{deck.icon}</div>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:"#fff"}}>{deck.name}</div>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:7}}>
            <div style={{background:"rgba(0,0,0,.3)",borderRadius:10,padding:"9px 11px"}}>
              <div style={{fontSize:16,fontWeight:700,color:deck.color}}>{Object.keys(deck.cards).length}</div>
              <div style={{fontSize:9,color:"rgba(255,255,255,.3)",textTransform:"uppercase",letterSpacing:.5}}>cards</div>
            </div>
            <div style={{background:"rgba(0,0,0,.3)",borderRadius:10,padding:"9px 11px"}}>
              <div style={{fontSize:16,fontWeight:700,color:"#EF5350"}}>{deck.objStacks.length}</div>
              <div style={{fontSize:9,color:"rgba(255,255,255,.3)",textTransform:"uppercase",letterSpacing:.5}}>obj stacks</div>
            </div>
            <div style={{background:"rgba(0,0,0,.3)",borderRadius:10,padding:"9px 11px"}}>
              <div style={{fontSize:16,fontWeight:700,color:"#66BB6A"}}>{deck.objStacks.reduce(function(sum,os){return sum+Object.keys(os.cards).length;},0)}</div>
              <div style={{fontSize:9,color:"rgba(255,255,255,.3)",textTransform:"uppercase",letterSpacing:.5}}>obj cards</div>
            </div>
          </div>
        </div>

        {/* Session type picker */}
        <SectionHdr>Start a session</SectionHdr>
        <div style={{display:"flex",gap:9,marginBottom:14}}>
          {Object.entries(STYPE).map(function(entry) {
            var key = entry[0]; var st3 = entry[1]; var on = pendingType===key;
            return (
              <button key={key} onClick={function(){setPendingType(key); setPlayView("new");}}
                style={{flex:1,background:on?st3.bg:"rgba(255,255,255,.07)",border:"1.5px solid "+(on?st3.border:"rgba(255,255,255,.09)"),borderRadius:14,padding:"15px 10px",cursor:"pointer",fontFamily:"inherit",textAlign:"center",transition:"all .15s"}}>
                <div style={{fontSize:22,marginBottom:5}}>{key==="live"?"📞":"🎯"}</div>
                <div style={{fontSize:12,fontWeight:700,color:on?st3.color:"rgba(255,255,255,.5)"}}>{st3.label}</div>
                <div style={{fontSize:9,color:"rgba(255,255,255,.28)",marginTop:2}}>{key==="live"?"Real call":"Dry run"}</div>
              </button>
            );
          })}
        </div>

        {/* New session form (shown when a type is picked) */}
        {playView === "new" && (
          <div style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.1)",borderRadius:14,padding:"14px 16px",marginBottom:14,animation:"fadeIn .15s ease both"}}>
            <div style={{fontSize:13,fontWeight:700,color:"#fff",marginBottom:12}}>{st2.label === "Live" ? "📞" : "🎯"} New {st2.label} Session</div>
            <label style={labelSt()}>Title <span style={{color:"#EF5350",fontSize:9}}>*</span></label>
            <input value={newName} onChange={function(e){setNewName(e.target.value);setNameError(false);}} onKeyDown={function(e){if(e.key==="Enter")startSession();}}
              placeholder={pendingType==="live"?"e.g. Cold call — Acme Corp":"e.g. Morning practice run"}
              style={inputSt({marginBottom:nameError?4:10,borderColor:nameError?"rgba(239,83,80,.7)":undefined})} autoFocus/>
            {nameError && <div style={{fontSize:10,color:"#EF5350",marginBottom:8}}>Session title is required</div>}
            <label style={labelSt()}>Description <span style={{color:"rgba(255,255,255,.25)",fontWeight:400,textTransform:"none",letterSpacing:0,fontSize:10}}>(optional)</span></label>
            <textarea value={newDesc} onChange={function(e){setNewDesc(e.target.value);}}
              placeholder={pendingType==="live"?"Prospect info, context, goals…":"What you're working on, focus areas…"}
              rows={2}
              style={Object.assign({},inputSt({resize:"none",fontSize:13,lineHeight:1.5}),{marginBottom:12,minHeight:58})}/>
            <div style={{display:"flex",gap:8}}>
              <button onClick={function(){setPlayView("home");setNewName("");setNewDesc("");}} style={Object.assign({},ghostBtn(),{flex:1,padding:"10px"})}>Cancel</button>
              <button onClick={startSession}
                style={Object.assign({},solidBtn(st2.color),{flex:2})}>
                {st2.label === "Live" ? "📞" : "🎯"} Start {st2.label}
              </button>
            </div>
          </div>
        )}

        <div style={{height:20}}/>
      </div>
    </div>
  );
}

// ─── SESSION STATS HELPERS ────────────────────────────────────────────────────
function sessionVisits(s) { return (s.events||[]).filter(function(e){return e.type==="visit";}); }
function sessionNotes(s)  { return (s.events||[]).filter(function(e){return e.type==="note";}); }
function sessionDurSec(s) { return s.endTs ? Math.round((s.endTs-s.startTs)/1000) : null; }
function fmtSec(s) { if(!s||s<=0)return"0s"; if(s<60)return s+"s"; return Math.floor(s/60)+"m "+(s%60?s%60+"s":""); }
function fmtMs(ms) { if(!ms||ms<1000)return"<1s"; if(ms<60000)return(ms/1000).toFixed(1)+"s"; return Math.floor(ms/60000)+"m"+(Math.round(ms/1000)%60)+"s"; }
function fmtDate(ts) { return new Date(ts).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}); }
function fmtTime(ts) { return new Date(ts).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}); }
function fmtDateTime(ts) { return fmtDate(ts)+" · "+fmtTime(ts); }

// ─── SHARE MODAL ──────────────────────────────────────────────────────────────
function ShareModal({ session, orgUsers, authUser, onClose }) {
  var [shares, setShares] = useState(null);
  var [toUserId, setToUserId] = useState("");
  var [context, setContext] = useState("");
  var [submitting, setSubmitting] = useState(false);
  var [error, setError] = useState("");

  // Only non-admin users excluding self
  var shareableUsers = (orgUsers||[]).filter(function(u){ return u.role !== "admin" && u.id !== (authUser||{}).id; });

  useEffect(function() {
    apiGet("/sessions/" + session.id + "/shares")
      .then(function(data){ setShares(data); })
      .catch(function(){ setShares([]); });
  }, [session.id]);

  function submitShare() {
    if (!toUserId) { setError("Select a user to share with"); return; }
    setError(""); setSubmitting(true);
    apiPost("/sessions/" + session.id + "/share", { toUserId: toUserId, context: context.trim()||null })
      .then(function(share) {
        setShares(function(prev){ return (prev||[]).concat([share]); });
        setToUserId(""); setContext("");
      })
      .catch(function(e){ setError(e.message||"Failed to share"); })
      .finally(function(){ setSubmitting(false); });
  }

  function revokeShare(shareId) {
    apiDel("/sessions/" + session.id + "/shares/" + shareId)
      .then(function(){ setShares(function(prev){ return prev.filter(function(s){ return s.id!==shareId; }); }); })
      .catch(function(e){ console.error("redcard:", e); });
  }

  return (
    <div style={{position:"fixed",inset:0,zIndex:500,display:"flex",alignItems:"flex-end",justifyContent:"center",background:"rgba(0,0,0,.55)"}}
      onClick={function(e){if(e.target===e.currentTarget)onClose();}}>
      <div style={{background:"#13151c",border:"1px solid rgba(255,255,255,.1)",borderRadius:"18px 18px 0 0",width:"100%",maxWidth:430,maxHeight:"80vh",overflowY:"auto",padding:"18px 16px 32px",animation:"sheetUp .2s ease both"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div style={{fontSize:13,fontWeight:700,color:"#fff"}}>Share session</div>
          <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",color:"rgba(255,255,255,.4)",fontSize:18,padding:"2px 6px",fontFamily:"inherit"}}>×</button>
        </div>
        <div style={{fontSize:10,color:"rgba(255,255,255,.35)",marginBottom:14,lineHeight:1.5}}>
          Share <span style={{color:"#fff",fontWeight:700}}>{session.name}</span> with a teammate. They can view the session and leave feedback.
        </div>
        <label style={labelSt()}>Share with</label>
        <select value={toUserId} onChange={function(e){setToUserId(e.target.value);setError("");}}
          style={{width:"100%",background:"#081428",border:"1px solid rgba(255,255,255,.15)",borderRadius:9,padding:"9px 12px",color:toUserId?"rgba(255,255,255,.82)":"rgba(255,255,255,.3)",fontSize:12,fontFamily:"inherit",outline:"none",appearance:"none",marginBottom:10}}>
          <option value="">Select a teammate…</option>
          {shareableUsers.map(function(u){ return <option key={u.id} value={u.id}>{u.displayName} ({u.email})</option>; })}
        </select>
        <label style={labelSt()}>Context <span style={{color:"rgba(255,255,255,.25)",fontWeight:400,textTransform:"none",letterSpacing:0,fontSize:10}}>(optional)</span></label>
        <input value={context} onChange={function(e){setContext(e.target.value);}}
          placeholder="e.g. Check my objection handling here…"
          style={inputSt({marginBottom:10})}/>
        {error && <div style={{fontSize:10,color:"#EF5350",marginBottom:8}}>{error}</div>}
        <button onClick={submitShare} disabled={submitting||!toUserId}
          style={Object.assign({},solidBtn(SESS_COLOR),{width:"100%",opacity:(!toUserId||submitting)?0.45:1,marginBottom:16})}>
          {submitting?"Sharing…":"Share session"}
        </button>
        {shares && shares.length > 0 && (
          <div>
            <SectionHdr>Shared with</SectionHdr>
            {shares.map(function(s){
              return (
                <div key={s.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.08)",borderRadius:10,padding:"9px 12px",marginBottom:7}}>
                  <div>
                    <div style={{fontSize:12,color:"#fff",fontWeight:600}}>{s.toUserName}</div>
                    <div style={{fontSize:9,color:"rgba(255,255,255,.3)"}}>{s.toUserEmail}{s.context?" · "+s.context:""}</div>
                  </div>
                  <button onClick={function(){revokeShare(s.id);}} style={ghostSm({color:"rgba(239,83,80,.5)",borderColor:"rgba(239,83,80,.2)",fontSize:10,padding:"4px 8px"})}>Revoke</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SESSION REVIEW ───────────────────────────────────────────────────────────
function SessionReview({ session, onBack, authUser, orgUsers, onMarkFeedbackSeen }) {
  var [tab, setTab] = useState("overview");
  var [feedbackSeenOnce, setFeedbackSeenOnce] = useState(false);
  var [feedback, setFeedback] = useState(null);
  var [fbText, setFbText] = useState("");
  var [fbCardId, setFbCardId] = useState("");
  var [fbSubmitting, setFbSubmitting] = useState(false);
  var [fbEditId, setFbEditId] = useState(null);
  var [fbEditText, setFbEditText] = useState("");
  var [showShare, setShowShare] = useState(false);
  var st = STYPE[session.sessionType||"live"] || STYPE.live;
  var v = sessionVisits(session), n = sessionNotes(session), d = sessionDurSec(session);
  var pv = v.filter(function(x){return !x.isObjCard;}), ov = v.filter(function(x){return x.isObjCard;});
  var iv = v.filter(function(x){return x.intendedPath;});
  var intPct = v.length ? Math.round(iv.length/v.length*100) : 0;
  var reachedClose = pv.some(function(x){return x.cardType==="close";});
  var lastPitch = pv[pv.length-1];

  var tbc = {};
  v.forEach(function(x) {
    if (!tbc[x.cardId]) tbc[x.cardId]={title:x.cardTitle,type:x.cardType,obj:x.isObjCard,ms:0,ct:0};
    tbc[x.cardId].ms += x.durationMs||0;
    tbc[x.cardId].ct++;
  });
  var allT = Object.values(tbc).sort(function(a,b){return b.ms-a.ms;});
  var top3 = allT.filter(function(c){return !c.obj;}).slice(0,3);
  var topObj = allT.filter(function(c){return c.obj;})[0];
  var maxMs = allT.length ? allT[0].ms : 1;
  var objStacks = {};
  ov.forEach(function(x){if(x.stackLabel)objStacks[x.stackLabel]=(objStacks[x.stackLabel]||0)+1;});
  var topVisitedStackEntry = Object.entries(objStacks).sort(function(a,b){return b[1]-a[1];})[0];
  var topVisitedStack = topVisitedStackEntry ? { label: topVisitedStackEntry[0], count: topVisitedStackEntry[1] } : null;

  // Deduplicated card list from visited path (for feedback card selector)
  var visitedCards = [];
  var _seenCards = {};
  v.forEach(function(x) {
    if (!_seenCards[x.cardId]) { _seenCards[x.cardId]=true; visitedCards.push({id:x.cardId,title:x.cardTitle,type:x.cardType}); }
  });

  var isAdmin = !!(authUser && authUser.role === "admin");
  var isOwner = !!(authUser && session.userId === authUser.id);
  var isSharedRecipient = !!(session._shared);
  var canWriteFeedback = isAdmin || isSharedRecipient;

  // Fetch feedback and poll every 5s while on feedback tab
  useEffect(function() {
    function loadFeedback() {
      apiGet("/sessions/" + session.id + "/feedback")
        .then(function(data) { setFeedback(data); })
        .catch(function() {});
    }
    loadFeedback();
    var timer = setInterval(loadFeedback, 5000);
    return function() { clearInterval(timer); };
  }, [session.id]);

  var hasFeedback = feedback && feedback.length > 0;
  var showFbBadge = hasFeedback && !feedbackSeenOnce;

  function submitFeedback() {
    var trimmed = fbText.trim();
    if (!trimmed) return;
    setFbSubmitting(true);
    var selectedCard = visitedCards.find(function(c){ return c.id === fbCardId; });
    apiPost("/sessions/" + session.id + "/feedback", {
      text: trimmed,
      cardId: selectedCard ? selectedCard.id : null,
      cardTitle: selectedCard ? selectedCard.title : null,
    })
      .then(function(fb) {
        setFeedback(function(prev){ return (prev||[]).concat([fb]); });
        setFbText(""); setFbCardId("");
      })
      .catch(function(e){ console.error("redcard:", e); })
      .finally(function(){ setFbSubmitting(false); });
  }

  function saveFbEdit(fbId) {
    var trimmed = fbEditText.trim();
    if (!trimmed) return;
    var existing = (feedback||[]).find(function(f){ return f.id===fbId; });
    apiPut("/sessions/" + session.id + "/feedback/" + fbId, {
      text: trimmed,
      cardId: existing ? existing.cardId : null,
      cardTitle: existing ? existing.cardTitle : null,
    })
      .then(function(updated) {
        setFeedback(function(prev){ return prev.map(function(f){ return f.id===fbId?updated:f; }); });
        setFbEditId(null); setFbEditText("");
      })
      .catch(function(e){ console.error("redcard:", e); });
  }

  function deleteFeedbackItem(fbId) {
    apiDel("/sessions/" + session.id + "/feedback/" + fbId)
      .then(function() { setFeedback(function(prev){ return prev.filter(function(f){ return f.id!==fbId; }); }); })
      .catch(function(e){ console.error("redcard:", e); });
  }

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,.07)",borderLeft:"3px solid "+st.color,display:"flex",alignItems:"center",gap:9,flexShrink:0}}>
        <button onClick={onBack} style={Object.assign({},iconBtn(),{padding:"5px 8px"})}>←</button>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap",marginBottom:1}}>
            <span style={{fontSize:13,fontWeight:700,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{session.name}</span>
            {session.sold && <span style={{fontSize:9,fontWeight:700,background:"rgba(102,187,106,.15)",border:"1px solid rgba(102,187,106,.3)",color:"#66BB6A",padding:"1px 7px",borderRadius:99,textTransform:"uppercase",letterSpacing:.4}}>sold</span>}
            <span style={{fontSize:9,fontWeight:700,color:st.color,background:st.bg,border:"1px solid "+st.border,padding:"1px 7px",borderRadius:99,textTransform:"uppercase",letterSpacing:.4}}>{st.label}</span>
            {session._shared && <span style={{fontSize:9,color:"rgba(255,255,255,.35)",background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",padding:"1px 7px",borderRadius:99}}>shared</span>}
          </div>
          {session._shared && session._shareFromName && <div style={{fontSize:9,color:"rgba(255,255,255,.28)",marginBottom:1}}>From: {session._shareFromName}{session._shareContext ? " · "+session._shareContext : ""}</div>}
          {session.description && <div style={{fontSize:10,color:"rgba(255,255,255,.32)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{session.description}</div>}
          <div style={{fontSize:9,color:"rgba(255,255,255,.25)"}}>{fmtDateTime(session.startTs)}</div>
        </div>
        {isOwner && !isAdmin && (
          <button onClick={function(){setShowShare(true);}}
            style={ghostSm({fontSize:10,padding:"5px 10px"})}>Share</button>
        )}
      </div>
      <div style={{display:"flex",borderBottom:"1px solid rgba(255,255,255,.06)",flexShrink:0}}>
        {[["overview","Overview"],["path","Path"],["notes","Notes"],["feedback","Feedback"]].map(function(t) {
          var on = tab===t[0];
          var isFbTab = t[0]==="feedback";
          return (
            <button key={t[0]} onClick={function(){setTab(t[0]);if(isFbTab){setFeedbackSeenOnce(true);if(onMarkFeedbackSeen)onMarkFeedbackSeen(session.id);}}}
              style={{flex:1,background:"none",border:"none",borderBottom:"2px solid "+(on?SESS_COLOR:"transparent"),padding:"9px 2px",cursor:"pointer",fontFamily:"inherit",fontSize:10,fontWeight:on?700:400,color:on?SESS_COLOR:"rgba(255,255,255,.35)",transition:"all .15s",position:"relative"}}>
              {t[1]}
              {isFbTab && showFbBadge && <span style={{position:"absolute",top:6,right:"calc(50% - 20px)",width:6,height:6,borderRadius:"50%",background:"#EF5350",display:"inline-block"}}/>}
            </button>
          );
        })}
      </div>
      {showShare && <ShareModal session={session} orgUsers={orgUsers} authUser={authUser} onClose={function(){setShowShare(false);}}/>}
      <div style={{flex:1,overflowY:"auto",padding:"14px 14px 0"}}>
        {/* OVERVIEW */}
        {tab==="overview" && (
          <div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
              <StatBox value={d?fmtSec(d):"—"} label="Duration" color="rgba(255,255,255,.65)"/>
              <StatBox value={pv.length} label="Cards visited" color={SESS_COLOR}/>
              <StatBox value={ov.length} label="Obj visits" color={OBJ_COLOR}/>
            </div>
            <div style={{background:session.sold?"rgba(102,187,106,.08)":"rgba(255,255,255,.05)",border:"1px solid "+(session.sold?"rgba(102,187,106,.22)":"rgba(255,255,255,.07)"),borderRadius:12,padding:"12px 14px",marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontSize:13,fontWeight:700,color:session.sold?"#66BB6A":"rgba(255,255,255,.45)",marginBottom:2}}>{session.sold?"✓ Sold":"✗ Not sold"}</div>
                {session.sold && session.soldCardTitle && <div style={{fontSize:10,color:"rgba(255,255,255,.32)"}}>Closed on: {session.soldCardTitle}</div>}
                {!session.sold && lastPitch && <div style={{fontSize:10,color:"rgba(255,255,255,.28)"}}>Last card: {lastPitch.cardTitle}</div>}
              </div>
              <span style={{fontSize:10,fontWeight:700,color:reachedClose?"#66BB6A":"rgba(255,255,255,.3)",background:reachedClose?"rgba(102,187,106,.1)":"rgba(255,255,255,.05)",padding:"2px 9px",borderRadius:99,border:"1px solid "+(reachedClose?"rgba(102,187,106,.25)":"rgba(255,255,255,.07)")}}>{reachedClose?"Reached close":"No close"}</span>
            </div>
            <div style={{background:"rgba(102,187,106,.06)",border:"1px solid rgba(102,187,106,.15)",borderRadius:12,padding:"12px 14px",marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><span style={{fontSize:12,fontWeight:700,color:"#66BB6A"}}>★ Intended Path</span><span style={{fontSize:12,color:"#66BB6A"}}>{intPct}%</span></div>
              <div style={{height:5,background:"rgba(255,255,255,.07)",borderRadius:99,overflow:"hidden"}}><div style={{height:"100%",background:"#66BB6A",borderRadius:99,width:intPct+"%",transition:"width .4s"}}/></div>
              <div style={{fontSize:9,color:"rgba(255,255,255,.28)",marginTop:5}}>{iv.length} of {v.length} card visits on intended path</div>
            </div>
            {Object.keys(objStacks).length > 0 && (
              <div style={{marginBottom:12}}>
                <SectionHdr>Objections hit</SectionHdr>
                <div style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.08)",borderRadius:12,padding:"11px 13px"}}>
                  {Object.entries(objStacks).map(function(entry, i, arr) {
                    return <div key={entry[0]} style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingBottom:i<arr.length-1?8:0,marginBottom:i<arr.length-1?8:0,borderBottom:i<arr.length-1?"1px solid rgba(255,255,255,.05)":"none"}}>
                      <span style={{fontSize:12,color:"rgba(255,255,255,.65)"}}>{entry[0]}</span>
                      <span style={{fontSize:10,fontWeight:700,color:OBJ_COLOR,background:"rgba(239,83,80,.1)",padding:"2px 8px",borderRadius:99}}>{entry[1]} card{entry[1]>1?"s":""}</span>
                    </div>;
                  })}
                </div>
              </div>
            )}
            {top3.length > 0 && (
              <div style={{marginBottom:12}}>
                <SectionHdr>Top cards by time</SectionHdr>
                <div style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.08)",borderRadius:12,padding:"12px 14px"}}>
                  {top3.map(function(c, i) { var m=TM[c.type]||TM.pitch; var pct=Math.round(c.ms/maxMs*100); return (
                    <div key={c.title} style={{marginBottom:i<top3.length-1?10:0}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                        <div style={{display:"flex",alignItems:"center",gap:5}}><span style={{fontSize:10,color:m.color}}>■</span><span style={{fontSize:12,color:i===0?"#fff":"rgba(255,255,255,.65)",fontWeight:i===0?700:400}}>{c.title}</span></div>
                        <span style={{fontSize:11,color:"rgba(255,255,255,.4)"}}>{fmtMs(c.ms)}</span>
                      </div>
                      <div style={{height:4,background:"rgba(255,255,255,.07)",borderRadius:99,overflow:"hidden"}}><div style={{height:"100%",background:m.color,borderRadius:99,width:pct+"%"}}/></div>
                    </div>
                  );})}
                </div>
              </div>
            )}
            {(topObj || topVisitedStack) && (
              <div style={{background:"rgba(239,83,80,.06)",border:"1px solid rgba(239,83,80,.15)",borderRadius:12,padding:"12px 14px",marginBottom:12}}>
                <SectionHdr style={{color:OBJ_COLOR,marginBottom:10}}>🛡️ Objection Highlights</SectionHdr>
                {topObj && (
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:topVisitedStack?8:0}}>
                    <div>
                      <div style={{fontSize:9,color:"rgba(239,83,80,.6)",textTransform:"uppercase",letterSpacing:.8,marginBottom:2}}>Most time in</div>
                      <span style={{fontSize:12,color:"#fff"}}>{topObj.title}</span>
                    </div>
                    <span style={{fontSize:12,color:OBJ_COLOR,flexShrink:0}}>{fmtMs(topObj.ms)}</span>
                  </div>
                )}
                {topObj && topVisitedStack && <div style={{height:1,background:"rgba(239,83,80,.15)",margin:"8px 0"}}/>}
                {topVisitedStack && (
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div>
                      <div style={{fontSize:9,color:"rgba(239,83,80,.6)",textTransform:"uppercase",letterSpacing:.8,marginBottom:2}}>Most visited stack</div>
                      <span style={{fontSize:12,color:"#fff"}}>{topVisitedStack.label}</span>
                    </div>
                    <span style={{fontSize:11,color:OBJ_COLOR,background:"rgba(239,83,80,.12)",padding:"2px 8px",borderRadius:99,flexShrink:0}}>{topVisitedStack.count} visit{topVisitedStack.count!==1?"s":""}</span>
                  </div>
                )}
              </div>
            )}
            {n.length > 0 ? (
              <div style={{marginBottom:12}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <SectionHdr style={{margin:0}}>Notes ({n.length})</SectionHdr>
                  <button onClick={function(){setTab("notes");}} style={ghostSm({fontSize:10,padding:"3px 9px"})}>See all</button>
                </div>
                {n.slice(0,2).map(function(note, i) {
                  return <div key={i} style={{background:"rgba(168,255,62,.07)",border:"1px solid rgba(168,255,62,.18)",borderRadius:11,padding:"10px 13px",marginBottom:7}}>
                    <div style={{fontSize:10,fontWeight:700,color:SESS_COLOR,marginBottom:3}}>{note.cardTitle}</div>
                    <div style={{fontSize:12,color:"rgba(255,255,255,.82)",lineHeight:1.5}}>{note.text}</div>
                  </div>;
                })}
              </div>
            ) : <div style={{textAlign:"center",color:"rgba(255,255,255,.25)",padding:"12px 0",fontSize:12}}>No notes recorded</div>}
          </div>
        )}
        {/* PATH */}
        {tab==="path" && (
          <div>
            <SectionHdr>{v.length} card visits</SectionHdr>
            {v.length===0 && <div style={{textAlign:"center",color:"rgba(255,255,255,.25)",padding:"24px 0",fontSize:12}}>No visits recorded.</div>}
            {v.map(function(x, i) { var m=TM[x.cardType]||TM.pitch; return (
              <div key={i} style={{display:"flex",gap:9}}>
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",flexShrink:0}}>
                  <div style={{width:22,height:22,borderRadius:"50%",background:x.isObjCard?"rgba(239,83,80,.16)":m.color+"1a",border:"1.5px solid "+(x.isObjCard?OBJ_COLOR:m.color),display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:x.isObjCard?OBJ_COLOR:m.color}}>
                    {x.isObjCard?"!":m.icon}
                  </div>
                  {i<v.length-1 && <div style={{width:1,background:"rgba(255,255,255,.07)",flex:1,minHeight:6,margin:"1px auto"}}/>}
                </div>
                <div style={{flex:1,paddingBottom:i<v.length-1?2:0,minWidth:0}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:5,paddingBottom:i<v.length-1?5:0}}>
                    <div>
                      <div style={{display:"flex",alignItems:"center",gap:4,flexWrap:"wrap"}}>
                        <span style={{fontSize:12,color:"#fff",fontWeight:i===0?700:400}}>{x.cardTitle}</span>
                        {x.intendedPath && <span style={{fontSize:8,color:"#66BB6A",background:"rgba(102,187,106,.12)",padding:"1px 4px",borderRadius:99}}>★</span>}
                        {x.isObjCard && x.stackLabel && <span style={{fontSize:9,color:OBJ_COLOR,background:"rgba(239,83,80,.1)",padding:"1px 5px",borderRadius:99}}>{x.stackLabel}</span>}
                      </div>
                      <div style={{fontSize:9,color:"rgba(255,255,255,.22)"}}>{fmtTime(x.ts)}</div>
                    </div>
                    <span style={{fontSize:10,color:"rgba(255,255,255,.32)",flexShrink:0,background:"rgba(255,255,255,.05)",padding:"2px 6px",borderRadius:99}}>{fmtMs(x.durationMs||0)}</span>
                  </div>
                </div>
              </div>
            );})}
          </div>
        )}
        {/* NOTES */}
        {tab==="notes" && (
          <div>
            <SectionHdr>{n.length} note{n.length!==1?"s":""}</SectionHdr>
            {n.length===0 && <div style={{textAlign:"center",color:"rgba(255,255,255,.25)",padding:"24px 0",fontSize:12}}>No notes in this session.</div>}
            {n.map(function(note, i) { return (
              <div key={i} style={{background:"rgba(168,255,62,.07)",border:"1px solid rgba(168,255,62,.18)",borderRadius:11,padding:"11px 13px",marginBottom:9}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                  <span style={{fontSize:11,fontWeight:700,color:SESS_COLOR}}>{note.cardTitle}</span>
                  <span style={{fontSize:9,color:"rgba(255,255,255,.25)"}}>{fmtTime(note.ts)}</span>
                </div>
                <div style={{fontSize:13,color:"rgba(255,255,255,.85)",lineHeight:1.5}}>{note.text}</div>
              </div>
            );})}
          </div>
        )}
        {/* FEEDBACK */}
        {tab==="feedback" && (
          <div>
            <SectionHdr>{(feedback||[]).length} feedback item{(feedback||[]).length!==1?"s":""}</SectionHdr>
            {feedback===null && <div style={{textAlign:"center",color:"rgba(255,255,255,.3)",padding:"24px 0",fontSize:12}}>Loading…</div>}
            {feedback!==null && feedback.length===0 && <div style={{textAlign:"center",color:"rgba(255,255,255,.25)",padding:"24px 0",fontSize:12}}>No feedback yet.</div>}
            {(feedback||[]).map(function(fb) {
              var cardType = fb.cardId ? (visitedCards.find(function(c){return c.id===fb.cardId;})||{type:"pitch"}).type : null;
              var ctm = cardType ? (TM[cardType]||TM.pitch) : null;
              var isEditing = fbEditId === fb.id;
              var isMine = authUser && fb.authorId === authUser.id;
              return (
                <div key={fb.id} style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.09)",borderRadius:12,padding:"12px 13px",marginBottom:9}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                      <span style={{fontSize:11,fontWeight:700,color:SESS_COLOR}}>{fb.authorName}</span>
                      {fb.cardId && ctm && (
                        <span style={{fontSize:9,background:ctm.color+"22",border:"1px solid "+ctm.color+"44",color:ctm.color,padding:"1px 7px",borderRadius:99}}>{fb.cardTitle}</span>
                      )}
                      {!fb.cardId && <span style={{fontSize:9,color:"rgba(255,255,255,.28)",background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.08)",padding:"1px 7px",borderRadius:99}}>General</span>}
                    </div>
                    <div style={{display:"flex",gap:4,flexShrink:0}}>
                      <span style={{fontSize:9,color:"rgba(255,255,255,.22)"}}>{fmtDateTime(fb.updatedAt)}</span>
                      {canWriteFeedback && isMine && !isEditing && (
                        <button onClick={function(){setFbEditId(fb.id);setFbEditText(fb.text);}}
                          style={{background:"none",border:"none",cursor:"pointer",color:"rgba(255,255,255,.3)",fontSize:11,padding:"0 3px",fontFamily:"inherit"}}>✎</button>
                      )}
                      {(isAdmin || (canWriteFeedback && isMine)) ? (
                        <button onClick={function(){deleteFeedbackItem(fb.id);}}
                          style={{background:"none",border:"none",cursor:"pointer",color:"rgba(239,83,80,.4)",fontSize:11,padding:"0 3px",fontFamily:"inherit"}}>🗑</button>
                      ) : null}
                    </div>
                  </div>
                  {isEditing ? (
                    <div>
                      <textarea value={fbEditText} onChange={function(e){setFbEditText(e.target.value);}} rows={2}
                        style={Object.assign({},inputSt({resize:"none",fontSize:12,lineHeight:1.5}),{marginBottom:6,minHeight:48})}/>
                      <div style={{display:"flex",gap:6}}>
                        <button onClick={function(){setFbEditId(null);setFbEditText("");}} style={Object.assign({},ghostBtn(),{flex:1,padding:"6px",fontSize:11})}>Cancel</button>
                        <button onClick={function(){saveFbEdit(fb.id);}} style={Object.assign({},solidBtn(SESS_COLOR),{flex:2,padding:"6px",fontSize:11})}>Save</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{fontSize:13,color:"rgba(255,255,255,.82)",lineHeight:1.55,whiteSpace:"pre-wrap"}}>{fb.text}</div>
                  )}
                </div>
              );
            })}
            {canWriteFeedback && (
              <div style={{background:"rgba(168,255,62,.06)",border:"1px solid rgba(168,255,62,.18)",borderRadius:12,padding:"12px 13px",marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:700,color:SESS_COLOR,marginBottom:8}}>Add feedback</div>
                {visitedCards.length > 0 && (
                  <div style={{marginBottom:8}}>
                    <div style={{fontSize:9,color:"rgba(255,255,255,.3)",marginBottom:3,textTransform:"uppercase",letterSpacing:.6}}>Link to card (optional)</div>
                    <select value={fbCardId} onChange={function(e){setFbCardId(e.target.value);}}
                      style={{width:"100%",background:"#081428",border:"1px solid rgba(168,255,62,.25)",borderRadius:8,padding:"7px 10px",color:"rgba(255,255,255,.7)",fontSize:11,fontFamily:"inherit",outline:"none",appearance:"none"}}>
                      <option value="">General feedback</option>
                      {visitedCards.map(function(c){
                        return <option key={c.id} value={c.id}>{c.title}</option>;
                      })}
                    </select>
                  </div>
                )}
                <textarea value={fbText} onChange={function(e){setFbText(e.target.value);}}
                  placeholder="Leave feedback on this session…" rows={3}
                  style={Object.assign({},inputSt({resize:"none",fontSize:12,lineHeight:1.5}),{marginBottom:8,minHeight:58})}/>
                <button onClick={submitFeedback} disabled={fbSubmitting||!fbText.trim()}
                  style={Object.assign({},solidBtn(SESS_COLOR),{width:"100%",opacity:(!fbText.trim()||fbSubmitting)?0.45:1})}>
                  {fbSubmitting?"Submitting…":"Submit feedback"}
                </button>
              </div>
            )}
          </div>
        )}
        <div style={{height:16}}/>
      </div>
    </div>
  );
}

// ─── SESSIONS TAB ─────────────────────────────────────────────────────────────
// Three sub-views: list, review (single session), analytics (aggregate)
// All data is scoped to the currently active deck.
function SessionsTab({ deckId, deckName, deckColor, deckRootCard, onInitialReview, viewScope, setViewScope, authUser, orgUsers, orgTeams }) {
  var [view,           setView]           = useState("list");
  var [sessions,       setSessions]       = useState(null);
  var [reviewId,       setReviewId]       = useState(onInitialReview || null);
  var [filtersOpen,    setFiltersOpen]    = useState(false);
  var [fType,          setFType]          = useState("all");
  var [fFrom,          setFFrom]          = useState("");
  var [fTo,            setFTo]            = useState("");
  var [userSearch,     setUserSearch]     = useState("");
  var [suggestOpen,    setSuggestOpen]    = useState(false);
  var [collapsedUsers, setCollapsedUsers] = useState({});
  var [shareTarget, setShareTarget] = useState(null);
  var [fbSeenTs, setFbSeenTs] = useState(function(){
    try { return JSON.parse(localStorage.getItem("rc_fb_seen") || "{}"); } catch(e){ return {}; }
  });

  function markFbSeen(sessionId) {
    var now = Date.now();
    setFbSeenTs(function(prev) {
      var next = Object.assign({}, prev, {[sessionId]: now});
      try { localStorage.setItem("rc_fb_seen", JSON.stringify(next)); } catch(e){}
      return next;
    });
  }

  var isAdmin      = !!(authUser && authUser.role === "admin");
  var isAdminScope = !!(isAdmin && viewScope && viewScope !== "self");

  // Auto-open review if portaled from Play
  useEffect(function() {
    if (onInitialReview) { setReviewId(onInitialReview); setView("review"); }
  }, [onInitialReview]);

  function buildSessionUrl() {
    var url = "/sessions?deckId=" + deckId;
    if (isAdminScope) url += "&scope=" + viewScope;
    return url;
  }
  useEffect(function() {
    if (view === "list" || view === "analytics") {
      apiGet(buildSessionUrl())
        .then(function(data) { setSessions(data.sort(function(a,b){return b.startTs-a.startTs;})); })
        .catch(function() { setSessions([]); });
    }
  }, [deckId, view, viewScope]);

  function deleteSession(id) {
    apiDel("/sessions/" + id).then(function() {
      setSessions(function(prev) { return prev.filter(function(s){return s.id!==id;}); });
    }).catch(function(e){ console.error("redcard:", e); });
  }

  function toggleCollapse(userId) {
    setCollapsedUsers(function(prev) {
      var next = Object.assign({}, prev);
      // Default (undefined) is collapsed; toggle to false (expanded) or back to true (collapsed)
      var currentlyCollapsed = prev[userId] !== false;
      next[userId] = !currentlyCollapsed;
      return next;
    });
  }

  function getFiltered() {
    if (!sessions) return [];
    return sessions.filter(function(s) {
      if (fType !== "all" && (s.mode||"live") !== fType) return false;
      if (fFrom) { var d=new Date(fFrom); d.setHours(0,0,0,0); if(s.startTs<d.getTime())return false; }
      if (fTo)   { var d2=new Date(fTo);  d2.setHours(23,59,59,999); if(s.startTs>d2.getTime())return false; }
      return true;
    });
  }

  if (view === "review" && reviewId) {
    var reviewSess = sessions ? sessions.find(function(s){return s.id===reviewId;}) : null;
    if (!reviewSess && sessions === null) {
      apiGet(buildSessionUrl()).then(function(data) {
        setSessions(data.sort(function(a,b){return b.startTs-a.startTs;}));
      });
      return <div style={{padding:40,textAlign:"center",color:"rgba(255,255,255,.3)",fontSize:13}}>Loading…</div>;
    }
    if (!reviewSess) { setView("list"); return null; }
    return <SessionReview session={reviewSess} onBack={function(){setView("list");}} authUser={authUser} orgUsers={orgUsers} onMarkFeedbackSeen={markFbSeen}/>;
  }

  if (view === "analytics") {
    return <SessionAnalytics sessions={getFiltered()} deckColor={deckColor} deckName={deckName} deckRootCard={deckRootCard}
      fType={fType} setFType={setFType}
      fFrom={fFrom} setFFrom={setFFrom} fTo={fTo} setFTo={setFTo}
      filtersOpen={filtersOpen} setFiltersOpen={setFiltersOpen}
      onBack={function(){setView("list");}}/>;
  }

  var filtered      = getFiltered();
  var filtLive      = filtered.filter(function(s){ return (s.mode||"live") === "live"; });
  var filtSold      = filtLive.filter(function(s){ return s.sold; });
  var filtPrac      = filtered.filter(function(s){ return s.mode === "practice"; });
  var filtCr        = filtLive.length ? Math.round(filtSold.length / filtLive.length * 100) : 0;
  var filtPracSold  = filtPrac.filter(function(s){ return s.sold; });
  var filtPracCr    = filtPrac.length ? Math.round(filtPracSold.length / filtPrac.length * 100) : 0;
  var filtAvgDur    = (function(){
    var ds = filtered.filter(function(s){return s.endTs;}).map(function(s){return Math.round((s.endTs-s.startTs)/1000);});
    return ds.length ? Math.round(ds.reduce(function(a,b){return a+b;},0)/ds.length) : null;
  })();
  var filtLiveAvgDur = (function(){
    var ds = filtLive.filter(function(s){return s.endTs;}).map(function(s){return Math.round((s.endTs-s.startTs)/1000);});
    return ds.length ? Math.round(ds.reduce(function(a,b){return a+b;},0)/ds.length) : null;
  })();
  var activeFilters = fType!=="all"||fFrom||fTo;

  // Build filter-aware stat boxes
  var statBoxes;
  if (fType === "practice") {
    statBoxes = [
      { value: filtPrac.length, label: "Practice runs", color: "#00B4FF" },
      { value: filtAvgDur ? fmtSec(filtAvgDur) : "—", label: "Avg duration", color: "rgba(255,255,255,.65)" },
      { value: filtPracCr + "%", label: "Practice CR%", color: "#66BB6A" },
    ];
  } else if (fType === "live") {
    statBoxes = [
      { value: filtLive.length, label: "Live sessions", color: "#A8FF3E" },
      { value: filtCr + "%", label: "Close rate", color: "#66BB6A" },
      { value: filtLiveAvgDur ? fmtSec(filtLiveAvgDur) : "—", label: "Avg duration", color: "rgba(255,255,255,.65)" },
    ];
  } else {
    statBoxes = [
      { value: filtered.length, label: "Total", color: SESS_COLOR },
      { value: filtCr + "%", label: "Close rate", color: "#66BB6A" },
      { value: filtAvgDur ? fmtSec(filtAvgDur) : "—", label: "Avg duration", color: "rgba(255,255,255,.65)" },
    ];
  }

  // Build user map for group lookups
  var userMap = {};
  (orgUsers||[]).forEach(function(u){ userMap[u.id] = u; });

  // Autocomplete suggestions — users present in filtered sessions
  var presentUserIds = {};
  filtered.forEach(function(s){ if (s.userId) presentUserIds[s.userId] = true; });
  var searchTerm = userSearch.trim().toLowerCase();
  var suggestions = (orgUsers||[]).filter(function(u) {
    return presentUserIds[u.id] && searchTerm && u.displayName.toLowerCase().includes(searchTerm) && u.displayName.toLowerCase() !== searchTerm;
  }).slice(0, 6);

  // For admin scope, build groups filtered by user search
  function buildGroups() {
    var groups = {};
    filtered.forEach(function(s) {
      var key = s.userId || "__unknown";
      if (!groups[key]) groups[key] = { user: userMap[s.userId] || { id:s.userId, displayName:"Unknown", email:"" }, sessions:[] };
      groups[key].sessions.push(s);
    });
    var sorted = Object.values(groups).sort(function(a,b){ return a.user.displayName.localeCompare(b.user.displayName); });
    if (searchTerm) {
      sorted = sorted.filter(function(g){ return g.user.displayName.toLowerCase().includes(searchTerm); });
    }
    return sorted;
  }

  function renderSessionRow(s) {
    var st = STYPE[s.mode||"live"] || STYPE.live;
    var d = sessionDurSec(s), v = sessionVisits(s), n = sessionNotes(s), ov = v.filter(function(x){return x.isObjCard;});
    var isOwner = authUser && s.userId === authUser.id && !s._shared;
    var hasFbNotif = isOwner && (s.feedbackCount||0) > 0 && (!fbSeenTs[s.id] || (s.latestFeedbackAt && s.latestFeedbackAt > fbSeenTs[s.id]));
    return (
      <div key={s.id} onClick={function(){setReviewId(s.id);setView("review");}}
        style={{background:"#081428",border:"1px solid rgba(255,255,255,.08)",borderLeft:"3px solid "+st.color,borderRadius:"0 12px 12px 0",padding:"11px 12px",marginBottom:8,cursor:"pointer",transition:"background .12s",position:"relative"}}>
        {hasFbNotif && <span style={{position:"absolute",top:10,right:10,width:8,height:8,borderRadius:"50%",background:"#EF5350",display:"block",boxShadow:"0 0 0 2px rgba(239,83,80,.3)"}} title="New feedback"/>}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:5}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap",marginBottom:2}}>
              <span style={{fontSize:13,fontWeight:700,color:"#fff"}}>{s.name}</span>
              {s.sold && <span style={{fontSize:9,fontWeight:700,background:"rgba(102,187,106,.15)",border:"1px solid rgba(102,187,106,.3)",color:"#66BB6A",padding:"1px 7px",borderRadius:99,textTransform:"uppercase",letterSpacing:.4}}>sold</span>}
              {s._shared && <span style={{fontSize:9,color:"rgba(255,255,255,.32)",background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",padding:"1px 7px",borderRadius:99}}>shared</span>}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}>
              <span style={{fontSize:9,fontWeight:700,color:st.color,background:st.bg,border:"1px solid "+st.border,padding:"1px 7px",borderRadius:99,textTransform:"uppercase",letterSpacing:.4}}>{st.label}</span>
              {s._shared && s._shareFromName && <span style={{fontSize:9,color:"rgba(255,255,255,.25)"}}>by {s._shareFromName}</span>}
              <span style={{fontSize:9,color:"rgba(255,255,255,.25)"}}>{fmtDateTime(s.startTs)}</span>
            </div>
          </div>
          <div style={{display:"flex",gap:4,flexShrink:0,alignItems:"center"}}>
            {isOwner && (
              <button onClick={function(e){e.stopPropagation();setShareTarget(s);}}
                style={ghostSm({fontSize:10,padding:"4px 8px",color:"rgba(168,255,62,.7)",borderColor:"rgba(168,255,62,.2)"})}>Share</button>
            )}
            {isOwner && (
              <button onClick={function(e){e.stopPropagation();deleteSession(s.id);}} style={ghostSm({color:"rgba(239,83,80,.5)",borderColor:"rgba(239,83,80,.2)",fontSize:10,padding:"4px 7px"})}>🗑</button>
            )}
          </div>
        </div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          {d && <span style={{fontSize:10,color:"rgba(255,255,255,.35)",background:"rgba(255,255,255,.05)",padding:"2px 6px",borderRadius:99}}>{fmtSec(d)}</span>}
          <span style={{fontSize:10,color:st.color,background:st.bg,padding:"2px 6px",borderRadius:99}}>{v.length} cards</span>
          {ov.length>0 && <span style={{fontSize:10,color:OBJ_COLOR,background:"rgba(239,83,80,.08)",padding:"2px 6px",borderRadius:99}}>{ov.length} obj</span>}
          {n.length>0 && <span style={{fontSize:10,color:"rgba(255,255,255,.3)",background:"rgba(255,255,255,.05)",padding:"2px 6px",borderRadius:99}}>📝 {n.length}</span>}
          {(s.feedbackCount||0) > 0 && <span style={{fontSize:10,color:hasFbNotif?"#EF5350":"rgba(255,255,255,.3)",background:hasFbNotif?"rgba(239,83,80,.1)":"rgba(255,255,255,.05)",padding:"2px 6px",borderRadius:99}}>💬 {s.feedbackCount}</span>}
        </div>
      </div>
    );
  }

  var groups = isAdminScope ? buildGroups() : null;
  var displayCount = isAdminScope
    ? groups.reduce(function(a,g){return a+g.sessions.length;},0)
    : filtered.length;

  return (
    <div style={{flex:1,overflowY:"auto"}} onClick={function(){ if(suggestOpen) setSuggestOpen(false); }}>
      {/* ── HEADER STRIP: count + analytics ── */}
      <div style={{padding:"10px 14px 0",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:"rgba(255,255,255,.55)",letterSpacing:.3}}>
              {sessions===null ? "Loading…" : displayCount+" session"+(displayCount!==1?"s":"")+(isAdminScope&&groups?" · "+groups.length+" rep"+(groups.length!==1?"s":""):"")}
            </div>
            {activeFilters && <div style={{fontSize:9,color:SESS_COLOR,marginTop:1}}>Filters active</div>}
          </div>
          <button onClick={function(){setView("analytics");}} style={{background:"rgba(168,255,62,.1)",border:"1px solid rgba(168,255,62,.25)",borderRadius:10,color:SESS_COLOR,fontSize:11,fontWeight:700,padding:"6px 12px",cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:5}}>
            📊 Analytics
          </button>
        </div>

        {/* ── TYPE FILTER: always visible pill tabs ── */}
        <div style={{display:"flex",background:"rgba(255,255,255,.05)",borderRadius:10,padding:2,gap:1,marginBottom:10}}>
          {[["all","All","#FFD54F"],["live","📞 Live","#A8FF3E"],["practice","🎯 Practice","#00B4FF"]].map(function(t){
            var on=fType===t[0];
            return <button key={t[0]} onClick={function(){setFType(t[0]);}}
              style={{flex:1,background:on?"rgba(255,255,255,.1)":"transparent",border:"none",borderRadius:8,padding:"7px 4px",cursor:"pointer",fontFamily:"inherit",color:on?t[2]:"rgba(255,255,255,.4)",fontSize:11,fontWeight:on?700:400}}>{t[1]}</button>;
          })}
        </div>

        {/* ── STAT BOXES: filter-aware ── */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:7,marginBottom:10}}>
          {statBoxes.map(function(sb,i){
            return <StatBox key={i} value={sessions?sb.value:"…"} label={sb.label} color={sb.color}/>;
          })}
        </div>

        {/* ── ADMIN SCOPE ── */}
        {isAdmin && (
          <div style={{marginBottom:8}}>
            <select value={viewScope||"self"} onChange={function(e){ setViewScope(e.target.value); setSessions(null); }}
              style={{width:"100%",background:"#081428",border:"1px solid rgba(168,255,62,.2)",borderRadius:10,padding:"8px 12px",color:SESS_COLOR,fontSize:11,fontFamily:"inherit",cursor:"pointer",outline:"none",appearance:"none",backgroundImage:"url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23A8FF3E'/%3E%3C/svg%3E\")",backgroundRepeat:"no-repeat",backgroundPosition:"right 12px center"}}>
              <option value="self">👤 My sessions</option>
              <option value="org">🌐 Entire org</option>
              {(orgTeams||[]).map(function(t){ return <option key={t.id} value={"team:"+t.id}>🏷️ {t.name}</option>; })}
              {(orgUsers||[]).filter(function(u){ return u.id !== authUser.id; }).map(function(u){ return <option key={u.id} value={"user:"+u.id}>👤 {u.displayName}</option>; })}
            </select>
          </div>
        )}

        {/* ── USER SEARCH (admin multi-user scope) ── */}
        {isAdminScope && (
          <div style={{position:"relative",marginBottom:8}} onClick={function(e){e.stopPropagation();}}>
            <div style={{position:"relative"}}>
              <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",color:"rgba(255,255,255,.3)",fontSize:13,pointerEvents:"none"}}>🔎</span>
              <input value={userSearch} onChange={function(e){ setUserSearch(e.target.value); setSuggestOpen(true); }}
                onFocus={function(){ setSuggestOpen(true); }}
                placeholder="Filter by rep name…"
                style={inputSt({paddingLeft:32,height:34,fontSize:11})}
              />
              {userSearch && (
                <button onClick={function(){ setUserSearch(""); setSuggestOpen(false); }}
                  style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"rgba(255,255,255,.35)",fontSize:14,padding:"2px 4px",fontFamily:"inherit"}}>×</button>
              )}
            </div>
            {suggestOpen && suggestions.length > 0 && (
              <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:200,background:"#1a1d24",border:"1px solid rgba(255,255,255,.12)",borderRadius:10,marginTop:3,overflow:"hidden",boxShadow:"0 8px 24px rgba(0,0,0,.5)"}}>
                {suggestions.map(function(u) {
                  return (
                    <button key={u.id}
                      onMouseDown={function(e){ e.preventDefault(); setUserSearch(u.displayName); setSuggestOpen(false); }}
                      style={{display:"flex",alignItems:"center",gap:9,width:"100%",background:"none",border:"none",borderBottom:"1px solid rgba(255,255,255,.06)",padding:"8px 12px",cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}>
                      <div style={{width:22,height:22,borderRadius:"50%",background:"rgba(168,255,62,.15)",border:"1px solid rgba(168,255,62,.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:SESS_COLOR,flexShrink:0}}>
                        {u.displayName[0].toUpperCase()}
                      </div>
                      <div>
                        <div style={{fontSize:12,fontWeight:600,color:"#fff"}}>{u.displayName}</div>
                        <div style={{fontSize:9,color:"rgba(255,255,255,.3)"}}>{u.email}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── DATE FILTER (collapsible) ── */}
        <div style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.07)",borderRadius:10,marginBottom:10,overflow:"hidden"}}>
          <button onClick={function(){setFiltersOpen(function(p){return !p;});}}
            style={{display:"flex",justifyContent:"space-between",alignItems:"center",width:"100%",background:"none",border:"none",padding:"8px 11px",cursor:"pointer",fontFamily:"inherit"}}>
            <div style={{display:"flex",alignItems:"center",gap:7}}>
              <span style={{fontSize:11,color:"rgba(255,255,255,.45)",fontWeight:600}}>📅 Date range</span>
              {(fFrom||fTo) && <span style={{background:"rgba(168,255,62,.15)",border:"1px solid rgba(168,255,62,.25)",color:SESS_COLOR,fontSize:9,fontWeight:700,padding:"1px 6px",borderRadius:99}}>active</span>}
            </div>
            <span style={{color:"rgba(255,255,255,.3)",fontSize:10}}>{filtersOpen?"▲":"▼"}</span>
          </button>
          {filtersOpen && (
            <div style={{padding:"0 11px 11px",borderTop:"1px solid rgba(255,255,255,.06)"}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginTop:8}}>
                <div><div style={{fontSize:9,color:"rgba(255,255,255,.3)",marginBottom:3,textTransform:"uppercase",letterSpacing:.6}}>From</div><input type="date" value={fFrom} onChange={function(e){setFFrom(e.target.value);}} style={inputSt({fontSize:11,padding:"6px 8px"})}/></div>
                <div><div style={{fontSize:9,color:"rgba(255,255,255,.3)",marginBottom:3,textTransform:"uppercase",letterSpacing:.6}}>To</div><input type="date" value={fTo} onChange={function(e){setFTo(e.target.value);}} style={inputSt({fontSize:11,padding:"6px 8px"})}/></div>
              </div>
              {(fFrom||fTo) && <button onClick={function(){setFFrom("");setFTo("");}} style={{width:"100%",background:"none",border:"1px solid rgba(255,255,255,.1)",borderRadius:8,color:"rgba(255,255,255,.3)",fontSize:11,padding:"6px",cursor:"pointer",fontFamily:"inherit",marginTop:6}}>Clear date filter</button>}
            </div>
          )}
        </div>

        {sessions===null && <div style={{textAlign:"center",color:"rgba(255,255,255,.3)",padding:"28px 0"}}>Loading…</div>}
        {sessions!==null && displayCount===0 && <div style={{textAlign:"center",color:"rgba(255,255,255,.25)",padding:"32px 0",fontSize:13,lineHeight:1.7}}>No sessions match your filters.</div>}
      </div>

      {/* ── SESSION LIST ── */}
      <div style={{padding:"0 14px"}}>
        {!isAdminScope && filtered.map(renderSessionRow)}
        {isAdminScope && groups && groups.map(function(g) {
          var isCollapsed = collapsedUsers[g.user.id] !== false;
          var liveCt = g.sessions.filter(function(s){ return (s.mode||"live")==="live"; }).length;
          var soldCt = g.sessions.filter(function(s){ return s.sold; }).length;
          var pracCt = g.sessions.filter(function(s){ return s.mode==="practice"; }).length;
          return (
            <div key={g.user.id} style={{marginBottom:isCollapsed?8:16}}>
              <button onClick={function(){ toggleCollapse(g.user.id); }}
                style={{display:"flex",alignItems:"center",gap:9,width:"100%",background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)",borderRadius:10,padding:"9px 12px",cursor:"pointer",fontFamily:"inherit",marginBottom:isCollapsed?0:8,textAlign:"left"}}>
                <div style={{width:28,height:28,borderRadius:"50%",background:"rgba(168,255,62,.15)",border:"1px solid rgba(168,255,62,.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:SESS_COLOR,flexShrink:0}}>
                  {g.user.displayName[0].toUpperCase()}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:700,color:"#fff"}}>{g.user.displayName}</div>
                  <div style={{fontSize:9,color:"rgba(255,255,255,.3)",marginTop:1}}>
                    {g.user.email}
                    <span style={{marginLeft:6}}>{g.sessions.length} session{g.sessions.length!==1?"s":""}</span>
                    {liveCt>0 && <span style={{marginLeft:6,color:"rgba(168,255,62,.6)"}}>{soldCt}/{liveCt} sold</span>}
                    {pracCt>0 && <span style={{marginLeft:6,color:"rgba(0,180,255,.5)"}}>{pracCt} practice</span>}
                  </div>
                </div>
                <span style={{fontSize:10,color:"rgba(255,255,255,.3)",flexShrink:0}}>{isCollapsed?"▶":"▼"}</span>
              </button>
              {!isCollapsed && g.sessions.slice().sort(function(a,b){return b.startTs-a.startTs;}).map(renderSessionRow)}
            </div>
          );
        })}
        <div style={{height:16}}/>
      </div>
      {shareTarget && <ShareModal session={shareTarget} orgUsers={orgUsers} authUser={authUser} onClose={function(){setShareTarget(null);}}/>}
    </div>
  );
}

// ─── SESSION ANALYTICS ────────────────────────────────────────────────────────
function SessionAnalytics({ sessions, deckColor, deckName, deckRootCard, fType, setFType, fFrom, setFFrom, fTo, setFTo, filtersOpen, setFiltersOpen, onBack }) {
  var live = sessions.filter(function(s){return (s.sessionType||s.mode||"live")==="live";});
  var practice = sessions.filter(function(s){return (s.sessionType||s.mode||"live")==="practice";});
  var sold = live.filter(function(s){return s.sold;});
  var cr = live.length ? Math.round(sold.length/live.length*100) : 0;
  var allV = sessions.flatMap(function(s){return sessionVisits(s);});
  var intPct = allV.length ? Math.round(allV.filter(function(v){return v.intendedPath;}).length/allV.length*100) : 0;
  var completedSess = sessions.filter(function(s){return s.endTs;});
  var avgSec = completedSess.length ? Math.round(completedSess.reduce(function(sum,s){return sum+sessionDurSec(s);},0)/completedSess.length) : 0;

  var hadIntro  = live.filter(function(s){return sessionVisits(s).some(function(v){return !v.isObjCard&&(v.cardType==="pitch"||v.cardType==="discovery");});}).length;
  var pastIntro = live.filter(function(s){return sessionVisits(s).some(function(v){return v.cardType==="discovery"&&!v.isObjCard;});}).length;
  var reachedClose = live.filter(function(s){return sessionVisits(s).some(function(v){return v.cardType==="close"&&!v.isObjCard;});}).length;

  var objC = {};
  sessions.forEach(function(s){sessionVisits(s).filter(function(v){return v.isObjCard&&v.stackLabel;}).forEach(function(v){objC[v.stackLabel]=(objC[v.stackLabel]||0)+1;});});
  var topObjs = Object.entries(objC).sort(function(a,b){return b[1]-a[1];});
  var topObjLabel = topObjs.length ? topObjs[0][0] : "—";
  var topObjCount = topObjs.length ? topObjs[0][1] : 0;
  var maxObj = topObjs.length ? topObjs[0][1] : 1;

  var cardT = {};
  sessions.forEach(function(s){sessionVisits(s).filter(function(v){return !v.isObjCard && v.cardId !== deckRootCard;}).forEach(function(v){
    if(!cardT[v.cardId])cardT[v.cardId]={title:v.cardTitle,type:v.cardType,ms:0,ct:0};
    cardT[v.cardId].ms+=v.durationMs||0; cardT[v.cardId].ct++;
  });});
  var topCards = Object.values(cardT).sort(function(a,b){return b.ct-a.ct;}).slice(0,10);
  var maxCt = topCards.length ? topCards[0].ct : 1;
  var hasDateFilter = !!(fFrom||fTo);

  function renderKeyMetrics() {
    if (fType === "live") {
      return (
        <div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
            <StatBox value={cr+"%"} label="Close rate" color="#66BB6A"/>
            <StatBox value={sold.length+"/"+live.length} label="Sold / Live" color="#A8FF3E"/>
            <StatBox value={fmtSec(avgSec)||"—"} label="Avg duration" color={SESS_COLOR}/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
            <StatBox value={intPct+"%"} label="Intended path" color="#66BB6A"/>
            <StatBox value={topObjCount||"—"} label={"Top obj: "+(topObjLabel.length>10?topObjLabel.slice(0,10)+"…":topObjLabel)} color={OBJ_COLOR}/>
          </div>
        </div>
      );
    }
    if (fType === "practice") {
      return (
        <div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
            <StatBox value={practice.length} label="Practice runs" color="#00B4FF"/>
            <StatBox value={fmtSec(avgSec)||"—"} label="Avg duration" color={SESS_COLOR}/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
            <StatBox value={intPct+"%"} label="Intended path" color="#66BB6A"/>
            <StatBox value={topObjCount||"—"} label={topObjCount?"Most practiced obj":"Top objection"} color={OBJ_COLOR}/>
          </div>
        </div>
      );
    }
    // All
    return (
      <div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
          <StatBox value={sessions.length} label="Total sessions" color={SESS_COLOR}/>
          <StatBox value={fmtSec(avgSec)||"—"} label="Avg duration" color={SESS_COLOR}/>
          <StatBox value={intPct+"%"} label="Intended path" color="#66BB6A"/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
          <StatBox value={cr+"%"} label="Close rate" color="#66BB6A"/>
          <StatBox value={topObjCount||"—"} label={"Top objection"} color={OBJ_COLOR}/>
        </div>
      </div>
    );
  }

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,.07)",display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
        <button onClick={onBack} style={Object.assign({},iconBtn(),{padding:"5px 8px"})}>←</button>
        <span style={{fontSize:13,fontWeight:700,color:"#fff",flex:1}}>Analytics · {deckName}</span>
        <span style={{fontSize:9,color:"rgba(255,255,255,.25)"}}>{sessions.length} session{sessions.length!==1?"s":""}</span>
      </div>
      {/* Prominent type filter tabs */}
      <div style={{padding:"10px 14px 0",flexShrink:0}}>
        <div style={{display:"flex",background:"rgba(255,255,255,.05)",borderRadius:10,padding:2,gap:1,marginBottom:10}}>
          {[["all","All","#FFD54F"],["live","📞 Live","#A8FF3E"],["practice","🎯 Practice","#00B4FF"]].map(function(t){
            var on=fType===t[0];
            return <button key={t[0]} onClick={function(){setFType(t[0]);}} style={{flex:1,background:on?"rgba(255,255,255,.1)":"transparent",border:"none",borderRadius:8,padding:"7px",cursor:"pointer",fontFamily:"inherit",color:on?t[2]:"rgba(255,255,255,.4)",fontSize:12,fontWeight:on?700:400}}>{t[1]}</button>;
          })}
        </div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"0 14px 0"}}>
        {/* Date filter (collapsible) */}
        <div style={{background:"#081428",border:"1px solid rgba(255,255,255,.08)",borderRadius:10,marginBottom:12,overflow:"hidden"}}>
          <button onClick={function(){setFiltersOpen(function(p){return !p;});}}
            style={{display:"flex",justifyContent:"space-between",alignItems:"center",width:"100%",background:"none",border:"none",padding:"10px 12px",cursor:"pointer",fontFamily:"inherit"}}>
            <div style={{display:"flex",alignItems:"center",gap:7}}>
              <span style={{fontSize:12,color:"rgba(255,255,255,.5)",fontWeight:700}}>Date filter</span>
              {hasDateFilter && <span style={{background:"rgba(168,255,62,.18)",border:"1px solid rgba(168,255,62,.3)",color:SESS_COLOR,fontSize:9,fontWeight:700,padding:"1px 7px",borderRadius:99}}>active</span>}
            </div>
            <span style={{color:"rgba(255,255,255,.35)",fontSize:11}}>{filtersOpen?"▲":"▼"}</span>
          </button>
          {filtersOpen && (
            <div style={{padding:"0 12px 12px",borderTop:"1px solid rgba(255,255,255,.06)"}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:hasDateFilter?8:0,marginTop:10}}>
                <div><div style={{fontSize:9,color:"rgba(255,255,255,.3)",marginBottom:3,textTransform:"uppercase",letterSpacing:.6}}>From</div><input type="date" value={fFrom} onChange={function(e){setFFrom(e.target.value);}} style={inputSt({fontSize:11,padding:"6px 8px"})}/></div>
                <div><div style={{fontSize:9,color:"rgba(255,255,255,.3)",marginBottom:3,textTransform:"uppercase",letterSpacing:.6}}>To</div><input type="date" value={fTo} onChange={function(e){setFTo(e.target.value);}} style={inputSt({fontSize:11,padding:"6px 8px"})}/></div>
              </div>
              {hasDateFilter && <button onClick={function(){setFFrom("");setFTo("");}} style={{width:"100%",background:"none",border:"1px solid rgba(255,255,255,.1)",borderRadius:8,color:"rgba(255,255,255,.35)",fontSize:11,padding:"7px",cursor:"pointer",fontFamily:"inherit",marginTop:4}}>Clear date filter</button>}
            </div>
          )}
        </div>
        {/* Key metrics */}
        <SectionHdr>Key metrics</SectionHdr>
        {renderKeyMetrics()}
        {/* Funnel — only for live/all */}
        {fType !== "practice" && (
          <div style={{marginBottom:14}}>
            <SectionHdr>Call funnel — live calls</SectionHdr>
            <div style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.08)",borderRadius:12,padding:"13px 14px"}}>
              <BarRow label="Reached intro"   value={hadIntro}      denom={live.length}    color={SESS_COLOR}/>
              <BarRow label="Into discovery"  value={pastIntro}     denom={hadIntro}       color="#00B4FF"/>
              <BarRow label="Reached close"   value={reachedClose}  denom={pastIntro}      color="#66BB6A"/>
              <BarRow label="Sold"            value={sold.length}   denom={reachedClose}   color="#A8FF3E"/>
            </div>
          </div>
        )}
        {/* Top objections */}
        {topObjs.length > 0 && (
          <div style={{marginBottom:14}}>
            <SectionHdr>Most common objections</SectionHdr>
            <div style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.08)",borderRadius:12,padding:"13px 14px"}}>
              {topObjs.slice(0,5).map(function(entry, i) {
                var pct = Math.round(entry[1]/maxObj*100);
                return <div key={entry[0]} style={{marginBottom:i<Math.min(topObjs.length,5)-1?9:0}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:11,color:"rgba(255,255,255,.65)"}}>{entry[0]}</span><span style={{fontSize:11,color:OBJ_COLOR,fontWeight:700}}>{entry[1]}x</span></div>
                  <div style={{height:4,background:"rgba(255,255,255,.07)",borderRadius:99,overflow:"hidden"}}><div style={{height:"100%",background:OBJ_COLOR,borderRadius:99,width:pct+"%"}}/></div>
                </div>;
              })}
            </div>
          </div>
        )}
        {/* Top cards */}
        {topCards.length > 0 && (
          <div style={{marginBottom:14}}>
            <SectionHdr>Most visited cards</SectionHdr>
            <div style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.08)",borderRadius:12,padding:"13px 14px"}}>
              {topCards.map(function(c, i) { var m=TM[c.type]||TM.pitch; var pct=Math.round(c.ct/maxCt*100); return (
                <div key={c.title} style={{marginBottom:i<topCards.length-1?9:0}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
                    <div style={{display:"flex",alignItems:"center",gap:5,flex:1,minWidth:0}}>
                      <span style={{fontSize:10,color:m.color,flexShrink:0}}>■</span>
                      <span style={{fontSize:11,color:i===0?"#fff":"rgba(255,255,255,.65)",fontWeight:i===0?700:400,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.title}</span>
                    </div>
                    <span style={{fontSize:11,color:m.color,fontWeight:700,flexShrink:0,marginLeft:6}}>{c.ct}x</span>
                  </div>
                  <div style={{height:4,background:"rgba(255,255,255,.07)",borderRadius:99,overflow:"hidden"}}><div style={{height:"100%",background:m.color,borderRadius:99,width:pct+"%"}}/></div>
                </div>
              );})}
            </div>
          </div>
        )}
        <div style={{height:16}}/>
      </div>
    </div>
  );
}

// ─── SWIMLANE VIEW ────────────────────────────────────────────────────────────
var SL_CARD_W = 162, SL_CARD_H = 82;
var SL_CARD_GAP = 14;
var SL_LANE_W   = SL_CARD_W + 24;   // column width
var SL_COL_GAP  = 36;               // horizontal gap between columns
var SL_LANE_HDR = 38;               // column header height
var SL_PAD = 16;
var LANE_ORDER = ["pitch","discovery","close","objection"];

function buildTypeLayout(cards, rootCard) {
  var laneCards = {};
  LANE_ORDER.forEach(function(t){ laneCards[t] = []; });
  if (rootCard && cards[rootCard]) {
    laneCards[cards[rootCard].type || "pitch"].unshift(rootCard);
  }
  Object.keys(cards).forEach(function(id) {
    if (id === rootCard) return;
    var t = cards[id].type || "pitch";
    if (!laneCards[t]) laneCards[t] = [];
    laneCards[t].push(id);
  });
  var activeLanes = LANE_ORDER.filter(function(t){ return laneCards[t].length > 0; });

  // Each lane is a vertical COLUMN
  var laneX = {};
  activeLanes.forEach(function(t, i) {
    laneX[t] = SL_PAD + i * (SL_LANE_W + SL_COL_GAP);
  });

  var posMap = {};
  activeLanes.forEach(function(t) {
    laneCards[t].forEach(function(id, rowIdx) {
      posMap[id] = {
        x: laneX[t] + 12,
        y: SL_PAD + SL_LANE_HDR + rowIdx * (SL_CARD_H + SL_CARD_GAP),
        lane: t,
        laneX: laneX[t],
      };
    });
  });

  var maxRows = activeLanes.reduce(function(mx, t) { return Math.max(mx, laneCards[t].length); }, 0);
  var canvasW = SL_PAD * 2 + activeLanes.length * SL_LANE_W + Math.max(0, activeLanes.length - 1) * SL_COL_GAP;
  var canvasH = SL_PAD * 2 + SL_LANE_HDR + maxRows * (SL_CARD_H + SL_CARD_GAP) + 8;

  var edges = [];
  Object.keys(cards).forEach(function(id) {
    (cards[id].answers || []).forEach(function(a) {
      if (a.next && posMap[id] && posMap[a.next]) {
        edges.push({ from: id, to: a.next, label: a.label });
      }
    });
  });

  return { laneCards: laneCards, activeLanes: activeLanes, laneX: laneX, posMap: posMap, edges: edges, canvasW: canvasW, canvasH: canvasH };
}

function slEdgePath(fp, tp) {
  if (fp.lane === tp.lane) {
    // Same column: connect bottom→top (or loop if going backward)
    var cx = fp.x + SL_CARD_W / 2;
    var x1 = cx, y1 = fp.y + SL_CARD_H;
    var x2 = cx, y2 = tp.y;
    if (y2 >= y1 + 4) {
      var ctrl = Math.max(18, (y2 - y1) * 0.45);
      return { d:"M "+x1+","+y1+" C "+x1+","+(y1+ctrl)+" "+x2+","+(y2-ctrl)+" "+x2+","+y2, x1:x1,y1:y1,x2:x2,y2:y2, dir:"down" };
    } else {
      // Loop back — arc to the right of the column
      var rx = fp.x + SL_CARD_W + 32;
      var my = (y1 + y2) / 2;
      return { d:"M "+x1+","+y1+" C "+x1+","+(y1+28)+" "+rx+","+(y1+18)+" "+rx+","+my+" C "+rx+","+(y2-18)+" "+x2+","+(y2-28)+" "+x2+","+y2, x1:x1,y1:y1,x2:x2,y2:y2, dir:"down" };
    }
  } else {
    // Cross column: exit right side of source, enter left side of target
    var x1 = fp.x + SL_CARD_W, y1 = fp.y + SL_CARD_H / 2;
    var x2 = tp.x,              y2 = tp.y + SL_CARD_H / 2;
    var dx = x2 - x1;
    if (dx >= 0) {
      // Left→right normal flow
      var cp = Math.max(32, Math.abs(dx) * 0.42);
      return { d:"M "+x1+","+y1+" C "+(x1+cp)+","+y1+" "+(x2-cp)+","+y2+" "+x2+","+y2, x1:x1,y1:y1,x2:x2,y2:y2, dir:"right" };
    } else {
      // Reverse: right→left, drop below cards to route back
      var drop = 48;
      var mx = (x1 + x2) / 2;
      return { d:"M "+x1+","+y1+" C "+(x1+30)+","+y1+" "+(x1+30)+","+(y1+drop)+" "+mx+","+(y1+drop)+" C "+(x2-30)+","+(y1+drop)+" "+(x2-30)+","+y2+" "+x2+","+y2, x1:x1,y1:y1,x2:x2,y2:y2, dir:"right" };
    }
  }
}

function SwimlaneView({ cards, rootCard, onEdit, onSetRoot }) {
  var [zoom, setZoom]       = useState(1.0);
  var [selectedId, setSelectedId] = useState(null);
  var scrollRef  = useRef(null);
  var pinchRef   = useRef(null);
  var zoomRef    = useRef(1.0);

  useEffect(function() { zoomRef.current = zoom; }, [zoom]);

  // Attach non-passive touchmove for pinch zoom — scoped to this viewer
  useEffect(function() {
    var el = scrollRef.current;
    if (!el) return;
    function dist(e) { return Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY); }
    function onTS(e) { if (e.touches.length===2) pinchRef.current={d:dist(e),z:zoomRef.current}; }
    function onTM(e) {
      if (e.touches.length===2 && pinchRef.current) {
        e.preventDefault();
        setZoom(Math.min(2, Math.max(0.3, pinchRef.current.z * dist(e) / pinchRef.current.d)));
      }
    }
    function onTE(e) { if (e.touches.length<2) pinchRef.current=null; }
    el.addEventListener("touchstart", onTS, {passive:true});
    el.addEventListener("touchmove",  onTM, {passive:false});
    el.addEventListener("touchend",   onTE, {passive:true});
    return function() {
      el.removeEventListener("touchstart", onTS);
      el.removeEventListener("touchmove",  onTM);
      el.removeEventListener("touchend",   onTE);
    };
  }, []);

  if (!rootCard || !cards || Object.keys(cards).length === 0) {
    return <div style={{padding:32,textAlign:"center",color:"rgba(255,255,255,.3)",fontSize:13}}>No cards yet.</div>;
  }

  var layout   = buildTypeLayout(cards, rootCard);
  var laneCards= layout.laneCards, activeLanes=layout.activeLanes, laneX=layout.laneX;
  var posMap   = layout.posMap, edges=layout.edges, canvasW=layout.canvasW, canvasH=layout.canvasH;

  return (
    <div style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column"}}>
      {/* Toolbar */}
      <div style={{display:"flex",alignItems:"center",gap:6,padding:"6px 12px",borderBottom:"1px solid rgba(255,255,255,.06)",flexShrink:0}}>
        <button onClick={function(){setZoom(function(z){return Math.min(2,+(z+0.15).toFixed(2));});}} style={{background:"rgba(255,255,255,.07)",border:"none",color:"rgba(255,255,255,.6)",borderRadius:5,padding:"3px 9px",cursor:"pointer",fontSize:14,fontFamily:"inherit"}}>+</button>
        <span style={{fontSize:11,color:"rgba(255,255,255,.35)",minWidth:36,textAlign:"center",fontFamily:"inherit"}}>{Math.round(zoom*100)}%</span>
        <button onClick={function(){setZoom(function(z){return Math.max(0.3,+(z-0.15).toFixed(2));});}} style={{background:"rgba(255,255,255,.07)",border:"none",color:"rgba(255,255,255,.6)",borderRadius:5,padding:"3px 9px",cursor:"pointer",fontSize:14,fontFamily:"inherit"}}>−</button>
        <button onClick={function(){setZoom(1.0);}} style={{background:"rgba(255,255,255,.07)",border:"none",color:"rgba(255,255,255,.4)",borderRadius:5,padding:"3px 8px",cursor:"pointer",fontSize:11,marginLeft:2,fontFamily:"inherit"}}>Reset</button>
        <span style={{fontSize:10,color:"rgba(255,255,255,.18)",marginLeft:"auto"}}>★ intended · ⊕ merge · pinch to zoom</span>
      </div>

      {/* Scroll area */}
      <div ref={scrollRef} style={{overflow:"auto",flex:1,userSelect:"none"}}>
        {/* Wrapper sized to zoomed canvas so scrollbars appear correctly */}
        <div style={{position:"relative",width:canvasW*zoom+32,height:canvasH*zoom+32,minWidth:"100%",flexShrink:0}}>
          {/* Scaled canvas */}
          <div style={{position:"absolute",top:0,left:0,width:canvasW,height:canvasH,transform:"scale("+zoom+")",transformOrigin:"top left"}}>

            {/* Column lane headers */}
            {activeLanes.map(function(t, i) {
              var meta = TM[t] || TM.pitch;
              var x = laneX[t];
              return (
                <div key={t+"-hdr"} style={{position:"absolute",left:x,top:SL_PAD,width:SL_LANE_W,height:SL_LANE_HDR-6,background:meta.color+"16",border:"1px solid "+meta.color+"35",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",gap:5,pointerEvents:"none",userSelect:"none"}}>
                  <span style={{fontSize:13}}>{meta.icon}</span>
                  <span style={{fontSize:10,fontWeight:700,color:meta.color,textTransform:"uppercase",letterSpacing:1.1}}>{meta.label}</span>
                  <span style={{fontSize:9,color:"rgba(255,255,255,.28)",marginLeft:1}}>{laneCards[t].length}</span>
                </div>
              );
            })}

            {/* Vertical lane dividers */}
            {activeLanes.slice(0,-1).map(function(t, i) {
              var nextX = laneX[activeLanes[i+1]];
              var sepX = laneX[t] + SL_LANE_W + (nextX - laneX[t] - SL_LANE_W) / 2;
              return (
                <div key={t+"-div"} style={{position:"absolute",left:sepX,top:SL_PAD,height:canvasH-SL_PAD*2,width:1,background:"rgba(255,255,255,.055)",pointerEvents:"none"}}/>
              );
            })}

            {/* Edges SVG — rendered below cards */}
            <svg style={{position:"absolute",inset:0,width:canvasW,height:canvasH,overflow:"visible",pointerEvents:"none"}}>
              <defs>
                <marker id="arr" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
                  <polygon points="0,0 7,3.5 0,7" fill="rgba(255,255,255,.28)"/>
                </marker>
              </defs>
              {edges.map(function(edge, i) {
                var fp = posMap[edge.from], tp = posMap[edge.to];
                if (!fp || !tp) return null;
                var ep = slEdgePath(fp, tp);
                var lx = (ep.x1 + ep.x2) / 2;
                var ly = Math.min(ep.y1, ep.y2) + Math.abs(ep.y2 - ep.y1) * 0.38 - 8;
                return (
                  <g key={i}>
                    <path d={ep.d} stroke="rgba(255,255,255,.18)" strokeWidth={1.4} fill="none" markerEnd="url(#arr)"/>
                    {edge.label && (
                      <foreignObject x={lx-36} y={ly} width={72} height={16}>
                        <div style={{fontSize:8,background:"rgba(4,10,28,.92)",border:"1px solid rgba(255,255,255,.12)",borderRadius:99,padding:"1px 5px",color:"rgba(255,255,255,.45)",textAlign:"center",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontFamily:"'Inter',sans-serif"}}>{edge.label}</div>
                      </foreignObject>
                    )}
                  </g>
                );
              })}
            </svg>

            {/* Cards */}
            {Object.keys(posMap).map(function(cardId) {
              var pos = posMap[cardId];
              var card = cards[cardId];
              if (!card) return null;
              var meta = TM[card.type] || TM.pitch;
              var isRoot = cardId === rootCard;
              var isSelected = cardId === selectedId;
              var inboundCt = edges.filter(function(e){return e.to===cardId;}).length;
              var isMerge = inboundCt > 1;
              var canEdit = !!onEdit;
              return (
                <div key={cardId}
                  onClick={function(){ if(onEdit) { if(isSelected) onEdit(card); else setSelectedId(cardId); } else setSelectedId(isSelected?null:cardId); }}
                  style={{
                    position:"absolute", left:pos.x, top:pos.y,
                    width:SL_CARD_W,
                    height: isSelected && canEdit ? SL_CARD_H+28 : SL_CARD_H,
                    background: isRoot ? "rgba(0,180,255,.1)" : card.intendedPath ? "rgba(168,255,62,.06)" : "rgba(255,255,255,.06)",
                    border:"1.5px solid "+(isSelected ? meta.color : card.intendedPath ? "rgba(168,255,62,.25)" : "rgba(255,255,255,.1)"),
                    borderTop:"3px solid "+meta.color,
                    borderRadius:12, cursor: canEdit ? "pointer" : "default",
                    overflow:"hidden",
                    boxShadow: isSelected ? ("0 0 0 3px "+meta.color+"33,0 8px 28px rgba(0,0,0,.6)") : "0 2px 8px rgba(0,0,0,.35)",
                    transition:"box-shadow .15s, height .15s, border-color .15s",
                    zIndex: isSelected ? 10 : 1,
                  }}>
                  <div style={{padding:"7px 10px 4px",display:"flex",alignItems:"center",gap:5}}>
                    <span style={{fontSize:12}}>{meta.icon}</span>
                    <span style={{fontSize:11,fontWeight:700,color:"#fff",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{card.title || card.type}</span>
                  </div>
                  <div style={{padding:"0 10px 5px",display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}>
                    {isRoot && <span style={{fontSize:8,background:"rgba(0,180,255,.2)",color:"#00B4FF",borderRadius:99,padding:"1px 5px",fontWeight:700,flexShrink:0}}>root</span>}
                    {card.intendedPath && <span style={{fontSize:9,color:"#A8FF3E",flexShrink:0}}>★</span>}
                    {isMerge && <span style={{fontSize:9,color:meta.color,opacity:.7,flexShrink:0}}>⊕</span>}
                    <span style={{fontSize:9,color:"rgba(255,255,255,.22)",marginLeft:"auto"}}>{(card.answers||[]).filter(function(a){return a.next;}).length} →</span>
                  </div>
                  {isSelected && canEdit && (
                    <div style={{position:"absolute",bottom:0,left:0,right:0,background:"rgba(4,10,28,.95)",borderTop:"1px solid rgba(255,255,255,.09)",display:"flex"}}>
                      <button onClick={function(e){e.stopPropagation();onEdit(card);setSelectedId(null);}} style={{flex:1,fontSize:10,color:"rgba(255,255,255,.7)",background:"none",border:"none",padding:"6px",cursor:"pointer",fontFamily:"inherit"}}>✏ Edit</button>
                      {onSetRoot && !isRoot && (
                        <button onClick={function(e){e.stopPropagation();onSetRoot(cardId);setSelectedId(null);}} style={{flex:1,fontSize:10,color:"rgba(168,255,62,.8)",background:"none",border:"none",borderLeft:"1px solid rgba(255,255,255,.07)",padding:"6px",cursor:"pointer",fontFamily:"inherit"}}>⬆ Root</button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── CARDS TAB ────────────────────────────────────────────────────────────────
function CardsTab({ deck, onUpsert, onDelete, onUpdateDeck, readOnly }) {
  var [viewMode, setViewMode] = useState("list");
  var [editing,  setEditing]  = useState(null);
  var [search,   setSearch]   = useState("");
  var [filter,   setFilter]   = useState(null);

  function switchViewMode(v) {
    setViewMode(v);
    if (v === "tree") setFilter(null);
  }

  function startNew() {
    setEditing({ id:uid(), title:"", type:"pitch", overview:[], intendedPath:false, prompt:"", answers:[{id:aid(),label:"",next:null}] });
  }

  var pitchTypes = ["pitch","discovery","close"];
  var allCards = Object.values(deck.cards);
  var filtered = allCards.filter(function(c) {
    var ms = !search || c.title.toLowerCase().includes(search.toLowerCase()) || stripMarkup(c.prompt).toLowerCase().includes(search.toLowerCase());
    var mt = !filter || c.type === filter;
    return ms && mt;
  });
  var counts = {};
  pitchTypes.forEach(function(t) { counts[t] = allCards.filter(function(c){return c.type===t;}).length; });

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"10px 14px 8px",flexShrink:0,borderBottom:"1px solid rgba(255,255,255,.05)"}}>
        <div style={{display:"flex",alignItems:"center",gap:7}}>
          <div style={{display:"flex",gap:5,flex:1,minWidth:0}}>
            {viewMode==="list" && pitchTypes.map(function(t) {
              var m=TM[t]; var active=filter===t;
              return <button key={t} onClick={function(){setFilter(active?null:t);}}
                style={{flexShrink:0,background:active?m.color+"22":"rgba(255,255,255,.05)",border:"1px solid "+(active?m.color:"rgba(255,255,255,.09)"),borderRadius:99,padding:"4px 9px",cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:4}}>
                <span style={{fontSize:11}}>{m.icon}</span>
                <span style={{fontSize:12,fontWeight:700,color:active?m.color:"rgba(255,255,255,.7)"}}>{counts[t]}</span>
              </button>;
            })}
          </div>
          <div style={{display:"flex",background:"rgba(255,255,255,.05)",borderRadius:10,padding:2,gap:1,flexShrink:0}}>
            {["list","tree"].map(function(v) {
              var on=viewMode===v;
              return <button key={v} onClick={function(){switchViewMode(v);}}
                style={{background:on?"rgba(255,255,255,.14)":"transparent",border:"none",borderRadius:8,padding:"5px 11px",cursor:"pointer",color:on?"#fff":"rgba(255,255,255,.35)",fontSize:11,fontFamily:"inherit",fontWeight:on?700:400}}>
                {v==="list"?"≡ List":"⊞ Viewer"}
              </button>;
            })}
          </div>
          {readOnly && <span style={{fontSize:9,color:"rgba(255,255,255,.3)",background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",borderRadius:99,padding:"3px 9px",flexShrink:0}}>📖 View only</span>}
          {!readOnly && <button onClick={startNew} style={Object.assign({},solidBtn(deck.color),{height:32,padding:"0 14px",fontSize:13,flexShrink:0})}>+ Card</button>}
        </div>
        {viewMode==="list" && (
          <div style={{position:"relative",marginTop:8}}>
            <span style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",color:"rgba(255,255,255,.3)",fontSize:13}}>🔎</span>
            <input value={search} onChange={function(e){setSearch(e.target.value);}} placeholder="Search cards…" style={inputSt({paddingLeft:32,height:36})}/>
          </div>
        )}
        {viewMode==="tree" && !readOnly && <div style={{marginTop:6,fontSize:10,color:"rgba(255,255,255,.25)",lineHeight:1.5}}>Tap card to edit · ↩ = cross-link · ⊕ = merge · ★ = intended path · Pinch to zoom</div>}
        {viewMode==="tree" && readOnly && <div style={{marginTop:6,fontSize:10,color:"rgba(255,255,255,.25)",lineHeight:1.5}}>Tap card to view · Pinch to zoom</div>}
      </div>
      {viewMode === "tree" ? (
        <SwimlaneView cards={deck.cards} rootCard={deck.rootCard}
          onEdit={readOnly ? null : function(c){setEditing(c);}}
          onSetRoot={readOnly ? null : (onUpdateDeck ? function(id){onUpdateDeck(deck.id, function(d){return Object.assign({},d,{rootCard:id});});} : null)}/>
      ) : (
        <div style={{overflowY:"auto",flex:1,padding:"0 14px"}}>
          <div style={{display:"flex",flexDirection:"column",gap:7,paddingTop:8}}>
            {filtered.length===0 && <div style={{textAlign:"center",color:"rgba(255,255,255,.25)",padding:"40px 0",fontSize:14}}>{search?"No matches.":"No cards yet."}</div>}
            {filtered.map(function(card) {
              var m=TM[card.type]||TM.pitch; var isRoot=card.id===deck.rootCard;
              return (
                <button key={card.id} onClick={function(){setEditing(card);}}
                  style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.08)",borderLeft:"3px solid "+m.color,borderRadius:"0 14px 14px 0",padding:"12px 14px",cursor:"pointer",textAlign:"left",fontFamily:"inherit"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4,flexWrap:"wrap"}}>
                        <span style={{fontSize:14,fontWeight:700,color:"#fff"}}>{card.title}</span>
                        {isRoot && <span style={{fontSize:9,background:"rgba(255,255,255,.1)",color:"rgba(255,255,255,.45)",padding:"1px 7px",borderRadius:99,letterSpacing:.5,textTransform:"uppercase"}}>root</span>}
                        {card.intendedPath && <IntendedBadge/>}
                      </div>
                      {card.overview && card.overview.filter(function(b){return b&&b.trim();}).length > 0 && (
                        <div style={{fontSize:10,color:"rgba(255,255,255,.38)",marginBottom:4}}>◆ {card.overview.filter(function(b){return b&&b.trim();})[0]}</div>
                      )}
                      <div style={{fontSize:12,color:"rgba(255,255,255,.32)",lineHeight:1.4,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{stripMarkup(card.prompt)}</div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:5,flexShrink:0}}>
                      <TypeBadge type={card.type} small={true}/>
                      <span style={{fontSize:10,color:"rgba(255,255,255,.22)"}}>{card.answers.length} ans</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          <div style={{height:16}}/>
        </div>
      )}
      {editing && readOnly && (
        <div style={{position:"fixed",inset:0,zIndex:250,display:"flex",flexDirection:"column"}} onClick={function(e){if(e.target===e.currentTarget)setEditing(null);}}>
          <div onClick={function(){setEditing(null);}} style={{flex:1,background:"rgba(0,0,0,.5)",backdropFilter:"blur(8px)"}}/>
          <div style={{background:"#081428",borderRadius:"24px 24px 0 0",border:"1px solid rgba(255,255,255,.1)",borderBottom:"none",maxHeight:"75vh",overflow:"auto",padding:"0 0 32px",animation:"sheetUp .3s cubic-bezier(.22,1,.36,1) both"}}>
            <Handle/>
            <div style={{padding:"4px 16px 14px",borderBottom:"1px solid rgba(255,255,255,.07)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <TypeBadge type={editing.type}/>
                {editing.intendedPath && <IntendedBadge/>}
              </div>
              <button onClick={function(){setEditing(null);}} style={iconBtn()}>✕</button>
            </div>
            <div style={{padding:"14px 16px"}}>
              <div style={{fontSize:18,fontWeight:700,color:"#fff",fontFamily:"'Lora',serif",marginBottom:10}}>{editing.title}</div>
              {editing.overview && editing.overview.filter(function(b){return b&&b.trim();}).length > 0 && (
                <OverviewDisplay bullets={editing.overview} color={(TM[editing.type]||TM.pitch).color}/>
              )}
              {editing.prompt && (
                <div style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.07)",borderRadius:12,padding:"14px 16px",marginBottom:12,fontSize:15,lineHeight:1.7}}>
                  <RichPromptDisplay text={editing.prompt} accentColor={(TM[editing.type]||TM.pitch).color}/>
                </div>
              )}
              {(editing.answers||[]).filter(function(a){return a&&a.label;}).length > 0 && (
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,.3)",letterSpacing:1.2,textTransform:"uppercase",marginBottom:8}}>Prospect responds:</div>
                  {(editing.answers||[]).filter(function(a){return a&&a.label;}).map(function(ans,i){return(
                    <div key={ans.id||i} style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)",borderRadius:12,padding:"10px 13px",marginBottom:6,fontSize:13,color:"rgba(255,255,255,.8)"}}>{ans.label}</div>
                  );})}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {editing && !readOnly && (
        <CardEditorSheet card={editing} allCards={deck.cards} accentColor={deck.color} lockedType={null}
          onSave={function(c){onUpsert(deck.id,c);setEditing(null);}}
          onDelete={function(id){onDelete(deck.id,id);setEditing(null);}}
          onClose={function(){setEditing(null);}}/>
      )}
    </div>
  );
}

// ─── OBJECTIONS TAB ───────────────────────────────────────────────────────────
function ObjStackEditor({ stack, onSave, onDelete, onClose, initialEditCard, deckCards }) {
  var [form, setForm]         = useState(Object.assign({}, stack, { cards:Object.assign({}, stack.cards || {}) }));
  var [editCard, setEditCard] = useState(initialEditCard || null);
  var [editMeta, setEditMeta] = useState(false);
  var [viewMode, setViewMode] = useState("list");
  var [search, setSearch]     = useState("");

  function upsertCard(card) {
    setForm(function(p) {
      var nextCard = Object.assign({ overview:[], intendedPath:false, prompt:"", answers:[{id:aid(),label:"",next:null}] }, card || {});
      var nc = Object.assign({}, p.cards, { [nextCard.id]: nextCard });
      return Object.assign({}, p, { cards:nc, rootCard:p.rootCard || nextCard.id });
    });
    setEditCard(null);
  }

  function deleteCard(id) {
    setForm(function(p) {
      var nc = Object.assign({}, p.cards);
      delete nc[id];
      Object.values(nc).forEach(function(c) {
        c.answers = (c.answers || []).map(function(a) {
          return a && a.next===id ? Object.assign({}, a, { next:null }) : a;
        });
      });
      return Object.assign({}, p, { cards:nc, rootCard:p.rootCard===id ? (Object.keys(nc)[0] || null) : p.rootCard });
    });
    setEditCard(null);
  }

  var allCards = Object.values(form.cards || {});
  var filtered = allCards.filter(function(c) {
    if (!search.trim()) return true;
    var hay = ((c.title || "") + " " + stripMarkup(c.prompt || "")).toLowerCase();
    return hay.indexOf(search.toLowerCase()) !== -1;
  });

  return (
    <div style={{position:"fixed",inset:0,zIndex:250,display:"flex",flexDirection:"column"}}>
      <div onClick={onClose} style={{flex:1,background:"rgba(0,0,0,.6)",backdropFilter:"blur(8px)"}}/>
      <div style={{background:"#081428",borderRadius:"24px 24px 0 0",border:"1px solid rgba(239,83,80,.2)",borderBottom:"none",maxHeight:"92vh",display:"flex",flexDirection:"column",animation:"sheetUp .3s cubic-bezier(.22,1,.36,1) both"}}>
        <Handle/>

        {!editMeta ? (
          <div style={{padding:"8px 20px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid rgba(255,255,255,.07)"}}>
            <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
              <div style={{width:42,height:42,borderRadius:13,background:"rgba(239,83,80,.15)",border:"1px solid rgba(239,83,80,.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>{form.icon}</div>
              <div style={{minWidth:0}}>
                <div style={{fontSize:17,fontWeight:700,color:"#fff",fontFamily:"'Lora',serif",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{form.label}</div>
                <div style={{fontSize:11,color:"rgba(255,255,255,.3)"}}>{Object.keys(form.cards || {}).length} cards</div>
              </div>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={function(){setEditMeta(true);}} style={ghostSm()}>Edit</button>
              <button onClick={function(){onDelete(form.id);}} style={ghostSm({color:"#EF5350",borderColor:"rgba(239,83,80,.3)"})}>Delete</button>
              <button onClick={onClose} style={iconBtn()}>✕</button>
            </div>
          </div>
        ) : (
          <div style={{padding:"8px 20px 14px",borderBottom:"1px solid rgba(255,255,255,.07)"}}>
            <label style={labelSt()}>Stack Name</label>
            <input value={form.label} onChange={function(e){setForm(function(p){return Object.assign({},p,{label:e.target.value});});}} style={inputSt({marginBottom:10})}/>
            <label style={labelSt()}>Icon</label>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
              {OBJ_ICONS.map(function(ic) {
                return <button key={ic} onClick={function(){setForm(function(p){return Object.assign({},p,{icon:ic});});}}
                  style={{background:form.icon===ic?"rgba(255,255,255,.15)":"rgba(255,255,255,.05)",border:"1.5px solid "+(form.icon===ic?"rgba(255,255,255,.4)":"rgba(255,255,255,.08)"),borderRadius:9,width:38,height:38,cursor:"pointer",fontSize:18}}>{ic}</button>;
              })}
            </div>
            <button onClick={function(){setEditMeta(false);}} style={Object.assign({},solidBtn(OBJ_COLOR),{width:"100%"})}>Done</button>
          </div>
        )}

        <div style={{padding:"10px 14px 8px",flexShrink:0,borderBottom:"1px solid rgba(255,255,255,.05)"}}>
          <div style={{display:"flex",alignItems:"center",gap:7}}>
            <div style={{display:"flex",background:"rgba(255,255,255,.05)",borderRadius:10,padding:2,gap:1,flexShrink:0}}>
              {["list","tree"].map(function(v) {
                var on=viewMode===v;
                return <button key={v} onClick={function(){setViewMode(v);}}
                  style={{background:on?"rgba(255,255,255,.14)":"transparent",border:"none",borderRadius:8,padding:"5px 11px",cursor:"pointer",color:on?"#fff":"rgba(255,255,255,.35)",fontSize:11,fontFamily:"inherit",fontWeight:on?700:400}}>
                  {v==="list"?"≡ List":"⊞ Viewer"}
                </button>;
              })}
            </div>
            <button onClick={function(){setEditCard({id:uid(),title:"",type:"objection",overview:[],intendedPath:false,prompt:"",answers:[{id:aid(),label:"",next:null}]});}} style={Object.assign({},solidBtn(OBJ_COLOR),{height:32,padding:"0 14px",fontSize:13,flexShrink:0})}>+ Card</button>
          </div>
          {viewMode==="list" && (
            <div style={{position:"relative",marginTop:8}}>
              <span style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",color:"rgba(255,255,255,.3)",fontSize:13}}>🔎</span>
              <input value={search} onChange={function(e){setSearch(e.target.value);}} placeholder="Search stack cards…" style={inputSt({paddingLeft:32,height:36})}/>
            </div>
          )}
          {viewMode==="tree" && <div style={{marginTop:6,fontSize:10,color:"rgba(255,255,255,.25)",lineHeight:1.5}}>Tap card to edit · ↩ = cross-link · ⊕ = merge · ★ = intended path · Pinch to zoom</div>}
        </div>

        {viewMode === "tree" ? (
          <SwimlaneView cards={form.cards || {}} rootCard={form.rootCard} onEdit={function(c){setEditCard(c);}}
            onSetRoot={function(id){setForm(function(p){return Object.assign({},p,{rootCard:id});});}} />
        ) : (
          <div style={{overflowY:"auto",flex:1,padding:"14px 20px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <span style={{fontSize:11,color:"rgba(255,255,255,.3)",letterSpacing:.5,textTransform:"uppercase",fontWeight:700}}>{filtered.length} card{filtered.length!==1?"s":""}</span>
              <span style={{fontSize:11,color:"rgba(255,255,255,.22)"}}>{form.rootCard ? "Entry card set" : "No entry card"}</span>
            </div>

            <div style={{display:"flex",flexDirection:"column",gap:7}}>
              {filtered.map(function(c) {
                var isEntry = c.id===form.rootCard;
                return (
                  <button key={c.id} onClick={function(){setEditCard(c);}}
                    style={{background:"rgba(239,83,80,.04)",border:"1px solid rgba(239,83,80,.12)",borderLeft:"3px solid #EF5350",borderRadius:"0 12px 12px 0",padding:"11px 13px",cursor:"pointer",textAlign:"left",fontFamily:"inherit"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3,flexWrap:"wrap"}}>
                          <span style={{fontSize:13,fontWeight:700,color:"#fff"}}>{c.title}</span>
                          {isEntry && <span style={{fontSize:9,background:"rgba(239,83,80,.2)",color:"#EF5350",padding:"1px 7px",borderRadius:99,letterSpacing:.5,textTransform:"uppercase"}}>entry</span>}
                          {c.intendedPath && <IntendedBadge/>}
                        </div>
                        {c.overview && c.overview.filter(function(b){return b&&b.trim();}).length > 0 && (
                          <div style={{fontSize:10,color:"rgba(255,255,255,.38)",marginBottom:4}}>◆ {c.overview.filter(function(b){return b&&b.trim();})[0]}</div>
                        )}
                        <div style={{fontSize:11,color:"rgba(255,255,255,.3)",lineHeight:1.4,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{stripMarkup(c.prompt || "")}</div>
                      </div>
                      <span style={{fontSize:10,color:"rgba(239,83,80,.5)",flexShrink:0}}>{(c.answers||[]).length} paths</span>
                    </div>
                  </button>
                );
              })}
              {filtered.length===0 && <div style={{textAlign:"center",color:"rgba(255,255,255,.25)",padding:"28px 0",fontSize:14}}>{search ? "No matches." : "No cards yet."}</div>}
            </div>
          </div>
        )}

        <div style={{borderTop:"1px solid rgba(255,255,255,.07)"}}>
          {/* After-resolution target */}
          <div style={{padding:"12px 20px 0"}}>
            <div style={{fontSize:10,fontWeight:700,color:"rgba(239,83,80,.6)",marginBottom:8,letterSpacing:1,textTransform:"uppercase"}}>After objection resolves</div>
            <div style={{display:"flex",gap:7,marginBottom:form.targetCard?9:0}}>
              <button onClick={function(){setForm(function(p){return Object.assign({},p,{targetCard:null});});}}
                style={{flex:1,background:!form.targetCard?"rgba(255,255,255,.1)":"rgba(255,255,255,.04)",border:"1.5px solid "+(!form.targetCard?"rgba(255,255,255,.3)":"rgba(255,255,255,.08)"),borderRadius:10,padding:"8px 6px",cursor:"pointer",fontFamily:"inherit",fontSize:11,color:!form.targetCard?"#fff":"rgba(255,255,255,.35)",fontWeight:!form.targetCard?700:400,textAlign:"center"}}>
              ↩ Return to current card
              </button>
              <button onClick={function(){setForm(function(p){return Object.assign({},p,{targetCard:p.targetCard||"__pick"});});}}
                style={{flex:1,background:form.targetCard?"rgba(239,83,80,.13)":"rgba(255,255,255,.04)",border:"1.5px solid "+(form.targetCard?"rgba(239,83,80,.4)":"rgba(255,255,255,.08)"),borderRadius:10,padding:"8px 6px",cursor:"pointer",fontFamily:"inherit",fontSize:11,color:form.targetCard?"#EF5350":"rgba(255,255,255,.35)",fontWeight:form.targetCard?700:400,textAlign:"center"}}>
              → Go to specific card
              </button>
            </div>
            {form.targetCard && deckCards && Object.keys(deckCards).length > 0 && (
              <select
                value={form.targetCard === "__pick" ? "" : form.targetCard}
                onChange={function(e){setForm(function(p){return Object.assign({},p,{targetCard:e.target.value||"__pick"});});}}
                style={Object.assign({},inputSt({fontSize:12,marginBottom:0}),{appearance:"none"})}>
                <option value="">— Select target card —</option>
                {Object.values(deckCards).map(function(c){
                  return <option key={c.id} value={c.id}>{(TM[c.type]||TM.pitch).icon} {c.title}</option>;
                })}
              </select>
            )}
          </div>
          <div style={{padding:"14px 20px",display:"flex",gap:10}}>
            <button onClick={onClose} style={Object.assign({},ghostBtn(),{flex:1})}>Cancel</button>
            <button onClick={function(){
              var toSave = Object.assign({},form);
              if (toSave.targetCard === "__pick") toSave.targetCard = null;
              onSave(toSave);
            }} style={Object.assign({},solidBtn(OBJ_COLOR),{flex:2})}>Save Stack</button>
          </div>
        </div>
      </div>

      {editCard && <CardEditorSheet card={editCard} allCards={form.cards || {}} accentColor={OBJ_COLOR} lockedType="objection" onSave={upsertCard} onDelete={deleteCard} onClose={function(){setEditCard(null);}}/>}
    </div>
  );
}

function ObjectionsTab({ deck, onUpdateDeck, readOnly }) {
  var [editing, setEditing]       = useState(null);
  var [pendingCard, setPendingCard] = useState(null);
  var [showNew, setShowNew]       = useState(false);
  var [viewMode, setViewMode]     = useState("list");
  var [selectedStackId, setSelectedStackId] = useState(null);
  var [nf, setNf]                 = useState({ label:"", icon:"😐" });

  function saveStack(s) {
    onUpdateDeck(deck.id, function(d) { return Object.assign({},d,{objStacks:d.objStacks.map(function(x){return x.id===s.id?s:x;})}); });
    setEditing(null); setPendingCard(null);
  }
  function deleteStack(id) {
    onUpdateDeck(deck.id, function(d) { return Object.assign({},d,{objStacks:d.objStacks.filter(function(s){return s.id!==id;})}); });
    setEditing(null); setPendingCard(null);
  }
  function createStack() {
    if (!nf.label.trim()) return;
    var s = { id:osid(), label:nf.label, icon:nf.icon, rootCard:null, cards:{} };
    onUpdateDeck(deck.id, function(d) { return Object.assign({},d,{objStacks:d.objStacks.concat([s])}); });
    setShowNew(false); setNf({label:"",icon:"😐"});
    setEditing(s);
  }
  function openStackCard(stack, card) {
    setPendingCard(card || null);
    setEditing(stack);
  }
  function onStackClick(stack) {
    if (readOnly) { setViewMode("tree"); setSelectedStackId(stack.id); return; }
    openStackCard(stack, null);
  }
  function setStackRoot(stackId, cardId) {
    onUpdateDeck(deck.id, function(d) {
      return Object.assign({}, d, { objStacks: d.objStacks.map(function(s) {
        return s.id === stackId ? Object.assign({}, s, { rootCard: cardId }) : s;
      })});
    });
  }

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {/* Header bar */}
      <div style={{padding:"10px 14px 8px",flexShrink:0,borderBottom:"1px solid rgba(255,255,255,.05)"}}>
        <div style={{display:"flex",alignItems:"center",gap:7}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:11,color:"rgba(255,255,255,.3)",letterSpacing:.5,textTransform:"uppercase",fontWeight:700}}>{deck.objStacks.length} Stack{deck.objStacks.length!==1?"s":""}</div>
          </div>
          <div style={{display:"flex",background:"rgba(255,255,255,.05)",borderRadius:10,padding:2,gap:1,flexShrink:0}}>
            {["list","tree"].map(function(v) {
              var on=viewMode===v;
              return <button key={v} onClick={function(){setViewMode(v);}}
                style={{background:on?"rgba(255,255,255,.14)":"transparent",border:"none",borderRadius:8,padding:"5px 11px",cursor:"pointer",color:on?"#fff":"rgba(255,255,255,.35)",fontSize:11,fontFamily:"inherit",fontWeight:on?700:400}}>
                {v==="list"?"≡ List":"⊞ Viewer"}
              </button>;
            })}
          </div>
          {readOnly && <span style={{fontSize:9,color:"rgba(255,255,255,.3)",background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",borderRadius:99,padding:"3px 9px",flexShrink:0}}>📖 View only</span>}
          {!readOnly && <button onClick={function(){setShowNew(true);}} style={ghostSm({color:OBJ_COLOR,borderColor:"rgba(239,83,80,.3)"})}>+ New</button>}
        </div>
        {viewMode==="tree" && deck.objStacks.length > 0 && !readOnly && <div style={{marginTop:6,fontSize:10,color:"rgba(255,255,255,.25)",lineHeight:1.5}}>Tap card to edit · ⬆ = set entry · ↩ = cross-link · Pinch to zoom</div>}
        {viewMode==="tree" && deck.objStacks.length > 0 && readOnly && <div style={{marginTop:6,fontSize:10,color:"rgba(255,255,255,.25)",lineHeight:1.5}}>Tap card to view · Pinch to zoom</div>}
      </div>

      {viewMode === "list" ? (
        <div style={{flex:1,overflowY:"auto",padding:"14px 14px 0"}}>
          <div style={{background:"rgba(239,83,80,.07)",border:"1px solid rgba(239,83,80,.15)",borderRadius:14,padding:"13px 15px",marginBottom:14}}>
            <div style={{fontSize:12,fontWeight:700,color:OBJ_COLOR,marginBottom:3}}>🛡️ Objection Stacks</div>
            <div style={{fontSize:11,color:"rgba(255,255,255,.35)",lineHeight:1.6}}>Linked to <strong style={{color:"rgba(255,255,255,.6)"}}>{deck.name}</strong>. Access from Play mode — returns to your current card.</div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {deck.objStacks.length===0 && <div style={{textAlign:"center",color:"rgba(255,255,255,.25)",padding:"40px 0",fontSize:14,lineHeight:1.7}}>No stacks yet.<br/>Create one to handle objections from anywhere in your pitch.</div>}
            {deck.objStacks.map(function(stack) {
              return (
                <button key={stack.id} onClick={function(){onStackClick(stack);}}
                  style={{background:"rgba(239,83,80,.05)",border:"1.5px solid rgba(239,83,80,.15)",borderRadius:16,padding:"15px",cursor:"pointer",textAlign:"left",fontFamily:"inherit"}}>
                  <div style={{display:"flex",alignItems:"center",gap:13}}>
                    <div style={{width:46,height:46,borderRadius:13,background:"rgba(239,83,80,.15)",border:"1px solid rgba(239,83,80,.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>{stack.icon}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:14,fontWeight:700,color:"#fff",marginBottom:4}}>{stack.label}</div>
                      <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                        <span style={{fontSize:11,color:"rgba(239,83,80,.7)",background:"rgba(239,83,80,.1)",padding:"2px 8px",borderRadius:99}}>{Object.keys(stack.cards).length} cards</span>
                        <span style={{fontSize:11,color:"rgba(255,255,255,.25)",background:"rgba(255,255,255,.05)",padding:"2px 8px",borderRadius:99}}>{stack.rootCard?"Has entry":"No entry card"}</span>
                      </div>
                    </div>
                    <span style={{color:"rgba(239,83,80,.5)",fontSize:18}}>›</span>
                  </div>
                </button>
              );
            })}
          </div>
          <div style={{height:20}}/>
        </div>
      ) : (
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
          {deck.objStacks.length===0 && (
            <div style={{textAlign:"center",color:"rgba(255,255,255,.25)",padding:"40px 0",fontSize:14,lineHeight:1.7}}>
              No stacks yet.<br/>Create one to handle objections from anywhere in your pitch.
            </div>
          )}
          {deck.objStacks.length > 0 && (function(){
            var activeStackId = selectedStackId || deck.objStacks[0].id;
            var activeStack = deck.objStacks.find(function(s){return s.id===activeStackId;}) || deck.objStacks[0];
            var cardCount = activeStack ? Object.keys(activeStack.cards).length : 0;
            return (
              <>
                {/* Pill selector */}
                <div style={{padding:"8px 14px 0",overflowX:"auto",flexShrink:0}}>
                  <div style={{display:"flex",gap:6,paddingBottom:6}}>
                    {deck.objStacks.map(function(stack){
                      var on = stack.id === activeStackId;
                      return (
                        <button key={stack.id} onClick={function(){setSelectedStackId(stack.id);}}
                          style={{display:"inline-flex",alignItems:"center",gap:5,background:on?"rgba(239,83,80,.15)":"rgba(255,255,255,.05)",border:"1.5px solid "+(on?"rgba(239,83,80,.4)":"rgba(255,255,255,.09)"),borderRadius:99,padding:"5px 12px",cursor:"pointer",fontFamily:"inherit",fontSize:11,color:on?OBJ_COLOR:"rgba(255,255,255,.4)",fontWeight:on?700:400,flexShrink:0}}>
                          <span>{stack.icon}</span><span>{stack.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {/* Active stack tree */}
                {activeStack && (
                  <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",borderTop:"1px solid rgba(255,255,255,.05)"}}>
                    <div style={{padding:"8px 14px 4px",display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
                      <div style={{width:28,height:28,borderRadius:8,background:"rgba(239,83,80,.15)",border:"1px solid rgba(239,83,80,.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0}}>{activeStack.icon}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:700,color:"#fff"}}>{activeStack.label}</div>
                        <div style={{fontSize:9,color:"rgba(239,83,80,.6)"}}>{cardCount} card{cardCount!==1?"s":""}{activeStack.rootCard?" · entry set":" · no entry"}</div>
                      </div>
                      {!readOnly && <button onClick={function(){openStackCard(activeStack, null);}} style={ghostSm({color:OBJ_COLOR,borderColor:"rgba(239,83,80,.3)",fontSize:11})}>Edit</button>}
                    </div>
                    {cardCount > 0 ? (
                      <SwimlaneView
                        cards={activeStack.cards}
                        rootCard={activeStack.rootCard}
                        onEdit={readOnly ? null : function(card){openStackCard(activeStack, card);}}
                        onSetRoot={readOnly ? null : function(cardId){setStackRoot(activeStack.id, cardId);}}
                      />
                    ) : (
                      <div style={{padding:"8px 14px 14px",fontSize:11,color:"rgba(255,255,255,.2)"}}>No cards — open editor to add some.</div>
                    )}
                  </div>
                )}
              </>
            );
          })()}
          <div style={{height:20,flexShrink:0}}/>
        </div>
      )}

      {showNew && (
        <div style={{position:"fixed",inset:0,zIndex:250,display:"flex",flexDirection:"column"}}>
          <div onClick={function(){setShowNew(false);}} style={{flex:1,background:"rgba(0,0,0,.6)",backdropFilter:"blur(8px)"}}/>
          <div style={{background:"#081428",borderRadius:"24px 24px 0 0",border:"1px solid rgba(239,83,80,.2)",borderBottom:"none",padding:"16px 20px 28px",animation:"sheetUp .3s cubic-bezier(.22,1,.36,1) both"}}>
            <Handle/>
            <div style={{fontSize:18,fontWeight:700,color:"#fff",marginBottom:16,fontFamily:"'Lora',serif"}}>New Objection Stack</div>
            <label style={labelSt()}>Name</label>
            <input value={nf.label} onChange={function(e){setNf(function(p){return Object.assign({},p,{label:e.target.value});});}} placeholder="e.g. Too Expensive" style={inputSt({marginBottom:14})}/>
            <label style={labelSt()}>Icon</label>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:18}}>
              {OBJ_ICONS.map(function(ic) {
                return <button key={ic} onClick={function(){setNf(function(p){return Object.assign({},p,{icon:ic});});}}
                  style={{background:nf.icon===ic?"rgba(239,83,80,.2)":"rgba(255,255,255,.05)",border:"1.5px solid "+(nf.icon===ic?"rgba(239,83,80,.5)":"rgba(255,255,255,.08)"),borderRadius:9,width:40,height:40,cursor:"pointer",fontSize:20}}>{ic}</button>;
              })}
            </div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={function(){setShowNew(false);}} style={Object.assign({},ghostBtn(),{flex:1})}>Cancel</button>
              <button onClick={createStack} style={Object.assign({},solidBtn(OBJ_COLOR),{flex:2})}>Create Stack</button>
            </div>
          </div>
        </div>
      )}
      {editing && (
        <ObjStackEditor
          stack={editing}
          onSave={saveStack}
          onDelete={deleteStack}
          onClose={function(){setEditing(null);setPendingCard(null);}}
          initialEditCard={pendingCard}
          deckCards={deck.cards}
        />
      )}
    </div>
  );
}

// ─── DECK SWITCHER SHEET ──────────────────────────────────────────────────────
function DeckSwitcherSheet({ decks, activeDeckId, onSelect, onAddDeck, onClose, isAdmin, onEditDeck }) {
  var [showNew, setShowNew] = useState(false);
  var [nf, setNf] = useState({ name:"", icon:"💼", color:"#F5A623", visibility:"public" });
  var [editingDeck, setEditingDeck] = useState(null);
  var [ef, setEf] = useState({ name:"", icon:"💼", color:"#00B4FF", visibility:"public" });

  function create() {
    if (!nf.name.trim()) return;
    onAddDeck({ name:nf.name, icon:nf.icon, color:nf.color, visibility:nf.visibility||"public", rootCard:null, cards:{}, objStacks:[] });
    setShowNew(false); setNf({name:"",icon:"⚡",color:"#F5A623",visibility:"public"}); onClose();
  }

  return (
    <div style={{position:"fixed",inset:0,zIndex:250,display:"flex",flexDirection:"column"}}>
      <div onClick={onClose} style={{flex:1,background:"rgba(0,0,0,.6)",backdropFilter:"blur(8px)"}}/>
      <div style={{background:"#081428",borderRadius:"24px 24px 0 0",border:"1px solid rgba(255,255,255,.1)",borderBottom:"none",maxHeight:"80vh",display:"flex",flexDirection:"column",animation:"sheetUp .3s cubic-bezier(.22,1,.36,1) both"}}>
        <Handle/>
        <div style={{padding:"4px 20px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid rgba(255,255,255,.07)"}}>
          <div style={{fontSize:18,fontWeight:700,color:"#fff",fontFamily:"'Lora',serif"}}>Switch Deck</div>
          <div style={{display:"flex",gap:8}}>
            {isAdmin && <button onClick={function(){setShowNew(function(p){return !p;});}} style={ghostSm()}>+ New Deck</button>}
            <button onClick={onClose} style={iconBtn()}>✕</button>
          </div>
        </div>
        <div style={{overflowY:"auto",flex:1,padding:"14px 20px"}}>
          {showNew && (
            <div style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.1)",borderRadius:14,padding:"16px",marginBottom:14}}>
              <div style={{fontSize:14,fontWeight:700,color:"#fff",marginBottom:14,fontFamily:"'Lora',serif"}}>New Pitch Deck</div>
              <label style={labelSt()}>Name</label>
              <input value={nf.name} onChange={function(e){setNf(function(p){return Object.assign({},p,{name:e.target.value});});}} placeholder="e.g. Enterprise Outbound" style={inputSt({marginBottom:11})}/>
              <label style={labelSt()}>Icon</label>
              <div style={{display:"flex",gap:7,flexWrap:"wrap",marginBottom:11}}>
                {DECK_ICONS.map(function(ic) {
                  return <button key={ic} onClick={function(){setNf(function(p){return Object.assign({},p,{icon:ic});});}}
                    style={{background:nf.icon===ic?"rgba(255,255,255,.15)":"rgba(255,255,255,.05)",border:"1.5px solid "+(nf.icon===ic?"rgba(255,255,255,.4)":"rgba(255,255,255,.07)"),borderRadius:9,width:36,height:36,cursor:"pointer",fontSize:17}}>{ic}</button>;
                })}
              </div>
              <label style={labelSt()}>Color</label>
              <div style={{display:"flex",gap:8,marginBottom:11}}>
                {DECK_COLORS.map(function(c) {
                  return <button key={c} onClick={function(){setNf(function(p){return Object.assign({},p,{color:c});});}}
                    style={{width:28,height:28,borderRadius:"50%",background:c,border:"3px solid "+(nf.color===c?"#fff":"transparent"),cursor:"pointer"}}/>;
                })}
              </div>
              <label style={labelSt()}>Visibility</label>
              <div style={{display:"flex",gap:8,marginBottom:14}}>
                {["public","private"].map(function(v){
                  var on = nf.visibility===v;
                  var icon = v==="public" ? "🌐" : "🔒";
                  return (
                    <button key={v} onClick={function(){setNf(function(p){return Object.assign({},p,{visibility:v});});}}
                      style={{flex:1,background:on?"rgba(168,255,62,.1)":"rgba(255,255,255,.07)",border:"1.5px solid "+(on?"rgba(168,255,62,.35)":"rgba(255,255,255,.1)"),borderRadius:10,padding:"8px 6px",cursor:"pointer",fontFamily:"inherit",textAlign:"center"}}>
                      <div style={{fontSize:14}}>{icon}</div>
                      <div style={{fontSize:9,color:on?SESS_COLOR:"rgba(255,255,255,.4)",fontWeight:on?700:400,marginTop:2}}>{v==="public"?"Public":"Private"}</div>
                    </button>
                  );
                })}
              </div>
              <div style={{display:"flex",gap:10}}>
                <button onClick={function(){setShowNew(false);}} style={Object.assign({},ghostBtn(),{flex:1,padding:"9px",fontSize:13})}>Cancel</button>
                <button onClick={create} style={Object.assign({},solidBtn(nf.color),{flex:2})}>Create</button>
              </div>
            </div>
          )}
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {decks.map(function(d) {
              var active = d.id===activeDeckId;
              var isEditing = editingDeck && editingDeck.id === d.id;
              if (isEditing) {
                return (
                  <div key={d.id} style={{background:"rgba(255,255,255,.06)",border:"1.5px solid rgba(255,255,255,.15)",borderRadius:16,padding:"14px 15px"}}>
                    <div style={{fontSize:12,fontWeight:700,color:"#fff",marginBottom:10}}>Edit Deck</div>
                    <label style={labelSt()}>Name</label>
                    <input value={ef.name} onChange={function(e){setEf(function(p){return Object.assign({},p,{name:e.target.value});});}} style={inputSt({marginBottom:10})}/>
                    <label style={labelSt()}>Icon</label>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
                      {DECK_ICONS.map(function(ic) {
                        return <button key={ic} onClick={function(){setEf(function(p){return Object.assign({},p,{icon:ic});});}}
                          style={{background:ef.icon===ic?"rgba(255,255,255,.15)":"rgba(255,255,255,.05)",border:"1.5px solid "+(ef.icon===ic?"rgba(255,255,255,.4)":"rgba(255,255,255,.07)"),borderRadius:9,width:34,height:34,cursor:"pointer",fontSize:16}}>{ic}</button>;
                      })}
                    </div>
                    <label style={labelSt()}>Color</label>
                    <div style={{display:"flex",gap:7,flexWrap:"wrap",marginBottom:10}}>
                      {DECK_COLORS.map(function(c) {
                        return <button key={c} onClick={function(){setEf(function(p){return Object.assign({},p,{color:c});});}}
                          style={{width:26,height:26,borderRadius:"50%",background:c,border:"3px solid "+(ef.color===c?"#fff":"transparent"),cursor:"pointer"}}/>;
                      })}
                    </div>
                    <label style={labelSt()}>Visibility</label>
                    <div style={{display:"flex",gap:8,marginBottom:12}}>
                      {["public","private"].map(function(v){
                        var on = ef.visibility===v;
                        var icon = v==="public" ? "🌐" : "🔒";
                        return (
                          <button key={v} onClick={function(){setEf(function(p){return Object.assign({},p,{visibility:v});});}}
                            style={{flex:1,background:on?"rgba(168,255,62,.1)":"rgba(255,255,255,.07)",border:"1.5px solid "+(on?"rgba(168,255,62,.35)":"rgba(255,255,255,.1)"),borderRadius:10,padding:"8px 6px",cursor:"pointer",fontFamily:"inherit",textAlign:"center"}}>
                            <div style={{fontSize:14}}>{icon}</div>
                            <div style={{fontSize:9,color:on?SESS_COLOR:"rgba(255,255,255,.4)",fontWeight:on?700:400,marginTop:2}}>{v==="public"?"Public":"Private"}</div>
                          </button>
                        );
                      })}
                    </div>
                    <div style={{display:"flex",gap:8}}>
                      <button onClick={function(){setEditingDeck(null);}} style={Object.assign({},ghostBtn(),{flex:1,padding:"8px",fontSize:12})}>Cancel</button>
                      <button onClick={function(){if(onEditDeck&&ef.name.trim())onEditDeck(editingDeck.id,ef);setEditingDeck(null);}} style={Object.assign({},solidBtn(ef.color),{flex:2,padding:"8px",fontSize:12})}>Save</button>
                    </div>
                  </div>
                );
              }
              return (
                <div key={d.id} style={{position:"relative",display:"flex",alignItems:"center",gap:0}}>
                  <button onClick={function(){onSelect(d.id);onClose();}}
                    style={{flex:1,background:active?d.color+"14":"rgba(255,255,255,.07)",border:"1.5px solid "+(active?d.color:"rgba(255,255,255,.08)"),borderRadius:16,padding:"13px 15px",cursor:"pointer",textAlign:"left",fontFamily:"inherit"}}>
                    <div style={{display:"flex",alignItems:"center",gap:11}}>
                      <div style={{width:44,height:44,borderRadius:13,background:d.color+"22",border:"1.5px solid "+d.color+"44",display:"flex",alignItems:"center",justifyContent:"center",fontSize:21,flexShrink:0}}>{d.icon}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:3,flexWrap:"wrap"}}>
                          <span style={{fontSize:14,fontWeight:700,color:"#fff"}}>{d.name}</span>
                          {active && <span style={{fontSize:9,background:d.color+"22",color:d.color,padding:"1px 8px",borderRadius:99,letterSpacing:.5,textTransform:"uppercase"}}>active</span>}
                          <span style={{fontSize:10,opacity:.55}} title={d.visibility==="private"?"Private — restricted access":"Public — org-wide"}>{d.visibility==="private"?"🔒":"🌐"}</span>
                        </div>
                        <div style={{fontSize:11,color:"rgba(255,255,255,.3)"}}>{Object.values(d.cards).length} cards · {d.objStacks.length} obj stacks</div>
                      </div>
                      {active && <span style={{color:d.color,fontSize:18}}>✓</span>}
                    </div>
                  </button>
                  {isAdmin && <button onClick={function(e){ e.stopPropagation(); setEf({name:d.name,icon:d.icon||"💼",color:d.color||"#00B4FF",visibility:d.visibility||"public"}); setEditingDeck(d); }} style={{background:"none",border:"none",cursor:"pointer",fontSize:14,padding:"2px 5px",color:"rgba(255,255,255,.4)",position:"absolute",right:10,top:"50%",transform:"translateY(-50%)"}}>✏</button>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── LOGIN SCREEN ─────────────────────────────────────────────────────────────
var DEV_PASSWORD = "Redcard2025!";
var DEV_ORGS = [
  {
    id: "apex", name: "Apex Sales", domain: "apexsales.com",
    admins: [
      { label:"Alex Mercer",    email:"alex@apexsales.com"    },
      { label:"Jordan Rivera",  email:"jordan@apexsales.com"  },
      { label:"Sam Patel",      email:"sam@apexsales.com"     },
    ],
    teams: [
      { name:"Team Alpha", users:[
        { label:"Marcus Chen",    email:"marcus@apexsales.com"  },
        { label:"Priya Nair",     email:"priya@apexsales.com"   },
        { label:"Tyler Brooks",   email:"tyler@apexsales.com"   },
        { label:"Sofia Martinez", email:"sofia@apexsales.com"   },
      ]},
      { name:"Team Beta", users:[
        { label:"Dani Walsh",     email:"dani@apexsales.com"    },
        { label:"Kenji Tanaka",   email:"kenji@apexsales.com"   },
        { label:"Amara Osei",     email:"amara@apexsales.com"   },
        { label:"Ryan Costello",  email:"ryan@apexsales.com"    },
      ]},
      { name:"Team Gamma", users:[
        { label:"Leila Hassan",   email:"leila@apexsales.com"   },
        { label:"Colt Barnard",   email:"colt@apexsales.com"    },
        { label:"Zara Kim",       email:"zara@apexsales.com"    },
        { label:"Derek Pham",     email:"derek@apexsales.com"   },
      ]},
    ],
  },
  {
    id: "meridian", name: "Meridian Group", domain: "meridiangroup.com",
    admins: [
      { label:"Casey Wright", email:"casey@meridiangroup.com" },
      { label:"Riley Stone",  email:"riley@meridiangroup.com" },
    ],
    teams: [
      { name:"Team North", users:[
        { label:"Jordan Fox",   email:"fox@meridiangroup.com"   },
        { label:"Avery Blake",  email:"blake@meridiangroup.com" },
      ]},
      { name:"Team South", users:[
        { label:"Morgan Shaw",  email:"shaw@meridiangroup.com"  },
        { label:"Taylor Reed",  email:"reed@meridiangroup.com"  },
      ]},
    ],
  },
];

function LoginScreen({ onLogin }) {
  var [email,   setEmail]   = useState("");
  var [pass,    setPass]    = useState("");
  var [err,     setErr]     = useState("");
  var [busy,    setBusy]    = useState(false);
  var [selOrg,  setSelOrg]  = useState(null);   // null | DEV_ORGS entry
  var [showPicker, setShowPicker] = useState(false);

  function pickOrg(org) {
    setSelOrg(org);
    setEmail(""); setPass(""); setErr("");
  }

  function pickUser(u) {
    setEmail(u.email);
    setPass(DEV_PASSWORD);
    setShowPicker(false);
    setErr("");
  }

  function submit(e) {
    e.preventDefault();
    if (!email.trim() || !pass) { setErr("Email and password are required."); return; }
    setBusy(true); setErr("");
    fetch("/api/auth/login", {
      method:"POST", credentials:"include",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ email: email.trim(), password: pass }),
    })
      .then(function(r) { return r.ok ? r.json() : r.json().then(function(b){ throw new Error(b.error||"Login failed"); }); })
      .then(function(user) { setBusy(false); onLogin(user); })
      .catch(function(e) { setBusy(false); setErr(e.message || "Login failed"); });
  }

  var accentColor = "#00B4FF"; // always on-theme; org colors only identify org tiles

  return (
    <div style={{width:"100%",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"linear-gradient(135deg,#060d1a 0%,#071025 100%)",fontFamily:"'Inter',sans-serif",padding:24,overflowY:"auto"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Lora:ital,wght@0,400;0,700;1,400&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        body{background:#060d1a;color:#fff;}
        input::placeholder{color:rgba(255,255,255,.22);}
        input:focus{border-color:rgba(255,255,255,.3)!important;outline:none;}
        @keyframes fadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
        @keyframes dropIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
      `}</style>
      <div style={{width:"100%",maxWidth:380,animation:"fadeIn .4s cubic-bezier(.22,1,.36,1) both",paddingBottom:24}}>

        {/* Logo */}
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{width:54,height:54,borderRadius:16,background:"#1565C0",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:28,fontWeight:900,color:"#fff",marginBottom:14}}>O</div>
          <div style={{fontSize:22,fontWeight:700,color:"#fff",fontFamily:"'Lora',serif",marginBottom:4}}>OverCard</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,.3)",letterSpacing:.5}}>Sales Deck Platform</div>
        </div>

        {/* ── Step 1: Org selector ── */}
        <div style={{marginBottom:14}}>
          <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,.3)",letterSpacing:1.4,textTransform:"uppercase",marginBottom:8}}>Select organization</div>
          <div style={{display:"flex",gap:8}}>
            {DEV_ORGS.map(function(org) {
              var active = selOrg && selOrg.id === org.id;
              return (
                <button key={org.id} onClick={function(){ pickOrg(org); }}
                  style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:5,padding:"12px 10px",background:active?"rgba(0,180,255,.08)":"rgba(255,255,255,.07)",border:"1.5px solid "+(active?"rgba(0,180,255,.4)":"rgba(255,255,255,.09)"),borderRadius:14,cursor:"pointer",fontFamily:"inherit",transition:"all .15s"}}>
                  <div style={{width:34,height:34,borderRadius:10,background:active?"rgba(0,180,255,.15)":"rgba(255,255,255,.07)",border:"1.5px solid "+(active?"rgba(0,180,255,.35)":"rgba(255,255,255,.12)"),display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:700,color:active?"#00B4FF":"rgba(255,255,255,.5)"}}>
                    {org.name[0]}
                  </div>
                  <div style={{fontSize:11,fontWeight:700,color:active?"#fff":"rgba(255,255,255,.55)",textAlign:"center",lineHeight:1.3}}>{org.name}</div>
                  {active && <div style={{width:6,height:6,borderRadius:"50%",background:"#00B4FF"}}/>}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Step 2: User picker (only when org selected) ── */}
        {selOrg && (
          <div style={{marginBottom:14,position:"relative"}}>
            <button onClick={function(){ setShowPicker(function(p){ return !p; }); }}
              style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",background:accentColor+"0f",border:"1px solid "+accentColor+"33",borderRadius:12,padding:"10px 14px",cursor:"pointer",fontFamily:"inherit",color:"rgba(255,255,255,.7)",fontSize:12,transition:"all .15s"}}>
              <span style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:13}}>⚡</span>
                <span>{email ? email : "Quick select a user"}</span>
              </span>
              <span style={{fontSize:10,color:"rgba(255,255,255,.3)"}}>{showPicker ? "▲" : "▼"}</span>
            </button>
            {showPicker && (
              <div style={{position:"absolute",top:"calc(100% + 6px)",left:0,right:0,background:"#081428",border:"1px solid rgba(255,255,255,.12)",borderRadius:12,overflow:"hidden",zIndex:20,animation:"dropIn .15s ease both",maxHeight:300,overflowY:"auto",boxShadow:"0 16px 48px rgba(0,0,0,.8)"}}>
                {/* Admins */}
                <div style={{padding:"7px 12px 4px",fontSize:9,fontWeight:700,color:SESS_COLOR+"99",letterSpacing:1.2,textTransform:"uppercase",borderBottom:"1px solid rgba(255,255,255,.05)"}}>Admins</div>
                {selOrg.admins.map(function(u) {
                  return (
                    <button key={u.email} onClick={function(){ pickUser(u); }}
                      style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",background:"none",border:"none",borderBottom:"1px solid rgba(255,255,255,.04)",padding:"10px 14px",cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}>
                      <div>
                        <div style={{fontSize:12,fontWeight:700,color:"#fff"}}>{u.label}</div>
                        <div style={{fontSize:10,color:"rgba(255,255,255,.3)",marginTop:1}}>{u.email}</div>
                      </div>
                      <span style={{fontSize:9,fontWeight:700,padding:"2px 8px",borderRadius:99,background:"rgba(168,255,62,.15)",color:SESS_COLOR,border:"1px solid rgba(168,255,62,.25)",flexShrink:0}}>admin</span>
                    </button>
                  );
                })}
                {/* Teams */}
                {selOrg.teams.map(function(team) {
                  return (
                    <div key={team.name}>
                      <div style={{padding:"7px 12px 4px",fontSize:9,fontWeight:700,color:"rgba(0,180,255,.55)",letterSpacing:1.2,textTransform:"uppercase",borderBottom:"1px solid rgba(255,255,255,.04)",borderTop:"1px solid rgba(255,255,255,.05)"}}>{team.name}</div>
                      {team.users.map(function(u) {
                        return (
                          <button key={u.email} onClick={function(){ pickUser(u); }}
                            style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",background:"none",border:"none",borderBottom:"1px solid rgba(255,255,255,.04)",padding:"10px 14px",cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}>
                            <div>
                              <div style={{fontSize:12,fontWeight:700,color:"#fff"}}>{u.label}</div>
                              <div style={{fontSize:10,color:"rgba(255,255,255,.3)",marginTop:1}}>{u.email}</div>
                            </div>
                            <span style={{fontSize:9,fontWeight:700,padding:"2px 8px",borderRadius:99,background:"rgba(0,180,255,.1)",color:"#00B4FF",border:"1px solid rgba(0,180,255,.2)",flexShrink:0}}>user</span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Form ── */}
        <form onSubmit={submit} style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.09)",borderRadius:18,padding:"24px 24px",display:"flex",flexDirection:"column",gap:14}}>
          <div style={{fontSize:14,fontWeight:700,color:"#fff",marginBottom:2}}>Sign in</div>
          {err && <div style={{background:"rgba(239,83,80,.12)",border:"1px solid rgba(239,83,80,.3)",borderRadius:9,padding:"9px 12px",fontSize:12,color:"#EF5350"}}>{err}</div>}
          <div>
            <label style={labelSt()}>Email</label>
            <input type="email" value={email} onChange={function(e){setEmail(e.target.value);}} placeholder="you@company.com"
              style={inputSt({marginBottom:0})} autoFocus autoComplete="email"/>
          </div>
          <div>
            <label style={labelSt()}>Password</label>
            <input type="password" value={pass} onChange={function(e){setPass(e.target.value);}} placeholder="••••••••"
              style={inputSt({marginBottom:0})} autoComplete="current-password"/>
          </div>
          <button type="submit" disabled={busy}
            style={Object.assign({},solidBtn("#A8FF3E"),{marginTop:2,opacity:busy?0.6:1})}>
            {busy ? "Signing in…" : "Sign In"}
          </button>
        </form>
        <div style={{textAlign:"center",marginTop:16,fontSize:10,color:"rgba(255,255,255,.18)"}}>
          OverCard v2 · dev build
        </div>
      </div>
    </div>
  );
}

// ─── PROFILE SHEET ────────────────────────────────────────────────────────────
function ProfileSheet({ authUser, teamName, onLogout, onClose }) {
  var [busy, setBusy] = useState(false);
  function logout() {
    setBusy(true);
    fetch("/api/auth/logout", { method:"POST", credentials:"include" })
      .then(function(){ onLogout(); })
      .catch(function(){ onLogout(); });
  }
  return (
    <div style={{position:"fixed",inset:0,zIndex:250,display:"flex",flexDirection:"column"}}>
      <div onClick={onClose} style={{flex:1,background:"rgba(0,0,0,.6)",backdropFilter:"blur(8px)"}}/>
      <div style={{background:"#081428",borderRadius:"24px 24px 0 0",border:"1px solid rgba(255,255,255,.1)",borderBottom:"none",padding:"0 0 32px",animation:"sheetUp .3s cubic-bezier(.22,1,.36,1) both",fontFamily:"inherit"}}>
        <Handle/>
        <div style={{padding:"4px 20px 20px",borderBottom:"1px solid rgba(255,255,255,.07)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{fontSize:16,fontWeight:700,color:"#fff",fontFamily:"'Lora',serif"}}>Profile</div>
          <button onClick={onClose} style={iconBtn()}>✕</button>
        </div>
        <div style={{padding:"20px 20px 0",display:"flex",flexDirection:"column",gap:14}}>
          {/* Avatar + name */}
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <div style={{width:52,height:52,borderRadius:"50%",background:"#1565C0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,fontWeight:700,color:"#fff",flexShrink:0}}>
              {authUser.displayName[0].toUpperCase()}
            </div>
            <div>
              <div style={{fontSize:16,fontWeight:700,color:"#fff"}}>{authUser.displayName}</div>
              <div style={{fontSize:11,color:"rgba(255,255,255,.4)",marginTop:2}}>{authUser.email}</div>
            </div>
          </div>
          {/* Role + team */}
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <span style={{fontSize:10,fontWeight:700,padding:"3px 10px",borderRadius:99,background:authUser.role==="admin"?"rgba(168,255,62,.18)":"rgba(0,180,255,.1)",color:authUser.role==="admin"?SESS_COLOR:"#00B4FF",border:"1px solid "+(authUser.role==="admin"?"rgba(168,255,62,.3)":"rgba(0,180,255,.2)"),textTransform:"uppercase",letterSpacing:.6}}>
              {authUser.role}
            </span>
            {teamName && <span style={{fontSize:10,padding:"3px 10px",borderRadius:99,background:"rgba(255,255,255,.06)",color:"rgba(255,255,255,.45)",border:"1px solid rgba(255,255,255,.1)"}}>{teamName}</span>}
          </div>
          <button onClick={logout} disabled={busy}
            style={Object.assign({},ghostBtn(),{padding:"11px",marginTop:4,color:"#EF5350",borderColor:"rgba(239,83,80,.3)"})}>
            {busy ? "Signing out…" : "Sign Out"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ADMIN PANEL ──────────────────────────────────────────────────────────────
function AdminPanel({ authUser, orgUsers, orgTeams, onRefreshUsers, onRefreshTeams }) {
  var [sub, setSub]           = useState("users");
  var [editUser, setEditUser] = useState(null);    // null | "new" | user obj
  var [editTeam, setEditTeam] = useState(null);    // null | "new" | team obj
  var [busy, setBusy]         = useState(false);
  var [msg,  setMsg]          = useState("");

  // ── user form state ──
  var [uf, setUf] = useState({ email:"", displayName:"", role:"user", teamId:"", password:"" });
  // ── team form state ──
  var [tf, setTf] = useState({ name:"", adminIds:[], memberIds:[] });

  var admins = (orgUsers||[]).filter(function(u){ return u.role==="admin"; });

  function resetUf() { setUf({ email:"", displayName:"", role:"user", teamId:"", password:"" }); }
  function resetTf() { setTf({ name:"", adminIds:[], memberIds:[] }); }

  function flash(m) { setMsg(m); setTimeout(function(){ setMsg(""); }, 3000); }

  // ── users ──
  function saveUser() {
    if (!uf.displayName.trim()) { flash("Display name is required"); return; }
    if (editUser === "new" && (!uf.email.trim() || !uf.password)) { flash("Email and password required"); return; }
    setBusy(true);
    var p = editUser === "new"
      ? apiPost("/admin/users", { email:uf.email.trim(), displayName:uf.displayName.trim(), role:uf.role, teamId:uf.teamId||null, password:uf.password })
      : apiPut("/admin/users/" + editUser.id, { displayName:uf.displayName.trim(), role:uf.role, teamId:uf.teamId||null });
    p.then(function(){ setBusy(false); setEditUser(null); resetUf(); onRefreshUsers(); flash(editUser==="new"?"User created":"User updated"); })
     .catch(function(e){ setBusy(false); flash(e.message||"Error saving user"); });
  }

  function resetPassword(user) {
    var pw = prompt("New password for " + user.displayName + " (min 6 chars):");
    if (!pw || pw.length < 6) return;
    apiPost("/admin/users/" + user.id + "/reset-password", { password: pw })
      .then(function(){ flash("Password reset for " + user.displayName); })
      .catch(function(){ flash("Error resetting password"); });
  }

  function deleteUserConfirm(user) {
    if (!confirm("Delete " + user.displayName + "? This cannot be undone.")) return;
    apiDel("/admin/users/" + user.id)
      .then(function(){ onRefreshUsers(); flash("User deleted"); })
      .catch(function(){ flash("Error deleting user"); });
  }

  // ── teams ──
  var [addMemberSel, setAddMemberSel] = useState("");

  function saveTeam() {
    if (!tf.name.trim()) { flash("Team name is required"); return; }
    if (!tf.adminIds.length) { flash("At least one admin must be assigned"); return; }
    setBusy(true);
    var isNew = editTeam === "new";
    var p = isNew
      ? apiPost("/admin/teams", { name:tf.name.trim(), adminIds:tf.adminIds, memberIds:tf.memberIds })
      : apiPut("/admin/teams/" + editTeam.id, { name:tf.name.trim(), adminIds:tf.adminIds, memberIds:tf.memberIds });
    p.then(function(){ setBusy(false); setEditTeam(null); resetTf(); setAddMemberSel(""); onRefreshUsers(); onRefreshTeams(); flash(isNew?"Team created":"Team updated"); })
     .catch(function(e){ setBusy(false); flash(e.message||"Error saving team"); });
  }

  function deleteTeamConfirm(team) {
    if (!confirm("Delete team \"" + team.name + "\"? Users won't be deleted.")) return;
    apiDel("/admin/teams/" + team.id)
      .then(function(){ onRefreshTeams(); flash("Team deleted"); })
      .catch(function(){ flash("Error deleting team"); });
  }

  function toggleAdminId(uid) {
    setTf(function(p){
      var has = p.adminIds.includes(uid);
      return Object.assign({},p,{ adminIds: has ? p.adminIds.filter(function(x){return x!==uid;}) : p.adminIds.concat([uid]) });
    });
  }

  function toggleMemberId(uid) {
    setTf(function(f) {
      return Object.assign({},f,{ memberIds: f.memberIds.includes(uid) ? f.memberIds.filter(function(x){return x!==uid;}) : f.memberIds.concat([uid]) });
    });
  }


  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {/* Sub-tab bar */}
      <div style={{flexShrink:0,padding:"10px 14px 0",borderBottom:"1px solid rgba(255,255,255,.07)"}}>
        <div style={{fontSize:10,fontWeight:700,color:SESS_COLOR,letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>Admin Panel</div>
        <div style={{display:"flex",background:"rgba(255,255,255,.05)",borderRadius:10,padding:2,gap:1}}>
          {[["users","👥 Users"],["teams","🏷️ Teams"]].map(function(s){
            var on = sub===s[0];
            return <button key={s[0]} onClick={function(){setSub(s[0]);}}
              style={{flex:1,background:on?"rgba(255,255,255,.12)":"transparent",border:"none",borderRadius:8,padding:"7px 4px",cursor:"pointer",fontFamily:"inherit",color:on?"#fff":"rgba(255,255,255,.35)",fontSize:11,fontWeight:on?700:400}}>{s[1]}</button>;
          })}
        </div>
      </div>

      {msg && <div style={{margin:"8px 14px 0",background:"rgba(102,187,106,.1)",border:"1px solid rgba(102,187,106,.25)",borderRadius:9,padding:"7px 12px",fontSize:11,color:"#66BB6A",flexShrink:0}}>{msg}</div>}

      <div style={{flex:1,overflowY:"auto",padding:"12px 14px 0"}}>

        {/* ── USERS ── */}
        {sub==="users" && (
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <SectionHdr style={{margin:0}}>Users ({(orgUsers||[]).length})</SectionHdr>
              <button onClick={function(){resetUf();setEditUser("new");}} style={Object.assign({},ghostSm(),{fontSize:11})}>+ New User</button>
            </div>

            {editUser && (
              <div style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.1)",borderRadius:12,padding:"14px",marginBottom:14}}>
                <div style={{fontSize:13,fontWeight:700,color:"#fff",marginBottom:12}}>{editUser==="new"?"New User":"Edit: "+editUser.displayName}</div>
                {editUser==="new" && <>
                  <label style={labelSt()}>Email</label>
                  <input value={uf.email} onChange={function(e){setUf(function(p){return Object.assign({},p,{email:e.target.value});});}} placeholder="email@company.com" style={inputSt({marginBottom:9})}/>
                  <label style={labelSt()}>Password</label>
                  <input type="password" value={uf.password} onChange={function(e){setUf(function(p){return Object.assign({},p,{password:e.target.value});});}} placeholder="••••••••" style={inputSt({marginBottom:9})}/>
                </>}
                <label style={labelSt()}>Display Name</label>
                <input value={uf.displayName} onChange={function(e){setUf(function(p){return Object.assign({},p,{displayName:e.target.value});});}} placeholder="Full name" style={inputSt({marginBottom:9})}/>
                <label style={labelSt()}>Role</label>
                <div style={{display:"flex",gap:6,marginBottom:9}}>
                  {["user","admin"].map(function(r){
                    var on=uf.role===r;
                    return <button key={r} onClick={function(){setUf(function(p){return Object.assign({},p,{role:r});});}}
                      style={{background:on?"rgba(168,255,62,.15)":"rgba(255,255,255,.05)",border:"1px solid "+(on?"rgba(168,255,62,.4)":"rgba(255,255,255,.1)"),borderRadius:8,padding:"5px 14px",cursor:"pointer",fontFamily:"inherit",fontSize:11,color:on?SESS_COLOR:"rgba(255,255,255,.4)",fontWeight:on?700:400}}>{r}</button>;
                  })}
                </div>
                <label style={labelSt()}>Team Assignment</label>
                <select value={uf.teamId||""} onChange={function(e){setUf(function(p){return Object.assign({},p,{teamId:e.target.value});});}} style={inputSt({marginBottom:12})}>
                  <option value="">— None —</option>
                  {(orgTeams||[]).map(function(t){ return <option key={t.id} value={t.id}>{t.name}</option>; })}
                </select>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={function(){setEditUser(null);resetUf();}} style={Object.assign({},ghostBtn(),{flex:1,padding:"8px",fontSize:12})}>Cancel</button>
                  <button onClick={saveUser} disabled={busy} style={Object.assign({},solidBtn(SESS_COLOR),{flex:2,padding:"8px",fontSize:12})}>{busy?"Saving…":"Save"}</button>
                </div>
              </div>
            )}

            <div style={{display:"flex",flexDirection:"column",gap:7}}>
              {(orgUsers||[]).map(function(u){
                var userTeamList = (u.teamIds||[]).map(function(tid){ return (orgTeams||[]).find(function(t){return t.id===tid;}); }).filter(Boolean);
                return (
                  <div key={u.id} style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.07)",borderRadius:10,padding:"11px 12px",display:"flex",alignItems:"center",gap:10}}>
                    <div style={{width:34,height:34,borderRadius:"50%",background:"#1565C0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:"#fff",flexShrink:0}}>
                      {u.displayName[0].toUpperCase()}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                        <span style={{fontSize:12,fontWeight:700,color:"#fff"}}>{u.displayName}</span>
                        <span style={{fontSize:9,padding:"1px 6px",borderRadius:99,background:u.role==="admin"?"rgba(168,255,62,.18)":"rgba(0,180,255,.1)",color:u.role==="admin"?SESS_COLOR:"#00B4FF",border:"1px solid "+(u.role==="admin"?"rgba(168,255,62,.3)":"rgba(0,180,255,.2)"),textTransform:"uppercase",letterSpacing:.5}}>{u.role}</span>
                        {userTeamList.map(function(t){
                          return <span key={t.id} style={{fontSize:9,padding:"1px 6px",borderRadius:99,background:"rgba(255,255,255,.07)",color:"rgba(255,255,255,.45)",border:"1px solid rgba(255,255,255,.12)"}}>{t.name}</span>;
                        })}
                      </div>
                      <div style={{fontSize:10,color:"rgba(255,255,255,.35)",marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.email}</div>
                    </div>
                    <div style={{display:"flex",gap:5,flexShrink:0}}>
                      <button onClick={function(){setUf({email:u.email,displayName:u.displayName,role:u.role,teamId:u.teamId||"",password:""});setEditUser(u);}}
                        style={{background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",borderRadius:7,padding:"4px 8px",cursor:"pointer",fontSize:10,color:"rgba(255,255,255,.5)",fontFamily:"inherit"}}>✏</button>
                      <button onClick={function(){resetPassword(u);}}
                        style={{background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",borderRadius:7,padding:"4px 8px",cursor:"pointer",fontSize:10,color:"rgba(255,255,255,.5)",fontFamily:"inherit"}}>🔑</button>
                      {u.id !== authUser.id && <button onClick={function(){deleteUserConfirm(u);}}
                        style={{background:"rgba(239,83,80,.07)",border:"1px solid rgba(239,83,80,.2)",borderRadius:7,padding:"4px 8px",cursor:"pointer",fontSize:10,color:"#EF5350",fontFamily:"inherit"}}>✕</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── TEAMS ── */}
        {sub==="teams" && (
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <SectionHdr style={{margin:0}}>Teams ({(orgTeams||[]).length})</SectionHdr>
              <button onClick={function(){resetTf();setEditTeam("new");}} style={Object.assign({},ghostSm(),{fontSize:11})}>+ New Team</button>
            </div>

            {editTeam && (
              <div style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.1)",borderRadius:12,padding:"14px",marginBottom:14}}>
                <div style={{fontSize:13,fontWeight:700,color:"#fff",marginBottom:12}}>{editTeam==="new"?"New Team":"Edit: "+editTeam.name}</div>
                <label style={labelSt()}>Team Name</label>
                <input value={tf.name} onChange={function(e){setTf(function(p){return Object.assign({},p,{name:e.target.value});});}} placeholder="e.g. West Coast" style={inputSt({marginBottom:10})}/>
                <label style={labelSt()}>Assigned Admins <span style={{color:"#EF5350",fontSize:9}}>required</span></label>
                <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
                  {admins.map(function(a){
                    var on = tf.adminIds.includes(a.id);
                    return <button key={a.id} onClick={function(){toggleAdminId(a.id);}}
                      style={{background:on?"rgba(168,255,62,.15)":"rgba(255,255,255,.05)",border:"1px solid "+(on?"rgba(168,255,62,.4)":"rgba(255,255,255,.1)"),borderRadius:8,padding:"5px 11px",cursor:"pointer",fontFamily:"inherit",fontSize:11,color:on?SESS_COLOR:"rgba(255,255,255,.4)",fontWeight:on?700:400}}>{a.displayName}</button>;
                  })}
                </div>
                {/* Members section */}
                <label style={labelSt()}>Members</label>
                {tf.memberIds.length > 0 && (
                  <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:8}}>
                    {tf.memberIds.map(function(uid){
                      var u = (orgUsers||[]).find(function(x){return x.id===uid;});
                      if (!u) return null;
                      return (
                        <span key={uid} style={{display:"inline-flex",alignItems:"center",gap:4,background:"rgba(0,180,255,.1)",border:"1px solid rgba(0,180,255,.25)",borderRadius:99,padding:"3px 8px",fontSize:10,color:"#00B4FF"}}>
                          {u.displayName}
                          <button onClick={function(){toggleMemberId(uid);}} style={{background:"none",border:"none",cursor:"pointer",color:"rgba(0,180,255,.6)",fontSize:11,padding:"0 0 0 2px",fontFamily:"inherit",lineHeight:1}}>×</button>
                        </span>
                      );
                    })}
                  </div>
                )}
                {(orgUsers||[]).filter(function(u){ return !tf.memberIds.includes(u.id); }).length > 0 && (
                  <div style={{display:"flex",gap:6,marginBottom:12}}>
                    <select value={addMemberSel} onChange={function(e){setAddMemberSel(e.target.value);}}
                      style={inputSt({margin:0,flex:1,fontSize:12,padding:"7px 10px"})}>
                      <option value="">— Add member —</option>
                      {(orgUsers||[]).filter(function(u){ return !tf.memberIds.includes(u.id); }).map(function(u){
                        return <option key={u.id} value={u.id}>{u.displayName} ({u.role})</option>;
                      })}
                    </select>
                    <button onClick={function(){
                      if (!addMemberSel) return;
                      toggleMemberId(addMemberSel);
                      setAddMemberSel("");
                    }} style={ghostSm({color:SESS_COLOR,borderColor:"rgba(168,255,62,.3)",fontSize:12,padding:"7px 12px"})}>+ Add</button>
                  </div>
                )}
                {tf.memberIds.length === 0 && (orgUsers||[]).filter(function(u){ return !tf.memberIds.includes(u.id); }).length === 0 && (
                  <div style={{fontSize:10,color:"rgba(255,255,255,.25)",marginBottom:12}}>No users available.</div>
                )}
                {tf.memberIds.length === 0 && (orgUsers||[]).filter(function(u){ return !tf.memberIds.includes(u.id); }).length > 0 && (
                  <div style={{fontSize:10,color:"rgba(255,255,255,.25)",marginBottom:12}}>No members assigned yet.</div>
                )}
                <div style={{display:"flex",gap:8}}>
                  <button onClick={function(){setEditTeam(null);resetTf();}} style={Object.assign({},ghostBtn(),{flex:1,padding:"8px",fontSize:12})}>Cancel</button>
                  <button onClick={saveTeam} disabled={busy} style={Object.assign({},solidBtn(SESS_COLOR),{flex:2,padding:"8px",fontSize:12})}>{busy?"Saving…":"Save"}</button>
                </div>
              </div>
            )}

            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {(orgTeams||[]).filter(function(t){ return editTeam === "new" || !editTeam || editTeam.id !== t.id; }).map(function(team){
                var memberCount = (team.memberIds||[]).length;
                var teamAdmins  = admins.filter(function(a){ return (team.adminIds||[]).includes(a.id); });
                return (
                  <div key={team.id} style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.07)",borderRadius:10,padding:"12px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                      <div style={{fontSize:13,fontWeight:700,color:"#fff"}}>{team.name}</div>
                      <div style={{display:"flex",gap:5}}>
                        <button onClick={function(){setTf({name:team.name,adminIds:team.adminIds||[],memberIds:team.memberIds||[]});setAddMemberSel("");setEditTeam(team);}}
                          style={{background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",borderRadius:7,padding:"4px 8px",cursor:"pointer",fontSize:10,color:"rgba(255,255,255,.5)",fontFamily:"inherit"}}>✏</button>
                        <button onClick={function(){deleteTeamConfirm(team);}}
                          style={{background:"rgba(239,83,80,.07)",border:"1px solid rgba(239,83,80,.2)",borderRadius:7,padding:"4px 8px",cursor:"pointer",fontSize:10,color:"#EF5350",fontFamily:"inherit"}}>✕</button>
                      </div>
                    </div>
                    <div style={{fontSize:10,color:"rgba(255,255,255,.35)"}}>{memberCount} member{memberCount!==1?"s":""}</div>
                    <div style={{display:"flex",gap:5,flexWrap:"wrap",marginTop:6}}>
                      {teamAdmins.map(function(a){
                        return <span key={a.id} style={{fontSize:9,padding:"2px 8px",borderRadius:99,background:"rgba(168,255,62,.1)",color:SESS_COLOR,border:"1px solid rgba(168,255,62,.25)"}}>{a.displayName}</span>;
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}


        <div style={{height:16}}/>
      </div>
    </div>
  );
}

// ─── TAB CONFIG ─────────────────────────────────────────────────────────────
// Fixed per-tab accent colors — each represents the tab's purpose, on-theme
var TAB_ACCENTS = {
  play:       "#A8FF3E",  // lime green — action, go, start
  sessions:   "#FFD54F",  // yellow     — review, history, analytics
  cards:      "#00B4FF",  // electric blue — building, structure
  objections: "#EF5350",  // red        — defense, conflict handling
  admin:      "#7C4DFF",  // indigo     — elevated access (only allowed purple)
};
var USER_TABS  = [
  { id:"play",       label:"Play",       icon:"▶️", accent: TAB_ACCENTS.play       },
  { id:"sessions",   label:"Sessions",   icon:"📋", accent: TAB_ACCENTS.sessions   },
  { id:"cards",      label:"Cards",      icon:"🃏",  accent: TAB_ACCENTS.cards      },
  { id:"objections", label:"Objections", icon:"🛡️", accent: TAB_ACCENTS.objections },
];
var ADMIN_TABS = [
  { id:"play",       label:"Play",       icon:"▶️",  accent: TAB_ACCENTS.play       },
  { id:"sessions",   label:"Sessions",   icon:"📋",  accent: TAB_ACCENTS.sessions   },
  { id:"cards",      label:"Cards",      icon:"🃏",  accent: TAB_ACCENTS.cards      },
  { id:"objections", label:"Objections", icon:"🛡️", accent: TAB_ACCENTS.objections },
  { id:"admin",      label:"Admin",      icon:"⚙️", accent: TAB_ACCENTS.admin      },
];

export default function App() {
  var [authUser,    setAuthUser]    = useState(null);
  var [authChecked, setAuthChecked] = useState(false);

  useEffect(function() {
    fetch("/api/auth/me", { credentials:"include" })
      .then(function(r){ return r.ok ? r.json() : Promise.reject(); })
      .then(function(u){ setAuthUser(u); setAuthChecked(true); })
      .catch(function(){ setAuthUser(false); setAuthChecked(true); });
  }, []);

  // Register 401 handler so api helpers can clear auth state
  useEffect(function() {
    setUnauthHandler(function(){ setAuthUser(false); });
    return function(){ setUnauthHandler(null); };
  }, []);

  // Refresh JWT on visibility change and every hour to prevent mid-session logout
  useEffect(function() {
    function doRefresh() {
      fetch("/api/auth/refresh", { method:"POST", credentials:"include" })
        .then(function(r) { if (r.status === 401) setAuthUser(false); })
        .catch(function() {});
    }
    var interval = setInterval(doRefresh, 60 * 60 * 1000); // every hour
    function onVisible() { if (document.visibilityState === "visible") doRefresh(); }
    document.addEventListener("visibilitychange", onVisible);
    return function() { clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  if (!authChecked) return (
    <div style={{width:"100%",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#060d1a",flexDirection:"column",gap:16,fontFamily:"inherit"}}>
      <div style={{width:48,height:48,borderRadius:14,background:"#1565C0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,fontWeight:900,color:"#fff"}}>O</div>
      <div style={{color:"rgba(255,255,255,.5)",fontSize:13,letterSpacing:1}}>Loading OverCard…</div>
    </div>
  );
  if (!authUser) return <LoginScreen onLogin={function(u){ setAuthUser(u); }}/>;
  return <MainApp authUser={authUser} onLogout={function(){ setAuthUser(false); }}/>;
}

// ─── APP ────────────────────────────────────────────────────────────────────
function MainApp({ authUser, onLogout }) {
  var TABS        = authUser.role === "admin" ? ADMIN_TABS : USER_TABS;
  var [decks,     setDecks]    = useState([]);
  var [activeId,  setActiveId] = useState("d1");
  var [tab,       setTab]      = useState("play");
  var [showDS,    setShowDS]   = useState(false);
  var [saveStatus, setSaveStatus] = useState("idle"); // "idle"|"saving"|"saved"|"error"
  var [serverOk,  setServerOk] = useState(true);
  // Portal: when a session finishes, this holds the session ID to open in Sessions tab
  var [pendingReview, setPendingReview] = useState(null);
  // Track whether we're in an active session to lock tab switching
  var [sessionActive, setSessionActive] = useState(false);
  // Play tab state lifted here so it persists across tab switches
  var [playView,       setPlayView]       = useState("home");
  var [activeSession,  setActiveSession]  = useState(null);
  var [sessionEvents,  setSessionEvents]  = useState([]);
  // Admin scope for SessionsTab
  var [viewScope,   setViewScope]   = useState("self");
  // Admin org data
  var [orgUsers,    setOrgUsers]    = useState([]);
  var [orgTeams,    setOrgTeams]    = useState([]);
  // Profile sheet visibility
  var [showProfile, setShowProfile] = useState(false);
  // Dirty deck tracking for per-deck autosave
  var dirtyIds = useRef(new Set());

  // ── Load on mount ────────────────────────────────────────────────────────────
  useEffect(function() {
    apiGet("/decks")
      .then(function(data) {
        if (Array.isArray(data) && data.length > 0) {
          setDecks(data);
          var lastId = localStorage.getItem("redcard_activeId");
          if (lastId && data.find(function(d) { return d.id===lastId; })) setActiveId(lastId);
          else setActiveId(data[0].id);
        }
        setSaveStatus("saved"); setServerOk(true);
      })
      .catch(function() { setServerOk(false); setSaveStatus("error"); });
    if (authUser.role === "admin") {
      refreshOrgUsers();
      refreshOrgTeams();
    }
  }, []);

  function refreshOrgUsers() {
    apiGet("/admin/users").then(function(u){ setOrgUsers(u); }).catch(function(){});
  }
  function refreshOrgTeams() {
    apiGet("/admin/teams").then(function(t){ setOrgTeams(t); }).catch(function(){});
  }

  // ── Autosave decks with debounce (per-deck dirty tracking) ───────────────────
  var saveTimer = useRef(null);
  function markDirty(deckId) { dirtyIds.current.add(deckId); }
  useEffect(function() {
    if (decks.length === 0) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(function() {
      var dirty = Array.from(dirtyIds.current);
      if (dirty.length === 0) return;
      dirtyIds.current.clear();
      setSaveStatus("saving");
      var toSave = decks.filter(function(d){ return dirty.indexOf(d.id) !== -1; });
      Promise.all(toSave.map(function(d){ return apiPut("/decks/" + d.id, d); }))
        .then(function() { setSaveStatus("saved"); setServerOk(true); localStorage.setItem("redcard_activeId", activeId); })
        .catch(function() { setSaveStatus("error"); setServerOk(false); });
    }, SAVE_DELAY);
    return function() { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [decks, activeId]);

  var deck = decks.find(function(d) { return d.id===activeId; }) || decks[0];

  // ── Deck mutation helpers ─────────────────────────────────────────────────────
  function upsertCard(deckId, card) {
    markDirty(deckId);
    setDecks(function(ds) {
      return ds.map(function(d) {
        if (d.id !== deckId) return d;
        var nc = Object.assign({}, d.cards, {[card.id]: card});
        return Object.assign({}, d, { cards:nc, rootCard: d.rootCard||card.id });
      });
    });
  }
  function deleteCard(deckId, cardId) {
    markDirty(deckId);
    setDecks(function(ds) {
      return ds.map(function(d) {
        if (d.id !== deckId) return d;
        var nc = Object.assign({}, d.cards);
        delete nc[cardId];
        Object.values(nc).forEach(function(c) {
          c.answers = c.answers.map(function(a) { return a.next===cardId ? Object.assign({},a,{next:null}) : a; });
        });
        var nr = d.rootCard===cardId ? (Object.keys(nc)[0]||null) : d.rootCard;
        return Object.assign({}, d, { cards:nc, rootCard:nr });
      });
    });
  }
  function updateDeck(deckId, fn) {
    markDirty(deckId);
    setDecks(function(ds) { return ds.map(function(d) { return d.id===deckId ? fn(d) : d; }); });
  }
  function addDeck(newDeckData) {
    apiPost("/decks", newDeckData)
      .then(function(d) {
        setDecks(function(ds){ return ds.concat([d]); });
        setActiveId(d.id);
        setTab("play");
      })
      .catch(function(err){ console.error("Failed to create deck:", err); });
  }
  function switchDeck(id) {
    setActiveId(id);
    setSessionActive(false);
    setPendingReview(null);
    // Reset play state when deck changes (mirrors existing PlayTab useEffect logic)
    setPlayView("home");
    setActiveSession(null);
    setSessionEvents([]);
  }
  function editDeckMeta(deckId, attrs) {
    markDirty(deckId);
    setDecks(function(ds) {
      return ds.map(function(d) {
        return d.id === deckId ? Object.assign({}, d, { name:attrs.name, color:attrs.color, icon:attrs.icon, visibility:attrs.visibility||d.visibility }) : d;
      });
    });
  }

  // ── Portal from Play → Sessions ──────────────────────────────────────────────
  function handlePortalToReview(sessionId) {
    setSessionActive(false);
    if (sessionId) {
      setPendingReview(sessionId);
      setTab("sessions");
    }
  }

  // ── Tab switching ─────────────────────────────────────────────────────────────
  function handleTabClick(tabId) {
    if (tabId !== "sessions") setPendingReview(null); // clear portal on manual nav
    setTab(tabId);
  }

  // ── Tooltip context ───────────────────────────────────────────────────────────
  var [activeTip, setActiveTip] = useState(null);
  var tipCtxVal = { activeTip, setActiveTip };
  function handleAppClick() { setActiveTip(null); }

  // ── Loading / error states ────────────────────────────────────────────────────
  var saveLabel = saveStatus==="saving" ? "Saving…" : saveStatus==="error" ? "⚠ Save failed" : "Saved";
  var saveColor = saveStatus==="saving" ? "rgba(255,255,255,.2)" : saveStatus==="error" ? "#EF5350" : "rgba(102,187,106,.6)";

  if (saveStatus === "idle") {
    return (
      <div style={{width:"100%",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#060d1a",flexDirection:"column",gap:16,fontFamily:"inherit"}}>
        <div style={{width:48,height:48,borderRadius:14,background:"#1565C0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,fontWeight:900,color:"#fff"}}>O</div>
        <div style={{color:"rgba(255,255,255,.5)",fontSize:13,letterSpacing:1}}>Loading…</div>
      </div>
    );
  }
  if (!deck) {
    return (
      <div style={{width:"100%",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#060d1a",flexDirection:"column",gap:16,fontFamily:"inherit",padding:32}}>
        <div style={{fontSize:48}}>⚠️</div>
        <div style={{color:"rgba(255,255,255,.5)",fontSize:13,textAlign:"center",lineHeight:1.7}}>
          Could not connect to the API server.<br/>Make sure it's running:<br/><br/>
          <code style={{color:"#F5A623",fontSize:11}}>npm start</code>
        </div>
      </div>
    );
  }

  var tabAccent = TAB_ACCENTS[tab] || TAB_ACCENTS.play;

  return (
    <TipCtx.Provider value={tipCtxVal}>
      <GlobalInflTooltip/>
      <div onClick={handleAppClick}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Lora:ital,wght@0,400;0,700;1,400&display=swap');
          *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
          html,body,#root{height:100%;width:100%;}
          body{background:#060d1a;font-family:'Inter',sans-serif;color:#fff;overscroll-behavior:none;}
          @keyframes cardIn    {from{opacity:0;transform:translateX(28px) scale(.97)}to{opacity:1;transform:none}}
          @keyframes cardBack  {from{opacity:0;transform:translateX(-28px) scale(.97)}to{opacity:1;transform:none}}
          @keyframes answersIn {from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
          @keyframes answerItem{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
          @keyframes sheetUp   {from{transform:translateY(100%)}to{transform:none}}
          @keyframes fadeIn    {from{opacity:0}to{opacity:1}}
          @keyframes savePulse {0%{opacity:1}50%{opacity:.3}100%{opacity:1}}
          input,textarea,select{-webkit-appearance:none;}
          input::placeholder,textarea::placeholder{color:rgba(255,255,255,.22);}
          input:focus,textarea:focus{border-color:rgba(255,255,255,.3)!important;outline:none;}
          ::-webkit-scrollbar{width:2px;height:2px;}
          ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:99px;}
        `}</style>

        <div style={{width:"100%",maxWidth:430,margin:"0 auto",height:"100dvh",display:"flex",flexDirection:"column",background:"linear-gradient(180deg, #060d1a 0%, #071025 50%, #060d1a 100%)",boxShadow:"0 0 0 1px rgba(255,255,255,.04)"}}>

          {/* Server offline banner */}
          {!serverOk && (
            <div style={{background:"rgba(239,83,80,.14)",borderBottom:"1px solid rgba(239,83,80,.28)",padding:"5px 16px",fontSize:10,color:"#EF5350",textAlign:"center",flexShrink:0}}>
              ⚠ API server unreachable — changes won't be saved to disk
            </div>
          )}

          {/* Top bar — Deck switcher on left, user avatar on right */}
          <div style={{padding:"10px 14px",flexShrink:0,borderBottom:"1px solid rgba(255,255,255,.06)",background:"rgba(8,25,55,.4)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            {/* Deck switcher button */}
            <button onClick={function(){setShowDS(true);}}
              style={{display:"flex",alignItems:"center",gap:9,background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",borderRadius:13,padding:"7px 12px",cursor:"pointer",fontFamily:"inherit",transition:"background .12s"}}>
              <div style={{width:28,height:28,borderRadius:9,background:deck.color+"22",border:"1.5px solid "+deck.color+"44",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15}}>{deck.icon}</div>
              <div style={{textAlign:"left"}}>
                <div style={{fontSize:13,fontWeight:700,color:"#fff",lineHeight:1}}>{deck.name}</div>
                <div style={{fontSize:9,color:"rgba(255,255,255,.28)",marginTop:1}}>{decks.length} deck{decks.length!==1?"s":""} · tap to switch</div>
              </div>
              <span style={{fontSize:10,color:"rgba(255,255,255,.28)",marginLeft:2}}>⌄</span>
            </button>

            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <button onClick={function(){ setShowProfile(true); }}
                style={{width:34,height:34,borderRadius:"50%",background:authUser.role==="admin"?"rgba(168,255,62,.12)":"rgba(255,255,255,.06)",border:"1px solid "+(authUser.role==="admin"?"rgba(168,255,62,.3)":"rgba(255,255,255,.12)"),display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,cursor:"pointer",color:authUser.role==="admin"?SESS_COLOR:"rgba(255,255,255,.82)",fontFamily:"inherit",fontWeight:700}}
                title="Profile">
                {authUser.displayName ? authUser.displayName[0].toUpperCase() : "?"}
              </button>
            </div>
          </div>

          {/* Content area */}
          <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
            <div style={{flex:1,display:tab==="play"?"flex":"none",flexDirection:"column",overflow:"hidden"}}>
              <PlayTab
                deck={deck}
                activeId={activeId}
                onPortalToReview={handlePortalToReview}
                onSwitchDeck={switchDeck}
                playView={playView}
                setPlayView={setPlayView}
                activeSession={activeSession}
                setActiveSession={setActiveSession}
                sessionEvents={sessionEvents}
                setSessionEvents={setSessionEvents}
              />
            </div>
            {tab==="sessions" && (
              <SessionsTab
                key={deck.id+"-sessions"}
                deckId={deck.id}
                deckName={deck.name}
                deckColor={deck.color}
                deckRootCard={deck.rootCard}
                onInitialReview={pendingReview}
                viewScope={viewScope}
                setViewScope={setViewScope}
                authUser={authUser}
                orgUsers={orgUsers}
                orgTeams={orgTeams}
              />
            )}
            {tab==="cards" && (
              <CardsTab
                key={deck.id+"-cards"}
                deck={deck}
                onUpsert={upsertCard}
                onDelete={deleteCard}
                onUpdateDeck={updateDeck}
                readOnly={authUser.role !== "admin"}
              />
            )}
            {tab==="objections" && (
              <ObjectionsTab
                key={deck.id+"-obj"}
                deck={deck}
                onUpdateDeck={updateDeck}
                readOnly={authUser.role !== "admin"}
              />
            )}
            {tab==="admin" && authUser.role === "admin" && (
              <AdminPanel
                authUser={authUser}
                orgUsers={orgUsers}
                orgTeams={orgTeams}
                onRefreshUsers={refreshOrgUsers}
                onRefreshTeams={refreshOrgTeams}
              />
            )}
          </div>

          {/* Tab bar */}
          <div style={{flexShrink:0,borderTop:"1px solid rgba(255,255,255,.07)",background:"rgba(4,10,28,.98)",backdropFilter:"blur(20px)",padding:"8px 4px",paddingBottom:"calc(8px + env(safe-area-inset-bottom,0px))",display:"flex",justifyContent:"space-around"}}>
            {TABS.map(function(t) {
              var active = tab===t.id;
              var accent = t.accent;
              return (
                <button key={t.id} onClick={function(){handleTabClick(t.id);}}
                  style={{background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,padding:"4px 10px",borderRadius:12,fontFamily:"inherit"}}>
                  <div style={{width:34,height:34,borderRadius:10,background:active?accent+"22":"transparent",border:"1.5px solid "+(active?accent+"66":"transparent"),display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,transition:"all .18s"}}>{t.icon}</div>
                  <span style={{fontSize:8,fontWeight:700,letterSpacing:.5,textTransform:"uppercase",color:active?accent:"rgba(255,255,255,.22)"}}>{t.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {showDS && (
          <DeckSwitcherSheet
            decks={decks}
            activeDeckId={activeId}
            onSelect={switchDeck}
            onAddDeck={addDeck}
            onClose={function(){setShowDS(false);}}
            isAdmin={authUser.role === "admin"}
            onEditDeck={editDeckMeta}
          />
        )}
        {showProfile && (
          <ProfileSheet
            authUser={authUser}
            teamName={authUser.teamName || null}
            onLogout={function(){
              apiPost("/auth/logout", {}).catch(function(){});
              onLogout();
            }}
            onClose={function(){ setShowProfile(false); }}
          />
        )}
      </div>
    </TipCtx.Provider>
  );
}
