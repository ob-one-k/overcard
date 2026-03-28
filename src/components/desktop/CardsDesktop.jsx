import { useState, useRef, useEffect } from "react";
import { TM, uid, aid } from "../../lib/constants";
import { solidBtn, ghostBtn, ghostSm, iconBtn, inputSt, cardBg, resizeHandle } from "../../lib/styles";
import { TypeBadge, SectionHdr, IntendedBadge } from "../ui";
import { CardEditorSheet } from "../Editor";
import { TreeView, SwimlaneView } from "../Viewer";
import { stripMarkup } from "../../lib/richtext";

// ─── CARDS DESKTOP ────────────────────────────────────────────────────────────
// Two-pane: card list/tree/flow (left, resizable) + inline editor (right flex:1)
// View mode tab bar replaces old segmented pills.
// Swimlane (Flow) no longer collapses the left pane — both coexist.
export function CardsDesktop({ deck, onUpsert, onDelete, onUpdateDeck, readOnly }) {
  var [viewMode,  setViewMode]  = useState("list");
  var [editing,   setEditing]   = useState(null);
  var [search,    setSearch]    = useState("");
  var [collapsed, setCollapsed] = useState({});

  // ── Resizable left pane ──────────────────────────────────────────────────────
  var [leftW, setLeftW] = useState(function() {
    var stored = parseInt(localStorage.getItem("overcard_cards_leftW"), 10);
    return (stored >= 200 && stored <= 580) ? stored : 340;
  });
  var dragging    = useRef(false);
  var dragStartX  = useRef(0);
  var dragStartW  = useRef(340);
  var leftWRef    = useRef(leftW);
  var [isDragging, setIsDragging] = useState(false);

  function updateLeftW(w) { leftWRef.current = w; setLeftW(w); }

  useEffect(function() {
    function onMove(e) {
      if (!dragging.current) return;
      var delta = e.clientX - dragStartX.current;
      var newW = Math.max(200, Math.min(580, dragStartW.current + delta));
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

  // ── Card operations ──────────────────────────────────────────────────────────
  var pitchTypes = ["pitch","discovery","close"];
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

  var showSwimlane = viewMode === "flow";

  return (
    <div style={{display:"flex",height:"100%",overflow:"hidden",userSelect:isDragging?"none":"auto"}}>

      {/* ── Left pane: list / tree ── */}
      <div style={{width:leftW,minWidth:leftW,display:"flex",flexDirection:"column",overflow:"hidden",flexShrink:0}}>

        {/* View mode tab bar */}
        <div style={{display:"flex",borderBottom:"1px solid rgba(255,255,255,.06)",flexShrink:0}}>
          {[["list","List"],["tree","Tree"],["flow","Flow"]].map(function(pair) {
            var v = pair[0]; var lbl = pair[1]; var on = viewMode === v;
            return (
              <button key={v} onClick={function(){ setViewMode(v); }}
                style={{background:"none",border:"none",
                  borderBottom:"2px solid "+(on?deck.color:"transparent"),
                  padding:"9px 14px",cursor:"pointer",fontFamily:"inherit",
                  fontSize:11,fontWeight:on?700:400,
                  color:on?"#fff":"rgba(255,255,255,.38)",
                  transition:"color .15s, border-color .15s"}}>
                {lbl}
              </button>
            );
          })}
          <div style={{flex:1}}/>
          {!readOnly && (
            <button onClick={startNew}
              style={Object.assign({},solidBtn(deck.color),{height:30,padding:"0 12px",fontSize:11,margin:"6px 10px 6px 0",flexShrink:0})}>
              + Card
            </button>
          )}
        </div>

        {/* Search bar (list mode only) */}
        {viewMode === "list" && (
          <div style={{padding:"8px 10px",flexShrink:0,borderBottom:"1px solid rgba(255,255,255,.04)"}}>
            <div style={{position:"relative"}}>
              <span style={{position:"absolute",left:9,top:"50%",transform:"translateY(-50%)",color:"rgba(255,255,255,.25)",fontSize:11,pointerEvents:"none"}}>🔎</span>
              <input value={search} onChange={function(e){ setSearch(e.target.value); }} placeholder="Search cards…" style={inputSt({paddingLeft:28,height:30,fontSize:12})}/>
            </div>
          </div>
        )}

        {/* List content */}
        {viewMode === "list" && (
          <div style={{overflowY:"auto",flex:1,padding:"8px 10px"}}>
            {pitchTypes.map(function(t) {
              var m = TM[t];
              var group = allCards.filter(function(c){
                return c.type === t && (!search || c.title.toLowerCase().includes(search.toLowerCase()) || stripMarkup(c.prompt||"").toLowerCase().includes(search.toLowerCase()));
              }).sort(function(a,b){ return (a.sortIndex||0)-(b.sortIndex||0); });
              if (!group.length) return null;
              var isCollapsed = !!collapsed[t];
              return (
                <div key={t} style={{marginBottom:12}}>
                  <div onClick={function(){ setCollapsed(function(p){ return Object.assign({},p,{[t]:!isCollapsed}); }); }}
                    style={{display:"flex",alignItems:"center",gap:5,padding:"5px 0 6px",borderBottom:"1px solid rgba(255,255,255,.05)",marginBottom:isCollapsed?0:6,cursor:"pointer",userSelect:"none"}}>
                    <span style={{fontSize:11}}>{m.icon}</span>
                    <span style={{fontSize:10,fontWeight:700,color:m.color,letterSpacing:1.2,textTransform:"uppercase"}}>{m.label}</span>
                    <span style={{fontSize:10,color:"rgba(255,255,255,.2)",marginLeft:2}}>{group.length}</span>
                    <span style={{fontSize:9,color:"rgba(255,255,255,.2)",marginLeft:"auto"}}>{isCollapsed?"▶":"▼"}</span>
                  </div>
                  {!isCollapsed && group.map(function(card) {
                    var sel = editing && editing.id === card.id;
                    var isRoot = card.id === deck.rootCard;
                    return (
                      <button key={card.id}
                        onClick={function(){ setEditing(card); }}
                        style={{display:"flex",alignItems:"center",gap:8,width:"100%",textAlign:"left",
                          background:sel?"rgba(0,180,255,.1)":"rgba(255,255,255,.04)",
                          border:"1.5px solid "+(sel?"rgba(0,180,255,.4)":"rgba(255,255,255,.06)"),
                          borderLeft:"3px solid "+(sel?"#00B4FF":m.color),
                          borderRadius:10,padding:"9px 10px",marginBottom:5,cursor:"pointer",fontFamily:"inherit"}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:12,fontWeight:700,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{card.title||<em style={{opacity:.4}}>Untitled</em>}</div>
                          {card.overview && card.overview.filter(function(b){return b&&b.trim();}).length > 0 && (
                            <div style={{fontSize:10,color:"rgba(255,255,255,.3)",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                              {card.overview.filter(function(b){return b&&b.trim();})[0]}
                            </div>
                          )}
                        </div>
                        <div style={{display:"flex",gap:4,flexShrink:0}}>
                          {isRoot && <span style={{fontSize:9,color:"#66BB6A",background:"rgba(102,187,106,.15)",border:"1px solid rgba(102,187,106,.25)",borderRadius:99,padding:"1px 5px"}}>root</span>}
                          {card.intendedPath && <IntendedBadge/>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })}
            {allCards.length === 0 && !search && (
              <div style={{textAlign:"center",color:"rgba(255,255,255,.25)",padding:"40px 0",fontSize:14}}>No cards yet. Add one →</div>
            )}
          </div>
        )}

        {/* Tree view */}
        {viewMode === "tree" && (
          <div style={{flex:1,overflow:"hidden"}}>
            <TreeView cards={deck.cards} rootCard={deck.rootCard}
              onEdit={function(c){ setEditing(c); }}
              onSetRoot={readOnly ? null : function(id){ onUpdateDeck(deck.id, function(d){ return Object.assign({},d,{rootCard:id}); }); }}/>
          </div>
        )}

        {/* Flow (swimlane) preview in left pane — shows mini label */}
        {viewMode === "flow" && (
          <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8,color:"rgba(255,255,255,.2)",padding:16}}>
            <span style={{fontSize:24}}>⟶</span>
            <span style={{fontSize:11,textAlign:"center",lineHeight:1.5}}>Flow view is shown on the right</span>
            {!readOnly && <button onClick={startNew} style={Object.assign({},ghostBtn(),{fontSize:11,padding:"7px 14px",marginTop:4})}>+ New Card</button>}
          </div>
        )}
      </div>

      {/* ── Drag handle ── */}
      <div
        onMouseDown={startDrag}
        style={Object.assign({},resizeHandle(),{
          background:isDragging?"rgba(255,255,255,.1)":"transparent"
        })}
      />

      {/* ── Right area: swimlane OR inline editor ── */}

      {/* Flow (swimlane) — full-width right area */}
      <div style={{flex:1,overflowX:"auto",display:showSwimlane?"flex":"none",minWidth:0}}>
        <SwimlaneView cards={deck.cards} rootCard={deck.rootCard}
          onEdit={function(c){ setEditing(c); setViewMode("list"); }}/>
      </div>

      {/* Inline editor */}
      <div style={{flex:1,display:!showSwimlane?"flex":"none",flexDirection:"column",overflow:"hidden",minWidth:0,background:"rgba(8,20,50,.2)"}}>
        {editing ? (
          <CardEditorSheet
            key={editing.id}
            card={editing}
            allCards={deck.cards}
            rootCard={deck.rootCard}
            accentColor={TM[editing.type]?TM[editing.type].color:"#00B4FF"}
            onSave={function(card){
              safeUpsert(deck.id, card);
              setEditing(null);
            }}
            onDelete={readOnly ? null : function(id){
              onDelete(deck.id, id);
              setEditing(null);
            }}
            onClose={function(){ setEditing(null); }}
            onNavigateTo={function(targetCard){ setEditing(targetCard); }}
            onSaveAndNavigateTo={function(form, targetCard){
              safeUpsert(deck.id, form);
              setEditing(targetCard);
            }}
            inline={true}
          />
        ) : (
          <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,color:"rgba(255,255,255,.18)"}}>
            <span style={{fontSize:36}}>🃏</span>
            <span style={{fontSize:13}}>Select a card to edit</span>
            {!readOnly && <button onClick={startNew} style={Object.assign({},ghostBtn(),{fontSize:12,padding:"8px 18px",marginTop:4})}>+ New Card</button>}
          </div>
        )}
      </div>
    </div>
  );
}
