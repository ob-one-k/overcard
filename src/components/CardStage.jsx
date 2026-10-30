import { useState, useRef, useEffect, useLayoutEffect, useContext } from "react";
import { TM } from "../lib/constants";
import { stripMarkup } from "../lib/richtext";
import { getParents, orderParents, getChildren } from "../lib/cardGraph";
import DesktopCtx from "../lib/DesktopCtx";

// ─── CARD STAGE ───────────────────────────────────────────────────────────────
// Desktop/tablet card viewer used by the deck editor (Cards) and the objection
// stack editor. Never used by Play or the mobile tabs.
//
//   [ parent back-tab(s) ]  [   big floating centre card   ]  [ child cards ]
//
// • Centre: whatever `renderCenter(card, api)` returns (CardEditorSheet inline
//   or CardReadView). `api.navRef` / `api.onFormChange` let an editor route
//   stage navigation through save-then-navigate and show unsaved links live.
// • Left: the structural parents (cards whose answers lead here) as a fanned
//   stack of tabs tucked behind the centre card. Front = card you came from (if
//   a parent) → intended-path parent → alphabetical. Hover (tap on touch)
//   spreads them into a labelled list. Root shows no tab; an orphan shows a
//   ghost "Unlinked" tab.
// • Right: one floating card per distinct destination, captioned with the
//   answer label(s). Hover (first tap on touch) previews; click navigates.
// • Keys: ← front parent · 1–9 child (ignored while typing).
// • Compact (stage < 900px): side cards become title chips, parent tab sticks
//   out ~20% instead of ~⅓.

var TXT  = "#fff";
var TXT2 = "rgba(255,255,255,.72)";
var TXT3 = "rgba(255,255,255,.5)";
var GREEN = "#66BB6A";
var MAX_FAN = 3;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function bulletsOf(card) { return (card.overview || []).filter(function(b){ return b && b.trim(); }); }
function isTypingTarget(el) {
  if (!el) return false;
  var tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!el.isContentEditable;
}

var STAGE_CSS =
  "@keyframes ocStageFwd{from{opacity:0;transform:translateX(90px) scale(.92)}to{opacity:1;transform:none}}" +
  "@keyframes ocStageBack{from{opacity:0;transform:translateX(-90px) scale(.92)}to{opacity:1;transform:none}}" +
  "@keyframes ocStageOpen{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:none}}" +
  "@keyframes ocSideIn{from{opacity:0;transform:translateX(18px)}to{opacity:1;transform:none}}" +
  "@keyframes ocTabIn{from{opacity:0;transform:translateX(26px)}to{opacity:1}}" +
  "@keyframes ocRowIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}" +
  "@keyframes ocFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}" +
  ".oc-stage-child{transition:border-color .15s, box-shadow .15s, background .15s}" +
  ".oc-stage-child:hover,.oc-stage-child:focus-visible,.oc-stage-child[data-active='1']{animation-play-state:paused}" +
  ".oc-stage-child:hover,.oc-stage-child[data-active='1']{box-shadow:0 14px 34px rgba(0,0,0,.5), 0 0 0 1px var(--oc-c)}" +
  ".oc-stage-child:focus-visible,.oc-stage-tab:focus-visible,.oc-stage-row:focus-visible{outline:2px solid #fff;outline-offset:2px}" +
  ".oc-stage-row:hover{background:rgba(255,255,255,.07) !important}" +
  "@media (prefers-reduced-motion: reduce){.oc-stage-anim,.oc-stage-child{animation:none !important;transition:none !important}}";

