import { useSyncExternalStore } from "react";

// ─── VISUAL VIEWPORT / ON-SCREEN KEYBOARD ─────────────────────────────────────
// Phones and tablets show the keyboard over the page without resizing the layout
// (iOS always; Android with interactive-widget=resizes-visual). We track the
// *visible* area and publish it as CSS variables so fixed shells and sheets can
// sit exactly above the keyboard:
//   --vvt  visible area's offset from the top of the layout viewport
//   --vvh  visible area's height
//   --kb   keyboard inset at the bottom
// keyboardOpen is a tiny external store so only components that care re-render.

var kbOpen = false;
var subs = [];
var started = false;
var raf = 0;

export function isEditable(el) {
  if (!el || el === document.body) return false;
  var tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !/^(button|submit|checkbox|radio|range|color|file|reset|image)$/i.test(el.type || "");
  return !!el.isContentEditable;
}

function measure() {
  raf = 0;
  var vv = window.visualViewport;
  var ih = window.innerHeight;
  var h = vv ? vv.height : ih;
  var top = vv ? Math.max(0, vv.offsetTop) : 0;
  var kb = Math.max(0, Math.round(ih - h - top));
  var st = document.documentElement.style;
  st.setProperty("--vvh", Math.round(h) + "px");
  st.setProperty("--vvt", Math.round(top) + "px");
  st.setProperty("--kb", kb + "px");
  // A keyboard is never shorter than ~150px; smaller deltas are browser chrome
  var open = kb > 120;
  if (open !== kbOpen) {
    kbOpen = open;
    st.setProperty("--sheet-gap", open ? "8px" : "48px");
    if (!open) resetStrayScroll();
    subs.slice().forEach(function(fn) { fn(); });
  }
}

function schedule() { if (!raf) raf = requestAnimationFrame(measure); }

// Browsers scroll overflow:hidden containers (and the window on iOS) to reveal a
// focused field. Those offsets outlive the keyboard and make later taps land on
// the wrong element, so containers marked data-noscroll are snapped back.
export function resetStrayScroll() {
  var els = document.querySelectorAll("[data-noscroll]");
  for (var i = 0; i < els.length; i++) {
    if (els[i].scrollTop) els[i].scrollTop = 0;
    if (els[i].scrollLeft) els[i].scrollLeft = 0;
  }
  if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
}

function onFocusOut() {
  setTimeout(function() { if (!isEditable(document.activeElement)) resetStrayScroll(); }, 60);
}

export function startViewportTracking() {
  if (started || typeof window === "undefined") return;
  started = true;
  var vv = window.visualViewport;
  if (vv) { vv.addEventListener("resize", schedule); vv.addEventListener("scroll", schedule); }
  window.addEventListener("resize", schedule);
  window.addEventListener("orientationchange", schedule);
  document.addEventListener("focusout", onFocusOut);
  measure();
}

function subscribe(fn) {
  subs.push(fn);
  return function() { subs = subs.filter(function(s) { return s !== fn; }); };
}
function getSnapshot() { return kbOpen; }
function getServerSnapshot() { return false; }

export function useKeyboardOpen() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
export function keyboardIsOpen() { return kbOpen; }

// Scroll a focused field into view inside its nearest *scrollable* ancestor only.
// (Element.scrollIntoView would also scroll overflow:hidden layout containers.)
export function revealField(el) {
  if (!el) return;
  var p = el.parentElement;
  while (p && p !== document.body) {
    var oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) break;
    p = p.parentElement;
  }
  if (!p || p === document.body) return;
  var pr = p.getBoundingClientRect(), er = el.getBoundingClientRect();
  var vv = window.visualViewport;
  // Only the part of the scroller above the keyboard counts as visible
  var visBottom = Math.min(pr.bottom, vv ? vv.offsetTop + vv.height : window.innerHeight);
  var margin = 16;
  if (er.bottom > visBottom - margin) p.scrollTop += er.bottom - visBottom + margin;
  else if (er.top < pr.top + margin) p.scrollTop -= pr.top + margin - er.top;
}

// onFocus handler for editor containers: wait for the keyboard animation, then reveal
export function revealOnFocus(e) {
  var t = e.target;
  if (!isEditable(t)) return;
  setTimeout(function() { if (document.activeElement === t) revealField(t); }, 320);
}

export function isCoarsePointer() {
  try { return window.matchMedia("(pointer: coarse)").matches; } catch (e) { return false; }
}
