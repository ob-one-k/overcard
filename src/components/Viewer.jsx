import { useState, useEffect, useRef } from "react";
import { TM } from "../lib/constants";

// ─── FLOW VIEW — TOP-TO-BOTTOM LAYOUT ──────────────────────────────────────────
// Depth increases downward. Each BFS depth level is a horizontal row.
// Cards within a row are spread horizontally. Edges exit card bottoms, enter card tops.

var MIN_ZOOM    = 0.28;
var MAX_ZOOM    = 1.80;
var FL_CARD_W   = 220;
var FL_CARD_H   = 46;
var FL_ANS_H    = 22;
var FL_BAR_H    = 28;
var FL_CARD_GAP = 14;   // vertical gap used only for orphan section spacing
var FL_H_GAP    = 22;   // horizontal gap between cards in the same row
var FL_V_GAP    = 56;   // vertical gap between rows (the gutter zone)
var FL_ROW_H    = FL_CARD_H + FL_V_GAP;  // row pitch (center-to-center row spacing)
var FL_V_MID    = FL_V_GAP / 2;          // distance from card bottom to gutter center
var FL_PAD      = 44;
var FL_EDGE_IP  = "rgba(168,255,62,.70)";
var FL_EDGE_NRM = "rgba(255,255,255,.22)";
var FL_EDGE_LBK = "rgba(255,167,38,.60)";

// ─── ORTHOGONAL FORWARD PATH (top-to-bottom) ────────────────────────────────
// Exits card bottom, enters card top. Changes X only inside horizontal gutter
// zones — never while crossing a row of cards.
function buildForwardPath(srcX, srcBottom, dstX, dstTop, fd, td, gutterOffset) {
  var off = gutterOffset || 0;
  var parts = ["M " + srcX.toFixed(1) + "," + srcBottom];
  for (var d = fd; d < td; d++) {
    var gy = (FL_PAD + d * FL_ROW_H + FL_CARD_H + FL_V_MID + off).toFixed(1);
    var nextX = (srcX + (dstX - srcX) * (d - fd + 1) / (td - fd)).toFixed(1);
    parts.push("V " + gy);    // travel down to gutter center
    parts.push("H " + nextX); // change X inside the gutter
  }
  parts.push("V " + dstTop); // enter target from top
  return parts.join(" ");
}

// ─── LOOPBACK PATH (routes to the right of the canvas) ──────────────────────
function buildLoopPath(fromPos, toPos, laneX) {
  var sx = fromPos.x + FL_CARD_W;
  var sy = (fromPos.y + FL_CARD_H / 2).toFixed(1);
  var tx = toPos.x + FL_CARD_W;
  var ty = (toPos.y + FL_CARD_H / 2).toFixed(1);
  return "M " + sx + "," + sy + " H " + laneX + " V " + ty + " H " + tx;
}

// ─── GUTTER OFFSET ALLOCATOR ────────────────────────────────────────────────
// Assigns small Y offsets to parallel edges sharing the same (fd→td) gutter
// so they don't overlap within the horizontal gutter band.
function allocateGutterOffsets(edges) {
  var groups = {};
  edges.forEach(function(e) {
    var key = e.fd + "-" + e.td;
    if (!groups[key]) groups[key] = [];
    groups[key].push(e.key);
  });
  var offsets = {};
  Object.keys(groups).forEach(function(key) {
    var g = groups[key];
    g.forEach(function(ek, i) {
      offsets[ek] = (i - (g.length - 1) / 2) * 8;
    });
  });
  return offsets;
}

function avgParentX(id, cards, tempX) {
  var parents = [];
  Object.keys(cards).forEach(function(pid) {
    if ((cards[pid].answers||[]).some(function(a){ return a && a.next === id; })) {
      if (tempX[pid] !== undefined) parents.push(tempX[pid]);
    }
  });
  if (!parents.length) return tempX[id] || 0;
  return parents.reduce(function(s, x) { return s + x; }, 0) / parents.length;
}

