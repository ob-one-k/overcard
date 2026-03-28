import { useState, useEffect } from "react";

// ─── DESKTOP BREAKPOINT DETECTION HOOK ────────────────────────────────────────
// Returns { isDesktop, isTablet, isMobile, isTouchPrimary }
// isDesktop  = width >= 1024 AND primary input is NOT touch
// isTablet   = width >= 768 AND (width < 1024 OR primary input is touch)
// isMobile   = everything else (existing mobile layout, zero changes)
export function useDesktop() {
  function detect() {
    var w = window.innerWidth;
    var coarse = window.matchMedia("(pointer: coarse)").matches;
    // Touch-primary: coarse pointer OR touch events present on a sub-1024 screen
    var touchPrimary = coarse || ("ontouchstart" in window && w < 1024);
    var isDesktop = w >= 1024 && !touchPrimary;
    var isTablet  = !isDesktop && w >= 768;
    var isMobile  = !isDesktop && !isTablet;
    return { isDesktop: isDesktop, isTablet: isTablet, isMobile: isMobile, isTouchPrimary: touchPrimary };
  }

  var [state, setState] = useState(detect);

  useEffect(function() {
    var timer = null;
    function onResize() {
      clearTimeout(timer);
      timer = setTimeout(function() {
        setState(detect());
      }, 60);
    }
    window.addEventListener("resize", onResize);
    return function() {
      window.removeEventListener("resize", onResize);
      clearTimeout(timer);
    };
  }, []);

  return state;
}
