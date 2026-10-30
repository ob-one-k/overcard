import { useState, useEffect, useRef, useContext } from "react";
import { createPortal } from "react-dom";
import { TM, OBJ_COLOR } from "../lib/constants";
import { SHEET_MAX_H } from "../lib/styles";
import DesktopCtx from "../lib/DesktopCtx";
import { RichPromptDisplay } from "./Tooltip";

// ─── STUDY POPOUT ─────────────────────────────────────────────────────────────
// Read-only "flash card" view for brushing up on a deck outside a session.
//   start = { kind:"path",  index }    → step through the intended call path
//   start = { kind:"stack", stackId }  → step through one objection stack
// Borderless card centred in the viewport (portal to <body> so animated
// ancestors can't trap position:fixed). Desktop: horizontal two-column card.
// Tablet / phone: vertical card that scrolls internally.
// Nav: ← / → (keys, on-screen arrows, swipe), 1–9 follow a response, Esc closes.
// Nothing here emits session events — studying never touches analytics.

// Root card + the chain of intended-path answers that follows it
export function intendedOutline(deck) {
  var cards = (deck && deck.cards) || {};
  var root = deck && deck.rootCard ? cards[deck.rootCard] : null;
  if (!root) return [];
  var out = [root];
  var seen = {}; seen[root.id] = true;
  var cur = root;
  var guard = 0;
  while (cur && guard < 60) {
    guard++;
    var nextAns = (cur.answers || []).find(function(a) { return a.next && cards[a.next] && cards[a.next].intendedPath && !seen[a.next]; });
    if (!nextAns) break;
    seen[nextAns.next] = true;
    cur = cards[nextAns.next];
    out.push(cur);
  }
  return out;
}

// Stack cards in study order: root first, then breadth-first in answer order,
// then anything unreachable (so every card in the stack can be studied)
export function stackOrder(stack) {
  var cards = (stack && stack.cards) || {};
  var out = [];
  var seen = {};
  var queue = stack && stack.rootCard && cards[stack.rootCard] ? [stack.rootCard] : [];
  while (queue.length) {
    var id = queue.shift();
    if (seen[id] || !cards[id]) continue;
    seen[id] = true;
    out.push(cards[id]);
    (cards[id].answers || []).forEach(function(a) { if (a.next && cards[a.next] && !seen[a.next]) queue.push(a.next); });
  }
  Object.keys(cards).forEach(function(id) { if (!seen[id]) { seen[id] = true; out.push(cards[id]); } });
  return out;
}

var POP_CSS =
  "@keyframes ocStudyBg{from{opacity:0}to{opacity:1}}" +
  "@keyframes ocStudyIn{from{opacity:0;transform:translateY(14px) scale(.95)}to{opacity:1;transform:none}}" +
  ".oc-study-ans:hover:not(:disabled){background:rgba(255,255,255,.09)!important}" +
  ".oc-study-nav:hover:not(:disabled){background:rgba(255,255,255,.14)!important;color:#fff!important}" +
  ".oc-study-x:hover{background:rgba(255,255,255,.14)!important;color:#fff!important}" +
  "@media (prefers-reduced-motion: reduce){.oc-study-anim{animation:none!important}}";

