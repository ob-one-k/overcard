import { useState, useLayoutEffect } from "react";

// ─── SLIDING TAB INDICATOR ────────────────────────────────────────────────────
// Measures the active `[data-tab="<key>"]` child of containerRef (relative to the
// container, which must be position:relative) so one absolutely positioned
// indicator can slide between tabs. Render the indicator first and give the tabs
// position:relative + zIndex:1 so they sit above it.
// Re-measures on resize (rotation, sidebar collapse, drawer open). `animate` is
// false for the first placement, so the indicator appears in place instead of
// sliding in from the corner.
//   var ind = useSlidingIndicator(ref, tab);
//   ind.style → { transform, width, height, transition } or null before measuring
export function useSlidingIndicator(containerRef, activeKey, deps) {
  var [box, setBox] = useState(null);

  useLayoutEffect(function() {
    var el = containerRef.current;
    if (!el) return;
    function measure() {
      var t = el.querySelector('[data-tab="' + activeKey + '"]');
      if (!t) { setBox(null); return; }
      // Walk the offsetParent chain up to the container: layout positions ignore
      // transforms, so a button mid-press (scaled) never skews the measurement
      var x = 0, y = 0, n = t;
      while (n && n !== el) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
      if (n !== el) return;   // container isn't positioned / tab not inside it
      var next = { x: x, y: y, w: t.offsetWidth, h: t.offsetHeight };
      setBox(function(prev) {
        if (prev && prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h) return prev;
        // Slide only when moving between two real positions
        next.animate = !!prev;
        return next;
      });
    }
    measure();
    var ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro) {
      ro.observe(el);
      Array.prototype.forEach.call(el.querySelectorAll("[data-tab]"), function(c) { ro.observe(c); });
    }
    window.addEventListener("resize", measure);
    return function() { if (ro) ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [containerRef, activeKey].concat(deps || []));

  if (!box) return { style: null };
  var ease = "cubic-bezier(.22,1,.36,1)";
  return {
    style: {
      position: "absolute", left: 0, top: 0,
      width: box.w, height: box.h,
      transform: "translate(" + box.x + "px," + box.y + "px)",
      transition: box.animate ? "transform .34s " + ease + ", width .34s " + ease + ", height .34s " + ease : "none",
      pointerEvents: "none",
    },
  };
}
