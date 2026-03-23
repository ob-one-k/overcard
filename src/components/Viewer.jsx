import { useState, useEffect, useRef } from "react";
import { TM } from "../lib/constants";

// ─── FLOW VIEW ─────────────────────────────────────────────────────────────────
var MIN_ZOOM    = 0.28;
var MAX_ZOOM    = 1.80;
var FL_CARD_W   = 224;
var FL_CARD_H   = 46;
var FL_ANS_H    = 22;
var FL_BAR_H    = 28;
var FL_CARD_GAP = 14;
var FL_COL_W    = 280;
var FL_PAD      = 40;
var FL_EDGE_IP  = "rgba(168,255,62,.70)";
var FL_EDGE_NRM = "rgba(255,255,255,.22)";
var FL_EDGE_LBK = "rgba(255,167,38,.60)";

// ─── ORTHOGONAL FORWARD PATH ────────────────────────────────────────────────
// Routes from right edge of source to left edge of target, changing Y only
// inside the column gutters (56px wide), never while crossing a card column.
function buildForwardPath(srcRight, srcY, dstLeft, dstY, fd, td, gutterOffset) {
  var off = gutterOffset || 0;
  var parts = ["M " + srcRight + "," + srcY.toFixed(1)];
  for (var d = fd; d < td; d++) {
    var gx = (FL_PAD + d * FL_COL_W + FL_CARD_W + 28 + off).toFixed(1);
    var nextY = (srcY + (dstY - srcY) * (d - fd + 1) / (td - fd)).toFixed(1);
    parts.push("H " + gx);
    parts.push("V " + nextY);
  }
  parts.push("H " + dstLeft);
  return parts.join(" ");
}

// ─── LOOPBACK PATH ──────────────────────────────────────────────────────────
// Routes below the main canvas area and re-enters the target card from the left.
function buildLoopPath(fromPos, toPos, laneY) {
  var sx = (fromPos.x + FL_CARD_W / 2).toFixed(1);
  var sy = fromPos.y + FL_CARD_H;
  var tx = toPos.x;
  var ty = (toPos.y + FL_CARD_H / 2).toFixed(1);
  var routeX = (tx - 14).toFixed(1);
  return "M " + sx + "," + sy + " V " + laneY + " H " + routeX + " V " + ty + " H " + tx;
}

// ─── GUTTER LANE OFFSET ALLOCATOR ───────────────────────────────────────────
// Assigns small X offsets to parallel forward edges that share the same
// (source-depth → target-depth) pair, so they don't overlap in the gutter.
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

function avgParentY(id, cards, tempY) {
  var parents = [];
  Object.keys(cards).forEach(function(pid) {
    if ((cards[pid].answers||[]).some(function(a){ return a && a.next === id; })) {
      if (tempY[pid] !== undefined) parents.push(tempY[pid]);
    }
  });
  if (!parents.length) return tempY[id] || 0;
  return parents.reduce(function(s, y) { return s + y; }, 0) / parents.length;
}

