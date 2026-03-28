import { useState, useEffect, useRef, useContext } from "react";
import { TM, uid, aid, osid, OBJ_COLOR, OBJ_ICONS } from "../lib/constants";
import { solidBtn, ghostBtn, ghostSm, iconBtn, inputSt, cardBg, badgeSt, labelSt, SHEET_MAX_H } from "../lib/styles";
import { TypeBadge, Handle, SectionHdr, IntendedBadge } from "./ui";
import { TipCtx } from "./Tooltip";
import { OverviewDisplay, RichPromptDisplay } from "./Tooltip";
import { CardEditorSheet } from "./Editor";
import { TreeView, SwimlaneView } from "./Viewer";
import { stripMarkup } from "../lib/richtext";
import DesktopCtx from "../lib/DesktopCtx";
import { CardsDesktop } from "./desktop/CardsDesktop";
import { ObjectionsDesktop } from "./desktop/ObjectionsDesktop";

// ─── CARDS TAB ────────────────────────────────────────────────────────────────
export function CardsTab({ deck, onUpsert, onDelete, onUpdateDeck, readOnly }) {
  var desktop = useContext(DesktopCtx);
  if (desktop.isDesktop) return <CardsDesktop deck={deck} onUpsert={onUpsert} onDelete={onDelete} onUpdateDeck={onUpdateDeck} readOnly={readOnly}/>;

  var [viewMode,        setViewMode]        = useState("list");
  var [editing,         setEditing]         = useState(null);
  var [search,          setSearch]          = useState("");
  var [collapsedGroups, setCollapsedGroups] = useState({});
  var [dragViz,         setDragViz]         = useState(null);
  var dragRef          = useRef({ active:false, groupType:null, draggedId:null, currentInsert:null });
  var rowRefs          = useRef({});
  var listRef          = useRef(null);
  var dragOccurredRef  = useRef(false);

  function switchViewMode(v) {
    setViewMode(v);
  }

  function startNew() {
    setEditing({ id:uid(), title:"", type:"pitch", overview:[], intendedPath:false, prompt:"", answers:[{id:aid(),label:"",next:null}] });
  }

  var pitchTypes = ["pitch","discovery","close"];
  var allCards = Object.values(deck.cards);

  function hasIntendedParentFn(cardId) {
    return Object.values(deck.cards).some(function(c) {
      return c.intendedPath && (c.answers || []).some(function(a){ return a.next === cardId; });
    });
  }

  // Enforces sibling exclusivity: when enabling intendedPath on a card, any sibling
  // (another card reachable from the same intended-path parent via a different answer)
  // is automatically cleared first.
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
              onUpsert(deckId, Object.assign({}, sibling, {intendedPath: false}));
            }
          }
        });
      });
    }
    onUpsert(deckId, card);
  }

  function handleDragStart(e, card, groupType, sortedGroup) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    var startIndex = sortedGroup.findIndex(function(c){ return c.id === card.id; });
    dragRef.current = { active:true, groupType:groupType, draggedId:card.id, currentInsert:startIndex };
    dragOccurredRef.current = true;
    setDragViz({ draggedId:card.id, groupType:groupType, insertIndex:startIndex });
  }

  function handleDragMove(e) {
    if (!dragRef.current.active) return;
    var groupType = dragRef.current.groupType;
    var sorted = Object.values(deck.cards)
      .filter(function(c){ return c.type === groupType; })
      .sort(function(a,b){ return (a.sortIndex||0)-(b.sortIndex||0); });
    var insertIndex = sorted.length;
    for (var i = 0; i < sorted.length; i++) {
      var el = rowRefs.current[sorted[i].id];
      if (!el) continue;
      var rect = el.getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) { insertIndex = i; break; }
    }
    dragRef.current.currentInsert = insertIndex;
    setDragViz(function(prev){ return prev ? Object.assign({}, prev, { insertIndex:insertIndex }) : null; });
  }

  function handleDragEnd(e) {
    if (!dragRef.current.active) return;
    var groupType = dragRef.current.groupType;
    var draggedId = dragRef.current.draggedId;
    var insertIndex = dragRef.current.currentInsert;
    dragRef.current.active = false;
    setDragViz(null);
    if (insertIndex === null || insertIndex === undefined) return;
    var sorted = Object.values(deck.cards)
      .filter(function(c){ return c.type === groupType; })
      .sort(function(a,b){ return (a.sortIndex||0)-(b.sortIndex||0); });
    var without = sorted.filter(function(c){ return c.id !== draggedId; });
    var dragged = sorted.find(function(c){ return c.id === draggedId; });
    if (!dragged) return;
    var clamped = Math.max(0, Math.min(insertIndex, without.length));
    without.splice(clamped, 0, dragged);
    without.forEach(function(c, i) {
      if ((c.sortIndex === undefined ? 0 : c.sortIndex) !== i) {
        safeUpsert(deck.id, Object.assign({}, c, { sortIndex:i }));
      }
    });
  }

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"10px 14px 8px",flexShrink:0,borderBottom:"1px solid rgba(255,255,255,.05)"}}>
        <div style={{display:"flex",alignItems:"center",gap:7}}>
          <div style={{display:"flex",background:"rgba(255,255,255,.05)",borderRadius:10,padding:2,gap:1,flexShrink:0}}>
            {["list","tree"].map(function(v) {
              var on=viewMode===v;
              return <button key={v} onClick={function(){switchViewMode(v);}}
                style={{background:on?"rgba(255,255,255,.14)":"transparent",border:"none",borderRadius:8,padding:"5px 11px",cursor:"pointer",color:on?"#fff":"rgba(255,255,255,.35)",fontSize:11,fontFamily:"inherit",fontWeight:on?700:400}}>
                {v==="list"?"≡ List":"⊞ Viewer"}
              </button>;
            })}
          </div>
          <div style={{flex:1,minWidth:0}}/>
          {readOnly && <span style={{fontSize:9,color:"rgba(255,255,255,.3)",background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",borderRadius:99,padding:"3px 9px",flexShrink:0}}>📖 View only</span>}
          {!readOnly && <button onClick={startNew} style={Object.assign({},solidBtn(deck.color),{height:32,padding:"0 14px",fontSize:13,flexShrink:0})}>+ Card</button>}
        </div>
        {viewMode==="list" && (
          <div style={{position:"relative",marginTop:8}}>
            <span style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",color:"rgba(255,255,255,.3)",fontSize:13}}>🔎</span>
            <input value={search} onChange={function(e){setSearch(e.target.value);}} placeholder="Search cards…" style={inputSt({paddingLeft:32,height:36})}/>
          </div>
        )}
        {viewMode==="tree" && !readOnly && <div style={{marginTop:6,fontSize:10,color:"rgba(255,255,255,.25)",lineHeight:1.5}}>▶/▼ to expand · click card to edit · ★ = intended path · Pinch or ctrl+scroll to zoom</div>}
        {viewMode==="tree" && readOnly && <div style={{marginTop:6,fontSize:10,color:"rgba(255,255,255,.25)",lineHeight:1.5}}>▶/▼ to expand · click card to view · ★ = intended path · Pinch or ctrl+scroll to zoom</div>}
      </div>
      {viewMode === "tree" ? (
        <TreeView cards={deck.cards} rootCard={deck.rootCard}
          onEdit={function(c){setEditing(c);}}
          onSetRoot={readOnly ? null : (onUpdateDeck ? function(id){onUpdateDeck(deck.id, function(d){return Object.assign({},d,{rootCard:id});});} : null)}/>
      ) : (
        <div ref={listRef} style={{overflowY:"auto",flex:1,padding:"0 14px"}}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}>
          <div style={{display:"flex",flexDirection:"column",paddingTop:8}}>
            {(function(){
              var groups = pitchTypes.map(function(t) {
                var m = TM[t];
                var group = allCards.filter(function(c) {
                  return c.type === t && (!search || c.title.toLowerCase().includes(search.toLowerCase()) || stripMarkup(c.prompt).toLowerCase().includes(search.toLowerCase()));
                }).sort(function(a,b){ return (a.sortIndex||0)-(b.sortIndex||0); });
                return { t:t, m:m, group:group };
              }).filter(function(g){ return g.group.length > 0; });
              if (groups.length === 0) {
                return <div style={{textAlign:"center",color:"rgba(255,255,255,.25)",padding:"40px 0",fontSize:14}}>{search?"No matches.":"No cards yet."}</div>;
              }
              return groups.map(function(g) {
                var collapsed = !!collapsedGroups[g.t];
                return (
                  <div key={g.t} style={{marginBottom:18}}>
                    <div onClick={function(){setCollapsedGroups(function(p){return Object.assign({},p,{[g.t]:!collapsed});});}}
                      style={{display:"flex",alignItems:"center",gap:5,padding:"6px 0 8px",borderBottom:"1px solid rgba(255,255,255,.05)",marginBottom:collapsed?0:8,cursor:"pointer",userSelect:"none"}}>
                      <span style={{fontSize:12}}>{g.m.icon}</span>
                      <span style={{fontSize:10,fontWeight:700,color:g.m.color,letterSpacing:1.2,textTransform:"uppercase"}}>{g.m.label}</span>
                      <span style={{fontSize:10,color:"rgba(255,255,255,.2)",marginLeft:2}}>{g.group.length}</span>
                      <span style={{fontSize:9,color:"rgba(255,255,255,.2)",marginLeft:"auto"}}>{collapsed?"▶":"▼"}</span>
                    </div>
                    {!collapsed && (
                      <div style={{display:"flex",flexDirection:"column",gap:7}}>
                        {(function(){
                          var items = [];
                          g.group.forEach(function(card, cardIdx) {
                            var m=TM[card.type]||TM.pitch; var isRoot=card.id===deck.rootCard;
                            var hasParent = hasIntendedParentFn(card.id);
                            var showStar = !readOnly && (isRoot || hasParent || card.intendedPath);
                            var starCanToggle = !isRoot && (hasParent || card.intendedPath);
                            var starOn = isRoot || card.intendedPath;
                            var isDragging = dragViz && dragViz.draggedId === card.id;
                            var isDropHere = dragViz && dragViz.groupType === g.t && dragViz.insertIndex === cardIdx;
                            if (isDropHere) {
                              items.push(<div key={"drop-"+cardIdx} style={{height:2,background:deck.color,borderRadius:1}}/>);
                            }
                            items.push(
                              <div key={card.id}
                                ref={function(el){ if(el) rowRefs.current[card.id]=el; else delete rowRefs.current[card.id]; }}
                                style={{display:"flex",alignItems:"stretch",opacity:isDragging?0.3:1,transition:"opacity .1s"}}>
                                {!readOnly && (
                                  <div onPointerDown={function(e){handleDragStart(e,card,g.t,g.group);}}
                                    style={{display:"flex",alignItems:"center",padding:"0 7px",cursor:"grab",color:"rgba(255,255,255,.28)",fontSize:14,touchAction:"none",userSelect:"none",flexShrink:0,background:isDragging?"rgba(255,255,255,.03)":"rgba(255,255,255,.05)",borderTop:"1px solid rgba(255,255,255,.08)",borderBottom:"1px solid rgba(255,255,255,.08)",borderLeft:"3px solid "+m.color,borderRadius:"0 0 0 14px"}}>
                                    ⠿
                                  </div>
                                )}
                                <div onClick={function(){if(dragOccurredRef.current){dragOccurredRef.current=false;return;}setEditing(card);}}
                                  style={{flex:1,background:isDragging?"rgba(255,255,255,.03)":"rgba(255,255,255,.07)",border:isDragging?"1px dashed rgba(255,255,255,.15)":"1px solid rgba(255,255,255,.08)",borderLeft:readOnly?"3px solid "+m.color:"1px solid rgba(255,255,255,.08)",borderRadius:"0 14px 14px 0",padding:"12px 14px",cursor:"pointer",textAlign:"left",fontFamily:"inherit"}}>
                                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                                    <div style={{flex:1,minWidth:0}}>
                                      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4,flexWrap:"wrap"}}>
                                        <span style={{fontSize:14,fontWeight:700,color:"#fff"}}>{card.title}</span>
                                        {isRoot && <span style={{fontSize:9,background:"rgba(255,255,255,.1)",color:"rgba(255,255,255,.45)",padding:"1px 7px",borderRadius:99,letterSpacing:.5,textTransform:"uppercase"}}>root</span>}
                                        {readOnly && card.intendedPath && <IntendedBadge/>}
                                      </div>
                                      {card.overview && card.overview.filter(function(b){return b&&b.trim();}).length > 0 && (
                                        <div style={{fontSize:10,color:"rgba(255,255,255,.38)",marginBottom:4}}>◆ {card.overview.filter(function(b){return b&&b.trim();})[0]}</div>
                                      )}
                                      <div style={{fontSize:12,color:"rgba(255,255,255,.32)",lineHeight:1.4,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{stripMarkup(card.prompt)}</div>
                                    </div>
                                    <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:5,flexShrink:0}}>
                                      {showStar && (
                                        <button onClick={function(e){
                                          e.stopPropagation(); e.preventDefault();
                                          if (starCanToggle) safeUpsert(deck.id, Object.assign({}, card, {intendedPath: !card.intendedPath}));
                                        }}
                                        title={isRoot ? "Root — always on intended path" : card.intendedPath ? "Remove from intended path" : "Add to intended path"}
                                        style={{background:"none",border:"none",padding:"1px 2px",fontSize:15,color:starOn?"#66BB6A":"rgba(255,255,255,.3)",cursor:starCanToggle?"pointer":"default",fontFamily:"inherit",flexShrink:0,lineHeight:1,transition:"color .15s"}}>★</button>
                                      )}
                                      <TypeBadge type={card.type} small={true}/>
                                      <span style={{fontSize:10,color:"rgba(255,255,255,.22)"}}>{card.answers.length} ans</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          });
                          if (dragViz && dragViz.groupType === g.t && dragViz.insertIndex >= g.group.length) {
                            items.push(<div key="drop-end" style={{height:2,background:deck.color,borderRadius:1}}/>);
                          }
                          return items;
                        })()}
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </div>
          <div style={{height:16}}/>
        </div>
      )}
      {editing && readOnly && (
        <div style={{position:"fixed",inset:0,zIndex:250,display:"flex",flexDirection:"column"}} onClick={function(e){if(e.target===e.currentTarget)setEditing(null);}}>
          <div onClick={function(){setEditing(null);}} style={{flex:1,background:"rgba(0,0,0,.5)",backdropFilter:"blur(8px)"}}/>
          <div style={{background:"#081428",borderRadius:"24px 24px 0 0",border:"1px solid rgba(255,255,255,.1)",borderBottom:"none",maxHeight:"75vh",overflow:"auto",padding:"0 0 32px",animation:"sheetUp .3s cubic-bezier(.22,1,.36,1) both"}}>
            <Handle/>
            <div style={{padding:"4px 16px 14px",borderBottom:"1px solid rgba(255,255,255,.07)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <TypeBadge type={editing.type}/>
                {editing.intendedPath && <IntendedBadge/>}
              </div>
              <button onClick={function(){setEditing(null);}} style={iconBtn()}>✕</button>
            </div>
            <div style={{padding:"14px 16px"}}>
              <div style={{fontSize:18,fontWeight:700,color:"#fff",fontFamily:"'Lora',serif",marginBottom:10}}>{editing.title}</div>
              {editing.overview && editing.overview.filter(function(b){return b&&b.trim();}).length > 0 && (
                <OverviewDisplay bullets={editing.overview} color={(TM[editing.type]||TM.pitch).color}/>
              )}
              {editing.prompt && (
                <div style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.07)",borderRadius:12,padding:"14px 16px",marginBottom:12,fontSize:15,lineHeight:1.7}}>
                  <RichPromptDisplay text={editing.prompt} accentColor={(TM[editing.type]||TM.pitch).color}/>
                </div>
              )}
              {(editing.answers||[]).filter(function(a){return a&&a.label;}).length > 0 && (
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,.3)",letterSpacing:1.2,textTransform:"uppercase",marginBottom:8}}>Prospect responds:</div>
                  {(editing.answers||[]).filter(function(a){return a&&a.label;}).map(function(ans,i){
                    var linkedCard = ans.next ? (deck.cards[ans.next] || null) : null;
                    var lm = linkedCard ? (TM[linkedCard.type]||TM.pitch) : null;
                    return (
                      <div key={ans.id||i} style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)",borderRadius:12,padding:"10px 13px",marginBottom:6}}>
                        <div style={{fontSize:13,color:"rgba(255,255,255,.8)"}}>{ans.label}</div>
                        {linkedCard && (
                          <div style={{display:"flex",alignItems:"center",gap:5,marginTop:6,paddingTop:6,borderTop:"1px solid rgba(255,255,255,.05)"}}>
                            <span style={{fontSize:9,color:"rgba(255,255,255,.28)"}}>→</span>
                            <span style={{fontSize:11,color:lm.color,fontWeight:600,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{linkedCard.title}</span>
                            <span style={{fontSize:8,color:lm.color,background:lm.color+"1a",padding:"1px 5px",borderRadius:99,flexShrink:0,textTransform:"uppercase",letterSpacing:.5}}>{lm.label}</span>
                          </div>
                        )}
                        {!linkedCard && ans.next && <div style={{fontSize:9,color:"rgba(255,255,255,.2)",marginTop:4}}>→ (no destination linked)</div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {editing && !readOnly && (
        <CardEditorSheet key={editing.id} card={editing} allCards={deck.cards} rootCard={deck.rootCard} accentColor={deck.color} lockedType={null}
          onSave={function(c){safeUpsert(deck.id,c);setEditing(null);}}
          onDelete={function(id){onDelete(deck.id,id);setEditing(null);}}
          onClose={function(){setEditing(null);}}
          onNavigateTo={function(c){setEditing(c);}}
          onSaveAndNavigateTo={function(saved,next){safeUpsert(deck.id,saved);setEditing(next);}}/>
      )}
    </div>
  );
}

// ─── OBJECTIONS TAB ───────────────────────────────────────────────────────────
export function ObjStackEditor({ stack, onSave, onDelete, onClose, initialEditCard, deckCards, inline }) {
  var [form, setForm]         = useState(Object.assign({}, stack, { cards:Object.assign({}, stack.cards || {}) }));
  var [editCard, setEditCard] = useState(initialEditCard || null);
  var [editMeta, setEditMeta] = useState(false);
  var [viewMode, setViewMode] = useState("list");
  var [search, setSearch]     = useState("");

  function upsertCard(card) {
    setForm(function(p) {
      var nextCard = Object.assign({ overview:[], intendedPath:false, prompt:"", answers:[{id:aid(),label:"",next:null}] }, card || {});
      var nc = Object.assign({}, p.cards, { [nextCard.id]: nextCard });
      return Object.assign({}, p, { cards:nc, rootCard:p.rootCard || nextCard.id });
    });
    setEditCard(null);
  }
  function upsertCardAndNavigate(saved, next) {
    setForm(function(p) {
      var nextCard = Object.assign({ overview:[], intendedPath:false, prompt:"", answers:[{id:aid(),label:"",next:null}] }, saved || {});
      var nc = Object.assign({}, p.cards, { [nextCard.id]: nextCard });
      return Object.assign({}, p, { cards:nc, rootCard:p.rootCard || nextCard.id });
    });
    setEditCard(next);
  }

  function deleteCard(id) {
    setForm(function(p) {
      var nc = Object.assign({}, p.cards);
      delete nc[id];
      Object.values(nc).forEach(function(c) {
        c.answers = (c.answers || []).map(function(a) {
          return a && a.next===id ? Object.assign({}, a, { next:null }) : a;
        });
      });
      return Object.assign({}, p, { cards:nc, rootCard:p.rootCard===id ? (Object.keys(nc)[0] || null) : p.rootCard });
    });
    setEditCard(null);
  }

  var allCards = Object.values(form.cards || {});
  var filtered = allCards.filter(function(c) {
    if (!search.trim()) return true;
    var hay = ((c.title || "") + " " + stripMarkup(c.prompt || "")).toLowerCase();
    return hay.indexOf(search.toLowerCase()) !== -1;
  });

  var outerSt = inline
    ? {display:"flex",flexDirection:"column",height:"100%",overflow:"hidden"}
    : {position:"fixed",inset:0,zIndex:250,display:"flex",flexDirection:"column"};
  var sheetSt = inline
    ? {display:"flex",flexDirection:"column",flex:1,background:"#081428",overflow:"hidden"}
    : {background:"#081428",borderRadius:"24px 24px 0 0",border:"1px solid rgba(239,83,80,.2)",borderBottom:"none",maxHeight:SHEET_MAX_H,display:"flex",flexDirection:"column",animation:"sheetUp .3s cubic-bezier(.22,1,.36,1) both"};

  return (
    <div style={outerSt}>
      {!inline && <div onClick={onClose} style={{flex:1,background:"rgba(0,0,0,.6)",backdropFilter:"blur(8px)"}}/>}
      <div style={sheetSt}>
        {!inline && <Handle/>}

        {!editMeta ? (
          <div style={{padding:"8px 20px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid rgba(255,255,255,.07)"}}>
            <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
              <div style={{width:42,height:42,borderRadius:13,background:"rgba(239,83,80,.15)",border:"1px solid rgba(239,83,80,.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>{form.icon}</div>
              <div style={{minWidth:0}}>
                <div style={{fontSize:17,fontWeight:700,color:"#fff",fontFamily:"'Lora',serif",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{form.label}</div>
                <div style={{fontSize:11,color:"rgba(255,255,255,.3)"}}>{Object.keys(form.cards || {}).length} cards</div>
              </div>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={function(){setEditMeta(true);}} style={ghostSm()}>Edit</button>
              <button onClick={function(){onDelete(form.id);}} style={ghostSm({color:"#EF5350",borderColor:"rgba(239,83,80,.3)"})}>Delete</button>
              <button onClick={onClose} style={iconBtn()}>✕</button>
            </div>
          </div>
        ) : (
          <div style={{padding:"8px 20px 14px",borderBottom:"1px solid rgba(255,255,255,.07)"}}>
            <label style={labelSt()}>Stack Name</label>
            <input value={form.label} onChange={function(e){setForm(function(p){return Object.assign({},p,{label:e.target.value});});}} style={inputSt({marginBottom:10})}/>
            <label style={labelSt()}>Icon</label>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
              {OBJ_ICONS.map(function(ic) {
                return <button key={ic} onClick={function(){setForm(function(p){return Object.assign({},p,{icon:ic});});}}
                  style={{background:form.icon===ic?"rgba(255,255,255,.15)":"rgba(255,255,255,.05)",border:"1.5px solid "+(form.icon===ic?"rgba(255,255,255,.4)":"rgba(255,255,255,.08)"),borderRadius:9,width:38,height:38,cursor:"pointer",fontSize:18}}>{ic}</button>;
              })}
            </div>
            <button onClick={function(){setEditMeta(false);}} style={Object.assign({},solidBtn(OBJ_COLOR),{width:"100%"})}>Done</button>
          </div>
        )}

        <div style={{padding:"10px 14px 8px",flexShrink:0,borderBottom:"1px solid rgba(255,255,255,.05)"}}>
          <div style={{display:"flex",alignItems:"center",gap:7}}>
            <div style={{display:"flex",background:"rgba(255,255,255,.05)",borderRadius:10,padding:2,gap:1,flexShrink:0}}>
              {["list","tree"].map(function(v) {
                var on=viewMode===v;
                return <button key={v} onClick={function(){setViewMode(v);}}
                  style={{background:on?"rgba(255,255,255,.14)":"transparent",border:"none",borderRadius:8,padding:"5px 11px",cursor:"pointer",color:on?"#fff":"rgba(255,255,255,.35)",fontSize:11,fontFamily:"inherit",fontWeight:on?700:400}}>
                  {v==="list"?"≡ List":"⊞ Viewer"}
                </button>;
              })}
            </div>
            <button onClick={function(){setEditCard({id:uid(),title:"",type:"objection",overview:[],intendedPath:false,prompt:"",answers:[{id:aid(),label:"",next:null}]});}} style={Object.assign({},solidBtn(OBJ_COLOR),{height:32,padding:"0 14px",fontSize:13,flexShrink:0})}>+ Card</button>
          </div>
          {viewMode==="list" && (
            <div style={{position:"relative",marginTop:8}}>
              <span style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",color:"rgba(255,255,255,.3)",fontSize:13}}>🔎</span>
              <input value={search} onChange={function(e){setSearch(e.target.value);}} placeholder="Search stack cards…" style={inputSt({paddingLeft:32,height:36})}/>
            </div>
          )}
          {viewMode==="tree" && <div style={{marginTop:6,fontSize:10,color:"rgba(255,255,255,.25)",lineHeight:1.5}}>Tap card to edit · ↩ = cross-link · ⊕ = merge · ★ = intended path · Pinch to zoom</div>}
        </div>

        {viewMode === "tree" ? (
          <TreeView cards={form.cards || {}} rootCard={form.rootCard} onEdit={function(c){setEditCard(c);}}
            onSetRoot={function(id){setForm(function(p){return Object.assign({},p,{rootCard:id});});}} />
        ) : (
          <div style={{overflowY:"auto",flex:1,padding:"14px 20px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <span style={{fontSize:11,color:"rgba(255,255,255,.3)",letterSpacing:.5,textTransform:"uppercase",fontWeight:700}}>{filtered.length} card{filtered.length!==1?"s":""}</span>
              <span style={{fontSize:11,color:"rgba(255,255,255,.22)"}}>{form.rootCard ? "Entry card set" : "No entry card"}</span>
            </div>

            <div style={{display:"flex",flexDirection:"column",gap:7}}>
              {filtered.map(function(c) {
                var isEntry = c.id===form.rootCard;
                return (
                  <button key={c.id} onClick={function(){setEditCard(c);}}
                    style={{background:"rgba(239,83,80,.04)",border:"1px solid rgba(239,83,80,.12)",borderLeft:"3px solid #EF5350",borderRadius:"0 12px 12px 0",padding:"11px 13px",cursor:"pointer",textAlign:"left",fontFamily:"inherit"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3,flexWrap:"wrap"}}>
                          <span style={{fontSize:13,fontWeight:700,color:"#fff"}}>{c.title}</span>
                          {isEntry && <span style={{fontSize:9,background:"rgba(239,83,80,.2)",color:"#EF5350",padding:"1px 7px",borderRadius:99,letterSpacing:.5,textTransform:"uppercase"}}>entry</span>}
                          {c.intendedPath && <IntendedBadge/>}
                        </div>
                        {c.overview && c.overview.filter(function(b){return b&&b.trim();}).length > 0 && (
                          <div style={{fontSize:10,color:"rgba(255,255,255,.38)",marginBottom:4}}>◆ {c.overview.filter(function(b){return b&&b.trim();})[0]}</div>
                        )}
                        <div style={{fontSize:11,color:"rgba(255,255,255,.3)",lineHeight:1.4,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{stripMarkup(c.prompt || "")}</div>
                      </div>
                      <span style={{fontSize:10,color:"rgba(239,83,80,.5)",flexShrink:0}}>{(c.answers||[]).length} paths</span>
                    </div>
                  </button>
                );
              })}
              {filtered.length===0 && <div style={{textAlign:"center",color:"rgba(255,255,255,.25)",padding:"28px 0",fontSize:14}}>{search ? "No matches." : "No cards yet."}</div>}
            </div>
          </div>
        )}

        <div style={{borderTop:"1px solid rgba(255,255,255,.07)"}}>
          {/* After-resolution target */}
          <div style={{padding:"12px 20px 0"}}>
            <div style={{fontSize:10,fontWeight:700,color:"rgba(239,83,80,.6)",marginBottom:8,letterSpacing:1,textTransform:"uppercase"}}>After objection resolves</div>
            <div style={{display:"flex",gap:7,marginBottom:form.targetCard?9:0}}>
              <button onClick={function(){setForm(function(p){return Object.assign({},p,{targetCard:null});});}}
                style={{flex:1,background:!form.targetCard?"rgba(255,255,255,.1)":"rgba(255,255,255,.04)",border:"1.5px solid "+(!form.targetCard?"rgba(255,255,255,.3)":"rgba(255,255,255,.08)"),borderRadius:10,padding:"8px 6px",cursor:"pointer",fontFamily:"inherit",fontSize:11,color:!form.targetCard?"#fff":"rgba(255,255,255,.35)",fontWeight:!form.targetCard?700:400,textAlign:"center"}}>
              ↩ Return to current card
              </button>
              <button onClick={function(){setForm(function(p){return Object.assign({},p,{targetCard:p.targetCard||"__pick"});});}}
                style={{flex:1,background:form.targetCard?"rgba(239,83,80,.13)":"rgba(255,255,255,.04)",border:"1.5px solid "+(form.targetCard?"rgba(239,83,80,.4)":"rgba(255,255,255,.08)"),borderRadius:10,padding:"8px 6px",cursor:"pointer",fontFamily:"inherit",fontSize:11,color:form.targetCard?"#EF5350":"rgba(255,255,255,.35)",fontWeight:form.targetCard?700:400,textAlign:"center"}}>
              → Go to specific card
              </button>
            </div>
            {form.targetCard && deckCards && Object.keys(deckCards).length > 0 && (
              <select
                value={form.targetCard === "__pick" ? "" : form.targetCard}
                onChange={function(e){setForm(function(p){return Object.assign({},p,{targetCard:e.target.value||"__pick"});});}}
                style={Object.assign({},inputSt({fontSize:12,marginBottom:0}),{appearance:"none"})}>
                <option value="">— Select target card —</option>
                {Object.values(deckCards).map(function(c){
                  return <option key={c.id} value={c.id}>{(TM[c.type]||TM.pitch).icon} {c.title}</option>;
                })}
              </select>
            )}
          </div>
          <div style={{padding:"14px 20px",display:"flex",gap:10}}>
            <button onClick={onClose} style={Object.assign({},ghostBtn(),{flex:1})}>Cancel</button>
            <button onClick={function(){
              var toSave = Object.assign({},form);
              if (toSave.targetCard === "__pick") toSave.targetCard = null;
              onSave(toSave);
            }} style={Object.assign({},solidBtn(OBJ_COLOR),{flex:2})}>Save Stack</button>
          </div>
        </div>
      </div>

      {editCard && <CardEditorSheet key={editCard.id} card={editCard} allCards={form.cards || {}} accentColor={OBJ_COLOR} lockedType="objection"
        onSave={upsertCard} onDelete={deleteCard} onClose={function(){setEditCard(null);}}
        onNavigateTo={function(c){setEditCard(c);}}
        onSaveAndNavigateTo={upsertCardAndNavigate}/>}
    </div>
  );
}

export function ObjectionsTab({ deck, onUpdateDeck, readOnly }) {
  var desktop = useContext(DesktopCtx);
  if (desktop.isDesktop) return <ObjectionsDesktop deck={deck} onUpdateDeck={onUpdateDeck} readOnly={readOnly}/>;

  var [editing, setEditing]       = useState(null);
  var [pendingCard, setPendingCard] = useState(null);
  var [showNew, setShowNew]       = useState(false);
  var [viewMode, setViewMode]     = useState("list");
  var [selectedStackId, setSelectedStackId] = useState(null);
  var [expandedStackId, setExpandedStackId] = useState(null);
  var [viewCard, setViewCard]     = useState(null);
  var [viewCardStack, setViewCardStack] = useState(null);
  var [nf, setNf]                 = useState({ label:"", icon:"😐" });

  function saveStack(s) {
    onUpdateDeck(deck.id, function(d) { return Object.assign({},d,{objStacks:d.objStacks.map(function(x){return x.id===s.id?s:x;})}); });
    setEditing(null); setPendingCard(null);
  }
  function deleteStack(id) {
    onUpdateDeck(deck.id, function(d) { return Object.assign({},d,{objStacks:d.objStacks.filter(function(s){return s.id!==id;})}); });
    setEditing(null); setPendingCard(null);
  }
  function createStack() {
    if (!nf.label.trim()) return;
    var s = { id:osid(), label:nf.label, icon:nf.icon, rootCard:null, cards:{} };
    onUpdateDeck(deck.id, function(d) { return Object.assign({},d,{objStacks:d.objStacks.concat([s])}); });
    setShowNew(false); setNf({label:"",icon:"😐"});
    setEditing(s);
  }
  function openStackCard(stack, card) {
    setPendingCard(card || null);
    setEditing(stack);
  }
  function onStackClick(stack) {
    if (readOnly) {
      setExpandedStackId(function(prev){ return prev === stack.id ? null : stack.id; });
      return;
    }
    openStackCard(stack, null);
  }
  function setStackRoot(stackId, cardId) {
    onUpdateDeck(deck.id, function(d) {
      return Object.assign({}, d, { objStacks: d.objStacks.map(function(s) {
        return s.id === stackId ? Object.assign({}, s, { rootCard: cardId }) : s;
      })});
    });
  }

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {/* Header bar */}
      <div style={{padding:"10px 14px 8px",flexShrink:0,borderBottom:"1px solid rgba(255,255,255,.05)"}}>
        <div style={{display:"flex",alignItems:"center",gap:7}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:11,color:"rgba(255,255,255,.3)",letterSpacing:.5,textTransform:"uppercase",fontWeight:700}}>{deck.objStacks.length} Stack{deck.objStacks.length!==1?"s":""}</div>
          </div>
          <div style={{display:"flex",background:"rgba(255,255,255,.05)",borderRadius:10,padding:2,gap:1,flexShrink:0}}>
            {["list","tree"].map(function(v) {
              var on=viewMode===v;
              return <button key={v} onClick={function(){setViewMode(v);}}
                style={{background:on?"rgba(255,255,255,.14)":"transparent",border:"none",borderRadius:8,padding:"5px 11px",cursor:"pointer",color:on?"#fff":"rgba(255,255,255,.35)",fontSize:11,fontFamily:"inherit",fontWeight:on?700:400}}>
                {v==="list"?"≡ List":"⊞ Viewer"}
              </button>;
            })}
          </div>
          {readOnly && <span style={{fontSize:9,color:"rgba(255,255,255,.3)",background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",borderRadius:99,padding:"3px 9px",flexShrink:0}}>📖 View only</span>}
          {!readOnly && <button onClick={function(){setShowNew(true);}} style={ghostSm({color:OBJ_COLOR,borderColor:"rgba(239,83,80,.3)"})}>+ New</button>}
        </div>
        {viewMode==="tree" && deck.objStacks.length > 0 && !readOnly && <div style={{marginTop:6,fontSize:10,color:"rgba(255,255,255,.25)",lineHeight:1.5}}>Tap card to edit · ⬆ = set entry · ↩ = cross-link · Pinch to zoom</div>}
        {viewMode==="tree" && deck.objStacks.length > 0 && readOnly && <div style={{marginTop:6,fontSize:10,color:"rgba(255,255,255,.25)",lineHeight:1.5}}>Tap card to view · Pinch to zoom</div>}
      </div>

      {viewMode === "list" ? (
        <div style={{flex:1,overflowY:"auto",padding:"14px 14px 0"}}>
          <div style={{background:"rgba(239,83,80,.07)",border:"1px solid rgba(239,83,80,.15)",borderRadius:14,padding:"13px 15px",marginBottom:14}}>
            <div style={{fontSize:12,fontWeight:700,color:OBJ_COLOR,marginBottom:3}}>🛡️ Objection Stacks</div>
            <div style={{fontSize:11,color:"rgba(255,255,255,.35)",lineHeight:1.6}}>Linked to <strong style={{color:"rgba(255,255,255,.6)"}}>{deck.name}</strong>. Access from Play mode — returns to your current card.</div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {deck.objStacks.length===0 && <div style={{textAlign:"center",color:"rgba(255,255,255,.25)",padding:"40px 0",fontSize:14,lineHeight:1.7}}>No stacks yet.<br/>Create one to handle objections from anywhere in your pitch.</div>}
            {deck.objStacks.map(function(stack) {
              var isExpanded = readOnly && expandedStackId === stack.id;
              var stackCards = Object.values(stack.cards || {});
              return (
                <div key={stack.id} style={{background:"rgba(239,83,80,.05)",border:"1.5px solid "+(isExpanded?"rgba(239,83,80,.3)":"rgba(239,83,80,.15)"),borderRadius:16,overflow:"hidden",transition:"border-color .15s"}}>
                  <button onClick={function(){onStackClick(stack);}}
                    style={{width:"100%",background:"transparent",border:"none",padding:"15px",cursor:"pointer",textAlign:"left",fontFamily:"inherit"}}>
                    <div style={{display:"flex",alignItems:"center",gap:13}}>
                      <div style={{width:46,height:46,borderRadius:13,background:"rgba(239,83,80,.15)",border:"1px solid rgba(239,83,80,.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>{stack.icon}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:14,fontWeight:700,color:"#fff",marginBottom:4}}>{stack.label}</div>
                        <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                          <span style={{fontSize:11,color:"rgba(239,83,80,.7)",background:"rgba(239,83,80,.1)",padding:"2px 8px",borderRadius:99}}>{Object.keys(stack.cards).length} cards</span>
                          <span style={{fontSize:11,color:"rgba(255,255,255,.25)",background:"rgba(255,255,255,.05)",padding:"2px 8px",borderRadius:99}}>{stack.rootCard?"Has entry":"No entry card"}</span>
                        </div>
                      </div>
                      <span style={{color:"rgba(239,83,80,.5)",fontSize:readOnly?11:18,flexShrink:0}}>{readOnly?(isExpanded?"▼":"▶"):"›"}</span>
                    </div>
                  </button>
                  {isExpanded && (
                    <div style={{borderTop:"1px solid rgba(239,83,80,.12)",padding:"8px 12px 12px"}}>
                      {stackCards.length === 0 && <div style={{textAlign:"center",color:"rgba(255,255,255,.25)",padding:"16px 0",fontSize:12}}>No cards in this stack.</div>}
                      <div style={{display:"flex",flexDirection:"column",gap:6}}>
                        {stackCards.map(function(card) {
                          var isEntry = card.id === stack.rootCard;
                          return (
                            <button key={card.id} onClick={function(){setViewCard(card); setViewCardStack(stack);}}
                              style={{background:"rgba(239,83,80,.04)",border:"1px solid rgba(239,83,80,.12)",borderLeft:"3px solid #EF5350",borderRadius:"0 12px 12px 0",padding:"11px 13px",cursor:"pointer",textAlign:"left",fontFamily:"inherit"}}>
                              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                                <div style={{flex:1,minWidth:0}}>
                                  <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3,flexWrap:"wrap"}}>
                                    <span style={{fontSize:13,fontWeight:700,color:"#fff"}}>{card.title}</span>
                                    {isEntry && <span style={{fontSize:9,background:"rgba(239,83,80,.2)",color:"#EF5350",padding:"1px 7px",borderRadius:99,letterSpacing:.5,textTransform:"uppercase"}}>entry</span>}
                                    {card.intendedPath && <IntendedBadge/>}
                                  </div>
                                  {card.overview && card.overview.filter(function(b){return b&&b.trim();}).length > 0 && (
                                    <div style={{fontSize:10,color:"rgba(255,255,255,.38)",marginBottom:3}}>◆ {card.overview.filter(function(b){return b&&b.trim();})[0]}</div>
                                  )}
                                  <div style={{fontSize:11,color:"rgba(255,255,255,.3)",lineHeight:1.4,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{stripMarkup(card.prompt || "")}</div>
                                </div>
                                <span style={{fontSize:10,color:"rgba(239,83,80,.5)",flexShrink:0}}>{(card.answers||[]).length} paths</span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{height:20}}/>
        </div>
      ) : (
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
          {deck.objStacks.length===0 && (
            <div style={{textAlign:"center",color:"rgba(255,255,255,.25)",padding:"40px 0",fontSize:14,lineHeight:1.7}}>
              No stacks yet.<br/>Create one to handle objections from anywhere in your pitch.
            </div>
          )}
          {deck.objStacks.length > 0 && (function(){
            var activeStackId = selectedStackId || deck.objStacks[0].id;
            var activeStack = deck.objStacks.find(function(s){return s.id===activeStackId;}) || deck.objStacks[0];
            var cardCount = activeStack ? Object.keys(activeStack.cards).length : 0;
            return (
              <>
                {/* Pill selector */}
                <div style={{padding:"8px 14px 0",overflowX:"auto",flexShrink:0}}>
                  <div style={{display:"flex",gap:6,paddingBottom:6}}>
                    {deck.objStacks.map(function(stack){
                      var on = stack.id === activeStackId;
                      return (
                        <button key={stack.id} onClick={function(){setSelectedStackId(stack.id);}}
                          style={{display:"inline-flex",alignItems:"center",gap:5,background:on?"rgba(239,83,80,.15)":"rgba(255,255,255,.05)",border:"1.5px solid "+(on?"rgba(239,83,80,.4)":"rgba(255,255,255,.09)"),borderRadius:99,padding:"5px 12px",cursor:"pointer",fontFamily:"inherit",fontSize:11,color:on?OBJ_COLOR:"rgba(255,255,255,.4)",fontWeight:on?700:400,flexShrink:0}}>
                          <span>{stack.icon}</span><span>{stack.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {/* Active stack tree */}
                {activeStack && (
                  <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",borderTop:"1px solid rgba(255,255,255,.05)"}}>
                    <div style={{padding:"8px 14px 4px",display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
                      <div style={{width:28,height:28,borderRadius:8,background:"rgba(239,83,80,.15)",border:"1px solid rgba(239,83,80,.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0}}>{activeStack.icon}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:700,color:"#fff"}}>{activeStack.label}</div>
                        <div style={{fontSize:9,color:"rgba(239,83,80,.6)"}}>{cardCount} card{cardCount!==1?"s":""}{activeStack.rootCard?" · entry set":" · no entry"}</div>
                      </div>
                      {!readOnly && <button onClick={function(){openStackCard(activeStack, null);}} style={ghostSm({color:OBJ_COLOR,borderColor:"rgba(239,83,80,.3)",fontSize:11})}>Edit</button>}
                    </div>
                    {cardCount > 0 ? (
                      <TreeView
                        cards={activeStack.cards}
                        rootCard={activeStack.rootCard}
                        onEdit={readOnly ? function(card){setViewCard(card); setViewCardStack(activeStack);} : function(card){openStackCard(activeStack, card);}}
                        onSetRoot={readOnly ? null : function(cardId){setStackRoot(activeStack.id, cardId);}}
                      />
                    ) : (
                      <div style={{padding:"8px 14px 14px",fontSize:11,color:"rgba(255,255,255,.2)"}}>No cards — open editor to add some.</div>
                    )}
                  </div>
                )}
              </>
            );
          })()}
          <div style={{height:20,flexShrink:0}}/>
        </div>
      )}

      {showNew && (
        <div style={{position:"fixed",inset:0,zIndex:250,display:"flex",flexDirection:"column"}}>
          <div onClick={function(){setShowNew(false);}} style={{flex:1,background:"rgba(0,0,0,.6)",backdropFilter:"blur(8px)"}}/>
          <div style={{background:"#081428",borderRadius:"24px 24px 0 0",border:"1px solid rgba(239,83,80,.2)",borderBottom:"none",padding:"16px 20px 28px",animation:"sheetUp .3s cubic-bezier(.22,1,.36,1) both"}}>
            <Handle/>
            <div style={{fontSize:18,fontWeight:700,color:"#fff",marginBottom:16,fontFamily:"'Lora',serif"}}>New Objection Stack</div>
            <label style={labelSt()}>Name</label>
            <input value={nf.label} onChange={function(e){setNf(function(p){return Object.assign({},p,{label:e.target.value});});}} placeholder="e.g. Too Expensive" style={inputSt({marginBottom:14})}/>
            <label style={labelSt()}>Icon</label>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:18}}>
              {OBJ_ICONS.map(function(ic) {
                return <button key={ic} onClick={function(){setNf(function(p){return Object.assign({},p,{icon:ic});});}}
                  style={{background:nf.icon===ic?"rgba(239,83,80,.2)":"rgba(255,255,255,.05)",border:"1.5px solid "+(nf.icon===ic?"rgba(239,83,80,.5)":"rgba(255,255,255,.08)"),borderRadius:9,width:40,height:40,cursor:"pointer",fontSize:20}}>{ic}</button>;
              })}
            </div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={function(){setShowNew(false);}} style={Object.assign({},ghostBtn(),{flex:1})}>Cancel</button>
              <button onClick={createStack} style={Object.assign({},solidBtn(OBJ_COLOR),{flex:2})}>Create Stack</button>
            </div>
          </div>
        </div>
      )}
      {editing && (
        <ObjStackEditor
          stack={editing}
          onSave={saveStack}
          onDelete={deleteStack}
          onClose={function(){setEditing(null);setPendingCard(null);}}
          initialEditCard={pendingCard}
          deckCards={deck.cards}
        />
      )}
      {viewCard && readOnly && (
        <div style={{position:"fixed",inset:0,zIndex:250,display:"flex",flexDirection:"column"}}
          onClick={function(e){if(e.target===e.currentTarget){setViewCard(null);setViewCardStack(null);}}}>
          <div onClick={function(){setViewCard(null);setViewCardStack(null);}} style={{flex:1,background:"rgba(0,0,0,.5)",backdropFilter:"blur(8px)"}}/>
          <div style={{background:"#081428",borderRadius:"24px 24px 0 0",border:"1px solid rgba(239,83,80,.2)",borderBottom:"none",maxHeight:"75vh",overflow:"auto",padding:"0 0 32px",animation:"sheetUp .3s cubic-bezier(.22,1,.36,1) both"}}>
            <Handle/>
            <div style={{padding:"4px 16px 14px",borderBottom:"1px solid rgba(255,255,255,.07)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:9,background:"rgba(239,83,80,.15)",color:OBJ_COLOR,padding:"2px 9px",borderRadius:99,fontWeight:700,letterSpacing:.5,textTransform:"uppercase"}}>Objection</span>
                {viewCardStack && viewCard.id === viewCardStack.rootCard && <span style={{fontSize:9,background:"rgba(239,83,80,.2)",color:"#EF5350",padding:"1px 7px",borderRadius:99,letterSpacing:.5,textTransform:"uppercase"}}>entry</span>}
                {viewCard.intendedPath && <IntendedBadge/>}
              </div>
              <button onClick={function(){setViewCard(null);setViewCardStack(null);}} style={iconBtn()}>✕</button>
            </div>
            <div style={{padding:"14px 16px"}}>
              <div style={{fontSize:18,fontWeight:700,color:"#fff",fontFamily:"'Lora',serif",marginBottom:10}}>{viewCard.title}</div>
              {viewCard.overview && viewCard.overview.filter(function(b){return b&&b.trim();}).length > 0 && (
                <OverviewDisplay bullets={viewCard.overview} color={OBJ_COLOR}/>
              )}
              {viewCard.prompt && (
                <div style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.07)",borderRadius:12,padding:"14px 16px",marginBottom:12,fontSize:15,lineHeight:1.7}}>
                  <RichPromptDisplay text={viewCard.prompt} accentColor={OBJ_COLOR}/>
                </div>
              )}
              {(viewCard.answers||[]).filter(function(a){return a&&a.label;}).length > 0 && (
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,.3)",letterSpacing:1.2,textTransform:"uppercase",marginBottom:8}}>Prospect responds:</div>
                  {(viewCard.answers||[]).filter(function(a){return a&&a.label;}).map(function(ans,i){
                    var stackCards = viewCardStack ? (viewCardStack.cards || {}) : {};
                    var linkedCard = ans.next ? (stackCards[ans.next] || null) : null;
                    return (
                      <div key={ans.id||i} style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)",borderRadius:12,padding:"10px 13px",marginBottom:6}}>
                        <div style={{fontSize:13,color:"rgba(255,255,255,.8)"}}>{ans.label}</div>
                        {linkedCard && (
                          <div style={{display:"flex",alignItems:"center",gap:5,marginTop:6,paddingTop:6,borderTop:"1px solid rgba(255,255,255,.05)"}}>
                            <span style={{fontSize:9,color:"rgba(255,255,255,.28)"}}>→</span>
                            <span style={{fontSize:11,color:OBJ_COLOR,fontWeight:600,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{linkedCard.title}</span>
                          </div>
                        )}
                        {!linkedCard && ans.next && <div style={{fontSize:9,color:"rgba(255,255,255,.2)",marginTop:4}}>→ (no destination linked)</div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