// ─── COLLAPSED LIST RAIL ──────────────────────────────────────────────────────
// Slim rail shown in place of a list pane while a card is on the stage.
export function PaneRail({ label, onExpand, color }) {
  return (
    <button onClick={onExpand} aria-label={"Show " + label.toLowerCase() + " list"} title={"Show " + label.toLowerCase() + " list"}
      style={{width:48,minWidth:48,flexShrink:0,display:"flex",flexDirection:"column",alignItems:"center",gap:14,padding:"16px 0",background:"rgba(4,12,32,.45)",border:"none",borderRight:"1px solid rgba(255,255,255,.07)",cursor:"pointer",fontFamily:"inherit",color:TXT2}}>
      <span style={{width:32,height:32,borderRadius:9,background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.12)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,color:color||TXT}}>›</span>
      <span style={{writingMode:"vertical-rl",fontSize:13,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",color:TXT3}}>{label}</span>
    </button>
  );
}

// endLabel — optional text for responses with no destination (objection stacks pass where the
// rep goes after resolving, e.g. "returns to current card")
export function CardStage({ card, cards, rootCard, navDir, onNavigate, renderCenter, accent, lockedType, onBack, backLabel, endLabel }) {
  var desktop = useContext(DesktopCtx);
  var rootRef = useRef(null);
  var navRef = useRef(null);
  var [size, setSize] = useState({ w:0, h:0 });
  var [draft, setDraft] = useState(null);          // { id, answers, type } from the editor
  var [fanOpen, setFanOpen] = useState(false);
  var [preview, setPreview] = useState(null);      // { id, top }
  var fanTimer = useRef(null);
  var prevTimer = useRef(null);
  var lastPtr = useRef(null);
  var keyRef = useRef(null);

  // Remember where we came from (used to pick the front parent tab)
  var lastIdRef = useRef(card.id);
  var fromRef = useRef(null);
  if (lastIdRef.current !== card.id) { fromRef.current = lastIdRef.current; lastIdRef.current = card.id; }

  // ── Measure the stage ──────────────────────────────────────────────────────
  useLayoutEffect(function() {
    var el = rootRef.current; if (!el) return;
    function measure() {
      var r = el.getBoundingClientRect();
      setSize(function(p){ return (Math.round(r.width) === p.w && Math.round(r.height) === p.h) ? p : { w:Math.round(r.width), h:Math.round(r.height) }; });
    }
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return function(){ window.removeEventListener("resize", measure); };
    }
    var ro = new ResizeObserver(measure);
    ro.observe(el);
    return function(){ ro.disconnect(); };
  }, []);

  // Reset transient UI when the centre card changes
  useEffect(function() {
    setFanOpen(false); setPreview(null);
    clearTimeout(fanTimer.current); clearTimeout(prevTimer.current);
  }, [card.id]);
  useEffect(function() {
    return function(){ clearTimeout(fanTimer.current); clearTimeout(prevTimer.current); };
  }, []);

  // ── Graph ──────────────────────────────────────────────────────────────────
  var live = draft && draft.id === card.id ? draft : null;
  var type = (live && live.type) || card.type || lockedType || "pitch";
  var m = TM[type] || TM.pitch;
  var color = accent || m.color;
  var isRoot = !!rootCard && card.id === rootCard;
  var parents = orderParents(getParents(cards, card.id), fromRef.current);
  var kids = getChildren(cards, live ? live.answers : card.answers, card.id);
  var front = parents.length ? parents[0] : null;
  var touch = !!desktop.isTouchPrimary;

  function go(target, dir) {
    if (!target) return;
    setFanOpen(false); setPreview(null);
    if (navRef.current) navRef.current(target, dir);
    else if (onNavigate) onNavigate(target, dir);
  }

  // ── Keyboard: ← parent · 1–9 child ─────────────────────────────────────────
  // Window capture phase so the digits don't also switch app tabs (DesktopShell
  // listens on document for 1–N).
  keyRef.current = function(e) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
    if (e.key === "Escape" && (fanOpen || preview)) { setFanOpen(false); setPreview(null); e.stopPropagation(); return; }
    if (e.key === "ArrowLeft" && front) { e.preventDefault(); e.stopPropagation(); go(front.card, "back"); return; }
    var n = parseInt(e.key, 10);
    if (n >= 1 && n <= 9 && kids.linked[n - 1]) { e.preventDefault(); e.stopPropagation(); go(kids.linked[n - 1].card, "forward"); }
  };
  useEffect(function() {
    function onKey(e) { if (keyRef.current) keyRef.current(e); }
    window.addEventListener("keydown", onKey, true);
    return function(){ window.removeEventListener("keydown", onKey, true); };
  }, []);

  // ── Layout ─────────────────────────────────────────────────────────────────
  var W = size.w || 1000, H = size.h || 700;
  var compact = W < 900;
  var padX = compact ? 14 : 24;
  var padTop = onBack ? (compact ? 56 : 58) : (compact ? 18 : 26);
  var hint = !touch && !compact;
  var padBot = hint ? 34 : (compact ? 16 : 24);
  var sideW = compact ? clamp(Math.round(W * 0.19), 124, 168) : clamp(Math.round(W * 0.2), 196, 250);
  var gap = compact ? 18 : 30;
  var tabW = compact ? 200 : 270;
  var tabVis = compact ? Math.round(tabW * 0.2) : Math.round(tabW / 3);
  // Left only needs room for the tab strip + fan offset; keep a little air.
  var needL = compact ? tabVis + 16 : Math.max(tabVis + 80, Math.round(sideW * 0.75));
  var needR = sideW + gap;
  var avail = W - padX * 2;
  var centreW = Math.max(260, Math.min(780, avail - needL - needR));
  var slack = Math.max(0, avail - needL - needR - centreW);
  var centreLeft = padX + needL + Math.round(slack / 2);
  var centreTop = padTop;
  var centreH = Math.max(240, H - padTop - padBot);
  var centreRight = centreLeft + centreW;
  var tabH = Math.round(centreH * 0.84);
  var tabTop = centreTop + Math.round((centreH - tabH) / 2);
  var tabLeft = centreLeft - tabVis;

  var centreAnim = navDir === "forward" ? "ocStageFwd .34s cubic-bezier(.22,1,.36,1) backwards"
    : navDir === "back" ? "ocStageBack .34s cubic-bezier(.22,1,.36,1) backwards"
    : "ocStageOpen .26s cubic-bezier(.22,1,.36,1) backwards";

  // ── Fan hover/tap ──────────────────────────────────────────────────────────
  function fanEnter(e) {
    if (e.pointerType === "touch") return;
    clearTimeout(fanTimer.current);
    fanTimer.current = setTimeout(function(){ setFanOpen(true); }, 110);
  }
  function fanLeave(e) {
    if (e.pointerType === "touch") return;
    clearTimeout(fanTimer.current);
    fanTimer.current = setTimeout(function(){ setFanOpen(false); }, 180);
  }
  function tabClick() {
    var isTouch = lastPtr.current ? lastPtr.current === "touch" : touch;
    if (!front) return;
    if (isTouch && !fanOpen) { setFanOpen(true); setPreview(null); return; }
    go(front.card, "back");
  }

  // ── Child hover/tap ────────────────────────────────────────────────────────
  function childTop(el) {
    var root = rootRef.current; if (!root || !el) return centreTop;
    var rr = root.getBoundingClientRect(), cr = el.getBoundingClientRect();
    return cr.top - rr.top;
  }
  function childEnter(e, id) {
    if (e.pointerType === "touch") return;
    var top = childTop(e.currentTarget);
    clearTimeout(prevTimer.current);
    prevTimer.current = setTimeout(function(){ setPreview({ id:id, top:top }); }, 140);
  }
  function childLeave(e) {
    if (e.pointerType === "touch") return;
    clearTimeout(prevTimer.current);
    setPreview(null);
  }
  function childClick(e, entry) {
    var isTouch = lastPtr.current ? lastPtr.current === "touch" : touch;
    if (isTouch && !(preview && preview.id === entry.card.id)) {
      setFanOpen(false);
      setPreview({ id:entry.card.id, top:childTop(e.currentTarget) });
      return;
    }
    go(entry.card, "forward");
  }

  // ── Render pieces ──────────────────────────────────────────────────────────
  function renderTabs() {
    if (isRoot && !parents.length) {
      return (
        <div className="oc-stage-anim" style={{position:"absolute",left:Math.max(4, centreLeft - (compact ? 30 : 46)),top:centreTop + centreH / 2 - 60,width:compact?24:34,height:120,display:"flex",alignItems:"center",justifyContent:"center",animation:"fadeIn .3s backwards"}}>
          <span style={{writingMode:"vertical-rl",transform:"rotate(180deg)",fontSize:12,fontWeight:700,letterSpacing:1.6,textTransform:"uppercase",color:GREEN,opacity:.75}}>▶ Entry card</span>
        </div>
      );
    }
    if (!parents.length) {
      return (
        <div key={"ghost-" + card.id} className="oc-stage-anim" title="No card links here yet — add a response on another card that leads to this one."
          style={{position:"absolute",left:tabLeft,top:tabTop,width:tabW,height:tabH,borderRadius:18,border:"1.5px dashed rgba(255,255,255,.18)",background:"rgba(255,255,255,.02)",transform:"rotate(-2deg)",transformOrigin:"right center",zIndex:1,animation:"ocTabIn .35s .05s cubic-bezier(.22,1,.36,1) backwards"}}>
          <div style={{position:"absolute",left:0,top:0,bottom:0,width:tabVis,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8,color:TXT3}}>
            {compact ? (
              <span style={{writingMode:"vertical-rl",transform:"rotate(180deg)",fontSize:12,fontWeight:700,letterSpacing:1.4,textTransform:"uppercase"}}>Unlinked</span>
            ) : (
              <>
                <span style={{fontSize:18,opacity:.6}}>⌀</span>
                <span style={{fontSize:12,fontWeight:700,letterSpacing:1.2,textTransform:"uppercase"}}>Unlinked</span>
                <span style={{fontSize:12,lineHeight:1.4,textAlign:"center",padding:"0 8px",color:"rgba(255,255,255,.38)"}}>No card leads here</span>
              </>
            )}
          </div>
        </div>
      );
    }

    var shown = parents.slice(0, MAX_FAN);
    var extra = parents.length - shown.length;
    var frontMeta = TM[front.card.type] || TM.pitch;
    var via = front.answerLabels.length ? front.answerLabels.join(" · ") : null;
    return (
      <div key={"fan-" + card.id} onPointerEnter={fanEnter} onPointerLeave={fanLeave}
        style={{position:"absolute",left:0,top:0,width:centreLeft,height:"100%",pointerEvents:"none",zIndex:1}}>
        {/* Back cards (drawn back-to-front) */}
        {shown.slice(1).reverse().map(function(p, ri) {
          var i = shown.length - 1 - ri;
          var pm = TM[p.card.type] || TM.pitch;
          return (
            <div key={p.card.id} aria-hidden="true" className="oc-stage-anim"
              style={{position:"absolute",left:tabLeft - i * 13,top:tabTop - i * 10,width:tabW,height:tabH,borderRadius:18,
                background:"linear-gradient(160deg, " + pm.color + "30, #0a1838 70%)",border:"1px solid " + pm.color + "50",
                boxShadow:"0 10px 30px rgba(0,0,0,.45)",transform:"rotate(" + (-2.5 - i * 1.8) + "deg)",transformOrigin:"right center",
                opacity:1 - i * 0.2,pointerEvents:"auto",animation:"ocTabIn .4s " + (0.08 + i * 0.05) + "s cubic-bezier(.22,1,.36,1) backwards"}}/>
          );
        })}
        {/* Front tab */}
        <button className="oc-stage-tab oc-stage-anim"
          onPointerDown={function(e){ lastPtr.current = e.pointerType; }}
          onClick={tabClick}
          aria-label={"Previous card: " + (front.card.title || "Untitled") + (via ? " (via “" + via + "”)" : "") + (parents.length > 1 ? ". " + parents.length + " cards link here" : "")}
          aria-expanded={fanOpen}
          title={touch ? undefined : "← " + (front.card.title || "Untitled")}
          style={{position:"absolute",left:tabLeft,top:tabTop,width:tabW,height:tabH,borderRadius:18,padding:0,
            background:"linear-gradient(160deg, " + frontMeta.color + "3a, #0b1a3c 62%)",border:"1px solid " + frontMeta.color + "70",
            boxShadow:"0 14px 40px rgba(0,0,0,.5)",transform:"rotate(-2.5deg)",transformOrigin:"right center",
            cursor:"pointer",fontFamily:"inherit",textAlign:"left",pointerEvents:"auto",zIndex:2,
            animation:"ocTabIn .38s .04s cubic-bezier(.22,1,.36,1) backwards"}}>
          <span style={{position:"absolute",left:0,top:0,bottom:0,width:tabVis,display:"flex",flexDirection:"column",alignItems:compact?"center":"flex-start",
            padding:compact?"14px 0":"16px 10px 16px 14px",gap:compact?10:8,overflow:"hidden"}}>
            <span style={{fontSize:compact?15:17,lineHeight:1}}>{frontMeta.icon}</span>
            {compact ? (
              <span style={{writingMode:"vertical-rl",transform:"rotate(180deg)",fontSize:13,fontWeight:700,color:TXT,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxHeight:tabH - 90}}>
                {front.card.title || "Untitled"}
              </span>
            ) : (
              <>
                <span style={{fontSize:11,fontWeight:800,letterSpacing:1.2,textTransform:"uppercase",color:frontMeta.color}}>← From</span>
                <span style={{fontSize:14,fontWeight:700,color:TXT,lineHeight:1.3,display:"-webkit-box",WebkitLineClamp:5,WebkitBoxOrient:"vertical",overflow:"hidden",wordBreak:"break-word"}}>
                  {front.card.title || "Untitled"}
                </span>
                {via && <span style={{fontSize:12,color:TXT3,lineHeight:1.35,fontStyle:"italic",display:"-webkit-box",WebkitLineClamp:3,WebkitBoxOrient:"vertical",overflow:"hidden",wordBreak:"break-word"}}>“{via}”</span>}
              </>
            )}
            <span style={{flex:1}}/>
            {parents.length > 1 && (
              <span style={{alignSelf:compact?"center":"flex-start",fontSize:12,fontWeight:800,color:TXT,background:"rgba(255,255,255,.12)",border:"1px solid rgba(255,255,255,.22)",borderRadius:99,padding:compact?"2px 6px":"2px 9px"}}>
                {extra > 0 ? "+" + extra : parents.length}
              </span>
            )}
          </span>
        </button>

      </div>
    );
  }

  // Spread list of every parent (hover / tap on the fan). Rendered above the
  // centre card; the fan itself stays tucked behind it.
  function renderFanList() {
    if (!fanOpen || !parents.length) return null;
    var shownN = Math.min(parents.length, MAX_FAN);
    return (
      <div role="menu" aria-label="Cards that link here" onPointerEnter={fanEnter} onPointerLeave={fanLeave}
            style={{position:"absolute",left:Math.max(8, tabLeft - (shownN - 1) * 13 - 6),top:tabTop + 6,width:Math.min(320, centreLeft + centreW * 0.6 - 8),maxHeight:tabH - 12,overflowY:"auto",
              background:"rgba(8,18,44,.97)",border:"1px solid rgba(255,255,255,.14)",borderRadius:16,boxShadow:"0 24px 60px rgba(0,0,0,.6)",padding:"10px 8px",pointerEvents:"auto",zIndex:30,
              animation:"ocRowIn .18s cubic-bezier(.22,1,.36,1) backwards"}}>
            <div style={{fontSize:12,fontWeight:800,color:TXT3,letterSpacing:1.2,textTransform:"uppercase",padding:"2px 10px 8px"}}>
              Linked from · {parents.length}
            </div>
            {parents.map(function(p, i) {
              var pm = TM[p.card.type] || TM.pitch;
              var cameFrom = p.card.id === fromRef.current;
              return (
                <button key={p.card.id} role="menuitem" className="oc-stage-row"
                  onClick={function(){ go(p.card, "back"); }}
                  style={{display:"flex",alignItems:"flex-start",gap:10,width:"100%",textAlign:"left",background:i===0?"rgba(255,255,255,.05)":"transparent",border:"none",borderRadius:10,padding:"9px 10px",cursor:"pointer",fontFamily:"inherit",
                    animation:"ocRowIn .22s " + (i * 0.035) + "s cubic-bezier(.22,1,.36,1) backwards"}}>
                  <span style={{width:4,alignSelf:"stretch",borderRadius:99,background:pm.color,flexShrink:0}}/>
                  <span style={{fontSize:15,flexShrink:0,lineHeight:1.3}}>{pm.icon}</span>
                  <span style={{flex:1,minWidth:0}}>
                    <span style={{display:"flex",alignItems:"center",gap:6}}>
                      <span style={{fontSize:14,fontWeight:700,color:TXT,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1,minWidth:0}}>{p.card.title || "Untitled"}</span>
                      {i === 0 && !touch && <span style={{fontSize:11,color:TXT3,border:"1px solid rgba(255,255,255,.18)",borderRadius:5,padding:"0 5px",flexShrink:0}}>←</span>}
                    </span>
                    <span style={{display:"block",fontSize:13,color:TXT3,marginTop:2,lineHeight:1.4,wordBreak:"break-word"}}>
                      {p.answerLabels.length ? "“" + p.answerLabels.join("” · “") + "”" : "Unlabelled response"} → here
                    </span>
                    {(cameFrom || p.card.intendedPath) && (
                      <span style={{display:"flex",gap:6,marginTop:4}}>
                        {cameFrom && <span style={{fontSize:11,fontWeight:700,color:TXT2,background:"rgba(255,255,255,.08)",borderRadius:99,padding:"1px 7px"}}>You came from here</span>}
                        {p.card.intendedPath && <span style={{fontSize:11,fontWeight:700,color:GREEN,background:"rgba(102,187,106,.12)",borderRadius:99,padding:"1px 7px"}}>★ Intended</span>}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
    );
  }

  function renderChildren() {
    var items = [];
    kids.linked.forEach(function(entry, i) {
      var cm = TM[entry.card.type] || TM.pitch;
      var active = preview && preview.id === entry.card.id;
      var caption = entry.labels.length ? entry.labels.join(" · ") : "Unlabelled response";
      var keyHint = i < 9 && !touch ? String(i + 1) : null;
      items.push(
        <div key={entry.card.id} style={{position:"relative"}}>
          {/* connector back to the centre card */}
          <span aria-hidden="true" style={{position:"absolute",left:-gap,top:"50%",width:gap,height:1,background:"linear-gradient(90deg, " + color + "66, " + cm.color + "88)"}}/>
          <span aria-hidden="true" style={{position:"absolute",left:-gap - 3,top:"calc(50% - 3px)",width:7,height:7,borderRadius:"50%",background:color,boxShadow:"0 0 8px " + color}}/>
          <button className="oc-stage-child" data-active={active ? "1" : "0"}
            onPointerDown={function(e){ lastPtr.current = e.pointerType; }}
            onPointerEnter={function(e){ childEnter(e, entry.card.id); }}
            onPointerLeave={childLeave}
            onFocus={function(e){
              // keyboard focus only — a tap/click also focuses, and must not count as the "first tap"
              var kb = false; try { kb = e.currentTarget.matches(":focus-visible"); } catch (err) {}
              if (kb) setPreview({ id:entry.card.id, top:childTop(e.currentTarget) });
            }}
            onBlur={function(){ setPreview(null); }}
            onClick={function(e){ childClick(e, entry); }}
            aria-label={"Response " + (i + 1) + ": “" + caption + "” leads to " + (entry.card.title || "Untitled")}
            style={{"--oc-c":cm.color + "aa",display:"block",width:"100%",textAlign:"left",fontFamily:"inherit",cursor:"pointer",
              background:"linear-gradient(155deg, " + cm.color + (active ? "30" : "1f") + ", rgba(10,22,52,.94) 70%)",
              borderTop:"1px solid " + cm.color + (active ? "aa" : "55"),borderRight:"1px solid " + cm.color + (active ? "aa" : "55"),borderBottom:"1px solid " + cm.color + (active ? "aa" : "55"),borderLeft:"3px solid " + cm.color,borderRadius:compact?11:14,
              padding:compact?"8px 10px":"11px 13px 12px",boxShadow:"0 10px 26px rgba(0,0,0,.4)",
              animation:"ocSideIn .34s " + (0.06 + i * 0.045) + "s cubic-bezier(.22,1,.36,1) backwards, ocFloat 6.5s " + (0.6 + i * 0.7) + "s ease-in-out infinite"}}>
            {compact ? (
              <span style={{display:"flex",alignItems:"center",gap:7}}>
                {keyHint && <span style={{fontSize:11,fontWeight:800,color:cm.color,flexShrink:0}}>{keyHint}</span>}
                <span style={{fontSize:13,fontWeight:700,color:TXT,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1,minWidth:0}}>{entry.card.title || "Untitled"}</span>
              </span>
            ) : (
              <>
                <span style={{display:"flex",alignItems:"flex-start",gap:7,marginBottom:6}}>
                  {keyHint && <span style={{fontSize:11,fontWeight:800,color:cm.color,border:"1px solid " + cm.color + "66",borderRadius:5,padding:"0 5px",lineHeight:"16px",flexShrink:0}}>{keyHint}</span>}
                  <span style={{fontSize:12.5,color:TXT2,fontStyle:"italic",lineHeight:1.35,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden",wordBreak:"break-word"}}>“{caption}”</span>
                </span>
                <span style={{display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden",fontSize:15,fontWeight:700,color:TXT,lineHeight:1.3,wordBreak:"break-word"}}>{entry.card.title || "Untitled"}</span>
                <span style={{display:"flex",alignItems:"center",gap:5,marginTop:7,fontSize:11,fontWeight:700,letterSpacing:.6,textTransform:"uppercase",color:cm.color}}>
                  <span>{cm.icon}</span>{cm.label}
                  {entry.card.intendedPath && <span style={{color:GREEN,marginLeft:"auto",letterSpacing:0}}>★</span>}
                </span>
              </>
            )}
          </button>
        </div>
      );
    });
    kids.ends.forEach(function(end, i) {
      var what = end.self ? "↻ Repeats this card" : end.missing ? "⚠ Not linked" : (endLabel ? "■ Ends · " + endLabel : lockedType === "objection" ? "■ Ends · returns to pitch" : "■ Ends here");
      items.push(
        <div key={"end-" + i} className="oc-stage-anim"
          title={end.missing ? "This response points to a card that no longer exists." : "This response has no destination card."}
          style={{border:"1.5px dashed rgba(255,255,255,.2)",borderRadius:compact?11:14,padding:compact?"7px 10px":"10px 13px",color:TXT3,background:"rgba(255,255,255,.02)",
            animation:"ocSideIn .34s " + (0.06 + (kids.linked.length + i) * 0.045) + "s cubic-bezier(.22,1,.36,1) backwards"}}>
          {!compact && end.label && <div style={{fontSize:12.5,fontStyle:"italic",color:TXT3,lineHeight:1.35,marginBottom:4,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>“{end.label}”</div>}
          <div style={{fontSize:compact?12:13,fontWeight:700,color:end.missing ? "#FFB74D" : TXT3,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{what}</div>
        </div>
      );
    });
    if (!items.length) {
      items.push(
        <div key="none" className="oc-stage-anim" style={{border:"1.5px dashed rgba(255,255,255,.16)",borderRadius:14,padding:compact?"8px 10px":"12px 14px",color:TXT3,fontSize:13,lineHeight:1.5,animation:"fadeIn .3s backwards"}}>
          {compact ? "No responses" : "No responses yet — this card ends the path."}
        </div>
      );
    }
    return (
      <div key={"kids-" + card.id} style={{position:"absolute",left:centreRight,top:centreTop,width:sideW + gap,height:centreH,overflowY:"auto",overflowX:"hidden",display:"flex",flexDirection:"column",paddingLeft:gap,zIndex:2}}>
        <div style={{marginTop:"auto",marginBottom:"auto",display:"flex",flexDirection:"column",gap:compact?8:12,padding:"10px 6px 10px 0"}}>
          {!compact && kids.linked.length > 0 && <div style={{fontSize:12,fontWeight:800,color:TXT3,letterSpacing:1.2,textTransform:"uppercase",marginBottom:-2}}>Leads to</div>}
          {items}
        </div>
      </div>
    );
  }

  function renderPreview() {
    if (!preview) return null;
    var entry = null;
    kids.linked.forEach(function(e){ if (e.card.id === preview.id) entry = e; });
    if (!entry) return null;
    var pc = entry.card, pm = TM[pc.type] || TM.pitch;
    var bl = bulletsOf(pc).slice(0, 3);
    var script = stripMarkup(pc.prompt || "");
    var pw = Math.min(320, Math.max(220, centreW - 40));
    var top = clamp(preview.top - 10, 8, Math.max(8, H - 250));
    var isTouchPrev = (lastPtr.current ? lastPtr.current === "touch" : touch);
    return (
      <div role="tooltip" style={{position:"absolute",left:centreRight - pw + 10,top:top,width:pw,zIndex:40,pointerEvents:isTouchPrev?"auto":"none",
        background:"rgba(8,18,44,.98)",border:"1px solid " + pm.color + "66",borderTop:"3px solid " + pm.color,borderRadius:14,
        boxShadow:"0 24px 60px rgba(0,0,0,.65)",padding:"12px 14px 13px",animation:"ocRowIn .16s cubic-bezier(.22,1,.36,1) backwards"}}>
        <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:6}}>
          <span style={{fontSize:11,fontWeight:800,color:pm.color,letterSpacing:.8,textTransform:"uppercase"}}>{pm.icon} {pm.label}</span>
          {pc.intendedPath && <span style={{fontSize:11,fontWeight:700,color:GREEN}}>★ Intended</span>}
        </div>
        <div style={{fontSize:16,fontWeight:700,color:TXT,lineHeight:1.3,marginBottom:6,fontFamily:"'Lora',serif"}}>{pc.title || "Untitled"}</div>
        <div style={{fontSize:13,color:TXT2,marginBottom:bl.length || script ? 8 : 0}}>
          <span style={{color:TXT3}}>When they say </span>“{entry.labels.length ? entry.labels.join("” / “") : "…"}”
        </div>
        {bl.length > 0 && (
          <div style={{marginBottom:script ? 8 : 0}}>
            {bl.map(function(b, i) {
              return (
                <div key={i} style={{display:"flex",gap:7,alignItems:"flex-start",marginBottom:3}}>
                  <span style={{color:pm.color,fontSize:9,marginTop:4,flexShrink:0}}>◆</span>
                  <span style={{fontSize:13,color:TXT2,lineHeight:1.45}}>{b}</span>
                </div>
              );
            })}
          </div>
        )}
        {script && (
          <div style={{fontSize:13,color:"rgba(255,255,255,.6)",lineHeight:1.55,fontStyle:"italic",fontFamily:"'Lora',Georgia,serif",overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",borderLeft:"2px solid " + pm.color + "66",paddingLeft:9}}>
            {script}
          </div>
        )}
        {isTouchPrev && (
          <button onClick={function(){ go(pc, "forward"); }}
            style={{marginTop:10,width:"100%",minHeight:40,background:pm.color + "22",border:"1px solid " + pm.color + "66",color:pm.color,borderRadius:10,fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
            Open card →
          </button>
        )}
      </div>
    );
  }

  return (
    <div ref={rootRef} role="region" aria-label={"Card stage: " + (card.title || "Untitled")}
      onPointerDown={function(e){
        // tap on empty stage closes touch previews / the spread list
        if (e.target === e.currentTarget) { setPreview(null); setFanOpen(false); }
      }}
      style={{position:"relative",flex:1,minHeight:0,minWidth:0,overflow:"hidden",
        background:"radial-gradient(ellipse 60% 70% at 50% 45%, " + m.glow + ", transparent 70%), radial-gradient(rgba(255,255,255,.055) 1px, transparent 1px) 0 0/22px 22px, #06102a"}}>
      <style>{STAGE_CSS}</style>

      {onBack && (
        <button onClick={onBack}
          style={{position:"absolute",left:padX,top:compact?12:14,zIndex:45,display:"flex",alignItems:"center",gap:8,minHeight:compact?40:36,background:"rgba(8,18,44,.85)",border:"1px solid rgba(255,255,255,.16)",borderRadius:99,color:TXT,fontSize:14,fontWeight:600,padding:"0 16px 0 12px",cursor:"pointer",fontFamily:"inherit"}}>
          <span style={{fontSize:17,lineHeight:1}}>‹</span>{backLabel || "Back"}
        </button>
      )}

      {renderTabs()}

      {/* Centre card */}
      <div key={"centre-" + card.id} className="oc-stage-anim"
        style={{position:"absolute",left:centreLeft,top:centreTop,width:centreW,height:centreH,zIndex:10,display:"flex",flexDirection:"column",overflow:"hidden",
          borderRadius:20,background:"#081428",border:"1px solid " + color + "55",
          boxShadow:"0 34px 90px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.04), 0 0 70px " + m.glow,
          animation:centreAnim}}>
        <div aria-hidden="true" style={{height:3,flexShrink:0,background:"linear-gradient(90deg, transparent, " + color + ", transparent)"}}/>
        {renderCenter(card, { navRef:navRef, onFormChange:function(f){ setDraft({ id:f.id, answers:f.answers, type:f.type }); } })}
      </div>

      {renderChildren()}
      {renderFanList()}
      {renderPreview()}

      {hint && (
        <div aria-hidden="true" style={{position:"absolute",left:centreLeft,width:centreW,bottom:9,textAlign:"center",fontSize:12,color:"rgba(255,255,255,.38)",pointerEvents:"none"}}>
          {front && <><Kbd>←</Kbd> previous card</>}
          {front && kids.linked.length > 0 && <span style={{margin:"0 10px"}}>·</span>}
          {kids.linked.length > 0 && <><Kbd>1</Kbd>{kids.linked.length > 1 && <>–<Kbd>{String(Math.min(9, kids.linked.length))}</Kbd></>} open a response</>}
        </div>
      )}
    </div>
  );
}

function Kbd({ children }) {
  return <span style={{display:"inline-block",minWidth:18,padding:"0 5px",margin:"0 4px",border:"1px solid rgba(255,255,255,.2)",borderRadius:5,fontSize:11,lineHeight:"17px",color:"rgba(255,255,255,.6)",textAlign:"center"}}>{children}</span>;
}
