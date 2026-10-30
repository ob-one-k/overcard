import { useState, useRef, useEffect, useContext } from "react";
import { TM, uid, aid } from "../../lib/constants";
import { lsGet, lsSet } from "../../lib/api";
import { solidBtn, inputSt, resizeHandle } from "../../lib/styles";
import { CardEditorSheet } from "../Editor";
import { TreeView } from "../Viewer";
import { RichPromptDisplay } from "../Tooltip";
import { stripMarkup } from "../../lib/richtext";
import { getParents } from "../../lib/cardGraph";
import DesktopCtx from "../../lib/DesktopCtx";
import { CardStage, PaneRail } from "../CardStage";

// ─── DESKTOP TYPE SCALE ───────────────────────────────────────────────────────
// body 14–15 · meta 13 · section heading 16–18 · page title 20–24 · badges ≥11
var TXT  = "#fff";
var TXT2 = "rgba(255,255,255,.72)";
var TXT3 = "rgba(255,255,255,.5)";
var LINE = "rgba(255,255,255,.07)";
var GREEN = "#66BB6A";

function validBullets(card) { return (card.overview || []).filter(function(b){ return b && b.trim(); }); }

// ─── SMALL BADGES (desktop-sized) ─────────────────────────────────────────────
export function DeskTypeBadge({ type }) {
  var m = TM[type] || TM.pitch;
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:5,background:m.color+"1f",border:"1px solid "+m.color+"55",color:m.color,borderRadius:99,fontSize:12,fontWeight:700,letterSpacing:.5,padding:"3px 10px",textTransform:"uppercase",flexShrink:0}}>
      <span>{m.icon}</span>{m.label}
    </span>
  );
}
function MiniBadge({ color, children, title }) {
  return <span title={title} style={{fontSize:11,fontWeight:700,color:color,background:color+"1a",border:"1px solid "+color+"44",borderRadius:99,padding:"2px 8px",whiteSpace:"nowrap",flexShrink:0,letterSpacing:.3}}>{children}</span>;
}

