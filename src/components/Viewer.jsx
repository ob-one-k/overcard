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

// ─── CANVAS VIEW (free drag-and-drop node canvas) ─────────────────────────────
var CANVAS_W = 3600;
var CANVAS_H = 2800;
var DRAG_THRESHOLD = 6;

function canvasEdgePath(fx, fy, tx, ty) {
  var dx = tx - fx;
  var cp = Math.max(60, Math.abs(dx) * 0.45);
  if (dx >= 0) {
    return "M "+fx+","+fy+" C "+(fx+cp)+","+fy+" "+(tx-cp)+","+ty+" "+tx+","+ty;
  }
  var drop = Math.max(70, Math.abs(ty - fy) * 0.3 + 60);
  var mx = (fx + tx) / 2;
  return "M "+fx+","+fy
    +" C "+(fx+50)+","+fy+" "+(fx+50)+","+(fy+drop)+" "+mx+","+(fy+drop)
    +" C "+(tx-50)+","+(fy+drop)+" "+(tx-50)+","+ty+" "+tx+","+ty;
}

export function SwimlaneView({ cards, rootCard, onEdit, onSetRoot }) {
  var posRef       = useRef(null);
  var [posTick,    setPosTick]    = useState(0);
  var [pan,        setPan]        = useState({x:32,y:32});
  var panRef       = useRef({x:32,y:32});
  var [zoom,       setZoom]       = useState(1.0);
  var zoomRef      = useRef(1.0);
  var dragRef      = useRef({active:false,isPan:false,cardId:null,startPX:0,startPY:0,startCX:0,startCY:0,moved:false});
  var [selectedId, setSelectedId] = useState(null);
  var containerRef = useRef(null);
  var pinchRef     = useRef(null);
  var canEdit      = !!onEdit;

  // Initialize card positions from layout algorithm; preserve existing positions for known cards
  var cardKeyStr = Object.keys(cards).sort().join(",");
  useEffect(function() {
    var layout = buildTypeLayout(cards, rootCard, null, 0, false);
    var next = {};
    Object.keys(layout.posMap).forEach(function(id) {
      next[id] = (posRef.current && posRef.current[id])
        ? posRef.current[id]
        : {x: layout.posMap[id].x, y: layout.posMap[id].y};
    });
    posRef.current = next;
    setPosTick(function(t) { return t+1; });
  }, [cardKeyStr]); // eslint-disable-line react-hooks/exhaustive_deps

  // Non-passive touchmove for pinch-to-zoom
  useEffect(function() {
    var el = containerRef.current;
    if (!el) return;
    function dist(e) { return Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY); }
    function onTS(e) {
      if (e.touches.length === 2) {
        var rect = el.getBoundingClientRect();
        var mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
        var my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
        pinchRef.current = {d: dist(e), z: zoomRef.current, mx: mx, my: my};
      }
    }
    function onTM(e) {
      if (e.touches.length === 2 && pinchRef.current) {
        e.preventDefault();
        var nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinchRef.current.z * dist(e) / pinchRef.current.d));
        var mx = pinchRef.current.mx, my = pinchRef.current.my;
        var np = {
          x: mx - (mx - panRef.current.x) * (nz / zoomRef.current),
          y: my - (my - panRef.current.y) * (nz / zoomRef.current)
        };
        zoomRef.current = nz;
        panRef.current = np;
        setZoom(nz);
        setPan(Object.assign({}, np));
      }
    }
    function onTE(e) { if (e.touches.length < 2) pinchRef.current = null; }
    el.addEventListener("touchstart", onTS, {passive:true});
    el.addEventListener("touchmove",  onTM, {passive:false});
    el.addEventListener("touchend",   onTE, {passive:true});
    return function() {
      el.removeEventListener("touchstart", onTS);
      el.removeEventListener("touchmove",  onTM);
      el.removeEventListener("touchend",   onTE);
    };
  }, []);

  function fitToView() {
    var ids = Object.keys(posRef.current || {});
    if (!ids.length || !containerRef.current) return;
    var minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    ids.forEach(function(id) {
      var p = posRef.current[id];
      var h = cardHeight(cards[id] || {answers:[]});
      minX=Math.min(minX,p.x); minY=Math.min(minY,p.y);
      maxX=Math.max(maxX,p.x+SL_CARD_W); maxY=Math.max(maxY,p.y+h);
    });
    var pad=40, cW=containerRef.current.clientWidth, cH=containerRef.current.clientHeight;
    var nz = Math.min(1.2, Math.min(cW/(maxX-minX+pad*2), cH/(maxY-minY+pad*2)));
    nz = Math.max(MIN_ZOOM, nz);
    var np = {x:(pad-minX)*nz, y:(pad-minY)*nz};
    setZoom(nz); zoomRef.current=nz;
    setPan(np); panRef.current=np;
  }

  // Ctrl+wheel zoom
  function onWheel(e) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    var rect = containerRef.current ? containerRef.current.getBoundingClientRect() : {left:0,top:0};
    var mx = e.clientX - rect.left, my = e.clientY - rect.top;
    var factor = 1 - e.deltaY * 0.002;
    var nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomRef.current * factor));
    var np = {
      x: mx - (mx - panRef.current.x) * (nz / zoomRef.current),
      y: my - (my - panRef.current.y) * (nz / zoomRef.current)
    };
    zoomRef.current = nz; panRef.current = np;
    setZoom(nz); setPan(Object.assign({}, np));
  }

  // Container background pointer handlers (pan)
  function onContainerPointerDown(e) {
    if (e.target.closest("[data-canvas-card]")) return;
    dragRef.current = {active:true,isPan:true,cardId:null,startPX:e.clientX,startPY:e.clientY,startCX:panRef.current.x,startCY:panRef.current.y,moved:false};
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onContainerPointerMove(e) {
    var d = dragRef.current;
    if (!d.active || !d.isPan) return;
    var dx = e.clientX - d.startPX, dy = e.clientY - d.startPY;
    if (!d.moved && Math.sqrt(dx*dx+dy*dy) < DRAG_THRESHOLD) return;
    d.moved = true;
    var np = {x: d.startCX + dx, y: d.startCY + dy};
    panRef.current = np;
    setPan(Object.assign({}, np));
  }
  function onContainerPointerUp() {
    if (dragRef.current.active && dragRef.current.isPan) {
      dragRef.current = Object.assign({}, dragRef.current, {active:false, moved:false});
    }
  }

  // Card pointer handlers (drag + click/select)
  function onCardPointerDown(e, cardId) {
    e.stopPropagation();
    var pos = (posRef.current && posRef.current[cardId]) || {x:0,y:0};
    dragRef.current = {active:true,isPan:false,cardId:cardId,startPX:e.clientX,startPY:e.clientY,startCX:pos.x,startCY:pos.y,moved:false};
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onCardPointerMove(e, cardId) {
    var d = dragRef.current;
    if (!d.active || d.isPan || d.cardId !== cardId) return;
    var dx = e.clientX - d.startPX, dy = e.clientY - d.startPY;
    if (!d.moved && Math.sqrt(dx*dx+dy*dy) < DRAG_THRESHOLD) return;
    d.moved = true;
    var nx = d.startCX + dx / zoomRef.current;
    var ny = d.startCY + dy / zoomRef.current;
    if (posRef.current) posRef.current[cardId] = {x:nx, y:ny};
    var el = document.getElementById("cc-"+cardId);
    if (el) { el.style.left = nx+"px"; el.style.top = ny+"px"; }
  }
  function onCardPointerUp(e, cardId, card) {
    var d = dragRef.current;
    if (!d.active || d.cardId !== cardId) return;
    var wasMoved = d.moved;
    dragRef.current = Object.assign({}, dragRef.current, {active:false, moved:false});
    if (wasMoved) {
      setPosTick(function(t) { return t+1; }); // commit edges
    } else {
      // Click: select or edit
      if (canEdit) {
        if (selectedId === cardId) { onEdit(card); setSelectedId(null); }
        else setSelectedId(cardId);
      } else {
        setSelectedId(selectedId === cardId ? null : cardId);
      }
    }
  }

  if (!cards || Object.keys(cards).length === 0) {
    return <div style={{padding:32,textAlign:"center",color:"rgba(255,255,255,.3)",fontSize:13}}>No cards yet.</div>;
  }

  // Build edge list from current positions
  var pos = posRef.current || {};
  var edgeList = [];
  var inboundCounts = {};
  Object.keys(cards).forEach(function(fromId) {
    var card = cards[fromId];
    var fp = pos[fromId];
    if (!fp) return;
    var linked = (card.answers||[]).filter(function(a){return a.next && pos[a.next];});
    linked.forEach(function(ans, rowIdx) {
      var tp = pos[ans.next];
      if (!tp) return;
      inboundCounts[ans.next] = (inboundCounts[ans.next]||0) + 1;
      var fx = fp.x + SL_CARD_W;
      var fy = fp.y + SL_HDR_H + Math.min(rowIdx, SL_ANS_MAX-1) * SL_ANS_H + SL_ANS_H/2;
      var toCard = cards[ans.next];
      var th = toCard ? cardHeight(toCard) : SL_HDR_H;
      var tx = tp.x;
      var ty = tp.y + th/2;
      var isIntended = !!(toCard && toCard.intendedPath);
      edgeList.push({d:canvasEdgePath(fx,fy,tx,ty), intended:isIntended, key:fromId+"-"+ans.id});
    });
  });

  return (
    <div style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column"}}>
      {/* Toolbar */}
      <div style={{display:"flex",alignItems:"center",gap:6,padding:"6px 12px",borderBottom:"1px solid rgba(255,255,255,.06)",flexShrink:0}}>
        <button onClick={function(){var nz=Math.min(MAX_ZOOM,+(zoom+0.15).toFixed(2));setZoom(nz);zoomRef.current=nz;}} style={{background:"rgba(255,255,255,.07)",border:"none",color:"rgba(255,255,255,.6)",borderRadius:5,padding:"3px 9px",cursor:"pointer",fontSize:14,fontFamily:"inherit"}}>+</button>
        <span style={{fontSize:11,color:"rgba(255,255,255,.35)",minWidth:36,textAlign:"center",fontFamily:"inherit"}}>{Math.round(zoom*100)}%</span>
        <button onClick={function(){var nz=Math.max(MIN_ZOOM,+(zoom-0.15).toFixed(2));setZoom(nz);zoomRef.current=nz;}} style={{background:"rgba(255,255,255,.07)",border:"none",color:"rgba(255,255,255,.6)",borderRadius:5,padding:"3px 9px",cursor:"pointer",fontSize:14,fontFamily:"inherit"}}>−</button>
        <button onClick={function(){setZoom(1.0);zoomRef.current=1.0;}} style={{background:"rgba(255,255,255,.07)",border:"none",color:"rgba(255,255,255,.4)",borderRadius:5,padding:"3px 8px",cursor:"pointer",fontSize:11,marginLeft:2,fontFamily:"inherit"}}>Reset</button>
        <button onClick={fitToView} style={{background:"rgba(255,255,255,.07)",border:"none",color:"rgba(255,255,255,.4)",borderRadius:5,padding:"3px 8px",cursor:"pointer",fontSize:11,marginLeft:2,fontFamily:"inherit"}}>Fit</button>
        <span style={{marginLeft:"auto",fontSize:9,color:"rgba(255,255,255,.2)",fontFamily:"inherit"}}>Drag cards · pinch or ctrl+scroll to zoom · drag canvas to pan</span>
      </div>

      {/* Canvas container */}
      <div
        ref={containerRef}
        style={{flex:1,overflow:"hidden",position:"relative",cursor:"grab",userSelect:"none"}}
        onPointerDown={onContainerPointerDown}
        onPointerMove={onContainerPointerMove}
        onPointerUp={onContainerPointerUp}
        onWheel={onWheel}
      >
        {/* Scaled + panned inner canvas */}
        <div style={{
          position:"absolute",
          width:CANVAS_W, height:CANVAS_H,
          transform:"translate("+pan.x+"px,"+pan.y+"px) scale("+zoom+")",
          transformOrigin:"0 0"
        }}>
          {/* Edges SVG */}
          <svg style={{position:"absolute",inset:0,width:CANVAS_W,height:CANVAS_H,overflow:"visible",pointerEvents:"none"}}>
            <defs>
              <marker id="cv-arr-normal" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
                <polygon points="0,0 7,3.5 0,7" fill={SL_EDGE_NORMAL}/>
              </marker>
              <marker id="cv-arr-intended" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
                <polygon points="0,0 7,3.5 0,7" fill={SL_EDGE_INTENDED}/>
              </marker>
            </defs>
            {edgeList.map(function(edge) {
              var stroke = edge.intended ? SL_EDGE_INTENDED : SL_EDGE_NORMAL;
              var marker = edge.intended ? "url(#cv-arr-intended)" : "url(#cv-arr-normal)";
              return (
                <path key={edge.key} d={edge.d} stroke={stroke} strokeWidth={edge.intended?1.8:1.3} fill="none" markerEnd={marker}/>
              );
            })}
          </svg>

          {/* Card nodes */}
          {Object.keys(pos).map(function(cardId) {
            var p = pos[cardId];
            var card = cards[cardId];
            if (!card || !p) return null;
            var meta       = TM[card.type] || TM.pitch;
            var isRoot     = cardId === rootCard;
            var isSelected = cardId === selectedId;
            var linked     = (card.answers||[]).filter(function(a){return a.next;});
            var unlinked   = (card.answers||[]).filter(function(a){return !a.next && a.label;});
            var allRows    = linked.concat(unlinked);
            var shown      = allRows.slice(0, SL_ANS_MAX);
            var overflow   = allRows.length - shown.length;
            var isMerge    = (inboundCounts[cardId]||0) > 1;
            var cardH      = cardHeight(card);
            return (
              <div
                id={"cc-"+cardId}
                key={cardId}
                data-canvas-card="1"
                onPointerDown={function(e){onCardPointerDown(e,cardId);}}
                onPointerMove={function(e){onCardPointerMove(e,cardId);}}
                onPointerUp={function(e){onCardPointerUp(e,cardId,card);}}
                style={{
                  position:"absolute", left:p.x, top:p.y,
                  width:SL_CARD_W, height:cardH,
                  background: card.intendedPath ? "rgba(168,255,62,.06)" : "rgba(255,255,255,.06)",
                  borderTop:"3px solid "+meta.color,
                  borderRight:"1.5px solid "+(isSelected?meta.color:card.intendedPath?"rgba(168,255,62,.28)":"rgba(255,255,255,.10)"),
                  borderBottom:"1.5px solid "+(isSelected?meta.color:card.intendedPath?"rgba(168,255,62,.28)":"rgba(255,255,255,.10)"),
                  borderLeft:"1.5px solid "+(isSelected?meta.color:card.intendedPath?"rgba(168,255,62,.28)":"rgba(255,255,255,.10)"),
                  borderRadius:10, cursor:"pointer",
                  overflow:"hidden",
                  boxShadow: isSelected ? ("0 0 0 3px "+meta.color+"33,0 8px 28px rgba(0,0,0,.6)") : "0 2px 8px rgba(0,0,0,.35)",
                  transition:"box-shadow .18s, border-color .18s",
                  zIndex: isSelected ? 10 : 1,
                  display:"flex", flexDirection:"column",
                  touchAction:"none",
                }}>
                {/* Header */}
                <div style={{height:SL_HDR_H,padding:"0 8px",display:"flex",alignItems:"center",gap:5,flexShrink:0}}>
                  <span style={{fontSize:11}}>{meta.icon}</span>
                  <span style={{fontSize:11,fontWeight:700,color:"#fff",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{card.title || card.type}</span>
                  {isRoot && <span style={{fontSize:8,background:"rgba(0,180,255,.22)",color:"#00B4FF",borderRadius:99,padding:"1px 5px",fontWeight:700,flexShrink:0}}>root</span>}
                  {isMerge && <span style={{fontSize:9,color:meta.color,opacity:.65,flexShrink:0}}>⊕</span>}
                  {card.intendedPath && <span style={{fontSize:9,color:"#A8FF3E",flexShrink:0}}>★</span>}
                </div>
                {/* Answer rows */}
                {shown.length > 0 && <div style={{height:1,background:"rgba(255,255,255,.07)",flexShrink:0}}/>}
                {shown.map(function(ans, rowIdx) {
                  var hasLink = !!ans.next;
                  return (
                    <div key={ans.id||rowIdx} style={{height:SL_ANS_H,padding:"0 8px",display:"flex",alignItems:"center",gap:5,flexShrink:0,borderTop:rowIdx>0?"1px solid rgba(255,255,255,.05)":"none"}}>
                      <span style={{fontSize:9,color:hasLink?"rgba(255,255,255,.72)":"rgba(255,255,255,.28)",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ans.label||"—"}</span>
                      {hasLink && <span style={{display:"inline-block",width:5,height:5,borderRadius:"50%",background:"rgba(255,255,255,.35)",flexShrink:0}}/>}
                      {hasLink && <span style={{fontSize:9,color:"rgba(255,255,255,.28)",flexShrink:0,lineHeight:1}}>→</span>}
                    </div>
                  );
                })}
                {overflow > 0 && (
                  <div style={{height:SL_ANS_H,padding:"0 8px",display:"flex",alignItems:"center",flexShrink:0,borderTop:"1px solid rgba(255,255,255,.05)"}}>
                    <span style={{fontSize:9,color:"rgba(255,255,255,.25)",fontStyle:"italic"}}>+{overflow} more</span>
                  </div>
                )}
                {/* Selection action bar — click card to select, click selected to edit */}
                {isSelected && canEdit && (
                  <div style={{position:"absolute",bottom:0,left:0,right:0,background:"rgba(4,10,28,.95)",borderTop:"1px solid rgba(255,255,255,.09)",display:"flex"}}>
                    <button
                      onPointerDown={function(e){e.stopPropagation();}}
                      onClick={function(e){e.stopPropagation();onEdit(card);setSelectedId(null);}}
                      style={{flex:1,fontSize:10,color:"rgba(255,255,255,.7)",background:"none",border:"none",padding:"6px",cursor:"pointer",fontFamily:"inherit"}}>✏ Edit</button>
                    {onSetRoot && !isRoot && (
                      <button
                        onPointerDown={function(e){e.stopPropagation();}}
                        onClick={function(e){e.stopPropagation();onSetRoot(cardId);setSelectedId(null);}}
                        style={{flex:1,fontSize:10,color:"rgba(168,255,62,.8)",background:"none",border:"none",borderLeft:"1px solid rgba(255,255,255,.07)",padding:"6px",cursor:"pointer",fontFamily:"inherit"}}>⬆ Root</button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