function buildFlowLayout(cards, rootCard, selectedId) {
  if (!rootCard || !cards || !cards[rootCard]) {
    return { posMap: {}, edges: [], loopEdges: [], canvasW: 400, canvasH: 300, loopZoneTop: 300, orphans: [], depthMap: {} };
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

  // 2. Group into columns
  var columns = {};
  Object.keys(depth).forEach(function(id) {
    var d = depth[id];
    if (!columns[d]) columns[d] = [];
    columns[d].push(id);
  });
  var maxDepth = Object.keys(columns).reduce(function(m, d) { return Math.max(m, +d); }, 0);

  // 3. Barycenter sort (2 passes) to minimize edge crossings
  var tempY = {};
  Object.keys(columns).forEach(function(d) {
    columns[d].forEach(function(id, i) { tempY[id] = i; });
  });
  for (var pass = 0; pass < 2; pass++) {
    for (var d = 1; d <= maxDepth; d++) {
      if (!columns[d]) continue;
      columns[d] = columns[d].slice().sort(function(a, b) {
        return avgParentY(a, cards, tempY) - avgParentY(b, cards, tempY);
      });
      // Force intended-path card to the vertical center of its column
      var col = columns[d];
      var ipId = col.find(function(id) { return cards[id] && cards[id].intendedPath; });
      var ipIdx = ipId !== undefined ? col.indexOf(ipId) : -1;
      if (ipIdx !== -1 && col.length > 1) {
        var mid = Math.floor(col.length / 2);
        col.splice(ipIdx, 1);
        col.splice(mid, 0, ipId);
      }
      col.forEach(function(id, i) { tempY[id] = i; });
    }
  }

  // 4. Assign pixel positions — vertically center each column
  var colHeights = {};
  Object.keys(columns).forEach(function(d) {
    colHeights[d] = columns[d].length * (FL_CARD_H + FL_CARD_GAP) - FL_CARD_GAP;
  });
  var maxColH = Object.keys(colHeights).reduce(function(m, d) { return Math.max(m, colHeights[d]); }, FL_CARD_H);

  var posMap = {};
  Object.keys(columns).forEach(function(d) {
    var col = columns[d];
    var colH = colHeights[d];
    var startY = FL_PAD + (maxColH - colH) / 2;
    col.forEach(function(id, i) {
      posMap[id] = {
        x: FL_PAD + (+d) * FL_COL_W,
        y: startY + i * (FL_CARD_H + FL_CARD_GAP),
      };
    });
  });

  // 5a. Collect raw edges — split into forward (td > fd) and loopback (td <= fd)
  var rawForward = [], rawLoop = [];
  Object.keys(cards).forEach(function(fromId) {
    if (!posMap[fromId]) return;
    var card = cards[fromId];
    var fp = posMap[fromId];
    var isFromSelected = fromId === selectedId;
    (card.answers || []).forEach(function(ans, ansIdx) {
      if (!ans || !ans.next || !posMap[ans.next]) return;
      var fd = depth[fromId], td = depth[ans.next];
      var tp = posMap[ans.next];
      var toCard = cards[ans.next];
      var portY = isFromSelected
        ? (fp.y + FL_CARD_H + ansIdx * FL_ANS_H + FL_ANS_H / 2)
        : (fp.y + FL_CARD_H / 2);
      var edgeKey = fromId + "-" + (ans.id || ansIdx);
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
          portY: portY,
          toIntended: !!(toCard && toCard.intendedPath),
          key: edgeKey,
        });
      }
    });
  });

  // 5b. Gutter offset allocation + build forward edge paths
  var gutterOffsets = allocateGutterOffsets(rawForward);
  var edges = rawForward.map(function(e) {
    var fp = posMap[e.from], tp = posMap[e.to];
    var gOff = gutterOffsets[e.key] || 0;
    return Object.assign({}, e, {
      d: buildForwardPath(fp.x + FL_CARD_W, e.portY, tp.x, tp.y + FL_CARD_H / 2, e.fd, e.td, gOff),
    });
  });

  // 6. Orphans (unreachable from root)
  var orphans = Object.keys(cards).filter(function(id) { return depth[id] === undefined; });
  var orphanSectionH = orphans.length > 0 ? (50 + Math.ceil(orphans.length / 3) * (FL_CARD_H + 10)) : 0;
  var canvasW = (maxDepth + 1) * FL_COL_W + FL_PAD * 2;
  var loopZoneTop = maxColH + FL_PAD * 2 + orphanSectionH;

  // 5c. Loop lane allocation — wider depth-spans get deeper lanes so arcs don't cross
  var loopsSorted = rawLoop.slice().sort(function(a, b) {
    return Math.abs(b.fd - b.td) - Math.abs(a.fd - a.td);
  });
  var loopLaneMap = {};
  loopsSorted.forEach(function(e, i) {
    loopLaneMap[e.key] = loopZoneTop + 30 + i * 40;
  });

  var loopEdges = rawLoop.map(function(e) {
    var laneY = loopLaneMap[e.key];
    return Object.assign({}, e, {
      d: buildLoopPath(e.fromPos, e.toPos, laneY),
      laneY: laneY,
    });
  });

  var loopZoneH = rawLoop.length > 0 ? (60 + rawLoop.length * 40) : 0;
  var canvasH = loopZoneTop + loopZoneH;

  return { posMap: posMap, edges: edges, loopEdges: loopEdges, canvasW: canvasW, canvasH: canvasH, loopZoneTop: loopZoneTop, orphans: orphans, depthMap: depth };
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

  // Layout is fully deterministic from data — no position state needed
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

  // Pinch-to-zoom (must be non-passive to call preventDefault)
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

  // Path highlighting: build set of "related" nodes when a card is selected
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
        <button
          onClick={function() { var nz = Math.min(MAX_ZOOM, +(zoom + 0.15).toFixed(2)); setZoom(nz); zoomRef.current = nz; }}
          style={{ background: "rgba(255,255,255,.07)", border: "none", color: "rgba(255,255,255,.6)", borderRadius: 5, padding: "3px 9px", cursor: "pointer", fontSize: 14, fontFamily: "inherit" }}>+</button>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,.35)", minWidth: 36, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
        <button
          onClick={function() { var nz = Math.max(MIN_ZOOM, +(zoom - 0.15).toFixed(2)); setZoom(nz); zoomRef.current = nz; }}
          style={{ background: "rgba(255,255,255,.07)", border: "none", color: "rgba(255,255,255,.6)", borderRadius: 5, padding: "3px 9px", cursor: "pointer", fontSize: 14, fontFamily: "inherit" }}>−</button>
        <button
          onClick={function() { setZoom(1.0); zoomRef.current = 1.0; setPan({ x: 0, y: 0 }); panRef.current = { x: 0, y: 0 }; }}
          style={{ background: "rgba(255,255,255,.07)", border: "none", color: "rgba(255,255,255,.4)", borderRadius: 5, padding: "3px 8px", cursor: "pointer", fontSize: 11, marginLeft: 2, fontFamily: "inherit" }}>Reset</button>
        <button
          onClick={fitToView}
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
        {/* Scaled + panned inner canvas */}
        <div style={{
          position: "absolute",
          width: layout.canvasW, height: layout.canvasH,
          transform: "translate(" + pan.x + "px," + pan.y + "px) scale(" + zoom + ")",
          transformOrigin: "0 0",
        }}>

          {/* SVG edges layer */}
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

            {/* Forward edges — orthogonal staircase through column gutters */}
            {layout.edges.map(function(edge) {
              var ip = edge.toIntended;
              return (
                <path
                  key={edge.key}
                  d={edge.d}
                  stroke={ip ? FL_EDGE_IP : FL_EDGE_NRM}
                  strokeWidth={ip ? 2.5 : 1.5}
                  fill="none"
                  opacity={edgeOpacity(edge)}
                  markerEnd={ip ? "url(#fl-arr-ip)" : "url(#fl-arr-nm)"}
                />
              );
            })}

            {/* Loopback edges — dashed amber arcs routed below the main canvas */}
            {layout.loopEdges.map(function(edge) {
              return (
                <path
                  key={edge.key}
                  d={edge.d}
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
                  borderTop:    "1px solid " + borderColor,
                  borderRight:  "1px solid " + borderColor,
                  borderBottom: "1px solid " + borderColor,
                  borderLeft:   "3px solid " + (card.intendedPath ? "#A8FF3E" : meta.color),
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

                {/* Expanded state: answer rows + action bar */}
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
                          {hasLink && !isBack && <span style={{ fontSize: 9, color: "rgba(255,255,255,.3)", flexShrink: 0 }}>→</span>}
                        </div>
                      );
                    })}
                    {canEdit && (
                      <div style={{ height: FL_BAR_H, borderTop: "1px solid rgba(255,255,255,.08)", display: "flex", flexShrink: 0, marginTop: "auto" }}>
                        <button
                          onClick={function(e) { e.stopPropagation(); onEdit(card); setSelectedId(null); }}
                          style={{ flex: 1, fontSize: 10, color: "rgba(255,255,255,.7)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
                          ✏ Edit
                        </button>
                        {onSetRoot && !isRoot && (
                          <button
                            onClick={function(e) { e.stopPropagation(); onSetRoot(cardId); setSelectedId(null); }}
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

          {/* Loopback zone separator — shown below main cards when loopbacks exist */}
          {layout.loopEdges.length > 0 && (
            <div style={{ position: "absolute", left: FL_PAD, top: layout.loopZoneTop + 8, width: layout.canvasW - FL_PAD * 2 }}>
              <div style={{ height: 1, background: "rgba(255,167,38,.18)", marginBottom: 6 }} />
              <div style={{ fontSize: 9, color: "rgba(255,167,38,.35)", textTransform: "uppercase", letterSpacing: 0.8 }}>
                ↩ Loops ({layout.loopEdges.length})
              </div>
            </div>
          )}

          {/* Orphan section — positioned just above the loopback zone */}
          {layout.orphans.length > 0 && (
            <div style={{ position: "absolute", left: FL_PAD, top: layout.loopZoneTop - (50 + Math.ceil(layout.orphans.length / 3) * (FL_CARD_H + 10)), width: layout.canvasW - FL_PAD * 2 }}>
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
                    <div
                      key={id}
                      data-flow-card="1"
                      onClick={function(e) { e.stopPropagation(); if (canEdit) onEdit(card); }}
                      style={{
                        width: FL_CARD_W, height: FL_CARD_H,
                        background: "rgba(255,255,255,.03)",
                        border: "1px dashed rgba(255,255,255,.12)",
                        borderLeft: "3px solid rgba(255,255,255,.12)",
                        borderRadius: 9,
                        cursor: canEdit ? "pointer" : "default",
                        display: "flex", alignItems: "center", gap: 5,
                        padding: "0 9px",
                        opacity: 0.45,
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

// Both names alias to FlowView — Cards.jsx uses SwimlaneView, ObjectionsTab uses SwimlaneView
export var TreeView     = FlowView;
export var SwimlaneView = FlowView;
