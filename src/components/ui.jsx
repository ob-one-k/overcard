import { useState, useEffect, useRef } from "react";
import { TM, SESS_COLOR } from "../lib/constants";
import { inputSt } from "../lib/styles";

// ─── TINY COMPONENTS ──────────────────────────────────────────────────────────
export function TypeBadge({ type, small }) {
  var m = TM[type] || TM.pitch, s = small;
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:s?3:4, background:m.color+"22", border:"1px solid "+m.color+"44", color:m.color, borderRadius:99, fontSize:s?9:11, fontWeight:700, letterSpacing:.7, padding:s?"2px 7px":"3px 10px", textTransform:"uppercase", flexShrink:0 }}>
      <span style={{fontSize:s?9:11}}>{m.icon}</span>{m.label}
    </span>
  );
}
export function Handle() {
  return <div style={{display:"flex",justifyContent:"center",padding:"12px 0 4px"}}><div style={{width:38,height:4,borderRadius:99,background:"rgba(255,255,255,.15)"}}/></div>;
}
export function IntendedBadge() {
  return <span style={{display:"inline-flex",alignItems:"center",gap:3,background:"rgba(102,187,106,.15)",border:"1px solid rgba(102,187,106,.3)",color:"#66BB6A",borderRadius:99,fontSize:9,fontWeight:700,padding:"2px 7px",letterSpacing:.5,textTransform:"uppercase",flexShrink:0}}>★ intended</span>;
}
export function SectionHdr({ children, style }) {
  return <div style={Object.assign({fontSize:10,fontWeight:700,color:"rgba(255,255,255,.3)",letterSpacing:1.5,textTransform:"uppercase",marginBottom:8},style)}>{children}</div>;
}
export function StatBox({ value, label, color }) {
  return (
    <div style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.08)",borderRadius:12,padding:"12px 14px"}}>
      <div style={{fontSize:22,fontWeight:700,color:color||"rgba(255,255,255,.7)",marginBottom:3,lineHeight:1}}>{value}</div>
      <div style={{fontSize:9,color:"rgba(255,255,255,.3)",textTransform:"uppercase",letterSpacing:.7}}>{label}</div>
    </div>
  );
}
export function BarRow({ label, value, denom, color }) {
  var pct = denom > 0 ? Math.round(value / denom * 100) : 0;
  return (
    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:7}}>
      <div style={{fontSize:11,color:"rgba(255,255,255,.55)",minWidth:110}}>{label}</div>
      <div style={{flex:1}}><div style={{height:4,background:"rgba(255,255,255,.07)",borderRadius:99,overflow:"hidden"}}><div style={{height:"100%",background:color,borderRadius:99,width:pct+"%",transition:"width .4s"}}/></div></div>
      <div style={{fontSize:12,fontWeight:700,color:color,minWidth:36,textAlign:"right"}}>{pct}%</div>
    </div>
  );
}

