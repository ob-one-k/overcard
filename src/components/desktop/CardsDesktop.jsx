import { useState, useRef, useEffect } from "react";
import { TM, uid, aid } from "../../lib/constants";
import { solidBtn, ghostBtn, inputSt, resizeHandle } from "../../lib/styles";
import { IntendedBadge } from "../ui";
import { CardEditorSheet } from "../Editor";
import { TreeView } from "../Viewer";
import { stripMarkup } from "../../lib/richtext";

// ─── CARDS DESKTOP ────────────────────────────────────────────────────────────
// Salesforce-style record management layout.
//
// LIST mode  — resizable left pane (card groups) + right pane (inline editor)
// TREE mode  — left pane stays as a thin summary panel (180px) + right pane
//              shows TreeView full-width; clicking a node opens the editor
//              as a right-side panel that overlays the tree.
//
// Tab bar and + New Card button live in a top action bar that spans full width.
export function CardsDesktop({ deck, onUpsert, onDelete, onUpdateDeck, readOnly }) {
  var [viewMode,  setViewMode]  = useState("list");
  var [editing,   setEditing]   = useState(null);
  var [search,    setSearch]    = useState("");
  var [collapsed, setCollapsed] = useState({});

  // ── Resizable left pane (list mode only) ─────────────────────────────────────
  var [leftW, setLeftW] = useState(function() {
    var stored = parseInt(localStorage.getItem("overcard_cards_leftW"), 10);
    return (stored >= 200 && stored <= 560) ? stored : 320;
  });
  var dragging   = useRef(false);
  var dragStartX = useRef(0);
  var dragStartW = useRef(320);
  var leftWRef   = useRef(leftW);
  var [isDragging, setIsDragging] = useState(false);

  function updateLeftW(w) { leftWRef.current = w; setLeftW(w); }

  useEffect(function() {
    function onMove(e) {
      if (!dragging.current) return;
      var delta = e.clientX - dragStartX.current;
      var newW = Math.max(200, Math.min(560, dragStartW.current + delta));
      updateLeftW(newW);
    }
    function onUp() {
      if (!dragging.current) return;
      dragging.current = false;
      setIsDragging(false);
      localStorage.setItem("overcard_cards_leftW", String(leftWRef.current));
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

  // ── Stats for tree mode summary sidebar ──────────────────────────────────────
  var typeStats = pitchTypes.map(function(t) {
    var m = TM[t];
    var count = allCards.filter(function(c){ return c.type === t; }).length;
    var intendedCount = allCards.filter(function(c){ return c.type === t && c.intendedPath; }).length;
    return { type:t, m:m, count:count, intendedCount:intendedCount };
  });

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",overflow:"hidden",userSelect:isDragging?"none":"auto"}}>

      {/* ── Top action bar ── */}
      <div style={{
        height:46, flexShrink:0,
        display:"flex", alignItems:"center",
        borderBottom:"1px solid rgba(255,255,255,.07)",
        background:"rgba(6,16,42,.6)",
        padding:"0 0 0 4px",
        gap:0
      }}>
        {/* View mode tabs */}
        {[["list","≡ List"],["tree","◈ Tree"]].map(function(pair) {
          var v = pair[0]; var lbl = pair[1]; var on = viewMode === v;
          return (
            <button key={v} onClick={function(){ setViewMode(v); }}
              style={{
                background:"none", border:"none",
                borderBottom:"2px solid "+(on ? deck.color : "transparent"),
                height:46, padding:"0 16px",
                cursor:"pointer", fontFamily:"inherit",
                fontSize:12, fontWeight:on?700:400,
                color:on?"#fff":"rgba(255,255,255,.4)",
                transition:"color .15s, border-color .15s",
                flexShrink:0
              }}>
              {lbl}
            </button>
          );
        })}

        {/* Separator */}
        <div style={{width:1,height:22,background:"rgba(255,255,255,.08)",margin:"0 10px",flexShrink:0}}/>

        {/* Search (list mode) */}
        {viewMode === "list" && (
          <div style={{position:"relative",flex:1,minWidth:0,maxWidth:280}}>
            <span style={{position:"absolute",left:9,top:"50%",transform:"translateY(-50%)",color:"rgba(255,255,255,.22)",fontSize:12,pointerEvents:"none"}}>⌕</span>
            <input
              value={search}
              onChange={function(e){ setSearch(e.target.value); }}
              placeholder="Search cards…"
              style={inputSt({paddingLeft:28,height:30,fontSize:12})}
            />
          </div>
        )}

        {/* Tree mode context label */}
        {viewMode === "tree" && (
          <span style={{fontSize:11,color:"rgba(255,255,255,.3)",flex:1}}>
            {allCards.length} card{allCards.length!==1?"s":" "} · {allCards.filter(function(c){return c.intendedPath;}).length} on intended path
          </span>
        )}

        <div style={{flex:1}}/>

        {/* Card count badge */}
        <span style={{fontSize:10,color:"rgba(255,255,255,.25)",marginRight:10,flexShrink:0}}>
          {allCards.length} card{allCards.length!==1?"s":""}
        </span>

        {!readOnly && (
          <button
            onClick={startNew}
            style={Object.assign({},solidBtn(deck.color),{height:30,padding:"0 14px",fontSize:11,margin:"0 12px 0 0",flexShrink:0})}>
            + New Card
          </button>
        )}
      </div>

      {/* ── Body ── */}
      <div style={{flex:1,display:"flex",overflow:"hidden",minHeight:0}}>

        {/* ── LIST MODE ── */}
        {viewMode === "list" && (
          <>
            {/* Left pane: grouped card list */}
            <div style={{width:leftW,minWidth:leftW,display:"flex",flexDirection:"column",overflow:"hidden",flexShrink:0,borderRight:"1px solid rgba(255,255,255,.06)"}}>
              <div style={{overflowY:"auto",flex:1,padding:"10px 10px 0"}}>
                {pitchTypes.map(function(t) {
                  var m = TM[t];
                  var group = allCards.filter(function(c){
                    return c.type === t && (!search || c.title.toLowerCase().includes(search.toLowerCase()) || stripMarkup(c.prompt||"").toLowerCase().includes(search.toLowerCase()));
                  }).sort(function(a,b){ return (a.sortIndex||0)-(b.sortIndex||0); });
                  if (!group.length) return null;
                  var isColl = !!collapsed[t];
                  return (
                    <div key={t} style={{marginBottom:14}}>
                      {/* Group header */}
                      <div
                        onClick={function(){ setCollapsed(function(p){ return Object.assign({},p,{[t]:!isColl}); }); }}
                        style={{display:"flex",alignItems:"center",gap:6,padding:"4px 4px 6px",borderBottom:"1px solid rgba(255,255,255,.06)",marginBottom:isColl?0:7,cursor:"pointer",userSelect:"none"}}>
                        <span style={{fontSize:12}}>{m.icon}</span>
                        <span style={{fontSize:10,fontWeight:700,color:m.color,letterSpacing:1,textTransform:"uppercase"}}>{m.label}</span>
                        <span style={{fontSize:10,color:"rgba(255,255,255,.2)"}}>{group.length}</span>
                        <span style={{fontSize:9,color:"rgba(255,255,255,.2)",marginLeft:"auto"}}>{isColl?"▶":"▼"}</span>
                      </div>
                      {!isColl && group.map(function(card) {
                        var sel = editing && editing.id === card.id;
                        var isRoot = card.id === deck.rootCard;
                        return (
                          <button key={card.id}
                            onClick={function(){ setEditing(card); }}
                            style={{
                              display:"flex", alignItems:"center", gap:8,
                              width:"100%", textAlign:"left",
                              background:sel?"rgba(0,180,255,.1)":"rgba(255,255,255,.035)",
                              border:"1px solid "+(sel?"rgba(0,180,255,.35)":"rgba(255,255,255,.06)"),
                              borderLeft:"3px solid "+(sel?"#00B4FF":m.color),
                              borderRadius:9, padding:"8px 10px", marginBottom:4,
                              cursor:"pointer", fontFamily:"inherit",
                              transition:"background .1s"
                            }}>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontSize:12,fontWeight:600,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                {card.title || <em style={{opacity:.35}}>Untitled</em>}
                              </div>
                              {card.overview && card.overview.filter(function(b){return b&&b.trim();}).length > 0 && (
                                <div style={{fontSize:10,color:"rgba(255,255,255,.28)",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                  {card.overview.filter(function(b){return b&&b.trim();})[0]}
                                </div>
                              )}
                            </div>
                            <div style={{display:"flex",gap:4,flexShrink:0}}>
                              {isRoot && <span style={{fontSize:9,color:"#66BB6A",background:"rgba(102,187,106,.12)",border:"1px solid rgba(102,187,106,.22)",borderRadius:99,padding:"1px 5px"}}>root</span>}
                              {card.intendedPath && <IntendedBadge/>}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
                {allCards.length === 0 && !search && (
                  <div style={{textAlign:"center",color:"rgba(255,255,255,.2)",padding:"48px 0",fontSize:13}}>
                    No cards yet.{!readOnly && " Use + New Card to start."}
                  </div>
                )}
                <div style={{height:16}}/>
              </div>
            </div>

            {/* Drag handle */}
            <div
              onMouseDown={startDrag}
              style={Object.assign({},resizeHandle(),{background:isDragging?"rgba(255,255,255,.1)":"transparent"})}
            />

            {/* Right pane: card editor */}
            <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0,background:"rgba(8,20,50,.2)"}}>
              {editing ? (
                <CardEditorSheet
                  key={editing.id}
                  card={editing}
                  allCards={deck.cards}
                  rootCard={deck.rootCard}
                  accentColor={TM[editing.type] ? TM[editing.type].color : "#00B4FF"}
                  onSave={function(card){ safeUpsert(deck.id, card); setEditing(null); }}
                  onDelete={readOnly ? null : function(id){ onDelete(deck.id, id); setEditing(null); }}
                  onClose={function(){ setEditing(null); }}
                  onNavigateTo={function(targetCard){ setEditing(targetCard); }}
                  onSaveAndNavigateTo={function(form, targetCard){ safeUpsert(deck.id, form); setEditing(targetCard); }}
                  inline={true}
                />
              ) : (
                <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:14,color:"rgba(255,255,255,.15)"}}>
                  <span style={{fontSize:40}}>🃏</span>
                  <span style={{fontSize:13}}>Select a card to edit</span>
                  {!readOnly && (
                    <button onClick={startNew} style={Object.assign({},ghostBtn(),{fontSize:12,padding:"8px 20px",marginTop:2})}>
                      + New Card
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── TREE MODE ── */}
        {viewMode === "tree" && (
          <>
            {/* Left: type summary sidebar */}
            <div style={{width:180,minWidth:180,flexShrink:0,display:"flex",flexDirection:"column",borderRight:"1px solid rgba(255,255,255,.06)",background:"rgba(4,12,32,.4)"}}>
              <div style={{padding:"12px 14px 8px",flexShrink:0,borderBottom:"1px solid rgba(255,255,255,.05)"}}>
                <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,.3)",letterSpacing:1,textTransform:"uppercase",marginBottom:10}}>Card Types</div>
                {typeStats.map(function(ts) {
                  return (
                    <div key={ts.type} style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                      <div style={{width:3,height:32,borderRadius:99,background:ts.m.color,flexShrink:0}}/>
                      <div>
                        <div style={{fontSize:11,fontWeight:700,color:ts.m.color}}>{ts.count}</div>
                        <div style={{fontSize:9,color:"rgba(255,255,255,.3)",textTransform:"uppercase",letterSpacing:.7}}>{ts.m.label}</div>
                      </div>
                      {ts.intendedCount > 0 && (
                        <span style={{marginLeft:"auto",fontSize:9,color:"rgba(102,187,106,.7)",background:"rgba(102,187,106,.08)",borderRadius:99,padding:"2px 6px"}}>★{ts.intendedCount}</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div style={{padding:"10px 14px",flex:1}}>
                <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,.3)",letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>Root Card</div>
                {deck.rootCard && deck.cards[deck.rootCard] ? (
                  <button onClick={function(){ setEditing(deck.cards[deck.rootCard]); }}
                    style={{width:"100%",textAlign:"left",background:"rgba(102,187,106,.08)",border:"1px solid rgba(102,187,106,.2)",borderRadius:8,padding:"7px 10px",cursor:"pointer",fontFamily:"inherit"}}>
                    <div style={{fontSize:11,fontWeight:700,color:"#66BB6A",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{deck.cards[deck.rootCard].title || "Untitled"}</div>
                    <div style={{fontSize:9,color:"rgba(255,255,255,.3)",marginTop:2}}>entry point</div>
                  </button>
                ) : (
                  <div style={{fontSize:11,color:"rgba(255,255,255,.2)"}}>No root set</div>
                )}
              </div>
            </div>

            {/* Center: full tree view */}
            <div style={{flex:1,overflow:"hidden",position:"relative"}}>
              <TreeView
                cards={deck.cards}
                rootCard={deck.rootCard}
                onEdit={function(c){ setEditing(c); }}
                onSetRoot={readOnly ? null : function(id){ onUpdateDeck(deck.id, function(d){ return Object.assign({},d,{rootCard:id}); }); }}
              />
            </div>

            {/* Right: card editor panel (slides in when card selected) */}
            {editing && (
              <div style={{width:400,minWidth:400,flexShrink:0,display:"flex",flexDirection:"column",overflow:"hidden",borderLeft:"1px solid rgba(255,255,255,.08)",background:"rgba(8,20,50,.85)"}}>
                <CardEditorSheet
                  key={editing.id}
                  card={editing}
                  allCards={deck.cards}
                  rootCard={deck.rootCard}
                  accentColor={TM[editing.type] ? TM[editing.type].color : "#00B4FF"}
                  onSave={function(card){ safeUpsert(deck.id, card); setEditing(null); }}
                  onDelete={readOnly ? null : function(id){ onDelete(deck.id, id); setEditing(null); }}
                  onClose={function(){ setEditing(null); }}
                  onNavigateTo={function(targetCard){ setEditing(targetCard); }}
                  onSaveAndNavigateTo={function(form, targetCard){ safeUpsert(deck.id, form); setEditing(targetCard); }}
                  inline={true}
                />
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
}