export function StudyPopout({ deck, start, onClose }) {
  var desktop = useContext(DesktopCtx);
  var horizontal = !!(desktop && desktop.layout === "desktop");

  var isStack = !!(start && start.kind === "stack");
  var stack   = isStack ? (deck.objStacks || []).find(function(s) { return s.id === start.stackId; }) : null;
  var cardsMap = isStack ? (stack ? stack.cards : {}) : deck.cards;
  var seq      = isStack ? stackOrder(stack) : intendedOutline(deck);
  var seqIds   = seq.map(function(c) { return c.id; });

  var startIdx = !isStack && start && typeof start.index === "number" ? Math.max(0, Math.min(seq.length - 1, start.index)) : 0;
  var [pos,    setPos]    = useState(startIdx);
  var [detour, setDetour] = useState(null);   // card id reached via a response that isn't in the sequence
  var [dir,    setDir]    = useState(0);
  var [swapKey, setSwapKey] = useState(0);

  var dialogRef  = useRef(null);
  var touchRef   = useRef(null);
  var keyRef     = useRef(null);
  var bodyRefs   = useRef([]);

  var curId = detour || seqIds[pos];
  var card  = curId ? cardsMap[curId] : null;
  var meta  = card ? (TM[card.type] || TM.pitch) : TM.pitch;

  // Focus the dialog on open, restore focus to the opener on close
  useEffect(function() {
    var prev = document.activeElement;
    if (dialogRef.current) dialogRef.current.focus();
    return function() { if (prev && prev.focus) { try { prev.focus(); } catch (e) {} } };
  }, []);

  // Scroll panes back to the top whenever the card changes
  useEffect(function() {
    bodyRefs.current.forEach(function(el) { if (el) el.scrollTop = 0; });
  }, [curId]);

  useEffect(function() {
    function onKey(e) { if (keyRef.current) keyRef.current(e); }
    document.addEventListener("keydown", onKey, true);
    return function() { document.removeEventListener("keydown", onKey, true); };
  }, []);

  function show(nextPos, nextDetour, d) {
    setDir(d); setSwapKey(function(k) { return k + 1; });
    setPos(nextPos); setDetour(nextDetour);
  }
  function canPrev() { return !!detour || pos > 0; }
  function canNext() { return pos < seq.length - 1; }
  function prev() {
    if (detour) { show(pos, null, -1); return; }   // leave the detour → back to where you were
    if (pos > 0) show(pos - 1, null, -1);
  }
  function next() { if (pos < seq.length - 1) show(pos + 1, null, 1); }
  function jumpTo(id) {
    if (!id || !cardsMap[id] || id === curId) return;
    var idx = seqIds.indexOf(id);
    if (idx >= 0) show(idx, null, idx >= pos ? 1 : -1);
    else show(pos, id, 1);
  }

  // Key handler kept in a ref so it always sees fresh state; capture phase +
  // stopPropagation so page-level shortcuts underneath never fire
  keyRef.current = function(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    if (e.key === "ArrowLeft")  { e.preventDefault(); e.stopPropagation(); prev(); return; }
    if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); next(); return; }
    var n = parseInt(e.key, 10);
    if (card && n >= 1 && n <= 9) {
      var ans = (card.answers || [])[n - 1];
      if (ans && ans.next && cardsMap[ans.next]) { e.preventDefault(); e.stopPropagation(); jumpTo(ans.next); }
      return;
    }
    if (e.key === "Tab" && dialogRef.current) {
      // Keep focus inside the dialog
      var f = dialogRef.current.querySelectorAll("button:not([disabled]),[href],[tabindex]:not([tabindex='-1'])");
      if (!f.length) { e.preventDefault(); return; }
      var first = f[0], last = f[f.length - 1];
      var a = document.activeElement;
      if (e.shiftKey && (a === first || a === dialogRef.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
      e.stopPropagation();
    }
  };

  function onTouchStart(e) {
    var t = e.touches && e.touches[0];
    touchRef.current = t ? { x:t.clientX, y:t.clientY, ts:Date.now() } : null;
  }
  function onTouchEnd(e) {
    var s = touchRef.current; touchRef.current = null;
    var t = e.changedTouches && e.changedTouches[0];
    if (!s || !t) return;
    var dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.4 || Date.now() - s.ts > 800) return;
    if (dx < 0) next(); else prev();
  }

  if (!card) return null;

  var bullets   = (card.overview || []).filter(function(b) { return b && b.trim(); });
  var answers   = card.answers || [];
  var inSeq     = !detour;
  var tc        = isStack && stack && stack.targetCard && stack.targetCard !== "__pick" ? deck.cards[stack.targetCard] : null;
  var kindLabel = isStack ? (stack ? stack.label : "Objection") : "Intended call path";
  var animName  = dir > 0 ? "cardIn" : dir < 0 ? "cardBack" : "fadeIn";
  var glow      = meta.glow;

  // ── Pieces ──────────────────────────────────────────────────────────────────
  var badges = (
    <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
      <span style={{display:"inline-flex",alignItems:"center",gap:6,background:meta.color+"1f",color:meta.color,borderRadius:99,fontSize:horizontal?12:11,fontWeight:700,letterSpacing:.7,padding:"4px 11px",textTransform:"uppercase"}}>{meta.icon} {meta.label}</span>
      {card.intendedPath && !isStack && <span style={{fontSize:horizontal?12:11,fontWeight:700,color:"#66BB6A",background:"rgba(102,187,106,.13)",borderRadius:99,padding:"4px 11px"}}>★ Intended</span>}
      {!inSeq && <span style={{fontSize:horizontal?12:11,fontWeight:700,color:"#FFD54F",background:"rgba(255,213,79,.12)",borderRadius:99,padding:"4px 11px"}}>{isStack ? "Branch" : "Off the intended path"}</span>}
    </div>
  );

  var title = (
    <h2 id="oc-study-title" style={{margin:horizontal?"16px 0 0":"12px 0 0",fontSize:horizontal?32:24,fontWeight:700,color:"#fff",lineHeight:1.2,fontFamily:"'Lora',Georgia,serif"}}>{card.title || "Untitled card"}</h2>
  );

  var overview = bullets.length > 0 && (
    <ul style={{listStyle:"none",margin:horizontal?"20px 0 0":"14px 0 0",padding:0,display:"flex",flexDirection:"column",gap:horizontal?10:8}}>
      {bullets.map(function(b, i) {
        return (
          <li key={i} style={{display:"flex",alignItems:"flex-start",gap:10}}>
            <span aria-hidden="true" style={{color:meta.color,fontSize:10,marginTop:horizontal?6:5,flexShrink:0}}>◆</span>
            <span style={{fontSize:horizontal?16:14,color:"rgba(255,255,255,.84)",lineHeight:1.5}}>{b}</span>
          </li>
        );
      })}
    </ul>
  );

  var stackNote = isStack && (
    <div style={{marginTop:horizontal?22:14,fontSize:13,color:"rgba(255,255,255,.5)",lineHeight:1.5}}>
      {tc ? <span>Once resolved, continues to <strong style={{color:"rgba(255,255,255,.85)"}}>{tc.title}</strong></span>
          : <span>Once resolved, returns to the card you were on</span>}
    </div>
  );

  var script = (
    <div style={{padding:horizontal?"22px 26px":"16px 18px",background:"rgba(0,0,0,.28)",borderRadius:16,boxShadow:"inset 3px 0 0 "+meta.color}}>
      <div style={{fontSize:11,fontWeight:700,letterSpacing:1.2,textTransform:"uppercase",color:"rgba(255,255,255,.38)",marginBottom:8}}>Script</div>
      <p style={{margin:0,fontSize:horizontal?20:16,lineHeight:1.7,color:"rgba(255,255,255,.94)",fontFamily:"'Lora',Georgia,serif"}}>
        {card.prompt ? <RichPromptDisplay text={card.prompt} accentColor={meta.color}/> : <span style={{color:"rgba(255,255,255,.4)",fontStyle:"italic"}}>No script on this card yet.</span>}
      </p>
    </div>
  );

  var responses = (
    <section aria-label="Prospect responses" style={{marginTop:horizontal?20:16}}>
      <div style={{fontSize:11,fontWeight:700,letterSpacing:1.2,textTransform:"uppercase",color:"rgba(255,255,255,.38)",marginBottom:8,display:"flex",justifyContent:"space-between",gap:8}}>
        <span>{isStack ? "Responses" : "Prospect responds"}</span>
        {answers.length > 0 && !(desktop && desktop.isTouchPrimary) && <span style={{fontWeight:500,letterSpacing:.3,textTransform:"none"}}>Press 1–{Math.min(9, answers.length)} to follow</span>}
      </div>
      {answers.length === 0 && <div style={{fontSize:14,color:"rgba(255,255,255,.4)"}}>No responses on this card.</div>}
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {answers.map(function(ans, i) {
          var dest = ans.next ? cardsMap[ans.next] : null;
          var dm = dest ? (TM[dest.type] || TM.pitch) : null;
          var isIntended = !isStack && dest && dest.intendedPath;
          var sub = dest ? "→ " + dest.title + (isIntended ? "  ★" : "")
            : isStack ? (tc ? "↩ Resolves objection · then " + tc.title : "↩ Resolves objection")
            : ans.next ? "Linked card is missing" : "End of path";
          return (
            <button key={ans.id || i} className="oc-study-ans" onClick={function() { if (dest) jumpTo(dest.id); }} disabled={!dest}
              title={dest ? "Study “" + dest.title + "”" : undefined}
              style={{display:"flex",alignItems:"center",gap:12,width:"100%",textAlign:"left",background:isIntended?"rgba(102,187,106,.08)":"rgba(255,255,255,.045)",border:"none",borderRadius:12,padding:horizontal?"11px 14px":"11px 12px",minHeight:44,cursor:dest?"pointer":"default",fontFamily:"inherit",transition:"background .15s"}}>
              <span style={{width:26,height:26,borderRadius:8,background:(isIntended?"#66BB6A":meta.color)+"22",color:isIntended?"#66BB6A":meta.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:800,flexShrink:0}}>{i + 1}</span>
              <span style={{flex:1,minWidth:0}}>
                <span style={{display:"block",fontSize:horizontal?15:14,color:"rgba(255,255,255,.92)",lineHeight:1.4}}>{ans.label || "(no label)"}</span>
                <span style={{display:"block",fontSize:12,marginTop:2,color:dm?(isIntended?"#66BB6A":dm.color):"rgba(255,255,255,.38)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{sub}</span>
              </span>
              {dest && <span aria-hidden="true" style={{color:"rgba(255,255,255,.35)",fontSize:16,flexShrink:0}}>›</span>}
            </button>
          );
        })}
      </div>
    </section>
  );

  var navBtn = function(label, onClick, enabled, glyph) {
    return (
      <button className="oc-study-nav" onClick={onClick} disabled={!enabled} aria-label={label} title={label}
        style={{width:44,height:44,borderRadius:"50%",border:"none",background:"rgba(255,255,255,.07)",color:enabled?"rgba(255,255,255,.85)":"rgba(255,255,255,.2)",fontSize:18,cursor:enabled?"pointer":"default",fontFamily:"inherit",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",transition:"background .15s,color .15s"}}>{glyph}</button>
    );
  };

  var dots = seq.length > 1 && seq.length <= 14 && (
    <div style={{display:"flex",alignItems:"center",gap:6}}>
      {seq.map(function(c, i) {
        var on = inSeq && i === pos;
        var cm = TM[c.type] || TM.pitch;
        return (
          <button key={c.id} onClick={function() { if (!on) show(i, null, i >= pos ? 1 : -1); }} aria-label={"Card " + (i + 1) + ": " + c.title} aria-current={on || undefined}
            style={{width:on?22:8,height:8,borderRadius:99,border:"none",padding:0,background:on?cm.color:"rgba(255,255,255,.22)",cursor:on?"default":"pointer",transition:"width .25s,background .25s"}}/>
        );
      })}
    </div>
  );

  var footer = (
    <div style={{display:"flex",alignItems:"center",gap:12,padding:horizontal?"14px 24px 18px":"10px 14px 14px",flexShrink:0}}>
      {navBtn(detour ? "Back to " + (seq[pos] ? seq[pos].title : "sequence") : "Previous card", prev, canPrev(), "←")}
      <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:7,minWidth:0}}>
        <div aria-live="polite" style={{fontSize:13,fontWeight:700,color:"rgba(255,255,255,.75)",fontFeatureSettings:'"tnum"',whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"100%"}}>
          {inSeq ? (pos + 1) + " / " + seq.length : "Side trip · from " + (pos + 1) + " / " + seq.length}
        </div>
        {dots}
      </div>
      {navBtn("Next card", next, canNext(), "→")}
    </div>
  );

  var header = (
    <div style={{display:"flex",alignItems:"center",gap:10,padding:horizontal?"18px 20px 0 26px":"14px 12px 0 18px",flexShrink:0}}>
      <div style={{flex:1,minWidth:0,display:"flex",alignItems:"center",gap:8,fontSize:12,fontWeight:700,letterSpacing:1,textTransform:"uppercase",color:isStack?OBJ_COLOR:"rgba(102,187,106,.9)"}}>
        <span aria-hidden="true" style={{fontSize:isStack?16:12,letterSpacing:0}}>{isStack ? (stack && stack.icon) || "🛡️" : "★"}</span>
        <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{isStack ? "Objection · " + kindLabel : kindLabel}</span>
        <span style={{color:"rgba(255,255,255,.3)",fontWeight:600,letterSpacing:.4,textTransform:"none",flexShrink:0}}>· Study</span>
      </div>
      <button className="oc-study-x" onClick={onClose} aria-label="Close study card" title="Close (Esc)"
        style={{width:40,height:40,borderRadius:"50%",border:"none",background:"rgba(255,255,255,.07)",color:"rgba(255,255,255,.7)",fontSize:16,cursor:"pointer",fontFamily:"inherit",flexShrink:0,transition:"background .15s,color .15s"}}>✕</button>
    </div>
  );

  var shell = {
    position:"relative",
    display:"flex", flexDirection:"column",
    background:"radial-gradient(120% 80% at 0% 0%," + meta.color + "1c 0%,transparent 55%),linear-gradient(160deg,#0d1b36 0%,#081329 60%,#060f22 100%)",
    borderRadius:horizontal?28:24,
    boxShadow:"0 0 0 1px rgba(255,255,255,.035),0 0 90px " + glow + ",0 40px 100px rgba(0,0,0,.65)",
    transition:"box-shadow .35s ease,background .35s ease",
    overflow:"hidden", outline:"none",
    animation:"ocStudyIn .32s cubic-bezier(.22,1,.36,1) both",
  };
  if (horizontal) {
    shell.width = "min(1180px, calc(100vw - 64px))";
    shell.height = "min(660px, calc(100vh - 64px))";
  } else {
    shell.width = "min(560px, calc(100vw - 24px))";
    shell.maxHeight = SHEET_MAX_H;
  }

  var content = horizontal ? (
    <div key={swapKey} className="oc-study-anim" style={{flex:1,minHeight:0,display:"grid",gridTemplateColumns:"minmax(0,.82fr) minmax(0,1.18fr)",gap:0,animation:animName+" .3s cubic-bezier(.22,1,.36,1) both"}}>
      <div ref={function(el) { bodyRefs.current[0] = el; }} style={{overflowY:"auto",padding:"22px 28px 20px 30px"}}>
        {badges}{title}{overview}{stackNote}
      </div>
      <div ref={function(el) { bodyRefs.current[1] = el; }} style={{overflowY:"auto",padding:"22px 28px 20px 8px"}}>
        {script}{responses}
      </div>
    </div>
  ) : (
    <div key={swapKey} ref={function(el) { bodyRefs.current[0] = el; bodyRefs.current[1] = null; }} className="oc-study-anim"
      style={{flex:1,minHeight:0,overflowY:"auto",padding:"14px 18px 8px",animation:animName+" .3s cubic-bezier(.22,1,.36,1) both"}}>
      {badges}{title}{overview}{stackNote}
      <div style={{height:16}}/>
      {script}{responses}
    </div>
  );

  return createPortal(
    <div onClick={function(e) { if (e.target === e.currentTarget) onClose(); }}
      style={{position:"fixed",inset:0,zIndex:600,display:"flex",alignItems:"center",justifyContent:"center",padding:horizontal?32:12,boxSizing:"border-box",
        background:"rgba(2,8,20,.62)",backdropFilter:"blur(14px) saturate(120%)",WebkitBackdropFilter:"blur(14px) saturate(120%)",animation:"ocStudyBg .22s ease both"}}>
      <style>{POP_CSS}</style>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="oc-study-title" tabIndex={-1}
        className="oc-study-anim" style={shell} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {header}
        {content}
        {footer}
      </div>
    </div>,
    document.body
  );
}
