import { useState, useContext, useRef } from "react";
import { TM, uid, aid } from "../../lib/constants";
import { solidBtn, ghostBtn, ghostSm, iconBtn, inputSt, cardBg } from "../../lib/styles";
import { TypeBadge, SectionHdr, IntendedBadge } from "../ui";
import { CardEditorSheet } from "../Editor";
import { TreeView, SwimlaneView } from "../Viewer";
import { stripMarkup } from "../../lib/richtext";

// ─── CARDS DESKTOP ────────────────────────────────────────────────────────────
// Two-pane: card list / tree (left ~340px) + inline editor (right flex:1)
export function CardsDesktop({ deck, onUpsert, onDelete, onUpdateDeck, readOnly }) {
  var [viewMode,  setViewMode]  = useState("list");
  var [editing,   setEditing]   = useState(null);
  var [search,    setSearch]    = useState("");
  var [collapsed, setCollapsed] = useState({});

  var pitchTypes = ["pitch","discovery","close"];
  var allCards   = Object.values(deck.cards);

  // safeUpsert: enforces sibling exclusivity for intendedPath
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

  var showSwimlane = viewMode === "swimlane";

  return (
    <div style={{display:"flex",height:"100%",overflow:"hidden"}}>

      {/* ── Left pane: list / tree ── */}
      <div style={{width:showSwimlane?0:340,minWidth:showSwimlane?0:340,display:"flex",flexDirection:"column",borderRight:showSwimlane?"none":"1px solid rgba(255,255,255,.06)",overflow:"hidden",transition:"width .2s"}}>
        {/* Toolbar */}
        <div style={{padding:"10px 12px 8px",flexShrink:0,borderBottom:"1px solid rgba(255,255,255,.05)"}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
            <div style={{display:"flex",background:"rgba(255,255,255,.05)",borderRadius:10,padding:2,gap:1}}>
              {["list","tree","swimlane"].map(function(v) {
                var on = viewMode === v;
                var lbl2 = v==="list"?"List":v==="tree"?"Tree":"Lanes";
                return (
                  <button key={v} onClick={function(){ setViewMode(v); }}
                    style={{background:on?"rgba(255,255,255,.14)":"transparent",border:"none",borderRadius:8,padding:"4px 9px",cursor:"pointer",color:on?"#fff":"rgba(255,255,255,.35)",fontSize:11,fontFamily:"inherit",fontWeight:on?700:400}}>
                    {lbl2}
                  </button>
                );
              })}
            </div>
            <div style={{flex:1}}/>
            {!readOnly && <button onClick={startNew} style={Object.assign({},solidBtn(deck.color),{height:30,padding:"0 12px",fontSize:12,flexShrink:0})}>+ Card</button>}
          </div>
          {viewMode === "list" && (
            <div style={{position:"relative"}}>
              <span style={{position:"absolute",left:9,top:"50%",transform:"translateY(-50%)",color:"rgba(255,255,255,.3)",fontSize:12}}>🔎</span>
              <input value={search} onChange={function(e){ setSearch(e.target.value); }} placeholder="Search cards…" style={inputSt({paddingLeft:28,height:32,fontSize:12})}/>
            </div>
          )}
        </div>

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
                <div key={t} style={{marginBottom:14}}>
                  <div onClick={function(){ setCollapsed(function(p){ return Object.assign({},p,{[t]:!isCollapsed}); }); }}
                    style={{display:"flex",alignItems:"center",gap:5,padding:"5px 0 7px",borderBottom:"1px solid rgba(255,255,255,.05)",marginBottom:isCollapsed?0:6,cursor:"pointer",userSelect:"none"}}>
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
      </div>

      {/* ── Full-width swimlane ── */}
      {showSwimlane && (
        <div style={{flex:1,overflow:"hidden"}}>
          <SwimlaneView cards={deck.cards} rootCard={deck.rootCard}
            onEdit={function(c){ setEditing(c); setViewMode("list"); }}/>
        </div>
      )}

      {/* ── Right pane: inline editor ── */}
      {!showSwimlane && (
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0,background:"rgba(8,20,50,.2)"}}>
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
      )}
    </div>
  );
}