// ─── READ-ONLY CARD VIEW ──────────────────────────────────────────────────────
// Used for non-admin users (readOnly) in Cards and Objections. Large type,
// answers link through to their destination cards, "Linked from" shows parents
// (hidden when `staged` — CardStage draws the parents as back tabs instead).
export function CardReadView({ card, cards, rootCard, onOpen, onClose, accent, staged }) {
  var m = TM[card.type] || TM.pitch;
  var color = accent || m.color;
  var bullets = validBullets(card);
  var answers = (card.answers || []).filter(function(a){ return a && a.label; });
  var parents = staged ? [] : getParents(cards, card.id).map(function(p){ return p.card; });
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0}}>
      <div style={{padding:"18px 26px 16px",borderBottom:"1px solid "+LINE,flexShrink:0,display:"flex",alignItems:"flex-start",gap:14}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,flexWrap:"wrap"}}>
            <DeskTypeBadge type={card.type}/>
            {card.id === rootCard && <MiniBadge color={GREEN}>Entry card</MiniBadge>}
            {card.intendedPath && <MiniBadge color={GREEN}>★ Intended path</MiniBadge>}
          </div>
          <div style={{fontSize:24,fontWeight:700,color:TXT,fontFamily:"'Lora',serif",lineHeight:1.25}}>{card.title || "Untitled"}</div>
        </div>
        {onClose && (
          <button onClick={onClose} aria-label="Close card"
            style={{background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.12)",borderRadius:10,color:TXT2,cursor:"pointer",fontSize:15,padding:"6px 12px",fontFamily:"inherit",flexShrink:0}}>✕</button>
        )}
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"20px 26px 28px"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(320px, 1fr))",gap:20,alignItems:"start"}}>
          {/* Script column */}
          <div style={{minWidth:0}}>
            {bullets.length > 0 && (
              <div style={{background:"rgba(255,255,255,.045)",borderLeft:"3px solid "+color,borderRadius:12,padding:"14px 18px",marginBottom:16}}>
                <div style={{fontSize:13,fontWeight:700,color:TXT3,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Key points</div>
                {bullets.map(function(b, i) {
                  return (
                    <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start",marginBottom:i<bullets.length-1?6:0}}>
                      <span style={{color:color,fontSize:11,marginTop:5,flexShrink:0}}>◆</span>
                      <span style={{fontSize:15,color:TXT2,lineHeight:1.5}}>{b}</span>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{fontSize:13,fontWeight:700,color:TXT3,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Script</div>
            <div style={{background:"rgba(255,255,255,.04)",border:"1px solid "+LINE,borderRadius:14,padding:"18px 20px",fontSize:17,lineHeight:1.75,color:"rgba(255,255,255,.9)"}}>
              {card.prompt ? <RichPromptDisplay text={card.prompt} accentColor={color}/> : <span style={{color:TXT3,fontSize:15}}>No script written for this card.</span>}
            </div>
          </div>

          {/* Flow column */}
          <div style={{minWidth:0}}>
            <div style={{fontSize:13,fontWeight:700,color:TXT3,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Prospect responds</div>
            {answers.length === 0 && <div style={{fontSize:14,color:TXT3,marginBottom:16}}>No responses — this card ends the path.</div>}
            {answers.map(function(ans, i) {
              var linked = ans.next && cards ? cards[ans.next] : null;
              var lm = linked ? (TM[linked.type] || TM.pitch) : null;
              return (
                <button key={ans.id || i} disabled={!linked || !onOpen}
                  onClick={function(){ if (linked && onOpen) onOpen(linked); }}
                  style={{display:"block",width:"100%",textAlign:"left",background:"rgba(255,255,255,.04)",border:"1px solid "+LINE,borderRadius:12,padding:"12px 14px",marginBottom:8,cursor:linked&&onOpen?"pointer":"default",fontFamily:"inherit"}}>
                  <div style={{fontSize:15,color:TXT,lineHeight:1.4}}>{ans.label}</div>
                  {linked ? (
                    <div style={{display:"flex",alignItems:"center",gap:8,marginTop:8}}>
                      <span style={{fontSize:13,color:TXT3}}>→</span>
                      <span style={{fontSize:14,color:lm.color,fontWeight:600,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{linked.title || "Untitled"}</span>
                      <MiniBadge color={lm.color}>{lm.label}</MiniBadge>
                    </div>
                  ) : (
                    <div style={{fontSize:13,color:TXT3,marginTop:6}}>→ No destination linked</div>
                  )}
                </button>
              );
            })}
            {parents.length > 0 && (
              <>
                <div style={{fontSize:13,fontWeight:700,color:TXT3,textTransform:"uppercase",letterSpacing:1,margin:"18px 0 8px"}}>Linked from</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                  {parents.map(function(p) {
                    var pm = TM[p.type] || TM.pitch;
                    return (
                      <button key={p.id} onClick={function(){ if (onOpen) onOpen(p); }}
                        style={{background:pm.color+"14",border:"1px solid "+pm.color+"44",color:pm.color,borderRadius:99,fontSize:13,fontWeight:600,padding:"5px 12px",cursor:"pointer",fontFamily:"inherit"}}>
                        ← {p.title || "Untitled"}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── CARDS DESKTOP ────────────────────────────────────────────────────────────
// LIST mode — resizable list pane (default 380px) + detail pane (flex:1).
//             Detail pane: editor (admin) / read-only view (user) for the
//             selected card, or a deck overview (intended path, type mix,
//             cards needing attention) when nothing is selected.
// TREE mode — summary rail (260px) + TreeView + editor/read view side panel.
export function CardsDesktop({ deck, onUpsert, onDelete, onUpdateDeck, readOnly }) {
  var desktop = useContext(DesktopCtx);
  var isTablet = !!desktop.isTablet;
  var [viewMode,  setViewMode]  = useState("list");
  // While a card is on the stage the list pane folds into a rail (desktop
  // preference, persisted). Tablets hide the list entirely and show a back pill.
  var [listRail,  setListRailSt] = useState(function(){ return lsGet("overcard_cards_listRail") !== "0"; });
  function setListRail(v) { setListRailSt(v); lsSet("overcard_cards_listRail", v ? "1" : "0"); }
  var [editing,   setEditing]   = useState(null);
  var [navDir,    setNavDir]    = useState(null);
  var [search,    setSearch]    = useState("");
  var [collapsed, setCollapsed] = useState({});

  // ── Resizable left pane (list mode only) ─────────────────────────────────────
  var [leftW, setLeftW] = useState(function() {
    var stored = parseInt(lsGet("overcard_cards_leftW2"), 10);
    return (stored >= 300 && stored <= 600) ? stored : 380;
  });
  var dragging   = useRef(false);
  var dragStartX = useRef(0);
  var dragStartW = useRef(380);
  var leftWRef   = useRef(leftW);
  var [isDragging, setIsDragging] = useState(false);

  function updateLeftW(w) { leftWRef.current = w; setLeftW(w); }

  useEffect(function() {
    function onMove(e) {
      if (!dragging.current) return;
      var delta = e.clientX - dragStartX.current;
      var newW = Math.max(300, Math.min(600, dragStartW.current + delta));
      updateLeftW(newW);
    }
    function onUp() {
      if (!dragging.current) return;
      dragging.current = false;
      setIsDragging(false);
      lsSet("overcard_cards_leftW2", String(leftWRef.current));
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

  // ── Card operations ───────────────────────────────────────────────────────────
  var pitchTypes = ["pitch", "discovery", "close"];
  var allCards   = Object.values(deck.cards);

  function safeUpsert(deckId, card) {
    if (card.intendedPath && card.id !== deck.rootCard) {
      Object.values(deck.cards).forEach(function(parent) {
        if (!parent.intendedPath) return;
        var leadsToCard = (parent.answers || []).some(function(a){ return a.next === card.id; });
        if (!leadsToCard) return;
        (parent.answers || []).forEach(function(a) {
          if (a.next && a.next !== card.id) {
            var sibling = deck.cards[a.next];
            if (sibling && sibling.intendedPath) {
              onUpsert(deckId, Object.assign({}, sibling, { intendedPath: false }));
            }
          }
        });
      });
    }
    onUpsert(deckId, card);
  }

  function startNew() {
    setEditing({ id:uid(), title:"", type:"pitch", overview:[], intendedPath:false, prompt:"", answers:[{id:aid(),label:"",next:null}] });
  }
  function openCard(card) { setNavDir(null); setEditing(card); }

  // ── Deck analysis (overview pane + tree rail) ────────────────────────────────
  var typeStats = pitchTypes.map(function(t) {
    var m = TM[t];
    var count = allCards.filter(function(c){ return c.type === t; }).length;
    var intendedCount = allCards.filter(function(c){ return c.type === t && c.intendedPath; }).length;
    return { type:t, m:m, count:count, intendedCount:intendedCount };
  });

  // Intended path: walk from root through answers that lead to intended cards
  var intendedPath = [];
  (function() {
    var seen = {};
    var cur = deck.cards[deck.rootCard];
    while (cur && !seen[cur.id]) {
      seen[cur.id] = true;
      intendedPath.push(cur);
      var nextCard = null;
      (cur.answers || []).some(function(a) {
        var c = a && a.next ? deck.cards[a.next] : null;
        if (c && c.intendedPath && !seen[c.id]) { nextCard = c; return true; }
        return false;
      });
      cur = nextCard;
    }
  })();

  // Reachability from root → orphans; plus dead ends and unlinked answers
  var reachable = {};
  (function() {
    var stack = deck.rootCard ? [deck.rootCard] : [];
    while (stack.length) {
      var id = stack.pop();
      if (reachable[id] || !deck.cards[id]) continue;
      reachable[id] = true;
      (deck.cards[id].answers || []).forEach(function(a){ if (a && a.next) stack.push(a.next); });
    }
  })();
  var issues = [];
  allCards.forEach(function(c) {
    var labelled = (c.answers || []).filter(function(a){ return a && a.label; });
    var unlinked = labelled.filter(function(a){ return !a.next || !deck.cards[a.next]; }).length;
    if (deck.rootCard && !reachable[c.id]) issues.push({ card:c, text:"Not reachable from the entry card", color:"#FFD54F" });
    else if (unlinked > 0 && c.type !== "close") issues.push({ card:c, text:unlinked + " response" + (unlinked!==1?"s":"") + " without a destination", color:"#FF8A65" });
    if (!stripMarkup(c.prompt || "").trim()) issues.push({ card:c, text:"No script written", color:"#EF5350" });
  });

  var intendedTotal = allCards.filter(function(c){ return c.intendedPath; }).length;
  var q = search.toLowerCase();

  // ── Detail panel (editor for admins, read view for users) ───────────────────
  // staged=true (list mode) → wrapped in CardStage; tree mode keeps the plain panel.
  function closeCard() { setEditing(null); setNavDir(null); }
  function renderDetail(staged) {
    if (!editing) return null;
    if (staged) {
      var stageCard = readOnly ? (deck.cards[editing.id] || editing) : editing;
      return (
        <CardStage
          card={stageCard}
          cards={deck.cards}
          rootCard={deck.rootCard}
          navDir={navDir}
          onNavigate={function(target, dir){ setNavDir(dir||null); setEditing(target); }}
          onBack={isTablet ? closeCard : null}
          backLabel="All cards"
          renderCenter={function(c, api) {
            if (readOnly) {
              return <CardReadView key={c.id} card={c} cards={deck.cards} rootCard={deck.rootCard} staged={true}
                onOpen={function(t){ setNavDir("forward"); setEditing(t); }} onClose={closeCard}/>;
            }
            return (
              <CardEditorSheet
                key={c.id}
                card={c}
                allCards={deck.cards}
                rootCard={deck.rootCard}
                accentColor={TM[c.type] ? TM[c.type].color : "#00B4FF"}
                navDir={null}
                staged={true}
                navRef={api.navRef}
                onFormChange={api.onFormChange}
                onSave={function(card){ safeUpsert(deck.id, card); closeCard(); }}
                onDelete={function(id){ onDelete(deck.id, id); closeCard(); }}
                onClose={closeCard}
                onNavigateTo={function(targetCard, dir){ setNavDir(dir||null); setEditing(targetCard); }}
                onSaveAndNavigateTo={function(form, targetCard, dir){ safeUpsert(deck.id, form); setNavDir(dir||null); setEditing(targetCard); }}
                inline={true}
              />
            );
          }}
        />
      );
    }
    if (readOnly) {
      var live = deck.cards[editing.id] || editing;
      return <CardReadView card={live} cards={deck.cards} rootCard={deck.rootCard} onOpen={openCard} onClose={function(){ setEditing(null); }}/>;
    }
    return (
      <CardEditorSheet
        key={editing.id}
        card={editing}
        allCards={deck.cards}
        rootCard={deck.rootCard}
        accentColor={TM[editing.type] ? TM[editing.type].color : "#00B4FF"}
        navDir={navDir}
        onSave={function(card){ safeUpsert(deck.id, card); setEditing(null); setNavDir(null); }}
        onDelete={readOnly ? null : function(id){ onDelete(deck.id, id); setEditing(null); setNavDir(null); }}
        onClose={function(){ setEditing(null); setNavDir(null); }}
        onNavigateTo={function(targetCard, dir){ setNavDir(dir||null); setEditing(targetCard); }}
        onSaveAndNavigateTo={function(form, targetCard, dir){ safeUpsert(deck.id, form); setNavDir(dir||null); setEditing(targetCard); }}
        inline={true}
      />
    );
  }

  // ── Overview pane (nothing selected) ─────────────────────────────────────────
  function renderOverview() {
    var panel = { background:"rgba(255,255,255,.035)", border:"1px solid "+LINE, borderRadius:14, padding:"16px 18px", minWidth:0 };
    return (
      <div style={{flex:1,overflowY:"auto",padding:"22px 26px 28px"}}>
        <div style={{display:"flex",alignItems:"baseline",gap:12,flexWrap:"wrap",marginBottom:4}}>
          <div style={{fontSize:22,fontWeight:700,color:TXT,fontFamily:"'Lora',serif"}}>{deck.name}</div>
          <div style={{fontSize:14,color:TXT3}}>{allCards.length} card{allCards.length!==1?"s":""} · {intendedTotal} on intended path</div>
        </div>
        <div style={{fontSize:14,color:TXT3,marginBottom:18}}>
          {readOnly ? "Select a card on the left to read its script and responses." : "Select a card on the left to edit it, or create a new one."}
        </div>

        {/* Type mix */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(3, minmax(0, 1fr))",gap:12,marginBottom:16}}>
          {typeStats.map(function(ts) {
            return (
              <div key={ts.type} style={Object.assign({}, panel, {borderLeft:"4px solid "+ts.m.color,padding:"14px 16px"})}>
                <div style={{display:"flex",alignItems:"baseline",gap:8}}>
                  <span style={{fontSize:28,fontWeight:800,color:ts.m.color,lineHeight:1}}>{ts.count}</span>
                  <span style={{fontSize:15,fontWeight:600,color:TXT2}}>{ts.m.label}</span>
                </div>
                <div style={{fontSize:13,color:TXT3,marginTop:6}}>{ts.intendedCount} on intended path</div>
              </div>
            );
          })}
        </div>

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(320px, 1fr))",gap:16,alignItems:"start"}}>
          {/* Intended path */}
          <div style={panel}>
            <div style={{fontSize:16,fontWeight:700,color:TXT,marginBottom:12}}>★ Intended path</div>
            {intendedPath.length === 0 && <div style={{fontSize:14,color:TXT3}}>No entry card set yet.</div>}
            {intendedPath.map(function(c, i) {
              var m = TM[c.type] || TM.pitch;
              return (
                <button key={c.id} onClick={function(){ openCard(c); }}
                  style={{display:"flex",alignItems:"center",gap:12,width:"100%",textAlign:"left",background:"transparent",border:"none",borderTop:i?"1px solid "+LINE:"none",padding:"9px 4px",cursor:"pointer",fontFamily:"inherit"}}>
                  <span style={{width:26,height:26,borderRadius:"50%",background:m.color+"22",border:"1.5px solid "+m.color+"88",color:m.color,fontSize:13,fontWeight:800,display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{i+1}</span>
                  <span style={{fontSize:15,fontWeight:600,color:TXT,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.title || "Untitled"}</span>
                  <MiniBadge color={m.color}>{m.label}</MiniBadge>
                </button>
              );
            })}
          </div>

          {/* Needs attention */}
          <div style={panel}>
            <div style={{fontSize:16,fontWeight:700,color:TXT,marginBottom:12}}>Needs attention</div>
            {issues.length === 0 && <div style={{fontSize:14,color:GREEN}}>✓ Every card is reachable, scripted and linked.</div>}
            {issues.slice(0, 8).map(function(it, i) {
              return (
                <button key={it.card.id + i} onClick={function(){ openCard(it.card); }}
                  style={{display:"flex",alignItems:"center",gap:12,width:"100%",textAlign:"left",background:"transparent",border:"none",borderTop:i?"1px solid "+LINE:"none",padding:"9px 4px",cursor:"pointer",fontFamily:"inherit"}}>
                  <span style={{width:8,height:8,borderRadius:"50%",background:it.color,flexShrink:0}}/>
                  <span style={{flex:1,minWidth:0}}>
                    <span style={{display:"block",fontSize:15,fontWeight:600,color:TXT,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.card.title || "Untitled"}</span>
                    <span style={{display:"block",fontSize:13,color:TXT3,marginTop:2}}>{it.text}</span>
                  </span>
                </button>
              );
            })}
            {issues.length > 8 && <div style={{fontSize:13,color:TXT3,marginTop:6}}>+ {issues.length - 8} more</div>}
          </div>
        </div>

        {/* All cards at a glance */}
        {allCards.length > 0 && (
          <div style={Object.assign({}, panel, {marginTop:16,padding:"16px 0 6px",overflowX:"auto"})}>
            <div style={{fontSize:16,fontWeight:700,color:TXT,margin:"0 18px 10px"}}>All cards</div>
            <div style={{display:"grid",gridTemplateColumns:"minmax(160px,2.2fr) 110px repeat(3, minmax(70px,1fr))",gap:10,fontSize:13,color:TXT3,padding:"0 18px 8px",borderBottom:"1px solid "+LINE}}>
              <span>Card</span><span>Type</span><span style={{textAlign:"right"}}>Responses</span><span style={{textAlign:"right"}}>Linked from</span><span style={{textAlign:"right"}}>Path</span>
            </div>
            {pitchTypes.map(function(t) {
              return allCards.filter(function(c){ return c.type === t; }).sort(function(a,b){ return (a.sortIndex||0)-(b.sortIndex||0); }).map(function(c) {
                var m = TM[c.type] || TM.pitch;
                var nAns = (c.answers || []).filter(function(a){ return a && a.label; }).length;
                var nIn = allCards.filter(function(p){ return p.id !== c.id && (p.answers || []).some(function(a){ return a && a.next === c.id; }); }).length;
                return (
                  <button key={c.id} onClick={function(){ openCard(c); }}
                    style={{display:"grid",gridTemplateColumns:"minmax(160px,2.2fr) 110px repeat(3, minmax(70px,1fr))",gap:10,alignItems:"center",width:"100%",textAlign:"left",background:"transparent",border:"none",borderBottom:"1px solid "+LINE,padding:"10px 18px",cursor:"pointer",fontFamily:"inherit",fontSize:14,color:TXT2}}>
                    <span style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
                      <span style={{width:4,height:20,borderRadius:99,background:m.color,flexShrink:0}}/>
                      <span style={{fontWeight:600,color:TXT,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.title || "Untitled"}</span>
                      {c.id === deck.rootCard && <MiniBadge color={GREEN}>Entry</MiniBadge>}
                    </span>
                    <span style={{color:m.color,fontSize:13,fontWeight:600}}>{m.label}</span>
                    <span style={{textAlign:"right"}}>{nAns}</span>
                    <span style={{textAlign:"right"}}>{nIn}</span>
                    <span style={{textAlign:"right",color:c.intendedPath?GREEN:TXT3}}>{c.intendedPath ? "★ Intended" : "—"}</span>
                  </button>
                );
              });
            })}
          </div>
        )}

        {!readOnly && allCards.length === 0 && (
          <button onClick={startNew} style={Object.assign({},solidBtn(deck.color),{marginTop:18,fontSize:15})}>+ Create the first card</button>
        )}
      </div>
    );
  }

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",overflow:"hidden",userSelect:isDragging?"none":"auto"}}>

      {/* ── Top action bar ── */}
      <div style={{height:54,flexShrink:0,display:"flex",alignItems:"center",borderBottom:"1px solid "+LINE,background:"rgba(6,16,42,.6)",padding:"0 16px 0 8px",gap:12}}>
        {/* View mode tabs */}
        <div role="tablist" style={{display:"flex",alignSelf:"stretch"}}>
          {[["list","≡  List"],["tree","◈  Tree"]].map(function(pair) {
            var v = pair[0]; var lbl = pair[1]; var on = viewMode === v;
            return (
              <button key={v} role="tab" aria-selected={on} onClick={function(){ setViewMode(v); }}
                style={{background:"none",border:"none",borderBottom:"3px solid "+(on ? deck.color : "transparent"),padding:"0 18px",cursor:"pointer",fontFamily:"inherit",fontSize:15,fontWeight:on?700:500,color:on?TXT:TXT3,transition:"color .15s, border-color .15s",flexShrink:0,whiteSpace:"pre"}}>
                {lbl}
              </button>
            );
          })}
        </div>

        <div style={{width:1,height:26,background:LINE,flexShrink:0}}/>

        {viewMode === "list" ? (
          <input
            value={search}
            onChange={function(e){ setSearch(e.target.value); }}
            placeholder="Search card titles and scripts…"
            aria-label="Search cards"
            style={Object.assign({}, inputSt({height:36,fontSize:14,padding:"0 14px",borderRadius:10}), {flex:1,maxWidth:460,width:"auto"})}
          />
        ) : (
          <span style={{fontSize:14,color:TXT3,flex:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
            {readOnly ? "Click a card to read it" : "Click a card to edit"} · ctrl+scroll to zoom
          </span>
        )}

        <div style={{flex:1}}/>

        <span style={{fontSize:13,color:TXT3,flexShrink:0,whiteSpace:"nowrap"}}>
          {allCards.length} card{allCards.length!==1?"s":""} · <span style={{color:GREEN}}>★ {intendedTotal}</span>
        </span>

        {readOnly ? (
          <span style={{fontSize:13,color:TXT2,background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.12)",borderRadius:99,padding:"5px 12px",flexShrink:0}}>View only</span>
        ) : (
          <button onClick={startNew}
            style={Object.assign({},solidBtn(deck.color),{height:36,padding:"0 18px",fontSize:14,borderRadius:10,flexShrink:0})}>
            + New Card
          </button>
        )}
      </div>

      {/* ── Body ── */}
      <div style={{flex:1,display:"flex",overflow:"hidden",minHeight:0}}>

        {/* ── LIST MODE ── */}
        {viewMode === "list" && (
          <>
            {/* Collapsed list rail (desktop, card on stage) */}
            {editing && !isTablet && listRail && <PaneRail label="Cards" color={deck.color} onExpand={function(){ setListRail(false); }}/>}

            {/* Left pane: grouped card list */}
            {(!editing || (!isTablet && !listRail)) && <>
            <div style={{width:isTablet?Math.min(leftW,340):leftW,minWidth:isTablet?Math.min(leftW,340):leftW,display:"flex",flexDirection:"column",overflow:"hidden",flexShrink:0,background:"rgba(4,12,32,.35)"}}>
              {editing && (
                <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",borderBottom:"1px solid "+LINE,flexShrink:0}}>
                  <span style={{fontSize:13,fontWeight:700,color:TXT3,letterSpacing:1,textTransform:"uppercase",flex:1}}>Cards</span>
                  <button onClick={function(){ setListRail(true); }} title="Collapse the list to give the card stage more room"
                    style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.12)",borderRadius:8,color:TXT2,fontSize:13,padding:"4px 10px",cursor:"pointer",fontFamily:"inherit"}}>‹ Collapse</button>
                </div>
              )}
              <div style={{overflowY:"auto",flex:1,padding:"14px 14px 0"}}>
                {pitchTypes.map(function(t) {
                  var m = TM[t];
                  var group = allCards.filter(function(c){
                    return c.type === t && (!q || (c.title||"").toLowerCase().includes(q) || stripMarkup(c.prompt||"").toLowerCase().includes(q));
                  }).sort(function(a,b){ return (a.sortIndex||0)-(b.sortIndex||0); });
                  if (!group.length) return null;
                  var isColl = !!collapsed[t];
                  return (
                    <div key={t} style={{marginBottom:18}}>
                      {/* Group header */}
                      <button
                        onClick={function(){ setCollapsed(function(p){ return Object.assign({},p,{[t]:!isColl}); }); }}
                        aria-expanded={!isColl}
                        style={{display:"flex",alignItems:"center",gap:8,width:"100%",background:"none",border:"none",borderBottom:"1px solid "+LINE,padding:"4px 4px 8px",marginBottom:isColl?0:10,cursor:"pointer",fontFamily:"inherit"}}>
                        <span style={{fontSize:15}}>{m.icon}</span>
                        <span style={{fontSize:13,fontWeight:800,color:m.color,letterSpacing:1.2,textTransform:"uppercase"}}>{m.label}</span>
                        <span style={{fontSize:13,color:TXT3}}>{group.length}</span>
                        <span style={{fontSize:12,color:TXT3,marginLeft:"auto"}}>{isColl?"▶":"▼"}</span>
                      </button>
                      {!isColl && group.map(function(card) {
                        var sel = editing && editing.id === card.id;
                        var isRoot = card.id === deck.rootCard;
                        var b = validBullets(card);
                        var nAns = (card.answers || []).filter(function(a){ return a && a.label; }).length;
                        return (
                          <button key={card.id}
                            data-row="1"
                            onClick={function(){ openCard(card); }}
                            style={{
                              display:"flex", alignItems:"flex-start", gap:10,
                              width:"100%", textAlign:"left",
                              background:sel?m.color+"1a":"rgba(255,255,255,.035)",
                              borderTop:"1px solid "+(sel?m.color+"66":LINE),
                              borderRight:"1px solid "+(sel?m.color+"66":LINE),
                              borderBottom:"1px solid "+(sel?m.color+"66":LINE),
                              borderLeft:"4px solid "+m.color,
                              borderRadius:10, padding:"11px 12px", marginBottom:6,
                              cursor:"pointer", fontFamily:"inherit",
                              transition:"background .1s"
                            }}>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontSize:15,fontWeight:700,color:TXT,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                {card.title || <em style={{opacity:.45}}>Untitled</em>}
                              </div>
                              <div style={{fontSize:13,color:TXT3,marginTop:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                {b.length ? b[0] : (stripMarkup(card.prompt || "") || "No script yet")}
                              </div>
                              <div style={{fontSize:12,color:TXT3,marginTop:5}}>{nAns} response{nAns!==1?"s":""}</div>
                            </div>
                            <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:5,flexShrink:0}}>
                              {isRoot && <MiniBadge color={GREEN}>Entry</MiniBadge>}
                              {card.intendedPath && <MiniBadge color={GREEN}>★ Intended</MiniBadge>}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
                {allCards.length === 0 && (
                  <div style={{textAlign:"center",color:TXT3,padding:"48px 0",fontSize:15}}>
                    No cards yet.{!readOnly && " Use + New Card to start."}
                  </div>
                )}
                {allCards.length > 0 && q && !allCards.some(function(c){ return pitchTypes.indexOf(c.type) >= 0 && ((c.title||"").toLowerCase().includes(q) || stripMarkup(c.prompt||"").toLowerCase().includes(q)); }) && (
                  <div style={{textAlign:"center",color:TXT3,padding:"40px 0",fontSize:15}}>No cards match “{search}”</div>
                )}
                <div style={{height:16}}/>
              </div>
            </div>

            {/* Drag handle */}
            <div
              onMouseDown={startDrag}
              title="Drag to resize"
              style={Object.assign({},resizeHandle(),{background:isDragging?"rgba(255,255,255,.1)":"transparent"})}
            />
            </>}

            {/* Right pane: card stage (editor / read view) or overview */}
            <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0,background:"rgba(8,20,50,.2)"}}>
              {editing ? renderDetail(true) : renderOverview()}
            </div>
          </>
        )}

        {/* ── TREE MODE ── */}
        {viewMode === "tree" && (
          <>
            {/* Left: summary rail (hidden while the side panel is open so the tree keeps its width) */}
            {!editing && <div style={{width:260,minWidth:260,flexShrink:0,display:"flex",flexDirection:"column",borderRight:"1px solid "+LINE,background:"rgba(4,12,32,.4)",overflowY:"auto"}}>
              <div style={{padding:"16px 18px 12px",borderBottom:"1px solid "+LINE}}>
                <div style={{fontSize:13,fontWeight:700,color:TXT3,letterSpacing:1,textTransform:"uppercase",marginBottom:12}}>Card types</div>
                {typeStats.map(function(ts) {
                  return (
                    <div key={ts.type} style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
                      <div style={{width:4,height:36,borderRadius:99,background:ts.m.color,flexShrink:0}}/>
                      <div style={{flex:1}}>
                        <div style={{fontSize:20,fontWeight:800,color:ts.m.color,lineHeight:1.1}}>{ts.count}</div>
                        <div style={{fontSize:13,color:TXT2}}>{ts.m.label}</div>
                      </div>
                      {ts.intendedCount > 0 && <MiniBadge color={GREEN}>★ {ts.intendedCount}</MiniBadge>}
                    </div>
                  );
                })}
              </div>
              <div style={{padding:"14px 18px"}}>
                <div style={{fontSize:13,fontWeight:700,color:TXT3,letterSpacing:1,textTransform:"uppercase",marginBottom:10}}>Intended path</div>
                {intendedPath.length === 0 && <div style={{fontSize:14,color:TXT3}}>No entry card set</div>}
                {intendedPath.map(function(c, i) {
                  var m = TM[c.type] || TM.pitch;
                  var sel = editing && editing.id === c.id;
                  return (
                    <button key={c.id} onClick={function(){ openCard(c); }}
                      style={{display:"flex",alignItems:"center",gap:10,width:"100%",textAlign:"left",background:sel?m.color+"1a":"transparent",border:"none",borderRadius:8,padding:"7px 6px",cursor:"pointer",fontFamily:"inherit"}}>
                      <span style={{width:22,height:22,borderRadius:"50%",background:m.color+"22",border:"1.5px solid "+m.color+"88",color:m.color,fontSize:12,fontWeight:800,display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{i+1}</span>
                      <span style={{fontSize:14,color:i===0?GREEN:TXT2,fontWeight:i===0?700:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.title || "Untitled"}</span>
                    </button>
                  );
                })}
              </div>
            </div>}

            {/* Center: full tree view */}
            <div style={{flex:1,overflow:"hidden",position:"relative",minWidth:0}}>
              <TreeView
                cards={deck.cards}
                rootCard={deck.rootCard}
                onEdit={function(c){ openCard(c); }}
                onSetRoot={readOnly ? null : function(id){ onUpdateDeck(deck.id, function(d){ return Object.assign({},d,{rootCard:id}); }); }}
              />
            </div>

            {/* Right: card editor / read view panel */}
            {editing && (
              <div style={{width:"clamp(420px, 38%, 560px)",flexShrink:0,display:"flex",flexDirection:"column",overflow:"hidden",borderLeft:"1px solid rgba(255,255,255,.1)",background:"rgba(8,20,50,.85)"}}>
                {renderDetail(false)}
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
}
