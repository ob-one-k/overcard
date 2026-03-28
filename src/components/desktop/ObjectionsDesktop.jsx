import { useState } from "react";
import { OBJ_COLOR, OBJ_ICONS, osid } from "../../lib/constants";
import { solidBtn, ghostBtn, ghostSm, iconBtn, inputSt, labelSt } from "../../lib/styles";
import { ObjStackEditor } from "../Cards";

// ─── OBJECTIONS DESKTOP ───────────────────────────────────────────────────────
// Two-pane: left ~340px stack list + right flex:1 ObjStackEditor inline.
export function ObjectionsDesktop({ deck, onUpdateDeck, readOnly }) {
  var [selectedId, setSelectedId] = useState(null);
  var [showNew,    setShowNew]    = useState(false);
  var [nf,         setNf]         = useState({ label:"", icon:"😐" });

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
    <div style={{display:"flex",height:"100%",overflow:"hidden"}}>

      {/* ── Left pane: stack list ── */}
      <div style={{width:340,minWidth:340,display:"flex",flexDirection:"column",borderRight:"1px solid rgba(255,255,255,.06)",overflow:"hidden"}}>
        {/* Toolbar */}
        <div style={{padding:"10px 14px 10px",borderBottom:"1px solid rgba(255,255,255,.06)",flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{fontSize:11,fontWeight:700,color:"rgba(239,83,80,.7)",letterSpacing:.5,textTransform:"uppercase"}}>{deck.objStacks.length} Stack{deck.objStacks.length!==1?"s":""}</span>
            <div style={{flex:1}}/>
            {!readOnly && (
              <button onClick={function(){setShowNew(function(p){return !p;});}} style={ghostSm({color:OBJ_COLOR,borderColor:"rgba(239,83,80,.3)"})}>{showNew?"Cancel":"+ New"}</button>
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
            return (
              <button key={stack.id} onClick={function(){setSelectedId(stack.id);}}
                style={{display:"flex",alignItems:"center",gap:12,width:"100%",textAlign:"left",
                  background:sel?"rgba(239,83,80,.12)":"rgba(239,83,80,.04)",
                  border:"1.5px solid "+(sel?"rgba(239,83,80,.45)":"rgba(239,83,80,.14)"),
                  borderLeft:"3px solid "+(sel?OBJ_COLOR:"rgba(239,83,80,.3)"),
                  borderRadius:10,padding:"11px 12px",marginBottom:6,cursor:"pointer",fontFamily:"inherit"}}>
                <div style={{width:38,height:38,borderRadius:11,background:"rgba(239,83,80,.15)",border:"1px solid rgba(239,83,80,.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>{stack.icon}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{stack.label}</div>
                  <div style={{fontSize:10,color:"rgba(255,255,255,.3)",marginTop:2}}>{Object.keys(stack.cards).length} cards · {stack.rootCard?"entry set":"no entry"}</div>
                </div>
                <span style={{color:"rgba(239,83,80,.4)",fontSize:16,flexShrink:0}}>›</span>
              </button>
            );
          })}
        </div>
      </div>

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