function buildFlowLayout(cards, rootCard, selectedId) {
  if (!rootCard || !cards || !cards[rootCard]) {
    return { posMap: {}, edges: [], loopEdges: [], canvasW: 400, canvasH: 300, loopZoneLeft: 400, orphans: [], depthMap: {} };
  }

  // 1. BFS assign depths
  var depth = {};
  var bfsQueue = [rootCard];
  depth[rootCard] = 0;
  var visited = {};
  while (bfsQueue.length) {
    var cur = bfsQueue.shift();
    if (visited[cur]) continue;
    visited[cur] = true;
    ((cards[cur] && cards[cur].answers) || []).forEach(function(a) {
      if (a && a.next && cards[a.next] && depth[a.next] === undefined) {
        depth[a.next] = depth[cur] + 1;
        bfsQueue.push(a.next);
      }
    });
  }

  // 2. Group into rows by depth
  var rows = {};
  Object.keys(depth).forEach(function(id) {
    var d = depth[id];
    if (!rows[d]) rows[d] = [];
    rows[d].push(id);
  });
  var maxDepth = Object.keys(rows).reduce(function(m, d) { return Math.max(m, +d); }, 0);

  // 3. Barycenter sort — sort cards within each row by average parent X
  var tempX = {};
  Object.keys(rows).forEach(function(d) {
    rows[d].forEach(function(id, i) { tempX[id] = i; });
  });
  for (var pass = 0; pass < 2; pass++) {
    for (var d = 1; d <= maxDepth; d++) {
      if (!rows[d]) continue;
      rows[d] = rows[d].slice().sort(function(a, b) {
        return avgParentX(a, cards, tempX) - avgParentX(b, cards, tempX);
      });
      // Keep intended-path card centered in its row
      var row = rows[d];
      var ipId = row.find(function(id) { return cards[id] && cards[id].intendedPath; });
      var ipIdx = ipId !== undefined ? row.indexOf(ipId) : -1;
      if (ipIdx !== -1 && row.length > 1) {
        var mid = Math.floor(row.length / 2);
        row.splice(ipIdx, 1);
        row.splice(mid, 0, ipId);
      }
      row.forEach(function(id, i) { tempX[id] = i; });
    }
  }

  // 4. Assign pixel positions — center each row horizontally
  var rowWidths = {};
  Object.keys(rows).forEach(function(d) {
    rowWidths[d] = rows[d].length * FL_CARD_W + (rows[d].length - 1) * FL_H_GAP;
  });
  var maxRowW = Object.keys(rowWidths).reduce(function(m, d) { return Math.max(m, rowWidths[d]); }, FL_CARD_W);

  var posMap = {};
  Object.keys(rows).forEach(function(d) {
    var row = rows[d];
    var rowW = rowWidths[d];
    var startX = FL_PAD + (maxRowW - rowW) / 2;
    row.forEach(function(id, i) {
      posMap[id] = {
        x: startX + i * (FL_CARD_W + FL_H_GAP),
        y: FL_PAD + (+d) * FL_ROW_H,
      };
    });
  });

  // 5a. Collect raw edges — split forward vs loopback
  var rawForward = [], rawLoop = [];
  Object.keys(cards).forEach(function(fromId) {
    if (!posMap[fromId]) return;
    var card = cards[fromId];
    var fp = posMap[fromId];
    (card.answers || []).forEach(function(ans, ansIdx) {
      if (!ans || !ans.next || !posMap[ans.next]) return;
      var fd = depth[fromId], td = depth[ans.next];
      var tp = posMap[ans.next];
      var toCard = cards[ans.next];
      var edgeKey = fromId + "-" + (ans.id || ansIdx);
      // portX: center of card bottom (spread slightly when selected)
      var portX = (fp.x + FL_CARD_W / 2);
      if (td !== undefined && fd !== undefined && td <= fd) {
        rawLoop.push({
          from: fromId, to: ans.next, ansIdx: ansIdx,
          fd: fd !== undefined ? fd : 0,
          td: td !== undefined ? td : 0,
          fromPos: fp, toPos: tp,
          toIntended: !!(toCard && toCard.intendedPath),
          key: edgeKey,
        });
      } else {
        rawForward.push({
          from: fromId, to: ans.next, ansIdx: ansIdx,
          fd: fd !== undefined ? fd : 0,
          td: td !== undefined ? td : 0,
          portX: portX,
          toIntended: !!(toCard && toCard.intendedPath),
          key: edgeKey,
        });
      }
    });
  });

  // 5b. Gutter offsets + build forward edge paths
  var gutterOffsets = allocateGutterOffsets(rawForward);
  var edges = rawForward.map(function(e) {
    var fp = posMap[e.from], tp = posMap[e.to];
    var gOff = gutterOffsets[e.key] || 0;
    var srcCX = fp.x + FL_CARD_W / 2;
    var dstCX = tp.x + FL_CARD_W / 2;
    return Object.assign({}, e, {
      d: buildForwardPath(srcCX, fp.y + FL_CARD_H, dstCX, tp.y, e.fd, e.td, gOff),
    });
  });

  // 6. Orphans
  var orphans = Object.keys(cards).filter(function(id) { return depth[id] === undefined; });
  var orphanSectionH = orphans.length > 0 ? (50 + Math.ceil(orphans.length / 3) * (FL_CARD_H + 10)) : 0;
  var mainCanvasW = maxRowW + FL_PAD * 2;
  var canvasH = (maxDepth + 1) * FL_ROW_H + FL_PAD * 2 + orphanSectionH;
  var loopZoneLeft = mainCanvasW + 10;

  // 5c. Loop lane allocation — wider spans go further right
  var loopsSorted = rawLoop.slice().sort(function(a, b) {
    return Math.abs(b.fd - b.td) - Math.abs(a.fd - a.td);
  });
  var loopLaneMap = {};
  loopsSorted.forEach(function(e, i) {
    loopLaneMap[e.key] = loopZoneLeft + 20 + i * 38;
  });

  var loopEdges = rawLoop.map(function(e) {
    var laneX = loopLaneMap[e.key];
    return Object.assign({}, e, {
      d: buildLoopPath(e.fromPos, e.toPos, laneX),
      laneX: laneX,
    });
  });

  var loopZoneW = rawLoop.length > 0 ? (50 + rawLoop.length * 38) : 0;
  var canvasW = mainCanvasW + loopZoneW;

  return { posMap: posMap, edges: edges, loopEdges: loopEdges, canvasW: canvasW, canvasH: canvasH, loopZoneLeft: loopZoneLeft, mainCanvasW: mainCanvasW, orphans: orphans, depthMap: depth };
}

