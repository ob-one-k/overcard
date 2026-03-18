import { useState, useEffect, useRef, createContext, useContext } from "react";
import { TM, INFLECTIONS, INFL_MAP, INFL_CATS } from "../lib/constants";
import { parseRichText } from "../lib/richtext";
import { inputSt } from "../lib/styles";

// ─── GLOBAL INFLECTION TOOLTIP CONTEXT ───────────────────────────────────────
// Single tooltip rendered at App root — outside all animated/transformed ancestors.
// CSS animations create stacking contexts that trap position:fixed children.
// Hoisting to root ensures tooltips always render relative to the viewport.
export var TipCtx = createContext({ activeTip:null, setActiveTip:function(){} });

export function GlobalInflTooltip() {
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

export function InflWord({ seg, accent }) {
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

export function RichPromptDisplay({ text, accentColor }) {
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
export function OverviewDisplay({ bullets, color }) {
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
export function OverviewEditor({ bullets, onChange, accent }) {
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
