import { useState, useRef, useEffect, useContext } from "react";
import { OBJ_COLOR, OBJ_ICONS, osid } from "../../lib/constants";
import { lsGet, lsSet } from "../../lib/api";
import { solidBtn, inputSt, labelSt, resizeHandle } from "../../lib/styles";
import { ObjStackEditor } from "../Cards";
import { stripMarkup } from "../../lib/richtext";
import { CardReadView } from "./CardsDesktop";
import { CardStage, PaneRail } from "../CardStage";
import DesktopCtx from "../../lib/DesktopCtx";

// ─── DESKTOP TYPE SCALE ───────────────────────────────────────────────────────
// body 14–15 · meta 13 · section heading 16–18 · page title 20–24 · badges ≥11
var TXT  = "#fff";
var TXT2 = "rgba(255,255,255,.72)";
var TXT3 = "rgba(255,255,255,.5)";
var LINE = "rgba(255,255,255,.07)";
var GREEN = "#66BB6A";
var AMBER = "#FFD54F";

function stackHealth(stack) {
  var cardCount = Object.keys(stack.cards || {}).length;
  var hasEntry  = !!stack.rootCard;
  if (cardCount > 0 && hasEntry) return { color:GREEN, text:"Ready" };
  if (cardCount > 0)             return { color:AMBER, text:"No entry card" };
  return { color:OBJ_COLOR, text:"Empty" };
}

// Ordered card list for a stack: entry card first, then depth-first along answers,
// then anything unreachable.
function orderedStackCards(stack) {
  var cards = stack.cards || {};
  var out = [], seen = {};
  function visit(id) {
    if (!id || seen[id] || !cards[id]) return;
    seen[id] = true; out.push(cards[id]);
    (cards[id].answers || []).forEach(function(a){ if (a) visit(a.next); });
  }
  visit(stack.rootCard);
  Object.keys(cards).forEach(function(id){ if (!seen[id]) { seen[id] = true; out.push(cards[id]); } });
  return out;
}

function StackIcon({ icon, size }) {
  var sz = size || 40;
  return (
    <div style={{width:sz,height:sz,borderRadius:Math.round(sz*0.28),background:"rgba(239,83,80,.15)",border:"1px solid rgba(239,83,80,.32)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:Math.round(sz*0.5),flexShrink:0}}>{icon}</div>
  );
}

// ─── READ-ONLY STACK VIEW (non-admin users) ───────────────────────────────────
// Card list (left) + CardReadView on the CardStage (right) inside the detail
// pane. Tablet: the list fills the pane until a card is opened (back pill returns).
function StackReadView({ stack, deckCards, isTablet }) {
  var list = orderedStackCards(stack);
  var [cardId, setCardId] = useState(!isTablet && list.length ? list[0].id : null);
  var [navDir, setNavDir] = useState(null);
  function openCard(c, dir) { setNavDir(dir || null); setCardId(c.id); }
  var card = cardId && stack.cards[cardId] ? stack.cards[cardId] : null;
  var target = stack.targetCard && deckCards ? deckCards[stack.targetCard] : null;
  var h = stackHealth(stack);
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0}}>
      <div style={{padding:"16px 24px",borderBottom:"1px solid "+LINE,display:"flex",alignItems:"center",gap:14,flexShrink:0}}>
        <StackIcon icon={stack.icon} size={46}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:22,fontWeight:700,color:TXT,fontFamily:"'Lora',serif",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{stack.label}</div>
          <div style={{fontSize:14,color:TXT3,marginTop:3}}>
            {list.length} card{list.length!==1?"s":""} · <span style={{color:h.color}}>{h.text}</span>
            {" · "}{target ? <>after resolving, go to <span style={{color:TXT2,fontWeight:600}}>{target.title}</span></> : "after resolving, return to the current card"}
          </div>
        </div>
        <span style={{fontSize:13,color:TXT2,background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.12)",borderRadius:99,padding:"5px 12px",flexShrink:0}}>View only</span>
      </div>
      <div style={{flex:1,display:"flex",overflow:"hidden",minHeight:0}}>
        {!(isTablet && card) && <div style={{width:isTablet?"100%":300,flexShrink:0,overflowY:"auto",borderRight:"1px solid "+LINE,padding:"12px"}}>
          {list.length === 0 && <div style={{fontSize:14,color:TXT3,padding:"20px 6px"}}>No cards in this stack.</div>}
          {list.map(function(c) {
            var sel = c.id === cardId;
            var isEntry = c.id === stack.rootCard;
            return (
              <button key={c.id} onClick={function(){ openCard(c, null); }}
                style={{display:"block",width:"100%",textAlign:"left",background:sel?"rgba(239,83,80,.12)":"rgba(255,255,255,.03)",borderTop:"1px solid "+(sel?"rgba(239,83,80,.45)":LINE),borderRight:"1px solid "+(sel?"rgba(239,83,80,.45)":LINE),borderBottom:"1px solid "+(sel?"rgba(239,83,80,.45)":LINE),borderLeft:"4px solid "+OBJ_COLOR,borderRadius:10,padding:"10px 12px",marginBottom:6,cursor:"pointer",fontFamily:"inherit"}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:15,fontWeight:700,color:TXT,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.title || "Untitled"}</span>
                  {isEntry && <span style={{fontSize:11,fontWeight:700,color:OBJ_COLOR,background:"rgba(239,83,80,.15)",borderRadius:99,padding:"2px 8px",flexShrink:0}}>Entry</span>}
                </div>
                <div style={{fontSize:13,color:TXT3,marginTop:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{stripMarkup(c.prompt || "") || "No script"}</div>
              </button>
            );
          })}
        </div>}
        {card ? (
          <CardStage
            card={card}
            cards={stack.cards}
            rootCard={stack.rootCard}
            navDir={navDir}
            accent={OBJ_COLOR}
            lockedType="objection"
            onNavigate={openCard}
            onBack={isTablet ? function(){ setCardId(null); setNavDir(null); } : null}
            backLabel="Stack cards"
            renderCenter={function(c) {
              return <CardReadView key={c.id} card={c} cards={stack.cards} rootCard={stack.rootCard} accent={OBJ_COLOR} staged={true}
                onOpen={function(t){ openCard(t, "forward"); }}/>;
            }}
          />
        ) : (!isTablet &&
          <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:TXT3,fontSize:15}}>Select a card</div>
        )}
      </div>
    </div>
  );
}

