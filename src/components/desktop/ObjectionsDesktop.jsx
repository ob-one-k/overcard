import { useState, useRef, useEffect, useContext } from "react";
import { TM, OBJ_COLOR, OBJ_ICONS, osid, uid, aid, themed, LIMITS } from "../../lib/constants";
import { lsGet, lsSet } from "../../lib/api";
import { solidBtn, inputSt, labelSt, resizeHandle } from "../../lib/styles";
import { CardEditorSheet } from "../Editor";
import { TreeView } from "../Viewer";
import { DesktopModal } from "../DesktopModal";
import { ImportPicker } from "../ImportPicker";
import { CopyIcon } from "../ui";
import { liveStacks, archivedStacks, upsertStackCard, deleteStackCard, confirmStackDelete, canEditStack, canManageStack, reorderStacks } from "../../lib/deckOps";
import { StackStats } from "./StackStats";
import { AccessFields, accessSummary } from "../AccessFields";
import { ReorderList } from "../Reorder";
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
// renderEmpty() fills the stage while no card is open (the stack's stats).
function StackReadView({ stack, deckCards, isTablet, renderEmpty }) {
  var list = orderedStackCards(stack);
  var [cardId, setCardId] = useState(renderEmpty || isTablet || !list.length ? null : list[0].id);
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
        {!(isTablet && card) && <div style={{width:isTablet && !renderEmpty?"100%":300,flexShrink:0,overflowY:"auto",borderRight:"1px solid "+LINE,padding:"12px"}}>
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
        ) : renderEmpty ? (
          <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0}}>{renderEmpty()}</div>
        ) : (!isTablet &&
          <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:TXT3,fontSize:15}}>Select a card</div>
        )}
      </div>
    </div>
  );
}

