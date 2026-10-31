// ─── PRESS FEEDBACK ───────────────────────────────────────────────────────────
// One document-level handler gives every button the same press animation:
//   data-pressed  the button is held down (CSS scales/dims it)
//   data-press    the button is animating (held, or just released) — the CSS
//                 only overrides the button's own inline transition meanwhile
// CSS `scale` composes with a button's inline `transform` (centring, rotation)
// instead of replacing it, which the old `:active{transform:…!important}` did.
// Touches wait a moment before pressing and cancel on movement, so a scroll that
// starts on a button never flashes it.

var TOUCH_DELAY = 70;    // ms before a touch counts as a press
var MOVE_SLOP   = 10;    // px of movement that turns a touch into a scroll
var RELEASE_MS  = 200;   // how long data-press outlives the press (release animation)

var cur = null;          // { el, x, y, timer }
var started = false;

function target(e) {
  var el = e.target && e.target.closest ? e.target.closest("button, [role=button]") : null;
  if (!el || el.disabled || el.getAttribute("aria-disabled") === "true") return null;
  return el;
}

function release(el) {
  if (!el) return;
  el.removeAttribute("data-pressed");
  clearTimeout(el._pressT);
  el._pressT = setTimeout(function() { el.removeAttribute("data-press"); }, RELEASE_MS);
}

function end() {
  if (!cur) return;
  clearTimeout(cur.timer);
  release(cur.el);
  cur = null;
}

function onDown(e) {
  if (e.button > 0) return;            // primary button / touch / pen only
  end();
  var el = target(e);
  if (!el) return;
  clearTimeout(el._pressT);
  el.setAttribute("data-press", "");
  cur = { el: el, x: e.clientX, y: e.clientY, timer: 0 };
  if (e.pointerType === "touch") {
    cur.timer = setTimeout(function() { if (cur && cur.el === el) el.setAttribute("data-pressed", ""); }, TOUCH_DELAY);
  } else {
    el.setAttribute("data-pressed", "");
  }
}

function onMove(e) {
  if (!cur || e.pointerType !== "touch") return;
  if (Math.abs(e.clientX - cur.x) > MOVE_SLOP || Math.abs(e.clientY - cur.y) > MOVE_SLOP) end();
}

export function startPressFeedback() {
  if (started || typeof document === "undefined") return;
  started = true;
  document.addEventListener("pointerdown", onDown, { passive: true });
  document.addEventListener("pointermove", onMove, { passive: true });
  document.addEventListener("pointerup", end, { passive: true });
  // The browser cancels the pointer when a touch turns into a scroll
  document.addEventListener("pointercancel", end, { passive: true });
  window.addEventListener("blur", end);
}

// Shared button press/hover rules — injected by every top-level screen's <style>
export var PRESS_CSS =
  "button{touch-action:manipulation;}" +
  "button[data-press]{transition:scale .16s cubic-bezier(.2,.8,.2,1),filter .16s ease!important;}" +
  "button[data-pressed]{scale:.96;filter:brightness(.88);}" +
  "@media (hover:hover){button:not(:disabled):not([data-pressed]):hover{filter:brightness(1.12);}}" +
  "button:disabled{opacity:0.45!important;cursor:not-allowed;}" +
  "@media (prefers-reduced-motion:reduce){button[data-pressed]{scale:1;}*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important;}}";
