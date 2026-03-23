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

// ─── SWIMLANE VIEW ────────────────────────────────────────────────────────────
var SL_CARD_W    = 210;
var SL_CARD_GAP  = 18;
var SL_LANE_W    = SL_CARD_W + 28;
var SL_COL_GAP   = 48;
var SL_LANE_HDR  = 42;
var SL_PAD       = 20;
var LANE_ORDER   = ["pitch","discovery","close","objection"];
var SL_HDR_H     = 32;   // header row height (icon + title + badges)
var SL_ANS_H     = 22;   // height of each answer row
var SL_ANS_MAX   = 5;    // max answer rows before "+N more" stub
var COMPACT_CARD_H = 42; // compact mode (<70% zoom): header-only unselected height
var COMPACT_ANS_H  = 26; // compact mode: answer row height when selected
var SL_EDGE_INTENDED = "rgba(168,255,62,.55)";
var SL_EDGE_NORMAL   = "rgba(255,255,255,.20)";

function cardHeight(card) {
  var linked   = (card.answers || []).filter(function(a){ return a.next; }).length;
  var unlinked = (card.answers || []).filter(function(a){ return !a.next && a.label; }).length;
  var total    = linked + unlinked;
  var shown    = Math.min(total, SL_ANS_MAX);
  var overflow = total > SL_ANS_MAX ? 1 : 0;
  return SL_HDR_H + shown * SL_ANS_H + overflow * SL_ANS_H + 8;
}

function buildTypeLayout(cards, rootCard, selectedId, selExpansion, isCompact) {
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

  var laneX = {};
  activeLanes.forEach(function(t, i) {
    laneX[t] = SL_PAD + i * (SL_LANE_W + SL_COL_GAP);
  });

  var posMap = {};
  var laneExtent = {}; // tracks true bottom of each lane including selection expansion
  activeLanes.forEach(function(t) {
    var y = SL_PAD + SL_LANE_HDR;
    laneCards[t].forEach(function(id) {
      var card = cards[id];
      var h = isCompact ? COMPACT_CARD_H : cardHeight(card);
      var linked   = (card.answers || []).filter(function(a){ return a.next; });
      var unlinked = (card.answers || []).filter(function(a){ return !a.next && a.label; });
      var portYs;
      if (isCompact) {
        // All edges exit from the card's vertical midpoint in compact mode
        portYs = linked.map(function() { return y + COMPACT_CARD_H / 2; });
      } else {
        var allVisible = linked.concat(unlinked).slice(0, SL_ANS_MAX);
        portYs = allVisible.map(function(_, rowIdx) {
          return y + SL_HDR_H + rowIdx * SL_ANS_H + SL_ANS_H / 2;
        });
      }
      posMap[id] = {
        x: laneX[t] + 12, y: y, h: h,
        lane: t, laneX: laneX[t],
        answerPortYs: portYs,
        linkedAnswers: linked,
      };
      y += h + SL_CARD_GAP;
      // Push cards below the selected one down by its expansion amount
      if (selectedId && id === selectedId && selExpansion) y += selExpansion;
    });
    laneExtent[t] = y;
  });

  var maxLaneH = activeLanes.reduce(function(mx, t) {
    return Math.max(mx, (laneExtent[t] || 0) - (SL_PAD + SL_LANE_HDR));
  }, 0);
  var canvasW = SL_PAD * 2 + activeLanes.length * SL_LANE_W + Math.max(0, activeLanes.length - 1) * SL_COL_GAP;
  var canvasH = SL_PAD * 2 + SL_LANE_HDR + maxLaneH + 36;

  var edges = [];
  Object.keys(cards).forEach(function(id) {
    var fp = posMap[id];
    if (!fp) return;
    fp.linkedAnswers.forEach(function(a, ansIdx) {
      if (!posMap[a.next]) return;
      var portIdx = Math.min(ansIdx, SL_ANS_MAX - 1);
      var portY = fp.answerPortYs[portIdx] !== undefined ? fp.answerPortYs[portIdx] : fp.y + fp.h / 2;
      edges.push({
        from: id, to: a.next,
        portY: portY,
        toIntended: !!(cards[a.next] && cards[a.next].intendedPath),
      });
    });
  });

  return { laneCards: laneCards, activeLanes: activeLanes, laneX: laneX, posMap: posMap, edges: edges, canvasW: canvasW, canvasH: canvasH };
}