// ─── OBJECTIONS DESKTOP ───────────────────────────────────────────────────────
// Mirrors CardsDesktop, specialised for objection stacks.
//  • No stack open: stack list (left, resizable) + overview grid of every stack.
//  • Stack open (admins): top bar (stack switcher, List/Tree, search, + Card, manage)
//    and an "After resolving" strip. List mode = the stack's cards in path order
//    beside a CardStage editor; Tree mode = editor docked left of the stack tree.
//    Every edit saves straight to the deck (autosave) — there is no Save Stack step.
//  • Read-only users get StackReadView for the open stack.
// focus (from search): { cardId, stackId?, nonce } — open that card once, then onFocusDone()
// readOnly = can't edit the deck (no new stacks); each stack also carries its own canEdit /
// canManage (deck-style stack permissions). isAdmin widens the stats to the org.
export function ObjectionsDesktop({ deck, decks, onUpdateDeck, readOnly, isOwner, isAdmin, orgUsers, orgTeams, onOpenSession, focus, onFocusDone }) {
  var desktop = useContext(DesktopCtx);
  var isTablet = !!desktop.isTablet;
  var [selectedId, setSelectedIdSt] = useState(null);
  var [viewMode,   setViewMode]   = useState("list");
  var [editing,    setEditing]    = useState(null);
  var [navDir,     setNavDir]     = useState(null);
  // While a card is on the stage the stack's card list folds into a rail (desktop, persisted)
  var [listRail, setListRailSt] = useState(function(){ return lsGet("overcard_obj_listRail") !== "0"; });
  function setListRail(v) { setListRailSt(v); lsSet("overcard_obj_listRail", v ? "1" : "0"); }
  var [treeEdCollapsed, setTreeEdCollapsedSt] = useState(function(){ return lsGet("overcard_obj_treeEdCollapsed") === "1"; });
  function setTreeEdCollapsed(v) { setTreeEdCollapsedSt(v); lsSet("overcard_obj_treeEdCollapsed", v ? "1" : "0"); }
  var [showNew,    setShowNew]    = useState(false);
  var [nf,         setNf]         = useState({ label:"", icon:"😐" });
  var [search,     setSearch]     = useState("");
  var [cardSearch, setCardSearch] = useState("");
  var [showImport, setShowImport] = useState(false);
  var [showCardImport, setShowCardImport] = useState(false);   // copy cards into the open stack
  var [showMeta,   setShowMeta]   = useState(false);
  var [meta,       setMeta]       = useState({ label:"", icon:"😐", visibility:"public", accessList:[], editorIds:[] });
  var [showSwitch, setShowSwitch] = useState(false);
  var [showArchived, setShowArchived] = useState(false);

  var SEL_KEY = "overcard_obj_sel_" + deck.id;
  function selectStack(id) {
    setSelectedIdSt(id); setEditing(null); setNavDir(null); setCardSearch(""); setShowSwitch(false);
    if (id) lsSet(SEL_KEY, id);
  }
  // Like the Cards tab, the tab opens on content: the last stack opened on this deck, else the first
  useEffect(function() {
    if (focus) return;
    var live = liveStacks(deck);
    if (!live.length) return;
    var last = lsGet(SEL_KEY);
    selectStack(live.some(function(x) { return x.id === last; }) ? last : live[0].id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(function() {
    if (!focus) return;
    var st = (deck.objStacks || []).find(function(x) { return x.id === focus.stackId; });
    var c = st && (st.cards || {})[focus.cardId];
    if (st) { selectStack(st.id); if (c) { setNavDir(null); setEditing(c); } }
    if (onFocusDone) onFocusDone();
  }, [focus && focus.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

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
      updateLeftW(Math.max(300, Math.min(520, dragStartW.current + delta)));
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

  // ── Stack operations (all saved through the deck autosave) ────────────────────
  var stacks   = liveStacks(deck);
  var archived = archivedStacks(deck).filter(function(s) { return canEditStack(s, readOnly); });
  var selectedStack = selectedId ? stacks.find(function(s){ return s.id === selectedId; }) : null;
  var selectedEditable = !!selectedStack && canEditStack(selectedStack, readOnly);
  var q = search.toLowerCase();
  var visibleStacks = stacks.filter(function(s) {
    if (!q) return true;
    if ((s.label || "").toLowerCase().includes(q)) return true;
    return Object.values(s.cards || {}).some(function(c){ return (c.title||"").toLowerCase().includes(q) || stripMarkup(c.prompt||"").toLowerCase().includes(q); });
  });

  function updateStack(id, fn) {
    onUpdateDeck(deck.id, function(d) { return Object.assign({}, d, { objStacks: d.objStacks.map(function(x){ return x.id === id ? fn(x) : x; }) }); });
  }
  function createStack() {
    if (!nf.label.trim()) return;
    var s = { id:osid(), label:nf.label.trim(), icon:nf.icon, rootCard:null, cards:{} };
    onUpdateDeck(deck.id, function(d) { return Object.assign({},d,{objStacks:d.objStacks.concat([s])}); });
    setShowNew(false); setNf({label:"",icon:"😐"});
    selectStack(s.id);
  }
  function importStacks(res) {
    onUpdateDeck(deck.id, function(d) { return Object.assign({},d,{objStacks:d.objStacks.concat(res.stacks)}); });
    if (res.stacks.length === 1) selectStack(res.stacks[0].id);
  }
  function archiveStack(id) {
    updateStack(id, function(st){ return Object.assign({}, st, { archivedAt: Date.now() }); });
    if (id === selectedId) selectStack(null);
  }
  function restoreStack(id) {
    updateStack(id, function(st){ var n = Object.assign({}, st); delete n.archivedAt; return n; });
  }
  function deleteStack(st) {
    if (!isOwner || !confirmStackDelete(st)) return;
    onUpdateDeck(deck.id, function(d) { return Object.assign({},d,{objStacks:d.objStacks.filter(function(x){ return x.id !== st.id; })}); });
    if (st.id === selectedId) selectStack(null);
  }
  function openMeta(stack) {
    setMeta({ label:stack.label, icon:stack.icon, visibility:stack.visibility || "public", accessList:stack.accessList || [], editorIds:stack.editorIds || [] });
    setShowMeta(true);
  }
  function saveMeta() {
    if (!selectedStack || !meta.label.trim()) return;
    var manage = canManageStack(selectedStack, readOnly);
    updateStack(selectedStack.id, function(st){
      var next = Object.assign({}, st, { label:meta.label.trim(), icon:meta.icon });
      // Who uses / edits it: the stack's managers only (the server keeps it as is for anyone else)
      if (manage) Object.assign(next, { visibility:meta.visibility || "public", accessList:meta.accessList || [], editorIds:meta.editorIds || [] });
      return next;
    });
    setShowMeta(false);
  }
  function reorder(ids) {
    onUpdateDeck(deck.id, function(d) { return Object.assign({}, d, { objStacks: reorderStacks(d.objStacks, ids) }); });
  }
  function setTarget(id) {
    if (!selectedStack) return;
    updateStack(selectedStack.id, function(st){ return Object.assign({}, st, { targetCard: id || null }); });
  }

  // ── Card operations inside the open stack ─────────────────────────────────────
  function closeCard() { setEditing(null); setNavDir(null); }
  function openCard(c, dir) { setNavDir(dir || null); setEditing(c); }
  function newCard() {
    openCard({ id:uid(), title:"", type:"objection", overview:[], intendedPath:false, prompt:"", answers:[{id:aid(),label:"",next:null}] });
  }
  function saveCard(c) {
    var full = Object.assign({ overview:[], intendedPath:false, prompt:"", answers:[] }, c, { type:"objection" });
    updateStack(selectedStack.id, function(st){ return upsertStackCard(st, full); });
  }
  // Copied cards join the open stack (first one becomes the entry if it has none)
  function importStackCards(res) {
    updateStack(selectedStack.id, function(st) {
      return Object.assign({}, st, { cards:Object.assign({}, st.cards || {}, res.cards), rootCard:st.rootCard || res.firstId || null });
    });
  }
  function removeCard(id) {
    updateStack(selectedStack.id, function(st){ return deleteStackCard(st, id); });
    closeCard();
  }

  var totalCards = stacks.reduce(function(n, s){ return n + Object.keys(s.cards || {}).length; }, 0);
  var readyCount = stacks.filter(function(s){ return stackHealth(s).text === "Ready"; }).length;
  var deckCardList = Object.values(deck.cards || {}).sort(function(a, b) {
    var order = { pitch:0, discovery:1, close:2 };
    return ((order[a.type] || 0) - (order[b.type] || 0)) || ((a.sortIndex || 0) - (b.sortIndex || 0));
  });

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
            No stacks yet.{!readOnly && <><br/>Use <strong style={{color:OBJ_COLOR}}>+ New stack</strong> to create one for each common objection, or copy stacks from another deck.</>}
          </div>
        )}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(" + (isTablet ? 280 : 340) + "px, 1fr))",gap:16,alignItems:"start"}}>
          {visibleStacks.map(function(stack) {
            var list = orderedStackCards(stack);
            var h = stackHealth(stack);
            var entry = stack.rootCard && stack.cards[stack.rootCard];
            var target = stack.targetCard && deck.cards[stack.targetCard];
            return (
              <button key={stack.id} onClick={function(){ selectStack(stack.id); }}
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
                          <StepDot n={i+1}/>
                          <span style={{flex:1,minWidth:0,display:"flex",alignItems:"center",gap:8}}>
                            <span style={{fontSize:14,fontWeight:600,color:TXT,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.title || "Untitled"}</span>
                            <span style={{fontSize:13,color:TXT3,flexShrink:0}}>{nAns ? nAns + " response" + (nAns!==1?"s":"") : "end"}</span>
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

  // ── Stack list pane (nothing selected) ───────────────────────────────────────
  function renderStackList() {
    return (
      <div style={{width:isTablet?Math.min(leftW,340):leftW,minWidth:isTablet?Math.min(leftW,340):leftW,display:"flex",flexDirection:"column",overflow:"hidden",flexShrink:0,background:themed("rgba(4,12,32,.35)")}}>
        <div style={{padding:"14px 16px 12px",borderBottom:"1px solid "+LINE,flexShrink:0,display:"flex",flexDirection:"column",gap:10}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:16,fontWeight:700,color:TXT}}>Stacks</span>
            <span style={{fontSize:13,color:TXT3}}>{stacks.length}</span>
            <div style={{flex:1}}/>
            {readOnly ? (
              <span style={{fontSize:13,color:TXT2,background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.12)",borderRadius:99,padding:"4px 12px"}}>View only</span>
            ) : (
              <>
                <button onClick={function(){ setShowImport(true); }} title="Copy or duplicate objection stacks"
                  style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.14)",color:TXT2,borderRadius:10,fontSize:13,fontWeight:600,padding:"6px 10px",minHeight:isTablet?40:32,cursor:"pointer",fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:6}}><CopyIcon size={14}/>Copy</button>
                <button onClick={function(){ setShowNew(function(p){ return !p; }); if (showNew) setNf({label:"",icon:"😐"}); }}
                  style={{background:showNew?"transparent":"rgba(239,83,80,.14)",border:"1px solid rgba(239,83,80,.4)",color:OBJ_COLOR,borderRadius:10,fontSize:14,fontWeight:700,padding:"6px 14px",minHeight:isTablet?40:32,cursor:"pointer",fontFamily:"inherit"}}>
                  {showNew ? "Cancel" : "+ New stack"}
                </button>
              </>
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
              <input value={nf.label} onChange={function(e){setNf(function(p){return Object.assign({},p,{label:e.target.value});});}} maxLength={LIMITS.stackLabel}
                onKeyDown={function(e){ if (e.key === "Enter") createStack(); }}
                placeholder="e.g. Price Objection" style={inputSt({marginBottom:12,fontSize:15})} autoFocus={!desktop.isTouchPrimary}/>
              <label style={Object.assign({}, labelSt(), {fontSize:12})}>Icon</label>
              <IconGrid value={nf.icon} onPick={function(ic){ setNf(function(p){ return Object.assign({},p,{icon:ic}); }); }}/>
              <button onClick={createStack} disabled={!nf.label.trim()}
                style={Object.assign({},solidBtn(OBJ_COLOR),{width:"100%",fontSize:15,opacity:nf.label.trim()?1:.5})}>Create stack</button>
            </div>
          )}
        </div>

        <div style={{flex:1,overflowY:"auto",padding:"12px 12px 16px"}}>
          {stacks.length === 0 && (
            <div style={{textAlign:"center",color:TXT3,padding:"40px 16px",fontSize:15,lineHeight:1.7}}>No stacks yet.{!readOnly && <><br/>Create one to handle objections.</>}</div>
          )}
          {/* The owner drags stacks into the order every list (and Play) shows */}
          {isOwner && !q && stacks.length > 1 && <div style={{fontSize:12,color:TXT3,margin:"0 2px 8px"}}>Drag ⠿ to set the order reps see in Play.</div>}
          <ReorderList items={visibleStacks} getId={function(st){ return st.id; }} gap={6} label="Objection stack order"
            enabled={!!isOwner && !q} onReorder={reorder}
            renderItem={function(stack, handle) {
            var cardCount = Object.keys(stack.cards || {}).length;
            var h = stackHealth(stack);
            return (
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                {handle}
                <button data-row="1" onClick={function(){ selectStack(stack.id); }}
                  style={{flex:1,minWidth:0,display:"flex",alignItems:"center",gap:12,textAlign:"left",background:"rgba(255,255,255,.03)",
                    borderTop:"1px solid "+LINE,borderRight:"1px solid "+LINE,borderBottom:"1px solid "+LINE,borderLeft:"4px solid rgba(239,83,80,.4)",
                    borderRadius:10,padding:"11px 12px",cursor:"pointer",fontFamily:"inherit"}}>
                  <StackIcon icon={stack.icon} size={40}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:15,fontWeight:700,color:TXT,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{stack.label}</div>
                    <div style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:TXT3,marginTop:3,flexWrap:"wrap"}}>
                      <span>{cardCount} card{cardCount!==1?"s":""}</span>
                      <span style={{display:"inline-flex",alignItems:"center",gap:5,color:h.color}}>
                        <span style={{width:7,height:7,borderRadius:"50%",background:h.color}}/>{h.text}
                      </span>
                      <StackBadges stack={stack} readOnly={readOnly}/>
                    </div>
                  </div>
                  <span style={{color:"rgba(239,83,80,.55)",fontSize:18,flexShrink:0}}>›</span>
                </button>
              </div>
            );
          }}/>
          {stacks.length > 0 && visibleStacks.length === 0 && <div style={{textAlign:"center",color:TXT3,padding:"30px 0",fontSize:15}}>No matches</div>}

          {archived.length > 0 && (
            <div style={{marginTop:14}}>
              <button onClick={function(){ setShowArchived(function(p){ return !p; }); }}
                style={{background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",padding:"6px 2px",fontSize:12,fontWeight:700,letterSpacing:.8,textTransform:"uppercase",color:TXT3}}>
                {showArchived ? "▾" : "▸"} Archived ({archived.length})
              </button>
              {showArchived && archived.map(function(st) {
                return (
                  <div key={st.id} style={{display:"flex",alignItems:"center",gap:10,border:"1px dashed rgba(255,255,255,.14)",borderRadius:10,padding:"9px 10px",marginTop:6}}>
                    <span style={{fontSize:18,filter:"grayscale(.6)"}}>{st.icon}</span>
                    <span style={{flex:1,minWidth:0,fontSize:14,color:TXT2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{st.label}</span>
                    <SmallBtn onClick={function(){ restoreStack(st.id); }}>Restore</SmallBtn>
                    {isOwner && <SmallBtn danger onClick={function(){ deleteStack(st); }}>Delete</SmallBtn>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Open stack: card list pane ───────────────────────────────────────────────
  function renderCardList(stack, full) {
    var list = orderedStackCards(stack);
    var cq = cardSearch.toLowerCase();
    var shown = list.filter(function(c){ return !cq || (c.title||"").toLowerCase().includes(cq) || stripMarkup(c.prompt||"").toLowerCase().includes(cq); });
    var w = full ? "100%" : (isTablet ? Math.min(leftW,340) : leftW);
    return (
      <div style={{width:w,minWidth:full?0:w,flex:full?1:"none",display:"flex",flexDirection:"column",overflow:"hidden",flexShrink:0,background:themed("rgba(4,12,32,.35)")}}>
        <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",borderBottom:"1px solid "+LINE,flexShrink:0}}>
          <span style={{fontSize:13,fontWeight:700,color:TXT3,letterSpacing:1,textTransform:"uppercase",flex:1}}>Path · {list.length} card{list.length!==1?"s":""}</span>
          {editing && !isTablet && (
            <button onClick={function(){ setListRail(true); }} title="Collapse the list to give the card stage more room"
              style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.12)",borderRadius:8,color:TXT2,fontSize:13,padding:"4px 10px",cursor:"pointer",fontFamily:"inherit"}}>‹ Collapse</button>
          )}
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"12px"}}>
          {list.length === 0 && (
            <div style={{textAlign:"center",color:TXT3,padding:"36px 10px",fontSize:15,lineHeight:1.7}}>
              No cards yet.<br/>
              <button onClick={newCard} style={Object.assign({},solidBtn(OBJ_COLOR),{marginTop:12,fontSize:14})}>+ Create the entry card</button>
            </div>
          )}
          {shown.map(function(c) {
            var sel = editing && editing.id === c.id;
            var isEntry = c.id === stack.rootCard;
            var step = list.indexOf(c) + 1;
            var answers = (c.answers || []).filter(function(a){ return a && a.label; });
            var ends = answers.filter(function(a){ return !a.next || !stack.cards[a.next]; }).length;
            return (
              <button key={c.id} data-row="1" onClick={function(){ openCard(c, null); }}
                style={{display:"flex",alignItems:"flex-start",gap:10,width:"100%",textAlign:"left",background:sel?"rgba(239,83,80,.13)":"rgba(255,255,255,.035)",
                  borderTop:"1px solid "+(sel?"rgba(239,83,80,.5)":LINE),borderRight:"1px solid "+(sel?"rgba(239,83,80,.5)":LINE),borderBottom:"1px solid "+(sel?"rgba(239,83,80,.5)":LINE),
                  borderLeft:"4px solid "+OBJ_COLOR,borderRadius:10,padding:"11px 12px",marginBottom:6,cursor:"pointer",fontFamily:"inherit",minHeight:isTablet?52:0}}>
                <StepDot n={step}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:15,fontWeight:700,color:TXT,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.title || <em style={{opacity:.45}}>Untitled</em>}</span>
                    {isEntry && <span style={{fontSize:11,fontWeight:700,color:OBJ_COLOR,background:"rgba(239,83,80,.15)",borderRadius:99,padding:"2px 8px",flexShrink:0}}>Entry</span>}
                  </div>
                  <div style={{fontSize:13,color:TXT3,marginTop:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{stripMarkup(c.prompt || "") || "No script yet"}</div>
                  <div style={{fontSize:12,color:TXT3,marginTop:5}}>
                    {answers.length} response{answers.length!==1?"s":""}{ends ? " · " + ends + " ending" + (ends!==1?"s":"") : ""}
                  </div>
                </div>
              </button>
            );
          })}
          {list.length > 0 && shown.length === 0 && <div style={{textAlign:"center",color:TXT3,padding:"30px 0",fontSize:15}}>No cards match “{cardSearch}”</div>}
        </div>
      </div>
    );
  }

  // ── Open stack: stats when no card is on the stage (like the Cards tab overview) ──
  function renderStackStats(stack, editable) {
    var list = orderedStackCards(stack);
    var h = stackHealth(stack);
    var target = stack.targetCard && deck.cards[stack.targetCard];
    var header = (
      <>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <StackIcon icon={stack.icon} size={isTablet?44:50}/>
          <div style={{minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
              <span style={{fontSize:isTablet?20:22,fontWeight:700,color:TXT,fontFamily:"'Lora',serif"}}>{stack.label}</span>
              <StackBadges stack={stack} readOnly={readOnly}/>
            </div>
            <div style={{fontSize:14,color:TXT3,marginTop:3}}>{list.length} card{list.length!==1?"s":""} · <span style={{color:h.color}}>{h.text}</span> · {target ? "then → " + (target.title || "target card") : "returns to the current card"}</div>
          </div>
        </div>
        {editable && list.length === 0 && (
          <div style={{marginTop:14,background:"rgba(239,83,80,.06)",border:"1px dashed rgba(239,83,80,.3)",borderRadius:12,padding:"14px 16px",color:TXT2,fontSize:14,lineHeight:1.6,maxWidth:620}}>
            This stack has no cards yet. The first card you add becomes the entry card — what the rep says when the objection comes up.
            <div><button onClick={newCard} style={Object.assign({},solidBtn(OBJ_COLOR),{marginTop:10,fontSize:14})}>+ Create the entry card</button></div>
          </div>
        )}
      </>
    );
    return (
      <StackStats key={stack.id} deck={deck} stack={stack} orderedCards={list} canOrg={!!isAdmin} header={header}
        onOpenCard={editable ? function(c){ openCard(c, null); } : null}
        onOpenSession={onOpenSession}/>
    );
  }

  // ── Open stack: card editor (staged = on the CardStage, else the docked tree panel) ─
  function renderEditor(stack, staged) {
    var endLabel = stack.targetCard && deck.cards[stack.targetCard] ? "then → " + (deck.cards[stack.targetCard].title || "target card") : "returns to current card";
    function editorFor(c, api) {
      return (
        <CardEditorSheet key={c.id} card={c} allCards={stack.cards || {}} rootCard={stack.rootCard}
          accentColor={OBJ_COLOR} lockedType="objection" inline={true} staged={staged} navDir={staged ? null : navDir}
          navRef={api ? api.navRef : undefined} onFormChange={api ? api.onFormChange : undefined}
          onSave={function(card){ saveCard(card); closeCard(); }}
          onDelete={removeCard}
          onClose={closeCard}
          onNavigateTo={function(t, dir){ openCard(t, dir); }}
          onSaveAndNavigateTo={function(form, t, dir){ saveCard(form); openCard(t, dir); }}/>
      );
    }
    if (!staged) return editorFor(editing, null);
    return (
      <CardStage
        card={editing}
        cards={stack.cards || {}}
        rootCard={stack.rootCard}
        navDir={navDir}
        accent={OBJ_COLOR}
        lockedType="objection"
        endLabel={endLabel}
        onNavigate={function(c, dir){ openCard(c, dir); }}
        onBack={isTablet ? closeCard : null}
        backLabel="Stack cards"
        renderCenter={editorFor}
      />
    );
  }

  // ── Open stack: top bar + after-resolving strip ──────────────────────────────
  function renderStackBar(stack) {
    var tb = isTablet ? 40 : 36;
    return (
      <>
        <div style={{height:54,flexShrink:0,display:"flex",alignItems:"center",borderBottom:"1px solid "+LINE,background:themed("rgba(6,16,42,.6)"),padding:"0 14px 0 10px",gap:10,position:"relative"}}>
          <button onClick={function(){ selectStack(null); }} title="All stacks"
            style={{display:"flex",alignItems:"center",gap:6,minHeight:tb,background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.12)",borderRadius:99,color:TXT,fontSize:14,fontWeight:600,padding:"0 14px 0 10px",cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>
            <span style={{fontSize:17,lineHeight:1}}>‹</span>{isTablet ? "Stacks" : "All stacks"}
          </button>
          {/* Stack switcher */}
          <button onClick={function(){ setShowSwitch(function(p){ return !p; }); }} aria-expanded={showSwitch}
            style={{display:"flex",alignItems:"center",gap:8,minWidth:0,maxWidth:isTablet?200:320,background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",padding:"4px 6px",borderRadius:8,color:TXT}}>
            <span style={{fontSize:20}}>{stack.icon}</span>
            <span style={{fontSize:16,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{stack.label}</span>
            <span style={{fontSize:11,color:TXT3}}>▾</span>
          </button>
          {showSwitch && (
            <div style={{position:"absolute",top:50,left:isTablet?110:140,zIndex:40,minWidth:260,maxHeight:360,overflowY:"auto",background:themed("#0b1a36"),border:"1px solid rgba(255,255,255,.14)",borderRadius:12,boxShadow:"0 16px 40px rgba(0,0,0,.6)",padding:6}}>
              {stacks.map(function(st) {
                var on = st.id === stack.id;
                return (
                  <button key={st.id} onClick={function(){ selectStack(st.id); }}
                    style={{display:"flex",alignItems:"center",gap:10,width:"100%",textAlign:"left",background:on?"rgba(239,83,80,.14)":"transparent",border:"none",borderRadius:8,padding:"9px 10px",minHeight:isTablet?44:0,cursor:"pointer",fontFamily:"inherit",color:TXT,fontSize:14}}>
                    <span style={{fontSize:17}}>{st.icon}</span>
                    <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:on?700:500}}>{st.label}</span>
                    <span style={{fontSize:12,color:TXT3}}>{Object.keys(st.cards||{}).length}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div style={{width:1,height:26,background:LINE,flexShrink:0}}/>
          <div role="tablist" style={{display:"flex",alignSelf:"stretch"}}>
            {[["list","≡  List"],["tree","◈  Tree"]].map(function(pair) {
              var v = pair[0]; var on = viewMode === v;
              return (
                <button key={v} role="tab" aria-selected={on} onClick={function(){ setViewMode(v); }}
                  style={{background:"none",border:"none",borderBottom:"3px solid "+(on ? OBJ_COLOR : "transparent"),padding:isTablet?"0 12px":"0 16px",cursor:"pointer",fontFamily:"inherit",fontSize:15,fontWeight:on?700:500,color:on?TXT:TXT3,flexShrink:0,whiteSpace:"pre"}}>
                  {pair[1]}
                </button>
              );
            })}
          </div>
          {viewMode === "list" && !isTablet && (
            <input value={cardSearch} onChange={function(e){ setCardSearch(e.target.value); }} placeholder="Search this stack…" aria-label="Search stack cards"
              style={Object.assign({}, inputSt({height:36,fontSize:14,padding:"0 14px",borderRadius:10,marginBottom:0}), {flex:1,maxWidth:300,width:"auto"})}/>
          )}
          <div style={{flex:1}}/>
          <SmallBtn tall={isTablet} onClick={function(){ setShowCardImport(true); }} title="Copy objection cards from any stack into this one"><CopyIcon size={14}/>{isTablet ? "" : " Copy cards"}</SmallBtn>
          <button onClick={newCard} style={Object.assign({},solidBtn(OBJ_COLOR),{height:tb,padding:"0 16px",fontSize:14,borderRadius:10,flexShrink:0})}>+ Card</button>
          <SmallBtn tall={isTablet} onClick={function(){ openMeta(stack); }} title="Rename, change icon, or choose who uses and edits it">✎{isTablet ? "" : " Edit"}</SmallBtn>
          <SmallBtn tall={isTablet} warn onClick={function(){ archiveStack(stack.id); }} title="Hide from Play — restorable">🗄{isTablet ? "" : " Archive"}</SmallBtn>
          {isOwner && <SmallBtn tall={isTablet} danger onClick={function(){ deleteStack(stack); }} title="Delete permanently">🗑{isTablet ? "" : " Delete"}</SmallBtn>}
        </div>

        {/* After resolving: where Play goes once this stack ends */}
        <div style={{flexShrink:0,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",padding:"8px 16px",borderBottom:"1px solid "+LINE,background:"rgba(239,83,80,.04)"}}>
          <span style={{fontSize:12,fontWeight:700,letterSpacing:.8,textTransform:"uppercase",color:"rgba(239,83,80,.75)"}}>After resolving</span>
          <div style={{display:"flex",background:"rgba(255,255,255,.05)",borderRadius:10,padding:2,gap:2}}>
            <button onClick={function(){ setTarget(null); }} aria-pressed={!stack.targetCard}
              style={{background:!stack.targetCard?"rgba(255,255,255,.14)":"transparent",border:"none",borderRadius:8,padding:"0 12px",minHeight:isTablet?38:30,cursor:"pointer",fontFamily:"inherit",fontSize:13,color:!stack.targetCard?TXT:TXT3,fontWeight:!stack.targetCard?700:500}}>↩ Return to current card</button>
            <button onClick={function(){ if (!stack.targetCard && deckCardList.length) setTarget(deck.rootCard || deckCardList[0].id); }} aria-pressed={!!stack.targetCard}
              style={{background:stack.targetCard?"rgba(239,83,80,.2)":"transparent",border:"none",borderRadius:8,padding:"0 12px",minHeight:isTablet?38:30,cursor:"pointer",fontFamily:"inherit",fontSize:13,color:stack.targetCard?OBJ_COLOR:TXT3,fontWeight:stack.targetCard?700:500}}>→ Go to a card</button>
          </div>
          {stack.targetCard && (
            <select value={stack.targetCard} onChange={function(e){ setTarget(e.target.value); }} aria-label="Card to go to after resolving"
              style={Object.assign({}, inputSt({height:isTablet?40:32,fontSize:13,marginBottom:0,padding:"0 10px"}), {width:"auto",maxWidth:300,appearance:"auto"})}>
              {!deck.cards[stack.targetCard] && <option value={stack.targetCard}>⚠ Missing card</option>}
              {deckCardList.map(function(c){ return <option key={c.id} value={c.id}>{(TM[c.type]||TM.pitch).icon} {c.title || "Untitled"}</option>; })}
            </select>
          )}
          <div style={{flex:1}}/>
          {stack.rootCard && stack.cards[stack.rootCard] && (
            <button onClick={function(){ openCard(stack.cards[stack.rootCard], null); }}
              style={{background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:13,color:TXT3,padding:"4px 2px"}}>
              Entry: <span style={{color:TXT2,fontWeight:600}}>{stack.cards[stack.rootCard].title || "Untitled"}</span>
            </button>
          )}
        </div>
      </>
    );
  }

  // ── Open stack (admins) ──────────────────────────────────────────────────────
  function renderStackWorkspace(stack) {
    return (
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0}}>
        {renderStackBar(stack)}
        <div style={{flex:1,display:"flex",overflow:"hidden",minHeight:0}}>
          {viewMode === "list" && (
            <>
              {editing && !isTablet && listRail && <PaneRail label="Cards" color={OBJ_COLOR} onExpand={function(){ setListRail(false); }}/>}
              {(!editing || (!isTablet && !listRail)) && <>
                {renderCardList(stack, false)}
                <div onMouseDown={startDrag} title="Drag to resize"
                  style={Object.assign({},resizeHandle(),{background:isDragging?"rgba(255,255,255,.1)":"transparent"})}/>
              </>}
              <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0,background:themed("rgba(8,20,50,.2)")}}>
                {editing ? renderEditor(stack, true) : renderStackStats(stack, true)}
              </div>
            </>
          )}
          {viewMode === "tree" && (
            <>
              {editing && (
                <div style={{width:treeEdCollapsed ? 44 : (isTablet ? "clamp(360px, 46%, 500px)" : "clamp(420px, 36%, 560px)"),flexShrink:0,display:"flex",overflow:"hidden",
                  borderRight:"1px solid rgba(255,255,255,.1)",background:themed("rgba(8,20,50,.85)"),transition:"width .22s cubic-bezier(.22,1,.36,1)"}}>
                  <div style={{flex:1,minWidth:0,display:treeEdCollapsed ? "none" : "flex",flexDirection:"column",overflow:"hidden"}}>
                    {renderEditor(stack, false)}
                  </div>
                  <button onClick={function(){ setTreeEdCollapsed(!treeEdCollapsed); }}
                    title={treeEdCollapsed ? "Show card editor" : "Collapse card editor"} aria-expanded={!treeEdCollapsed}
                    style={{width:treeEdCollapsed ? 44 : (isTablet ? 28 : 18),flexShrink:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:treeEdCollapsed ? "flex-start" : "center",gap:12,
                      padding:treeEdCollapsed ? "14px 0" : 0,background:treeEdCollapsed ? "transparent" : "rgba(255,255,255,.03)",border:"none",
                      borderLeft:treeEdCollapsed ? "none" : "1px solid rgba(255,255,255,.07)",cursor:"pointer",fontFamily:"inherit",color:TXT2}}>
                    <span style={{fontSize:treeEdCollapsed ? 16 : 13,color:TXT}}>{treeEdCollapsed ? "›" : "‹"}</span>
                    {treeEdCollapsed && (
                      <span style={{writingMode:"vertical-rl",transform:"rotate(180deg)",fontSize:13,fontWeight:700,letterSpacing:.5,color:OBJ_COLOR,whiteSpace:"nowrap",overflow:"hidden",maxHeight:"70vh"}}>
                        Edit · {editing.title || "New card"}
                      </span>
                    )}
                  </button>
                </div>
              )}
              <div style={{flex:1,overflow:"hidden",position:"relative",minWidth:0,display:"flex",flexDirection:"column"}}>
                {Object.keys(stack.cards || {}).length ? (
                  <TreeView cards={stack.cards} rootCard={stack.rootCard}
                    onEdit={function(c){ setTreeEdCollapsed(false); openCard(c, null); }}
                    onSetRoot={function(id){ updateStack(stack.id, function(st){ return Object.assign({}, st, { rootCard:id }); }); }}/>
                ) : (
                  <div style={{margin:"auto",textAlign:"center",color:TXT3,fontSize:15,lineHeight:1.7}}>
                    No cards in this stack yet.<br/>
                    <button onClick={newCard} style={Object.assign({},solidBtn(OBJ_COLOR),{marginTop:12,fontSize:14})}>+ Create the entry card</button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{display:"flex",height:"100%",overflow:"hidden",userSelect:isDragging?"none":"auto"}}>
      {selectedStack && selectedEditable && renderStackWorkspace(selectedStack)}

      {selectedStack && !selectedEditable && (
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0}}>
          <div style={{flexShrink:0,display:"flex",alignItems:"center",gap:10,padding:"8px 14px",borderBottom:"1px solid "+LINE,background:themed("rgba(4,12,32,.45)")}}>
            <button onClick={function(){ selectStack(null); }}
              style={{display:"flex",alignItems:"center",gap:6,minHeight:40,background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.12)",borderRadius:99,color:TXT,fontSize:14,fontWeight:600,padding:"0 16px 0 12px",cursor:"pointer",fontFamily:"inherit"}}>
              <span style={{fontSize:17,lineHeight:1}}>‹</span>All stacks
            </button>
            {/* Switch stacks without going back to the list */}
            <select value={selectedStack.id} onChange={function(e){ selectStack(e.target.value); }} aria-label="Objection stack"
              style={Object.assign({}, inputSt({height:40,fontSize:14,marginBottom:0,padding:"0 10px"}), {width:"auto",maxWidth:280,appearance:"auto"})}>
              {stacks.map(function(st){ return <option key={st.id} value={st.id}>{st.icon} {st.label}</option>; })}
            </select>
          </div>
          <StackReadView key={selectedStack.id} stack={selectedStack} deckCards={deck.cards} isTablet={isTablet}
            renderEmpty={!isTablet || desktop.splitPanes ? function(){ return renderStackStats(selectedStack, false); } : null}/>
        </div>
      )}

      {!selectedStack && <>
        {renderStackList()}
        <div onMouseDown={startDrag} title="Drag to resize"
          style={Object.assign({},resizeHandle(),{background:isDragging?"rgba(255,255,255,.1)":"transparent"})}/>
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0,background:themed("rgba(8,20,50,.2)")}}>
          {renderOverview()}
        </div>
      </>}

      {showCardImport && selectedStack && (
        <ImportPicker mode="stackCards" decks={decks} currentDeckId={deck.id} onImport={importStackCards} onClose={function(){ setShowCardImport(false); }}/>
      )}
      {showImport && (
        <ImportPicker mode="stacks" decks={decks} currentDeckId={deck.id} onImport={importStacks} onClose={function(){ setShowImport(false); }}/>
      )}
      {showMeta && selectedStack && (
        <DesktopModal title="Stack details" width={480} onClose={function(){ setShowMeta(false); }}>
          <div style={{padding:"16px 20px 20px",maxHeight:"calc(var(--vvh, 100vh) - 160px)",overflowY:"auto"}}>
            <label style={Object.assign({}, labelSt(), {fontSize:12})}>Stack name</label>
            <input value={meta.label} onChange={function(e){ setMeta(function(p){ return Object.assign({},p,{label:e.target.value}); }); }} maxLength={LIMITS.stackLabel}
              onKeyDown={function(e){ if (e.key === "Enter") saveMeta(); }} style={inputSt({marginBottom:12,fontSize:15})}/>
            <label style={Object.assign({}, labelSt(), {fontSize:12})}>Icon</label>
            <IconGrid value={meta.icon} onPick={function(ic){ setMeta(function(p){ return Object.assign({},p,{icon:ic}); }); }}/>
            {canManageStack(selectedStack, readOnly) ? (
              <AccessFields value={meta} onChange={function(v){ setMeta(function(p){ return Object.assign({}, p, { visibility:v.visibility, accessList:v.accessList, editorIds:v.editorIds }); }); }}
                orgUsers={orgUsers} orgTeams={orgTeams} creatorId={selectedStack.createdBy} noun="stack"/>
            ) : (
              <div style={{fontSize:12,color:TXT3,marginBottom:12,lineHeight:1.5}}>{accessSummary(selectedStack)}</div>
            )}
            <button onClick={saveMeta} disabled={!meta.label.trim()} style={Object.assign({},solidBtn(OBJ_COLOR),{width:"100%",fontSize:15,opacity:meta.label.trim()?1:.5})}>Save</button>
          </div>
        </DesktopModal>
      )}
    </div>
  );
}

// 🔒 for a stack assigned to teams/people; "View only" for one this person can't edit
function StackBadges({ stack, readOnly }) {
  var priv = stack.visibility === "private";
  var view = !canEditStack(stack, readOnly);
  if (!priv && !view) return null;
  return (
    <>
      {priv && <span title="Assigned to teams/people" style={{fontSize:11,fontWeight:700,color:"#00B4FF",background:"rgba(0,180,255,.12)",border:"1px solid rgba(0,180,255,.3)",borderRadius:99,padding:"1px 8px"}}>🔒 Assigned</span>}
      {view && <span style={{fontSize:11,fontWeight:600,color:TXT2,background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.12)",borderRadius:99,padding:"1px 8px"}}>View only</span>}
    </>
  );
}

function StepDot({ n }) {
  return <span style={{width:22,height:22,borderRadius:"50%",background:"rgba(239,83,80,.14)",border:"1px solid rgba(239,83,80,.4)",color:OBJ_COLOR,fontSize:12,fontWeight:800,display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>{n}</span>;
}

function IconGrid({ value, onPick }) {
  return (
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(38px, 1fr))",gap:6,marginBottom:12}}>
      {OBJ_ICONS.map(function(ic){
        return <button key={ic} onClick={function(){ onPick(ic); }} aria-pressed={value===ic}
          style={{background:value===ic?"rgba(255,255,255,.15)":"rgba(255,255,255,.05)",border:"1.5px solid "+(value===ic?"rgba(255,255,255,.45)":"rgba(255,255,255,.08)"),borderRadius:8,height:38,cursor:"pointer",fontSize:18}}>{ic}</button>;
      })}
    </div>
  );
}

function SmallBtn({ onClick, children, danger, warn, title, tall }) {
  var c = danger ? OBJ_COLOR : warn ? "#FFB74D" : TXT2;
  return (
    <button onClick={onClick} title={title}
      style={{background:"rgba(255,255,255,.04)",border:"1px solid "+(danger ? "rgba(239,83,80,.35)" : warn ? "rgba(255,183,77,.3)" : "rgba(255,255,255,.14)"),color:c,borderRadius:10,fontSize:13,fontWeight:600,padding:"0 10px",minHeight:tall?40:32,minWidth:tall?40:0,cursor:"pointer",fontFamily:"inherit",flexShrink:0,whiteSpace:"nowrap"}}>
      {children}
    </button>
  );
}
