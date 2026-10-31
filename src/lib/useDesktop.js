import { useState, useEffect } from "react";

// ─── LAYOUT BREAKPOINT DETECTION HOOK ─────────────────────────────────────────
// Returns {
//   layout:        "desktop" | "tablet" | "mobile"
//   isDesktop:     width >= 1024 AND primary input is NOT touch   (full desktop)
//   isTablet:      layout === "tablet"
//   isMobile:      layout === "mobile" (phone layout, unchanged)
//   isTouchPrimary
//   compact:       true on tablet — desktop shell with a tighter type scale,
//                  icon rail, and list/detail panes
//   splitPanes:    true when list + detail panes fit side by side
//                  (always on desktop; tablet only when the window is >= 960 wide)
//   landscape:     window wider than tall — phone/tablet screens switch to their
//                  landscape layouts (desktop ignores it)
// }
//
// Breakpoints:
//   mobile  — width < 768, or a touch device whose SHORT screen side is < 600
//             (keeps landscape phones, e.g. 844×390, on the phone layout)
//   tablet  — 768 <= width < 1024 (any pointer), or any touch-primary device
//             >= 768 wide with a tablet-sized screen
//   desktop — width >= 1024 with a fine (mouse/trackpad) primary pointer
//
// NOTE: App.jsx hands DesktopCtx a value with isDesktop:true on tablet so every
// existing `desktop.isDesktop ? <XDesktop/> : <XMobile/>` switch renders the
// desktop component; compact-aware code checks `desktop.compact`.
export var SPLIT_MIN_W = 960;

export function detectLayout() {
  var w = window.innerWidth;
  var h = window.innerHeight;
  var coarse = false;
  try { coarse = window.matchMedia("(pointer: coarse)").matches; } catch (e) {}
  // Touch-primary: coarse pointer OR touch events present on a sub-1024 screen
  var touchPrimary = coarse || ("ontouchstart" in window && w < 1024);
  // Use the physical screen's short side (not innerHeight) so an on-screen
  // keyboard shrinking the viewport can't flip a tablet into the phone layout
  var shortSide = Math.min(w, h);
  try {
    if (window.screen && window.screen.width && window.screen.height) {
      shortSide = Math.min(window.screen.width, window.screen.height);
    }
  } catch (e) {}
  var isDesktop = w >= 1024 && !touchPrimary;
  var isTablet  = !isDesktop && w >= 768 && (!touchPrimary || shortSide >= 600);
  var isMobile  = !isDesktop && !isTablet;
  var layout    = isDesktop ? "desktop" : isTablet ? "tablet" : "mobile";
  return {
    layout:         layout,
    isDesktop:      isDesktop,
    isTablet:       isTablet,
    isMobile:       isMobile,
    isTouchPrimary: touchPrimary,
    compact:        isTablet,
    splitPanes:     isDesktop || (isTablet && w >= SPLIT_MIN_W),
    landscape:      w > h
  };
}

export function useDesktop() {
  var [state, setState] = useState(detectLayout);

  useEffect(function() {
    var timer = null;
    function onResize() {
      clearTimeout(timer);
      timer = setTimeout(function() {
        var next = detectLayout();
        // Keep the same object when nothing changed so context consumers only
        // re-render when a breakpoint is actually crossed
        setState(function(prev) {
          var same = true;
          for (var k in next) { if (next[k] !== prev[k]) { same = false; break; } }
          return same ? prev : next;
        });
      }, 60);
    }
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return function() {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      clearTimeout(timer);
    };
  }, []);

  return state;
}