function slEdgePath(fp, tp, portY) {
  var srcRight = fp.x + SL_CARD_W;
  var dstLeft  = tp.x;
  var dstMidY  = tp.y + SL_HDR_H / 2;
  var loopX    = fp.laneX + SL_LANE_W + SL_COL_GAP * 0.38;

  if (fp.lane === tp.lane) {
    var x1 = srcRight, y1 = portY;
    var x2 = srcRight, y2 = dstMidY;
    var farX = tp.y < fp.y ? loopX + 18 : loopX;
    return {
      d: "M "+x1+","+y1+" C "+farX+","+y1+" "+farX+","+y2+" "+x2+","+y2,
      x1:x1, y1:y1, x2:x2, y2:y2
    };
  } else {
    var x1 = srcRight, y1 = portY;
    var x2 = dstLeft,  y2 = dstMidY;
    var dx = x2 - x1;
    if (dx >= 0) {
      var cp = Math.max(36, Math.abs(dx) * 0.42);
      return {
        d: "M "+x1+","+y1+" C "+(x1+cp)+","+y1+" "+(x2-cp)+","+y2+" "+x2+","+y2,
        x1:x1, y1:y1, x2:x2, y2:y2
      };
    } else {
      var drop = Math.max(52, Math.abs(y2 - y1) * 0.3 + 40);
      var mx = (x1 + x2) / 2;
      return {
        d: "M "+x1+","+y1
          +" C "+(x1+36)+","+y1+" "+(x1+36)+","+(y1+drop)+" "+mx+","+(y1+drop)
          +" C "+(x2-36)+","+(y1+drop)+" "+(x2-36)+","+y2+" "+x2+","+y2,
        x1:x1, y1:y1, x2:x2, y2:y2
      };
    }
  }
}