var DP_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
var DP_DAYS   = ["Su","Mo","Tu","We","Th","Fr","Sa"];
export function DarkDatePicker({ value, onChange, style }) {
  var parsed  = value ? new Date(value + "T00:00:00") : null;
  var todayD  = new Date();
  var [open, setOpen]         = useState(false);
  var [viewYear, setViewYear] = useState(function(){ return parsed ? parsed.getFullYear() : todayD.getFullYear(); });
  var [viewMonth, setViewMonth] = useState(function(){ return parsed ? parsed.getMonth() : todayD.getMonth(); });
  var [panelPos, setPanelPos] = useState(null);
  var triggerRef = useRef(null);
  var panelRef   = useRef(null);

  useEffect(function() {
    if (value) { var d = new Date(value+"T00:00:00"); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); }
  }, [value]);

  useEffect(function() {
    if (!open) return;
    function onDown(e) {
      if (triggerRef.current && !triggerRef.current.contains(e.target) && panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return function(){ document.removeEventListener("mousedown", onDown); };
  }, [open]);

  function handleOpen() {
    if (!open && triggerRef.current) {
      var r = triggerRef.current.getBoundingClientRect();
      setPanelPos({ top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 252) });
    }
    setOpen(function(v){ return !v; });
  }

  function buildDays() {
    var first = new Date(viewYear, viewMonth, 1);
    var last  = new Date(viewYear, viewMonth + 1, 0);
    var days  = [];
    for (var i = first.getDay() - 1; i >= 0; i--) days.push({ date: new Date(viewYear, viewMonth, -i), cur: false });
    for (var d = 1; d <= last.getDate(); d++) days.push({ date: new Date(viewYear, viewMonth, d), cur: true });
    while (days.length < 42) days.push({ date: new Date(viewYear, viewMonth + 1, days.length - last.getDate() - first.getDay() + 1), cur: false });
    return days;
  }

  function toISO(d) {
    return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
  }
  function sameDay(a, b) { return a && b && a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
  function prevMo() { if (viewMonth===0){setViewMonth(11);setViewYear(function(y){return y-1;});}else setViewMonth(function(m){return m-1;}); }
  function nextMo() { if (viewMonth===11){setViewMonth(0);setViewYear(function(y){return y+1;});}else setViewMonth(function(m){return m+1;}); }

  var displayVal = parsed ? (DP_MONTHS[parsed.getMonth()]+" "+parsed.getDate()+", "+parsed.getFullYear()) : "";

  return (
    <div ref={triggerRef} style={{position:"relative"}}>
      <div onClick={handleOpen} style={Object.assign({},inputSt(style),{cursor:"pointer",userSelect:"none",display:"flex",alignItems:"center",justifyContent:"space-between",color:value?"rgba(255,255,255,.85)":"rgba(255,255,255,.25)"})}>
        <span>{displayVal || "Pick a date"}</span>
        <span style={{fontSize:11,opacity:.4,lineHeight:1}}>▾</span>
      </div>
      {open && panelPos && (
        <div ref={panelRef} style={{position:"fixed",top:panelPos.top,left:panelPos.left,zIndex:600,background:"#081428",border:"1px solid rgba(255,255,255,.14)",borderRadius:14,boxShadow:"0 16px 48px rgba(0,0,0,.75)",padding:"12px",width:240,userSelect:"none"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
            <button onClick={prevMo} style={{background:"rgba(255,255,255,.06)",border:"none",color:"rgba(255,255,255,.6)",cursor:"pointer",fontSize:15,padding:"3px 9px",borderRadius:7,fontFamily:"inherit",lineHeight:1}}>‹</button>
            <span style={{fontSize:13,fontWeight:700,color:"#fff"}}>{DP_MONTHS[viewMonth]} {viewYear}</span>
            <button onClick={nextMo} style={{background:"rgba(255,255,255,.06)",border:"none",color:"rgba(255,255,255,.6)",cursor:"pointer",fontSize:15,padding:"3px 9px",borderRadius:7,fontFamily:"inherit",lineHeight:1}}>›</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",marginBottom:4}}>
            {DP_DAYS.map(function(d){ return <div key={d} style={{textAlign:"center",fontSize:9,fontWeight:700,color:"rgba(255,255,255,.3)",padding:"2px 0",letterSpacing:.5}}>{d}</div>; })}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
            {buildDays().map(function(item, i) {
              var isSel   = sameDay(item.date, parsed);
              var isToday = sameDay(item.date, todayD);
              return (
                <div key={i} onClick={function(){ onChange({target:{value:toISO(item.date)}}); setOpen(false); }}
                  style={{textAlign:"center",fontSize:11,padding:"5px 2px",borderRadius:6,cursor:"pointer",
                    background: isSel ? "#A8FF3E" : "transparent",
                    color: isSel ? "#0a1a00" : item.cur ? "rgba(255,255,255,.78)" : "rgba(255,255,255,.2)",
                    fontWeight: isSel || isToday ? 700 : 400,
                    outline: isToday && !isSel ? "1px solid rgba(168,255,62,.45)" : "none",
                  }}>{item.date.getDate()}</div>
              );
            })}
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginTop:10,borderTop:"1px solid rgba(255,255,255,.07)",paddingTop:8}}>
            <button onClick={function(){ onChange({target:{value:""}}); setOpen(false); }} style={{background:"none",border:"none",color:"rgba(255,255,255,.35)",fontSize:11,cursor:"pointer",fontFamily:"inherit",padding:"2px 4px"}}>Clear</button>
            <button onClick={function(){ onChange({target:{value:toISO(todayD)}}); setOpen(false); }} style={{background:"none",border:"none",color:"#A8FF3E",fontSize:11,cursor:"pointer",fontFamily:"inherit",padding:"2px 4px",fontWeight:700}}>Today</button>
          </div>
        </div>
      )}
    </div>
  );
}