// ─── OBJECTIONS DESKTOP ───────────────────────────────────────────────────────
// Two-pane: resizable stack list (default 360px) + detail pane (flex:1).
// Detail pane: ObjStackEditor (admins) / StackReadView (read-only users) for the
// selected stack, or a grid overview of every stack when nothing is selected.
export function ObjectionsDesktop({ deck, onUpdateDeck, readOnly }) {
  var desktop = useContext(DesktopCtx);
  var isTablet = !!desktop.isTablet;
  var [selectedId, setSelectedId] = useState(null);
  // With a stack open the stack list folds into a rail (desktop, persisted) so
  // the card stage has room; tablets hide it and show a back bar instead.
  var [listRail, setListRailSt] = useState(function(){ return lsGet("overcard_obj_listRail") !== "0"; });
  function setListRail(v) { setListRailSt(v); lsSet("overcard_obj_listRail", v ? "1" : "0"); }
  var [showNew,    setShowNew]    = useState(false);
  var [nf,         setNf]         = useState({ label:"", icon:"😐" });
  var [search,     setSearch]     = useState("");

  // ── Resizable left pane ──────────────────────────────────────────────────────
  var [leftW, setLeftW] = useState(function() {
    var stored = parseInt(lsGet("overcard_objections_leftW2"), 10);
    return (stored >= 300 && stored <= 520) ? stored : 360;
  });
  var dragging    = useRef(false);
  var dragStartX  = useRef(0);
  var dragStartW  = useRef(360);
  var leftWRef    = useRef(leftW);
  var [isDragging, setIsDragging] = useState(false);

  function updateLeftW(w) { leftWRef.current = w; setLeftW(w); }

  useEffect(function() {
    function onMove(e) {
      if (!dragging.current) return;
      var delta = e.clientX - dragStartX.current;
      var newW = Math.max(300, Math.min(520, dragStartW.current + delta));
      updateLeftW(newW);
    }
    function onUp() {
      if (!dragging.current) return;
      dragging.current = false;
      setIsDragging(false);
      lsSet("overcard_objections_leftW2", String(leftWRef.current));
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return function() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, []);

  function startDrag(e) {
    dragging.current = true;
    dragStartX.current = e.clientX;
    dragStartW.current = leftWRef.current;
    setIsDragging(true);
    e.preventDefault();
  }

  // ── Stack operations ─────────────────────────────────────────────────────────
  var stacks = deck.objStacks || [];
  var selectedStack = selectedId ? stacks.find(function(s){ return s.id === selectedId; }) : null;
  var q = search.toLowerCase();
  var visibleStacks = stacks.filter(function(s) {
    if (!q) return true;
    if ((s.label || "").toLowerCase().includes(q)) return true;
    return Object.values(s.cards || {}).some(function(c){ return (c.title||"").toLowerCase().includes(q) || stripMarkup(c.prompt||"").toLowerCase().includes(q); });
  });

  function saveStack(s) {
    onUpdateDeck(deck.id, function(d) { return Object.assign({},d,{objStacks:d.objStacks.map(function(x){return x.id===s.id?s:x;})}); });
  }
  function deleteStack(id) {
    onUpdateDeck(deck.id, function(d) { return Object.assign({},d,{objStacks:d.objStacks.filter(function(s){return s.id!==id;})}); });
    setSelectedId(null);
  }
  function createStack() {
    if (!nf.label.trim()) return;
    var s = { id:osid(), label:nf.label, icon:nf.icon, rootCard:null, cards:{} };
    onUpdateDeck(deck.id, function(d) { return Object.assign({},d,{objStacks:d.objStacks.concat([s])}); });
    setShowNew(false); setNf({label:"",icon:"😐"});
    setSelectedId(s.id);
  }

  var totalCards = stacks.reduce(function(n, s){ return n + Object.keys(s.cards || {}).length; }, 0);
  var readyCount = stacks.filter(function(s){ return stackHealth(s).text === "Ready"; }).length;

  // ── Overview grid (nothing selected) ─────────────────────────────────────────
  function renderOverview() {
    return (
      <div style={{flex:1,overflowY:"auto",padding:"22px 26px 28px"}}>
        <div style={{display:"flex",alignItems:"baseline",gap:12,flexWrap:"wrap",marginBottom:4}}>
          <div style={{fontSize:22,fontWeight:700,color:TXT,fontFamily:"'Lora',serif"}}>Objection stacks</div>
          <div style={{fontSize:14,color:TXT3}}>{stacks.length} stack{stacks.length!==1?"s":""} · {totalCards} card{totalCards!==1?"s":""} · {readyCount} ready</div>
        </div>
        <div style={{fontSize:14,color:TXT3,marginBottom:18,lineHeight:1.6}}>
          Linked to <strong style={{color:TXT2}}>{deck.name}</strong>. Open a stack from Play mode at any point in the pitch — when it's resolved you return to your current card (or jump to the stack's target card).
        </div>
        {stacks.length === 0 && (
          <div style={{background:"rgba(239,83,80,.06)",border:"1px dashed rgba(239,83,80,.3)",borderRadius:14,padding:"32px 24px",textAlign:"center",color:TXT2,fontSize:15,lineHeight:1.6}}>
            No stacks yet.{!readOnly && <><br/>Use <strong style={{color:OBJ_COLOR}}>+ New stack</strong> to create one for each common objection.</>}
          </div>
        )}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(340px, 1fr))",gap:16,alignItems:"start"}}>
          {visibleStacks.map(function(stack) {
            var list = orderedStackCards(stack);
            var h = stackHealth(stack);
            var entry = stack.rootCard && stack.cards[stack.rootCard];
            var target = stack.targetCard && deck.cards[stack.targetCard];
            return (
              <button key={stack.id} onClick={function(){ setSelectedId(stack.id); }}
                style={{display:"flex",flexDirection:"column",gap:10,textAlign:"left",background:"rgba(239,83,80,.045)",border:"1px solid rgba(239,83,80,.18)",borderRadius:14,padding:"16px 18px",cursor:"pointer",fontFamily:"inherit",minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:12,width:"100%"}}>
                  <StackIcon icon={stack.icon} size={42}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:16,fontWeight:700,color:TXT,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{stack.label}</div>
                    <div style={{fontSize:13,color:TXT3,marginTop:2}}>{list.length} card{list.length!==1?"s":""} · <span style={{color:h.color}}>{h.text}</span></div>
                  </div>
                </div>
                <div style={{fontSize:14,color:TXT2,lineHeight:1.5,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",minHeight:42}}>
                  {entry ? stripMarkup(entry.prompt || "") || entry.title : <span style={{color:TXT3}}>No entry card yet</span>}
                </div>
                {list.length > 0 && (
                  <div style={{width:"100%",borderTop:"1px solid rgba(239,83,80,.14)",paddingTop:8}}>
                    {list.slice(0, 6).map(function(c, i) {
                      var nAns = (c.answers || []).filter(function(a){ return a && a.label; }).length;
                      return (
                        <div key={c.id} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"7px 0",borderTop:i?"1px solid rgba(255,255,255,.05)":"none"}}>
                          <span style={{width:22,height:22,borderRadius:"50%",background:"rgba(239,83,80,.14)",border:"1px solid rgba(239,83,80,.4)",color:OBJ_COLOR,fontSize:12,fontWeight:800,display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>{i+1}</span>
                          <span style={{flex:1,minWidth:0}}>
                            <span style={{display:"flex",alignItems:"center",gap:8}}>
                              <span style={{fontSize:14,fontWeight:600,color:TXT,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.title || "Untitled"}</span>
                              <span style={{fontSize:13,color:TXT3,flexShrink:0}}>{nAns ? nAns + " response" + (nAns!==1?"s":"") : "end"}</span>
                            </span>
                            {i > 0 && c.prompt && <span style={{display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden",fontSize:13,color:TXT3,lineHeight:1.5,marginTop:2}}>{stripMarkup(c.prompt)}</span>}
                          </span>
                        </div>
                      );
                    })}
                    {list.length > 6 && <div style={{fontSize:13,color:TXT3,paddingTop:4}}>+ {list.length - 6} more</div>}
                  </div>
                )}
                <div style={{fontSize:13,color:TXT3}}>{target ? "→ then " + (target.title || "target card") : "↩ returns to current card"}</div>
              </button>
            );
          })}
        </div>
        {stacks.length > 0 && visibleStacks.length === 0 && <div style={{fontSize:15,color:TXT3,textAlign:"center",padding:"30px 0"}}>No stacks match “{search}”</div>}
      </div>
    );
  }

  return (
    <div style={{display:"flex",height:"100%",overflow:"hidden",userSelect:isDragging?"none":"auto"}}>

      {/* ── Collapsed stack rail (desktop, stack open) ── */}
      {selectedStack && !isTablet && listRail && <PaneRail label="Stacks" color={OBJ_COLOR} onExpand={function(){ setListRail(false); }}/>}

      {(!selectedStack || (!isTablet && !listRail)) && <>
      {/* ── Left pane: stack list ── */}
      <div style={{width:isTablet?Math.min(leftW,340):leftW,minWidth:isTablet?Math.min(leftW,340):leftW,display:"flex",flexDirection:"column",overflow:"hidden",flexShrink:0,background:"rgba(4,12,32,.35)"}}>
        {/* Toolbar */}
        <div style={{padding:"14px 16px 12px",borderBottom:"1px solid "+LINE,flexShrink:0,display:"flex",flexDirection:"column",gap:10}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:16,fontWeight:700,color:TXT}}>Stacks</span>
            <span style={{fontSize:13,color:TXT3}}>{stacks.length}</span>
            <div style={{flex:1}}/>
            {selectedStack && (
              <button onClick={function(){ setListRail(true); }} title="Collapse the stack list to give the card stage more room"
                style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.12)",borderRadius:8,color:TXT2,fontSize:13,padding:"5px 10px",cursor:"pointer",fontFamily:"inherit"}}>‹</button>
            )}
            {readOnly ? (
              <span style={{fontSize:13,color:TXT2,background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.12)",borderRadius:99,padding:"4px 12px"}}>View only</span>
            ) : (
              <button onClick={function(){ setShowNew(function(p){ return !p; }); if (showNew) setNf({label:"",icon:"😐"}); }}
                style={{background:showNew?"transparent":"rgba(239,83,80,.14)",border:"1px solid rgba(239,83,80,.4)",color:OBJ_COLOR,borderRadius:10,fontSize:14,fontWeight:700,padding:"6px 14px",cursor:"pointer",fontFamily:"inherit"}}>
                {showNew ? "Cancel" : "+ New stack"}
              </button>
            )}
          </div>
          {stacks.length > 0 && (
            <input value={search} onChange={function(e){ setSearch(e.target.value); }}
              placeholder="Search stacks and cards…" aria-label="Search objection stacks"
              style={inputSt({height:38,fontSize:14,padding:"0 14px",borderRadius:10})}/>
          )}
          {showNew && !readOnly && (
            <div style={{background:"rgba(239,83,80,.06)",border:"1px solid rgba(239,83,80,.2)",borderRadius:12,padding:"14px"}}>
              <label style={Object.assign({}, labelSt(), {fontSize:12})}>Stack name</label>
              <input value={nf.label} onChange={function(e){setNf(function(p){return Object.assign({},p,{label:e.target.value});});}}
                onKeyDown={function(e){ if (e.key === "Enter") createStack(); }}
                placeholder="e.g. Price Objection" style={inputSt({marginBottom:12,fontSize:15})} autoFocus/>
              <label style={Object.assign({}, labelSt(), {fontSize:12})}>Icon</label>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(38px, 1fr))",gap:6,marginBottom:12}}>
                {OBJ_ICONS.map(function(ic){
                  return <button key={ic} onClick={function(){setNf(function(p){return Object.assign({},p,{icon:ic});});}}
                    aria-pressed={nf.icon===ic}
                    style={{background:nf.icon===ic?"rgba(255,255,255,.15)":"rgba(255,255,255,.05)",border:"1.5px solid "+(nf.icon===ic?"rgba(255,255,255,.45)":"rgba(255,255,255,.08)"),borderRadius:8,height:38,cursor:"pointer",fontSize:18}}>{ic}</button>;
                })}
              </div>
              <button onClick={createStack} disabled={!nf.label.trim()}
                style={Object.assign({},solidBtn(OBJ_COLOR),{width:"100%",fontSize:15,opacity:nf.label.trim()?1:.5})}>Create stack</button>
            </div>
          )}
        </div>

        {/* Stack list */}
        <div style={{flex:1,overflowY:"auto",padding:"12px 12px 16px"}}>
          {stacks.length === 0 && (
            <div style={{textAlign:"center",color:TXT3,padding:"40px 16px",fontSize:15,lineHeight:1.7}}>No stacks yet.{!readOnly && <><br/>Create one to handle objections.</>}</div>
          )}
          {visibleStacks.map(function(stack) {
            var sel = stack.id === selectedId;
            var cardCount = Object.keys(stack.cards || {}).length;
            var h = stackHealth(stack);
            return (
              <button key={stack.id} data-row="1" onClick={function(){ setSelectedId(stack.id); }}
                style={{display:"flex",alignItems:"center",gap:12,width:"100%",textAlign:"left",
                  background:sel?"rgba(239,83,80,.13)":"rgba(255,255,255,.03)",
                  borderTop:"1px solid "+(sel?"rgba(239,83,80,.5)":LINE),
                  borderRight:"1px solid "+(sel?"rgba(239,83,80,.5)":LINE),
                  borderBottom:"1px solid "+(sel?"rgba(239,83,80,.5)":LINE),
                  borderLeft:"4px solid "+(sel?OBJ_COLOR:"rgba(239,83,80,.4)"),
                  borderRadius:10,padding:"11px 12px",marginBottom:6,cursor:"pointer",fontFamily:"inherit"}}>
                <StackIcon icon={stack.icon} size={40}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:15,fontWeight:700,color:TXT,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{stack.label}</div>
                  <div style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:TXT3,marginTop:3}}>
                    <span>{cardCount} card{cardCount!==1?"s":""}</span>
                    <span style={{display:"inline-flex",alignItems:"center",gap:5,color:h.color}}>
                      <span style={{width:7,height:7,borderRadius:"50%",background:h.color}}/>{h.text}
                    </span>
                  </div>
                </div>
                <span style={{color:"rgba(239,83,80,.55)",fontSize:18,flexShrink:0}}>›</span>
              </button>
            );
          })}
          {stacks.length > 0 && visibleStacks.length === 0 && <div style={{textAlign:"center",color:TXT3,padding:"30px 0",fontSize:15}}>No matches</div>}
        </div>
      </div>

      {/* ── Drag handle ── */}
      <div
        onMouseDown={startDrag}
        title="Drag to resize"
        style={Object.assign({},resizeHandle(),{background:isDragging?"rgba(255,255,255,.1)":"transparent"})}
      />
      </>}

      {/* ── Right pane ── */}
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0,background:"rgba(8,20,50,.2)"}}>
        {selectedStack && isTablet && (
          <div style={{flexShrink:0,display:"flex",alignItems:"center",gap:10,padding:"8px 14px",borderBottom:"1px solid "+LINE,background:"rgba(4,12,32,.45)"}}>
            <button onClick={function(){ setSelectedId(null); }}
              style={{display:"flex",alignItems:"center",gap:6,minHeight:40,background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.12)",borderRadius:99,color:TXT,fontSize:14,fontWeight:600,padding:"0 16px 0 12px",cursor:"pointer",fontFamily:"inherit"}}>
              <span style={{fontSize:17,lineHeight:1}}>‹</span>All stacks
            </button>
            <span style={{fontSize:14,color:TXT3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{selectedStack.icon} {selectedStack.label}</span>
          </div>
        )}
        {selectedStack && readOnly && (
          <StackReadView key={selectedStack.id} stack={selectedStack} deckCards={deck.cards} isTablet={isTablet}/>
        )}
        {selectedStack && !readOnly && (
          <ObjStackEditor
            key={selectedStack.id}
            inline={true}
            stack={selectedStack}
            deckCards={deck.cards}
            onSave={function(s){saveStack(s);}}
            onDelete={deleteStack}
            onClose={function(){setSelectedId(null);}}
          />
        )}
        {!selectedStack && renderOverview()}
      </div>
    </div>
  );
}