export function SwimlaneView({ cards, rootCard, onEdit, onSetRoot }) {
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
        setZoom(Math.min(1.55, Math.max(0.40, pinchRef.current.z * dist(e) / pinchRef.current.d)));
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

  var isCompact = zoom < 0.70;
  var canEdit   = !!onEdit;

  // Compute how much extra height the selected card adds beyond its base height
  var selExpansion = 0;
  if (selectedId && canEdit) {
    var sc = cards[selectedId];
    if (sc) {
      if (isCompact) {
        var scLinked   = (sc.answers||[]).filter(function(a){return a.next;}).length;
        var scUnlinked = (sc.answers||[]).filter(function(a){return !a.next && a.label;}).length;
        var scTotal    = scLinked + scUnlinked;
        var scShown    = Math.min(scTotal, SL_ANS_MAX);
        var scOverflow = scTotal > SL_ANS_MAX ? 1 : 0;
        selExpansion = (scShown + scOverflow) * COMPACT_ANS_H + 28;
      } else {
        selExpansion = 28; // just the action bar in normal mode
      }
    }
  }

  var layout   = buildTypeLayout(cards, rootCard, selectedId, selExpansion, isCompact);
  var laneCards= layout.laneCards, activeLanes=layout.activeLanes, laneX=layout.laneX;
  var posMap   = layout.posMap, edges=layout.edges, canvasW=layout.canvasW, canvasH=layout.canvasH;

  return (
    <div style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column"}}>
      {/* Toolbar */}
      <div style={{display:"flex",alignItems:"center",gap:6,padding:"6px 12px",borderBottom:"1px solid rgba(255,255,255,.06)",flexShrink:0}}>
        <button onClick={function(){setZoom(function(z){return Math.min(1.55,+(z+0.15).toFixed(2));});}} style={{background:"rgba(255,255,255,.07)",border:"none",color:"rgba(255,255,255,.6)",borderRadius:5,padding:"3px 9px",cursor:"pointer",fontSize:14,fontFamily:"inherit"}}>+</button>
        <span style={{fontSize:11,color:"rgba(255,255,255,.35)",minWidth:36,textAlign:"center",fontFamily:"inherit"}}>{Math.round(zoom*100)}%</span>
        <button onClick={function(){setZoom(function(z){return Math.max(0.40,+(z-0.15).toFixed(2));});}} style={{background:"rgba(255,255,255,.07)",border:"none",color:"rgba(255,255,255,.6)",borderRadius:5,padding:"3px 9px",cursor:"pointer",fontSize:14,fontFamily:"inherit"}}>−</button>
        <button onClick={function(){setZoom(1.0);}} style={{background:"rgba(255,255,255,.07)",border:"none",color:"rgba(255,255,255,.4)",borderRadius:5,padding:"3px 8px",cursor:"pointer",fontSize:11,marginLeft:2,fontFamily:"inherit"}}>Reset</button>
        {isCompact && <span style={{marginLeft:"auto",fontSize:9,color:"rgba(168,255,62,.6)",letterSpacing:.5,textTransform:"uppercase",fontWeight:700}}>Compact</span>}
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
                <marker id="arr-normal" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
                  <polygon points="0,0 7,3.5 0,7" fill={SL_EDGE_NORMAL}/>
                </marker>
                <marker id="arr-intended" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
                  <polygon points="0,0 7,3.5 0,7" fill={SL_EDGE_INTENDED}/>
                </marker>
              </defs>
              {edges.map(function(edge, i) {
                var fp = posMap[edge.from], tp = posMap[edge.to];
                if (!fp || !tp) return null;
                var ep = slEdgePath(fp, tp, edge.portY);
                var stroke   = edge.toIntended ? SL_EDGE_INTENDED : SL_EDGE_NORMAL;
                var markerId = edge.toIntended ? "url(#arr-intended)" : "url(#arr-normal)";
                var strokeW  = edge.toIntended ? 1.8 : 1.3;
                return (
                  <g key={i}>
                    <path d={ep.d} stroke={stroke} strokeWidth={strokeW} fill="none" markerEnd={markerId}/>
                    <circle cx={ep.x1} cy={ep.y1} r={2.5} fill={stroke}/>
                  </g>
                );
              })}
            </svg>

            {/* Cards */}
            {Object.keys(posMap).map(function(cardId) {
              var pos  = posMap[cardId];
              var card = cards[cardId];
              if (!card) return null;
              var meta       = TM[card.type] || TM.pitch;
              var isRoot     = cardId === rootCard;
              var isSelected = cardId === selectedId;
              var linked   = (card.answers || []).filter(function(a){ return a.next; });
              var unlinked = (card.answers || []).filter(function(a){ return !a.next && a.label; });
              var allRows  = linked.concat(unlinked);
              var shown    = allRows.slice(0, SL_ANS_MAX);
              var overflow = allRows.length - shown.length;
              var inboundCt = edges.filter(function(e){ return e.to === cardId; }).length;
              var isMerge   = inboundCt > 1;
              // cardH = base height + selection expansion (only for selected card)
              var expansion = (isSelected && canEdit) ? selExpansion : 0;
              var cardH = isCompact ? (COMPACT_CARD_H + expansion) : (pos.h + expansion);
              // In compact mode, answer rows only visible when selected
              var showAnswers = !isCompact || (isSelected && canEdit);
              var ansH = isCompact ? COMPACT_ANS_H : SL_ANS_H;
              return (
                <div key={cardId}
                  onClick={function(){ if(canEdit){ if(isSelected) onEdit(card); else setSelectedId(cardId); } else setSelectedId(isSelected?null:cardId); }}
                  style={{
                    position:"absolute", left:pos.x, top:pos.y,
                    width:SL_CARD_W, height:cardH,
                    background: card.intendedPath ? "rgba(168,255,62,.06)" : "rgba(255,255,255,.06)",
                    borderTop:"3px solid "+meta.color,
                    borderRight:"1.5px solid "+(isSelected ? meta.color : card.intendedPath ? "rgba(168,255,62,.28)" : "rgba(255,255,255,.10)"),
                    borderBottom:"1.5px solid "+(isSelected ? meta.color : card.intendedPath ? "rgba(168,255,62,.28)" : "rgba(255,255,255,.10)"),
                    borderLeft:"1.5px solid "+(isSelected ? meta.color : card.intendedPath ? "rgba(168,255,62,.28)" : "rgba(255,255,255,.10)"),
                    borderRadius:10, cursor: canEdit ? "pointer" : "default",
                    overflow:"hidden",
                    boxShadow: isSelected ? ("0 0 0 3px "+meta.color+"33,0 8px 28px rgba(0,0,0,.6)") : "0 2px 8px rgba(0,0,0,.35)",
                    transition:"box-shadow .18s, height .18s, border-color .18s",
                    zIndex: isSelected ? 10 : 1,
                    display:"flex", flexDirection:"column",
                  }}>
                  {/* Header row — compact uses larger text, fills full card height when not selected */}
                  {isCompact ? (
                    <div style={{height:COMPACT_CARD_H,padding:"0 9px",display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                      <span style={{fontSize:14,flexShrink:0}}>{meta.icon}</span>
                      <span style={{fontSize:13,fontWeight:700,color:"#fff",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{card.title || card.type}</span>
                      {isRoot && <span style={{fontSize:7,background:"rgba(0,180,255,.22)",color:"#00B4FF",borderRadius:99,padding:"1px 4px",fontWeight:700,flexShrink:0}}>root</span>}
                      {card.intendedPath && <span style={{fontSize:11,color:"#A8FF3E",flexShrink:0}}>★</span>}
                      {isMerge && <span style={{fontSize:9,color:meta.color,opacity:.7,flexShrink:0}}>⊕</span>}
                    </div>
                  ) : (
                    <div style={{height:SL_HDR_H,padding:"0 8px",display:"flex",alignItems:"center",gap:5,flexShrink:0}}>
                      <span style={{fontSize:11}}>{meta.icon}</span>
                      <span style={{fontSize:11,fontWeight:700,color:"#fff",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{card.title || card.type}</span>
                      {isRoot && <span style={{fontSize:8,background:"rgba(0,180,255,.22)",color:"#00B4FF",borderRadius:99,padding:"1px 5px",fontWeight:700,flexShrink:0}}>root</span>}
                      {isMerge && <span style={{fontSize:9,color:meta.color,opacity:.65,flexShrink:0}}>⊕</span>}
                      {card.intendedPath && <span style={{fontSize:9,color:"#A8FF3E",flexShrink:0}}>★</span>}
                    </div>
                  )}
                  {/* Divider + answer rows — hidden in compact mode until selected */}
                  {showAnswers && shown.length > 0 && <div style={{height:1,background:"rgba(255,255,255,.07)",flexShrink:0}}/>}
                  {showAnswers && shown.map(function(ans, rowIdx) {
                    var hasLink = !!ans.next;
                    return (
                      <div key={ans.id || rowIdx} style={{height:ansH,padding:"0 8px",display:"flex",alignItems:"center",gap:5,flexShrink:0,borderTop:rowIdx>0?"1px solid rgba(255,255,255,.05)":"none"}}>
                        <span style={{fontSize:isCompact?10:9,color:hasLink?"rgba(255,255,255,.72)":"rgba(255,255,255,.28)",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ans.label||"—"}</span>
                        {hasLink && <span style={{display:"inline-block",width:5,height:5,borderRadius:"50%",background:"rgba(255,255,255,.35)",flexShrink:0}}/>}
                        {hasLink && <span style={{fontSize:9,color:"rgba(255,255,255,.28)",flexShrink:0,lineHeight:1}}>→</span>}
                      </div>
                    );
                  })}
                  {/* Overflow stub */}
                  {showAnswers && overflow > 0 && (
                    <div style={{height:ansH,padding:"0 8px",display:"flex",alignItems:"center",flexShrink:0,borderTop:"1px solid rgba(255,255,255,.05)"}}>
                      <span style={{fontSize:9,color:"rgba(255,255,255,.25)",fontStyle:"italic"}}>+{overflow} more</span>
                    </div>
                  )}
                  {/* Selection action bar */}
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
