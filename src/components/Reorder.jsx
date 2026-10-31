import { useRef, useState } from "react";

// ─── DRAG-TO-REORDER LIST ─────────────────────────────────────────────────────
// A vertical list whose rows can be dragged by a handle (mouse, touch or pen) or
// moved with ↑/↓ while the handle has focus. The dragged row follows the pointer
// and the rows it passes slide out of the way; onReorder(ids) gets the new order.
//   <ReorderList items={decks} getId={d => d.id} enabled={isOwner} gap={8}
//     onReorder={ids => …} renderItem={(d, handle) => <Row>{handle}…</Row>}/>
// `handle` is the grip element to place in the row (null when disabled).

export function ReorderList({ items, getId, renderItem, onReorder, enabled, gap, label }) {
  var g = gap == null ? 8 : gap;
  var rowRefs = useRef({});
  var drag = useRef(null);
  var [viz, setViz] = useState(null);    // { id, dy, target, from, h }

  function ids() { return items.map(getId); }

  function start(e, id) {
    if (!enabled || (e.button != null && e.button > 0)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    var order = ids();
    var rects = order.map(function(x) { var el = rowRefs.current[x]; return el ? el.getBoundingClientRect() : null; });
    var from = order.indexOf(id);
    drag.current = { id: id, startY: e.clientY, from: from, rects: rects, target: from };
    setViz({ id: id, dy: 0, target: from, from: from, h: rects[from] ? rects[from].height : 0 });
  }

  function move(e) {
    var d = drag.current;
    if (!d) return;
    var dy = e.clientY - d.startY;
    var r = d.rects[d.from];
    var center = r.top + r.height / 2 + dy;
    // Target slot: the first row whose middle lies below the dragged row's centre
    var target = d.rects.length - 1;
    for (var i = 0; i < d.rects.length; i++) {
      if (!d.rects[i]) continue;
      var mid = d.rects[i].top + d.rects[i].height / 2;
      if (center < mid) { target = i > d.from ? i - 1 : i; break; }
    }
    d.target = target;
    setViz({ id: d.id, dy: dy, target: target, from: d.from, h: r.height });
  }

  function end() {
    var d = drag.current;
    drag.current = null;
    setViz(null);
    if (!d || d.target === d.from) return;
    var order = ids();
    var moved = order.splice(d.from, 1)[0];
    order.splice(d.target, 0, moved);
    onReorder(order);
  }

  function nudge(e, id) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    var order = ids(), i = order.indexOf(id), j = e.key === "ArrowUp" ? i - 1 : i + 1;
    if (j < 0 || j >= order.length) return;
    order.splice(i, 1); order.splice(j, 0, id);
    onReorder(order);
    // Keep focus on the moved row's handle after it re-renders in its new place
    setTimeout(function() {
      var el = rowRefs.current[id] && rowRefs.current[id].querySelector("[data-reorder-handle]");
      if (el) el.focus();
    }, 0);
  }

  return (
    <div role="list" aria-label={label} style={{display:"flex",flexDirection:"column",gap:g}}>
      {items.map(function(item, idx) {
        var id = getId(item);
        var shift = 0, isDragged = false;
        if (viz) {
          if (id === viz.id) { isDragged = true; shift = viz.dy; }
          else if (viz.from < viz.target && idx > viz.from && idx <= viz.target) shift = -(viz.h + g);
          else if (viz.from > viz.target && idx >= viz.target && idx < viz.from) shift = viz.h + g;
        }
        var handle = enabled ? (
          <button type="button" data-reorder-handle aria-label="Drag to reorder (or use the arrow keys)" title="Drag to reorder"
            onPointerDown={function(e) { start(e, id); }} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
            onKeyDown={function(e) { nudge(e, id); }} onClick={function(e) { e.stopPropagation(); }}
            style={{touchAction:"none",cursor:viz && isDragged ? "grabbing" : "grab",background:"none",border:"none",color:"rgba(255,255,255,.4)",fontSize:16,lineHeight:1,
              width:32,minHeight:40,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontFamily:"inherit",padding:0,borderRadius:8}}>
            ⠿
          </button>
        ) : null;
        return (
          <div key={id} role="listitem" ref={function(el) { if (el) rowRefs.current[id] = el; else delete rowRefs.current[id]; }}
            style={{position:"relative",zIndex:isDragged ? 2 : 1,
              transform:shift ? "translateY(" + shift + "px)" : undefined,
              transition:isDragged || !viz ? "none" : "transform .2s cubic-bezier(.22,1,.36,1)",
              filter:isDragged ? "drop-shadow(0 12px 24px rgba(0,0,0,.5))" : undefined}}>
            {renderItem(item, handle, isDragged)}
          </div>
        );
      })}
    </div>
  );
}
