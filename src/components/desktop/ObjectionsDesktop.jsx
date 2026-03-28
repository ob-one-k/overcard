import { useState, useRef, useEffect } from "react";
import { OBJ_COLOR, OBJ_ICONS, osid } from "../../lib/constants";
import { solidBtn, ghostBtn, ghostSm, iconBtn, inputSt, labelSt, resizeHandle } from "../../lib/styles";
import { ObjStackEditor } from "../Cards";

// ─── OBJECTIONS DESKTOP ───────────────────────────────────────────────────────
// Two-pane: left (resizable, default 340px) stack list + right flex:1 ObjStackEditor inline.
// Drag handle between panes; pane width persisted to localStorage.
export function ObjectionsDesktop({ deck, onUpdateDeck, readOnly }) {
  var [selectedId, setSelectedId] = useState(null);
  var [showNew,    setShowNew]    = useState(false);
  var [nf,         setNf]         = useState({ label:"", icon:"😐" });

  // ── Resizable left pane ──────────────────────────────────────────────────────
  var [leftW, setLeftW] = useState(function() {
    var stored = parseInt(localStorage.getItem("overcard_objections_leftW"), 10);
    return (stored >= 200 && stored <= 500) ? stored : 340;
  });
  var dragging    = useRef(false);
  var dragStartX  = useRef(0);
  var dragStartW  = useRef(340);
  var leftWRef    = useRef(leftW);
  var [isDragging, setIsDragging] = useState(false);

  function updateLeftW(w) { leftWRef.current = w; setLeftW(w); }

  useEffect(function() {
    function onMove(e) {
      if (!dragging.current) return;
      var delta = e.clientX - dragStartX.current;
      var newW = Math.max(200, Math.min(500, dragStartW.current + delta));
      updateLeftW(newW);
    }
    function onUp() {
      if (!dragging.current) return;
      dragging.current = false;
      setIsDragging(false);
      localStorage.setItem("overcard_objections_leftW", String(leftWRef.current));
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return function() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, []);

  function startDrag(e) {
    dragging.current = true;
    dragStartX.current = e.clientX;
    dragStartW.current = leftWRef.current;
    setIsDragging(true);
    e.preventDefault();
  }

  // ── Stack operations ─────────────────────────────────────────────────────────
  var selectedStack = selectedId ? deck.objStacks.find(function(s){ return s.id === selectedId; }) : null;

  function saveStack(s) {
    onUpdateDeck(deck.id, function(d) { return Object.assign({},d,{objStacks:d.objStacks.map(function(x){return x.id===s.id?s:x;})}); });
  }
  function deleteStack(id) {
    onUpdateDeck(deck.id, function(d) { return Object.assign({},d,{objStacks:d.objStacks.filter(function(s){return s.id!==id;})}); });
    setSelectedId(null);
  }
  function createStack() {
    if (!nf.label.trim()) return;
    var s = { id:osid(), label:nf.label, icon:nf.icon, rootCard:null, cards:{} };
    onUpdateDeck(deck.id, function(d) { return Object.assign({},d,{objStacks:d.objStacks.concat([s])}); });
    setShowNew(false); setNf({label:"",icon:"😐"});
    setSelectedId(s.id);
  }

  return (
    <div style={{display:"flex",height:"100%",overflow:"hidden",userSelect:isDragging?"none":"auto"}}>

      {/* ── Left pane: stack list ── */}
      <div style={{width:leftW,minWidth:leftW,display:"flex",flexDirection:"column",overflow:"hidden",flexShrink:0}}>
        {/* Toolbar */}
        <div style={{padding:"10px 14px 10px",borderBottom:"1px solid rgba(255,255,255,.06)",flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{fontSize:11,fontWeight:700,color:"rgba(239,83,80,.7)",letterSpacing:.5,textTransform:"uppercase"}}>{deck.objStacks.length} Stack{deck.objStacks.length!==1?"s":""}</span>
            <div style={{flex:1}}/>
            {!readOnly && (
              <button onClick={function(){setShowNew(function(p){return !p;}); if (showNew) setNf({label:"",icon:"😐"});}} style={ghostSm({color:OBJ_COLOR,borderColor:"rgba(239,83,80,.3)"})}>{showNew?"Cancel":"+ New"}</button>
            )}
          </div>
          {showNew && !readOnly && (
            <div style={{marginTop:10,background:"rgba(239,83,80,.06)",border:"1px solid rgba(239,83,80,.18)",borderRadius:12,padding:"12px"}}>
              <label style={labelSt()}>Stack Name</label>
              <input value={nf.label} onChange={function(e){setNf(function(p){return Object.assign({},p,{label:e.target.value});});}}
                placeholder="e.g. Price Objection" style={inputSt({marginBottom:10})} autoFocus/>
              <label style={labelSt()}>Icon</label>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
                {OBJ_ICONS.map(function(ic){
                  return <button key={ic} onClick={function(){setNf(function(p){return Object.assign({},p,{icon:ic});});}}
                    style={{background:nf.icon===ic?"rgba(255,255,255,.15)":"rgba(255,255,255,.05)",border:"1.5px solid "+(nf.icon===ic?"rgba(255,255,255,.4)":"rgba(255,255,255,.08)"),borderRadius:8,width:34,height:34,cursor:"pointer",fontSize:16}}>{ic}</button>;
                })}
              </div>
              <button onClick={createStack} style={Object.assign({},solidBtn(OBJ_COLOR),{width:"100%"})}>Create Stack</button>
            </div>
          )}
        </div>

        {/* Stack list */}
        <div style={{flex:1,overflowY:"auto",padding:"8px 10px"}}>
          {deck.objStacks.length === 0 && (
            <div style={{textAlign:"center",color:"rgba(255,255,255,.25)",padding:"40px 16px",fontSize:13,lineHeight:1.7}}>No stacks yet.{!readOnly && <><br/>Create one to handle objections.</>}</div>
          )}
          {deck.objStacks.map(function(stack) {
            var sel = stack.id === selectedId;
            var cardCount = Object.keys(stack.cards).length;
            var hasEntry  = !!stack.rootCard;
            var healthDot = (cardCount > 0 && hasEntry) ? "#66BB6A"
                          : cardCount > 0              ? "#FFD54F"
                          : "#EF5350";
            return (
              <button key={stack.id} onClick={function(){setSelectedId(stack.id);}}
                style={{display:"flex",alignItems:"center",gap:10,width:"100%",textAlign:"left",
                  background:sel?"rgba(239,83,80,.12)":"rgba(239,83,80,.04)",
                  border:"1.5px solid "+(sel?"rgba(239,83,80,.45)":"rgba(239,83,80,.14)"),
                  borderLeft:"3px solid "+(sel?OBJ_COLOR:"rgba(239,83,80,.3)"),
                  borderRadius:10,padding:"10px 12px",marginBottom:6,cursor:"pointer",fontFamily:"inherit"}}>
                {/* Health dot */}
                <div style={{width:7,height:7,borderRadius:"50%",background:healthDot,flexShrink:0,boxShadow:"0 0 4px "+healthDot+"88"}}/>
                <div style={{width:36,height:36,borderRadius:10,background:"rgba(239,83,80,.15)",border:"1px solid rgba(239,83,80,.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:19,flexShrink:0}}>{stack.icon}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{stack.label}</div>
                  <div style={{fontSize:9,color:"rgba(255,255,255,.3)",marginTop:2}}>
                    {cardCount} card{cardCount!==1?"s":""}
                    {" · "}
                    <span style={{color:hasEntry?"rgba(102,187,106,.7)":cardCount>0?"rgba(255,213,79,.6)":"rgba(239,83,80,.5)"}}>
                      {hasEntry ? "✓ entry set" : "⚠ no entry"}
                    </span>
                  </div>
                </div>
                <span style={{color:"rgba(239,83,80,.4)",fontSize:16,flexShrink:0}}>›</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Drag handle ── */}
      <div
        onMouseDown={startDrag}
        style={Object.assign({},resizeHandle(),{
          background:isDragging?"rgba(255,255,255,.1)":"transparent"
        })}
      />

      {/* ── Right pane: inline ObjStackEditor ── */}
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0}}>
        {selectedStack ? (
          <ObjStackEditor
            key={selectedStack.id}
            inline={true}
            stack={selectedStack}
            deckCards={deck.cards}
            onSave={function(s){saveStack(s);}}
            onDelete={deleteStack}
            onClose={function(){setSelectedId(null);}}
          />
        ) : (
          <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,color:"rgba(255,255,255,.18)"}}>
            <span style={{fontSize:40}}>🛡️</span>
            <span style={{fontSize:13}}>Select a stack to edit</span>
            {!readOnly && deck.objStacks.length === 0 && (
              <span style={{fontSize:11,color:"rgba(255,255,255,.15)"}}>Use the + New button to create one</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