function getAncestors(selectedId, cards) {
  var ancestors = {};
  function walk(id) {
    Object.keys(cards).forEach(function(pid) {
      if (ancestors[pid]) return;
      if ((cards[pid].answers || []).some(function(a) { return a && a.next === id; })) {
        ancestors[pid] = true;
        walk(pid);
      }
    });
  }
  walk(selectedId);
  return ancestors;
}

function getDescendants(selectedId, cards) {
  var desc = {};
  function walk(id) {
    ((cards[id] && cards[id].answers) || []).forEach(function(a) {
      if (a && a.next && !desc[a.next]) {
        desc[a.next] = true;
        walk(a.next);
      }
    });
  }
  walk(selectedId);
  return desc;
}

export function FlowView({ cards, rootCard, onEdit, onSetRoot }) {
  var [zoom,       setZoom]       = useState(1.0);
  var zoomRef      = useRef(1.0);
  var [pan,        setPan]        = useState({ x: 0, y: 0 });
  var panRef       = useRef({ x: 0, y: 0 });
  var [selectedId, setSelectedId] = useState(null);
  var containerRef = useRef(null);
  var pinchRef     = useRef(null);
  var dragRef      = useRef({ active: false, startPX: 0, startPY: 0, startCX: 0, startCY: 0, moved: false });
  var canEdit      = !!onEdit;

  var layout = buildFlowLayout(cards, rootCard, selectedId);

  // Auto-fit on mount
  useEffect(function() {
    if (!containerRef.current || !layout.canvasW) return;
    var cW = containerRef.current.clientWidth;
    var cH = containerRef.current.clientHeight;
    var nz = Math.min(1.0, Math.min((cW - 20) / layout.canvasW, (cH - 20) / layout.canvasH));
    nz = Math.max(MIN_ZOOM, nz);
    var np = { x: (cW - layout.canvasW * nz) / 2, y: (cH - layout.canvasH * nz) / 2 };
    setZoom(nz); zoomRef.current = nz;
    setPan(np); panRef.current = np;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function fitToView() {
    if (!containerRef.current || !layout.canvasW) return;
    var cW = containerRef.current.clientWidth;
    var cH = containerRef.current.clientHeight;
    var nz = Math.min(1.0, Math.min((cW - 20) / layout.canvasW, (cH - 20) / layout.canvasH));
    nz = Math.max(MIN_ZOOM, nz);
    var np = { x: (cW - layout.canvasW * nz) / 2, y: (cH - layout.canvasH * nz) / 2 };
    setZoom(nz); zoomRef.current = nz;
    setPan(np); panRef.current = np;
  }

  // Pinch-to-zoom
  useEffect(function() {
    var el = containerRef.current;
    if (!el) return;
    function dist(e) { return Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); }
    function onTS(e) {
      if (e.touches.length === 2) {
        var rect = el.getBoundingClientRect();
        pinchRef.current = {
          d: dist(e), z: zoomRef.current,
          mx: (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left,
          my: (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top,
        };
      }
    }
    function onTM(e) {
      if (e.touches.length === 2 && pinchRef.current) {
        e.preventDefault();
        var nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinchRef.current.z * dist(e) / pinchRef.current.d));
        var mx = pinchRef.current.mx, my = pinchRef.current.my;
        var np = {
          x: mx - (mx - panRef.current.x) * (nz / zoomRef.current),
          y: my - (my - panRef.current.y) * (nz / zoomRef.current),
        };
        zoomRef.current = nz; panRef.current = np;
        setZoom(nz); setPan(Object.assign({}, np));
      }
    }
    function onTE(e) { if (e.touches.length < 2) pinchRef.current = null; }
    el.addEventListener("touchstart", onTS, { passive: true });
    el.addEventListener("touchmove",  onTM, { passive: false });
    el.addEventListener("touchend",   onTE, { passive: true });
    return function() {
      el.removeEventListener("touchstart", onTS);
      el.removeEventListener("touchmove",  onTM);
      el.removeEventListener("touchend",   onTE);
    };
  }, []);

  function onWheel(e) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    var rect = containerRef.current ? containerRef.current.getBoundingClientRect() : { left: 0, top: 0 };
    var mx = e.clientX - rect.left, my = e.clientY - rect.top;
    var nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomRef.current * (1 - e.deltaY * 0.002)));
    var np = {
      x: mx - (mx - panRef.current.x) * (nz / zoomRef.current),
      y: my - (my - panRef.current.y) * (nz / zoomRef.current),
    };
    zoomRef.current = nz; panRef.current = np;
    setZoom(nz); setPan(Object.assign({}, np));
  }

  function onBgPointerDown(e) {
    if (e.target.closest("[data-flow-card]")) return;
    dragRef.current = { active: true, startPX: e.clientX, startPY: e.clientY, startCX: panRef.current.x, startCY: panRef.current.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onBgPointerMove(e) {
    var d = dragRef.current;
    if (!d.active) return;
    var dx = e.clientX - d.startPX, dy = e.clientY - d.startPY;
    if (!d.moved && Math.sqrt(dx * dx + dy * dy) < 6) return;
    d.moved = true;
    var np = { x: d.startCX + dx, y: d.startCY + dy };
    panRef.current = np;
    setPan(Object.assign({}, np));
  }
  function onBgPointerUp() {
    if (dragRef.current.active && !dragRef.current.moved) setSelectedId(null);
    dragRef.current = Object.assign({}, dragRef.current, { active: false, moved: false });
  }

  function onCardClick(e, cardId, card) {
    e.stopPropagation();
    if (selectedId === cardId) {
      if (canEdit) { onEdit(card); setSelectedId(null); }
    } else {
      setSelectedId(cardId);
    }
  }

  var highlighted = {};
  if (selectedId) {
    highlighted[selectedId] = true;
    var anc = getAncestors(selectedId, cards);
    var desc = getDescendants(selectedId, cards);
    Object.keys(anc).forEach(function(k) { highlighted[k] = true; });
    Object.keys(desc).forEach(function(k) { highlighted[k] = true; });
  }

  function cardOpacity(cardId) {
    if (!selectedId) return 1;
    return highlighted[cardId] ? 1 : 0.15;
  }
  function edgeOpacity(edge) {
    if (!selectedId) return 1;
    return (highlighted[edge.from] && highlighted[edge.to]) ? 1 : 0.07;
  }

  if (!cards || Object.keys(cards).length === 0) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: "rgba(255,255,255,.3)", fontSize: 13 }}>
        No cards yet.
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>

      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderBottom: "1px solid rgba(255,255,255,.06)", flexShrink: 0 }}>
        <button onClick={function() { var nz = Math.min(MAX_ZOOM, +(zoom + 0.15).toFixed(2)); setZoom(nz); zoomRef.current = nz; }}
          style={{ background: "rgba(255,255,255,.07)", border: "none", color: "rgba(255,255,255,.6)", borderRadius: 5, padding: "3px 9px", cursor: "pointer", fontSize: 14, fontFamily: "inherit" }}>+</button>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,.35)", minWidth: 36, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
        <button onClick={function() { var nz = Math.max(MIN_ZOOM, +(zoom - 0.15).toFixed(2)); setZoom(nz); zoomRef.current = nz; }}
          style={{ background: "rgba(255,255,255,.07)", border: "none", color: "rgba(255,255,255,.6)", borderRadius: 5, padding: "3px 9px", cursor: "pointer", fontSize: 14, fontFamily: "inherit" }}>−</button>
        <button onClick={function() { setZoom(1.0); zoomRef.current = 1.0; setPan({ x: 0, y: 0 }); panRef.current = { x: 0, y: 0 }; }}
          style={{ background: "rgba(255,255,255,.07)", border: "none", color: "rgba(255,255,255,.4)", borderRadius: 5, padding: "3px 8px", cursor: "pointer", fontSize: 11, marginLeft: 2, fontFamily: "inherit" }}>Reset</button>
        <button onClick={fitToView}
          style={{ background: "rgba(255,255,255,.07)", border: "none", color: "rgba(255,255,255,.4)", borderRadius: 5, padding: "3px 8px", cursor: "pointer", fontSize: 11, marginLeft: 2, fontFamily: "inherit" }}>Fit</button>
        <span style={{ marginLeft: "auto", fontSize: 9, color: "rgba(255,255,255,.2)" }}>
          Tap to select · tap again to edit · ★ = intended · Pinch or ctrl+scroll to zoom
        </span>
      </div>

      {/* Canvas viewport */}
      <div
        ref={containerRef}
        style={{ flex: 1, overflow: "hidden", position: "relative", cursor: "grab", userSelect: "none" }}
        onPointerDown={onBgPointerDown}
        onPointerMove={onBgPointerMove}
        onPointerUp={onBgPointerUp}
        onWheel={onWheel}
      >
        <div style={{
          position: "absolute",
          width: layout.canvasW, height: layout.canvasH,
          transform: "translate(" + pan.x + "px," + pan.y + "px) scale(" + zoom + ")",
          transformOrigin: "0 0",
        }}>

          {/* SVG edges layer — renders below cards */}
          <svg style={{ position: "absolute", inset: 0, width: layout.canvasW, height: layout.canvasH, overflow: "visible", pointerEvents: "none" }}>
            <defs>
              <marker id="fl-arr-ip" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                <polygon points="0,0 8,4 0,8" fill={FL_EDGE_IP} />
              </marker>
              <marker id="fl-arr-nm" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                <polygon points="0,0 8,4 0,8" fill={FL_EDGE_NRM} />
              </marker>
              <marker id="fl-arr-loop" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                <polygon points="0,0 8,4 0,8" fill={FL_EDGE_LBK} />
              </marker>
            </defs>

            {/* Forward edges — orthogonal staircase, bottom→top, X changes only in row gutters */}
            {layout.edges.map(function(edge) {
              var ip = edge.toIntended;
              return (
                <path key={edge.key} d={edge.d}
                  stroke={ip ? FL_EDGE_IP : FL_EDGE_NRM}
                  strokeWidth={ip ? 2.5 : 1.5}
                  fill="none"
                  opacity={edgeOpacity(edge)}
                  markerEnd={ip ? "url(#fl-arr-ip)" : "url(#fl-arr-nm)"}
                />
              );
            })}

            {/* Loopback edges — dashed amber, route to the right of the canvas */}
            {layout.loopEdges.map(function(edge) {
              return (
                <path key={edge.key} d={edge.d}
                  stroke={FL_EDGE_LBK}
                  strokeWidth="1.5"
                  strokeDasharray="5 3"
                  fill="none"
                  opacity={edgeOpacity(edge)}
                  markerEnd="url(#fl-arr-loop)"
                />
              );
            })}
          </svg>

          {/* Card nodes */}
          {Object.keys(layout.posMap).map(function(cardId) {
            var p    = layout.posMap[cardId];
            var card = cards[cardId];
            if (!card || !p) return null;
            var meta       = TM[card.type] || TM.pitch;
            var isRoot     = cardId === rootCard;
            var isSelected = cardId === selectedId;
            var answers    = card.answers || [];
            var expandedH  = isSelected ? (FL_CARD_H + answers.length * FL_ANS_H + (canEdit ? FL_BAR_H : 0)) : FL_CARD_H;
            var op         = cardOpacity(cardId);
            var borderColor = isSelected ? meta.color : card.intendedPath ? "rgba(168,255,62,.28)" : "rgba(255,255,255,.10)";

            return (
              <div
                key={cardId}
                data-flow-card="1"
                onClick={function(e) { onCardClick(e, cardId, card); }}
                style={{
                  position: "absolute", left: p.x, top: p.y,
                  width: FL_CARD_W, height: expandedH,
                  background: card.intendedPath ? "rgba(168,255,62,.07)" : isSelected ? "rgba(255,255,255,.10)" : "rgba(255,255,255,.06)",
                  borderTop:    "3px solid " + (card.intendedPath ? "#A8FF3E" : meta.color),
                  borderRight:  "1px solid " + borderColor,
                  borderBottom: "1px solid " + borderColor,
                  borderLeft:   "1px solid " + borderColor,
                  borderRadius: 9,
                  cursor: "pointer",
                  overflow: "hidden",
                  opacity: op,
                  boxShadow: isSelected ? ("0 0 0 2px " + meta.color + "44,0 6px 20px rgba(0,0,0,.55)") : "0 2px 8px rgba(0,0,0,.3)",
                  transition: "opacity .16s, box-shadow .15s, height .12s",
                  zIndex: isSelected ? 10 : 2,
                  display: "flex", flexDirection: "column",
                  touchAction: "none",
                }}
              >
                {/* Header row */}
                <div style={{ height: FL_CARD_H, padding: "0 9px", display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                  <span style={{ fontSize: 11 }}>{meta.icon}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {card.title || "(untitled)"}
                  </span>
                  {isRoot && <span style={{ fontSize: 8, background: "rgba(0,180,255,.2)", color: "#00B4FF", borderRadius: 99, padding: "1px 5px", fontWeight: 700, flexShrink: 0 }}>root</span>}
                  {card.intendedPath && <span style={{ fontSize: 9, color: "#A8FF3E", flexShrink: 0 }}>★</span>}
                </div>

                {/* Expanded: answer rows + action bar */}
                {isSelected && (
                  <div style={{ flex: 1, borderTop: "1px solid rgba(255,255,255,.08)", display: "flex", flexDirection: "column" }}>
                    {answers.map(function(ans, i) {
                      var fd = layout.depthMap[cardId], td = layout.depthMap[ans.next];
                      var isBack = ans.next && td !== undefined && fd !== undefined && td <= fd;
                      var hasLink = !!ans.next;
                      return (
                        <div key={ans.id || i} style={{
                          height: FL_ANS_H, padding: "0 9px",
                          display: "flex", alignItems: "center", gap: 5, flexShrink: 0,
                          borderTop: i > 0 ? "1px solid rgba(255,255,255,.05)" : "none",
                        }}>
                          <span style={{ fontSize: 9, color: hasLink ? "rgba(255,255,255,.75)" : "rgba(255,255,255,.3)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {ans.label || "—"}
                          </span>
                          {isBack && <span style={{ fontSize: 9, color: "rgba(255,167,38,.7)", flexShrink: 0 }}>↻</span>}
                          {hasLink && !isBack && <span style={{ fontSize: 9, color: "rgba(255,255,255,.3)", flexShrink: 0 }}>↓</span>}
                        </div>
                      );
                    })}
                    {canEdit && (
                      <div style={{ height: FL_BAR_H, borderTop: "1px solid rgba(255,255,255,.08)", display: "flex", flexShrink: 0, marginTop: "auto" }}>
                        <button onClick={function(e) { e.stopPropagation(); onEdit(card); setSelectedId(null); }}
                          style={{ flex: 1, fontSize: 10, color: "rgba(255,255,255,.7)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
                          ✏ Edit
                        </button>
                        {onSetRoot && !isRoot && (
                          <button onClick={function(e) { e.stopPropagation(); onSetRoot(cardId); setSelectedId(null); }}
                            style={{ flex: 1, fontSize: 10, color: "rgba(168,255,62,.8)", background: "none", border: "none", borderLeft: "1px solid rgba(255,255,255,.07)", cursor: "pointer", fontFamily: "inherit" }}>
                            ⬆ Root
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Loopback zone separator — vertical line to the right of main cards */}
          {layout.loopEdges.length > 0 && (
            <div style={{ position: "absolute", left: layout.loopZoneLeft - 6, top: FL_PAD, width: 1, height: layout.canvasH - FL_PAD * 2, background: "rgba(255,167,38,.15)" }} />
          )}
          {layout.loopEdges.length > 0 && (
            <div style={{ position: "absolute", left: layout.loopZoneLeft, top: FL_PAD + 4, fontSize: 9, color: "rgba(255,167,38,.35)", textTransform: "uppercase", letterSpacing: 0.8, writingMode: "vertical-rl" }}>
              ↩ Loops ({layout.loopEdges.length})
            </div>
          )}

          {/* Orphan section */}
          {layout.orphans.length > 0 && (
            <div style={{ position: "absolute", left: FL_PAD, top: layout.canvasH - orphanSectionH(layout.orphans), width: layout.mainCanvasW - FL_PAD * 2 }}>
              <div style={{ height: 1, background: "rgba(255,255,255,.07)", marginBottom: 12 }} />
              <div style={{ fontSize: 9, color: "rgba(255,255,255,.2)", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 }}>
                Unconnected ({layout.orphans.length})
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {layout.orphans.map(function(id) {
                  var card = cards[id];
                  if (!card) return null;
                  var meta = TM[card.type] || TM.pitch;
                  return (
                    <div key={id} data-flow-card="1"
                      onClick={function(e) { e.stopPropagation(); if (canEdit) onEdit(card); }}
                      style={{
                        width: FL_CARD_W, height: FL_CARD_H,
                        background: "rgba(255,255,255,.03)",
                        border: "1px dashed rgba(255,255,255,.12)",
                        borderTop: "3px solid rgba(255,255,255,.12)",
                        borderRadius: 9, cursor: canEdit ? "pointer" : "default",
                        display: "flex", alignItems: "center", gap: 5,
                        padding: "0 9px", opacity: 0.45,
                      }}
                    >
                      <span style={{ fontSize: 11 }}>{meta.icon}</span>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,.5)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {card.title || "(untitled)"}
                      </span>
                      <span style={{ fontSize: 8, color: "rgba(255,255,255,.2)" }}>orphan</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

function orphanSectionH(orphans) {
  return orphans.length > 0 ? (50 + Math.ceil(orphans.length / 3) * (FL_CARD_H + 10)) : 0;
}

// Both names alias to FlowView
export var TreeView     = FlowView;
export var SwimlaneView = FlowView;
