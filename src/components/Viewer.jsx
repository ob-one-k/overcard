import { useState, useEffect, useRef } from "react";
import { TM, SESS_COLOR } from "../lib/constants";
import { inputSt } from "../lib/styles";
import { TypeBadge, SectionHdr } from "./ui";

// ─── TREE VIEW ────────────────────────────────────────────────────────────────
var MIN_ZOOM = 0.40, MAX_ZOOM = 1.55;

export function TreeView({ cards, rootCard, onEdit, onSetRoot }) {
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
        <div key={"xlink-"+cardId+"-"+depth} style={{paddingLeft:depth*20,marginBottom:4}}>
          {ansLabel && <div style={{fontSize:10,color:"rgba(255,255,255,.18)",fontStyle:"italic",marginBottom:2,paddingLeft:28,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ansLabel}</div>}
          <div style={{display:"flex",alignItems:"center",gap:5,paddingLeft:20}}>
            <button onClick={function(){onEdit(card);}}
              style={{background:"rgba(255,167,38,.06)",border:"1px dashed rgba(255,167,38,.3)",borderRadius:8,padding:"6px 10px 6px 9px",cursor:"pointer",display:"flex",alignItems:"center",gap:6,fontFamily:"inherit",maxWidth:"100%"}}>
              <span style={{fontSize:12,color:"#FFA726",flexShrink:0}}>↻</span>
              <span style={{fontSize:12,color:meta.color,flexShrink:0}}>{meta.icon}</span>
              <span style={{fontSize:12,color:"rgba(255,167,38,.8)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:140}}>{card.title}</span>
              <span style={{fontSize:9,color:"rgba(255,255,255,.2)",flexShrink:0,borderLeft:"1px solid rgba(255,255,255,.1)",paddingLeft:6,marginLeft:1}}>loop back</span>
            </button>
          </div>
        </div>
      );
    }
    renderedOnce.add(cardId);
    var children = (card.answers||[]).filter(function(a){return a && a.next;}); var isCollapsed = collapsed[cardId];
    return (
      <div key={cardId+"-"+depth} style={{marginBottom:4}}>
        {ansLabel && depth>0 && <div style={{paddingLeft:depth*20+26,fontSize:10,color:"rgba(255,255,255,.2)",fontStyle:"italic",marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ansLabel}</div>}
        <div style={{display:"flex",alignItems:"center",gap:5,paddingLeft:depth*20}}>
          {children.length > 0 ? (
            <button onClick={function(){toggleCollapse(cardId);}} style={{width:20,height:20,background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",borderRadius:5,cursor:"pointer",fontSize:9,color:"rgba(255,255,255,.45)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              {isCollapsed?"▶":"▼"}
            </button>
          ) : <div style={{width:20,height:20,flexShrink:0}}/>}
          <button onClick={function(){onEdit(card);}} style={{flex:1,background:card.intendedPath?"rgba(102,187,106,.06)":"rgba(255,255,255,.07)",border:"1px solid "+(card.intendedPath?"rgba(102,187,106,.18)":"rgba(255,255,255,.07)"),borderLeft:"3px solid "+(card.intendedPath?"#66BB6A":meta.color),borderRadius:9,padding:"8px 11px",cursor:"pointer",display:"flex",alignItems:"center",gap:7,fontFamily:"inherit",transition:"background .14s",textAlign:"left",minWidth:0}}>
            <span style={{fontSize:14,flexShrink:0}}>{meta.icon}</span>
            <span style={{fontSize:13,color:"#fff",fontWeight:500,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{card.title}</span>
            {isRoot && <span style={{fontSize:9,background:"rgba(255,255,255,.1)",color:"rgba(255,255,255,.4)",padding:"2px 6px",borderRadius:99,flexShrink:0,textTransform:"uppercase",letterSpacing:.4}}>root</span>}
            {card.intendedPath && <span style={{fontSize:10,color:"#66BB6A",flexShrink:0}}>★</span>}
            {isMerge && <span style={{fontSize:10,color:meta.color,flexShrink:0,opacity:.7}}>⊕</span>}
          </button>
          {!isRoot && onSetRoot && (
            <button onClick={function(e){e.stopPropagation();onSetRoot(cardId);}}
              title="Set as root"
              style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.07)",borderRadius:6,padding:"5px 8px",cursor:"pointer",fontSize:10,color:"rgba(255,255,255,.3)",flexShrink:0,fontFamily:"inherit"}}
            >⬆</button>
          )}
        </div>
        {children.length>0 && !isCollapsed && (
          <div style={{position:"relative",marginLeft:depth*20+10}}>
            <div style={{position:"absolute",left:10,top:0,bottom:6,width:1,background:"rgba(255,255,255,.07)"}}/>
            <div style={{paddingLeft:10}}>
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

  return (
    <div style={{flex:1,position:"relative",overflow:"hidden",display:"flex",flexDirection:"column"}}>
      <div ref={scrollRef} style={{flex:1,overflowY:"auto",overflowX:"auto"}}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onWheel={onWheel}>
        <div style={{padding:"10px 12px",zoom:zoom,minWidth:"min-content"}}>
          {rootCard ? renderNode(rootCard,0,null) : <div style={{textAlign:"center",color:"rgba(255,255,255,.25)",padding:"40px 0",fontSize:14}}>No root card set.</div>}
          {orphans.length > 0 && (
            <div style={{marginTop:16}}>
              <SectionHdr>Unconnected ({orphans.length})</SectionHdr>
              {orphans.map(function(c) { var m=TM[c.type]||TM.pitch; return (
                <div key={c.id} style={{display:"flex",alignItems:"center",gap:5,marginBottom:5}}>
                  <div style={{width:20,flexShrink:0}}/>
                  <button onClick={function(){onEdit(c);}} style={{flex:1,background:"rgba(255,255,255,.02)",border:"1px dashed rgba(255,255,255,.1)",borderLeft:"3px solid rgba(255,255,255,.12)",borderRadius:9,padding:"8px 11px",cursor:"pointer",display:"flex",alignItems:"center",gap:7,fontFamily:"inherit",textAlign:"left",opacity:.45}}>
                    <span style={{fontSize:14}}>{m.icon}</span>
                    <span style={{fontSize:13,color:"rgba(255,255,255,.55)",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.title}</span>
                    <span style={{fontSize:9,color:"rgba(255,255,255,.2)"}}>orphan</span>
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
