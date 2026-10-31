import { useState, useEffect, useRef, useContext } from "react";
import { cachedGet, useCacheVersion } from "../lib/dataCache";
import DesktopCtx from "../lib/DesktopCtx";
import { TM, OBJ_COLOR, SESS_COLOR, accentA, themed, isAdminRole } from "../lib/constants";
import { TabIcon, SearchIcon } from "./TabIcons";

// ─── SEARCH (COMMAND PALETTE) ─────────────────────────────────────────────────
// ⌘K / Ctrl+K on desktop; the search button on tablet and phone (top bar / rail).
// Finds tabs, decks, cards (deck cards and objection-stack cards) and sessions (name, rep,
// deck, contact) and takes you there:
//   tab     → that tab
//   deck    → switches to it
//   card    → opens it in the Cards / Objections editor
//   session → opens its review in the Sessions tab
// Anything in another deck than the active one asks first ("you're switching decks"). Deck
// changes are refused while a call is in progress.
// Props: tabs, decks, activeDeckId, authUser, sessionActive, onNavigateTab, onOpen, onClose
//   onOpen({ type:"deck"|"card"|"session", … }) — App does the routing
export function CommandPalette({ tabs, decks, activeDeckId, authUser, sessionActive, onNavigateTab, onOpen, onClose }) {
  var layout = useContext(DesktopCtx);
  var touch = !!layout.isTouchPrimary;
  var phone = !layout.isDesktop;            // phones: full-screen search
  var [query,    setQuery]    = useState("");
  var [debQ,     setDebQ]     = useState("");
  var [selected, setSelected] = useState(0);
  var [sessions, setSessions] = useState(null);
  var [pending,  setPending]  = useState(null);   // a result that would switch decks, awaiting confirmation
  var [notice,   setNotice]   = useState("");

  var inputRef = useRef(null);
  var confirmRef = useRef(null);
  var debTimer = useRef(null);
  var activeDeck = (decks || []).find(function(d) { return d.id === activeDeckId; }) || null;

  useEffect(function() { if (inputRef.current) inputRef.current.focus(); }, []);
  useEffect(function() { if (pending && confirmRef.current) confirmRef.current.focus(); }, [pending]);

  // Sessions to search: admins across the org, everyone else their own + shared + highlights
  var admin = !!(authUser && isAdminRole(authUser.role));
  var sv = useCacheVersion("/sessions");
  useEffect(function() {
    var lists = [cachedGet(admin ? "/sessions?scope=org&limit=300" : "/sessions?limit=300"), cachedGet("/sessions/highlights")];
    Promise.all(lists.map(function(p) { return p.catch(function() { return []; }); })).then(function(res) {
      var seen = {}, out = [];
      res.forEach(function(list) { (Array.isArray(list) ? list : []).forEach(function(s) { if (!seen[s.id]) { seen[s.id] = true; out.push(s); } }); });
      out.sort(function(a, b) { return b.startTs - a.startTs; });
      setSessions(out);
    });
  }, [sv, admin]);

  useEffect(function() {
    if (debTimer.current) clearTimeout(debTimer.current);
    debTimer.current = setTimeout(function() { setDebQ(query); }, 120);
    return function() { if (debTimer.current) clearTimeout(debTimer.current); };
  }, [query]);
  useEffect(function() { setSelected(0); setNotice(""); }, [debQ]);

  var results = buildResults(debQ, tabs, decks, sessions);
  var flatItems = [];
  results.forEach(function(sec) { sec.items.forEach(function(item) { flatItems.push(item); }); });

  function deckName(id) { var d = (decks || []).find(function(x) { return x.id === id; }); return d ? d.name : "another deck"; }

  function execute(item, confirmed) {
    if (!item) return;
    if (item.type === "tab") {
      if (sessionActive && item.id !== "play") { setNotice("Finish your session first — tabs are locked during a call."); return; }
      onNavigateTab(item.id); onClose(); return;
    }
    var switching = item.deckId && item.deckId !== activeDeckId && item.deckAccessible !== false;
    if (switching && sessionActive) { setNotice("Finish your session before switching decks."); return; }
    if (item.type === "session" && sessionActive) { setNotice("Finish your session first — tabs are locked during a call."); return; }
    if (item.type === "card" && sessionActive) { setNotice("Finish your session first — tabs are locked during a call."); return; }
    // Opening something from another deck switches decks: ask first (a deck result is the
    // switch itself, so it needs no question)
    if (switching && item.type !== "deck" && !confirmed) { setPending(item); return; }
    onOpen(item);
    onClose();
  }

  function handleKeyDown(e) {
    if (e.key === "Escape") { e.preventDefault(); if (pending) setPending(null); else onClose(); return; }
    if (pending) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setSelected(function(s) { return Math.min(s + 1, flatItems.length - 1); }); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelected(function(s) { return Math.max(s - 1, 0); }); return; }
    if (e.key === "Enter") { e.preventDefault(); execute(flatItems[selected]); }
  }

  var panel = {
    width: phone ? "100%" : 680, maxWidth: phone ? "100%" : "92vw",
    background: themed("#0a1830"),
    border: phone ? "none" : "1px solid rgba(255,255,255,.12)",
    borderRadius: phone ? 0 : 16,
    boxShadow: phone ? "none" : "0 32px 96px rgba(0,0,0,.9)",
    overflow: "hidden", display: "flex", flexDirection: "column",
    height: phone ? "100%" : undefined,
    animation: phone ? "fadeIn .16s ease both" : "fadeIn .14s ease both",
  };

  return (
    <div onClick={function(e) { if (e.target === e.currentTarget) onClose(); }} onKeyDown={handleKeyDown}
      style={phone
        ? { position:"fixed", left:0, right:0, top:"var(--vvt, 0px)", height:"var(--vvh, 100%)", zIndex:800, display:"flex", background:themed("#0a1830") }
        : { position:"fixed", inset:0, background:"rgba(0,0,0,.65)", backdropFilter:"blur(6px)", zIndex:800, display:"flex", alignItems:"flex-start", justifyContent:"center", paddingTop: touch ? "5vh" : "13vh" }}>
      <div role="dialog" aria-label="Search" style={panel}>
        {/* Search field */}
        <div style={{display:"flex",alignItems:"center",gap:12,padding:phone ? "10px 12px 10px 16px" : "16px 20px",borderBottom:"1px solid rgba(255,255,255,.08)",flexShrink:0}}>
          <span style={{color:SESS_COLOR,opacity:.9}}><SearchIcon size={phone ? 18 : 20}/></span>
          <input ref={inputRef} value={query} onChange={function(e) { setQuery(e.target.value); setPending(null); }}
            placeholder="Search decks, cards, sessions…" aria-label="Search decks, cards, sessions and tabs"
            enterKeyHint="search" autoComplete="off" spellCheck={false}
            style={{flex:1,minWidth:0,background:"none",border:"none",outline:"none",fontSize:phone ? 16 : 18,color:"#fff",fontFamily:"inherit",caretColor:SESS_COLOR}}/>
          {query && (
            <button onClick={function() { setQuery(""); if (inputRef.current) inputRef.current.focus(); }} aria-label="Clear search"
              style={{background:"none",border:"none",cursor:"pointer",color:"rgba(255,255,255,.5)",fontSize:20,padding:"2px 6px",minWidth:touch ? 40 : undefined,minHeight:touch ? 40 : undefined,fontFamily:"inherit"}}>×</button>
          )}
          {phone && (
            <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",color:SESS_COLOR,fontSize:14,fontWeight:600,padding:"8px 4px",fontFamily:"inherit",flexShrink:0}}>Cancel</button>
          )}
        </div>

        {notice && (
          <div role="status" style={{padding:"9px 20px",fontSize:13,color:"#FFB74D",background:"rgba(255,183,77,.08)",borderBottom:"1px solid rgba(255,183,77,.18)",flexShrink:0}}>{notice}</div>
        )}

        {pending ? (
          // Opening this switches the active deck — confirm first
          <div style={{padding:phone ? "22px 18px" : "24px 26px",display:"flex",flexDirection:"column",gap:14,flex:phone ? 1 : undefined}}>
            <div style={{fontSize:17,fontWeight:700,color:"#fff",fontFamily:"'Lora',serif"}}>Switch decks?</div>
            <div style={{fontSize:14,color:"rgba(255,255,255,.7)",lineHeight:1.6}}>
              <strong style={{color:"#fff"}}>{pending.title}</strong> is in <strong style={{color:"#fff"}}>{deckName(pending.deckId)}</strong>.
              {activeDeck ? <> Opening it switches your active deck from <strong style={{color:"#fff"}}>{activeDeck.name}</strong>.</> : " Opening it switches your active deck."}
            </div>
            <div style={{display:"flex",gap:10,marginTop:4}}>
              <button onClick={function() { setPending(null); if (inputRef.current) inputRef.current.focus(); }}
                style={{flex:1,minHeight:44,background:"transparent",border:"1.5px solid rgba(255,255,255,.15)",borderRadius:12,color:"rgba(255,255,255,.7)",fontSize:14,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
              <button ref={confirmRef} onClick={function() { execute(pending, true); }}
                onKeyDown={function(e) { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); execute(pending, true); } }}
                style={{flex:2,minHeight:44,background:SESS_COLOR,border:"none",borderRadius:12,color:"#000",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                Switch to {deckName(pending.deckId)} &amp; open
              </button>
            </div>
          </div>
        ) : (
          <div style={{flex:phone ? 1 : undefined,maxHeight:phone ? undefined : "min(480px, 60vh)",overflowY:"auto",padding:"6px 0"}}>
            {flatItems.length === 0 && debQ.length >= 2 && (
              <div style={{textAlign:"center",padding:"32px 0",color:"rgba(255,255,255,.5)",fontSize:15}}>No results for “{debQ}”</div>
            )}
            {results.map(function(sec) {
              return <ResultSection key={sec.label} section={sec} selected={selected} flatItems={flatItems} onSelect={function(it) { execute(it); }}
                activeDeckId={activeDeckId} big={touch}/>;
            })}
          </div>
        )}

        {!touch && !pending && (
          <div style={{display:"flex",gap:18,padding:"10px 20px",borderTop:"1px solid rgba(255,255,255,.06)",background:"rgba(0,0,0,.2)",flexShrink:0}}>
            {[["↑↓", "Navigate"], ["↵", "Open"], ["Esc", "Close"]].map(function(pair) {
              return (
                <div key={pair[0]} style={{display:"flex",alignItems:"center",gap:5}}>
                  <span style={{fontSize:12,background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.14)",borderRadius:5,padding:"1px 7px",color:"rgba(255,255,255,.65)"}}>{pair[0]}</span>
                  <span style={{fontSize:13,color:"rgba(255,255,255,.5)"}}>{pair[1]}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── RESULT SECTION ───────────────────────────────────────────────────────────
function ResultSection({ section, selected, flatItems, onSelect, activeDeckId, big }) {
  return (
    <div>
      <div style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,.45)",letterSpacing:1.1,textTransform:"uppercase",padding:"10px 20px 6px"}}>{section.label}</div>
      {section.items.map(function(item) {
        var idx = flatItems.indexOf(item);
        var on = idx === selected;
        var elsewhere = item.deckId && item.deckId !== activeDeckId && item.type !== "deck" && item.deckAccessible !== false;
        return (
          <button key={item.key} onClick={function() { onSelect(item); }}
            style={{display:"flex",alignItems:"center",gap:12,width:"100%",textAlign:"left",background:on ? accentA(.1) : "transparent",
              boxShadow:on ? "inset 3px 0 0 " + SESS_COLOR : "none",border:"none",padding:"10px 20px",minHeight:big ? 54 : 48,cursor:"pointer",fontFamily:"inherit",outline:"none"}}>
            <span aria-hidden="true" style={{width:26,height:26,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",color:item.color || "rgba(255,255,255,.7)",fontSize:17}}>
              {item.tabId ? <TabIcon id={item.tabId} size={19}/> : item.icon}
            </span>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:15,fontWeight:600,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.title}</div>
              {item.subtitle && <div style={{fontSize:13,color:"rgba(255,255,255,.55)",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.subtitle}</div>}
            </div>
            {elsewhere && <span title="In another deck — you'll be asked before switching" style={{fontSize:11,fontWeight:700,color:"#FFB74D",background:"rgba(255,183,77,.1)",border:"1px solid rgba(255,183,77,.25)",borderRadius:99,padding:"2px 8px",flexShrink:0}}>other deck</span>}
            {on && !big && <span style={{fontSize:13,color:"rgba(255,255,255,.5)",flexShrink:0}}>↵</span>}
          </button>
        );
      })}
    </div>
  );
}

// ─── BUILD RESULTS ────────────────────────────────────────────────────────────
function fmtDay(ts) { return ts ? new Date(ts).toLocaleDateString("en-US", { month:"short", day:"numeric" }) : ""; }

function buildResults(query, tabs, decks, sessions) {
  var q = (query || "").toLowerCase().trim();
  var has = function(s) { return (s || "").toLowerCase().indexOf(q) !== -1; };
  var sections = [];

  var tabItems = tabs.filter(function(t) { return !q || has(t.label) || has(t.id); }).map(function(t) {
    return { key:"tab:" + t.id, type:"tab", id:t.id, tabId:t.id, title:t.label, subtitle:q ? "Go to " + t.label : null };
  });
  if (tabItems.length) sections.push({ label:"Navigate", items:tabItems });
  if (q.length < 2) return sections;

  var deckItems = (decks || []).filter(function(d) { return has(d.name); }).slice(0, 5).map(function(d) {
    var n = Object.keys(d.cards || {}).length;
    return { key:"deck:" + d.id, type:"deck", id:d.id, deckId:d.id, icon:d.icon, color:d.color, title:d.name, subtitle:"Switch to this deck · " + n + " card" + (n !== 1 ? "s" : "") };
  });
  if (deckItems.length) sections.push({ label:"Decks", items:deckItems });

  // Cards: titles first, then script matches; objection-stack cards included
  var cardItems = [];
  (decks || []).forEach(function(deck) {
    Object.values(deck.cards || {}).forEach(function(c) {
      var titleHit = has(c.title);
      if (!titleHit && !has(c.prompt)) return;
      var m = TM[c.type] || TM.pitch;
      cardItems.push({ key:"card:" + deck.id + ":" + c.id, type:"card", id:c.id, cardId:c.id, deckId:deck.id, icon:m.icon, color:m.color,
        title:c.title || "Untitled", subtitle:deck.name + " · " + m.label, rank:titleHit ? 0 : 1 });
    });
    (deck.objStacks || []).forEach(function(st) {
      if (st.archivedAt) return;
      Object.values(st.cards || {}).forEach(function(c) {
        var titleHit = has(c.title) || has(st.label);
        if (!titleHit && !has(c.prompt)) return;
        cardItems.push({ key:"stack:" + deck.id + ":" + st.id + ":" + c.id, type:"card", id:c.id, cardId:c.id, stackId:st.id, deckId:deck.id, icon:"🛡️", color:OBJ_COLOR,
          title:c.title || "Untitled", subtitle:deck.name + " · " + (st.icon || "") + " " + st.label, rank:titleHit ? 0 : 1 });
      });
    });
  });
  cardItems.sort(function(a, b) { return a.rank - b.rank; });
  if (cardItems.length) sections.push({ label:"Cards", items:cardItems.slice(0, 10) });

  var deckIds = {};
  (decks || []).forEach(function(d) { deckIds[d.id] = true; });
  var sessionItems = (sessions || []).filter(function(s) {
    return has(s.name) || has(s.userName) || has(s.deckName) || has(s.account) || has(s.contact);
  }).slice(0, 8).map(function(s) {
    var live = (s.mode || "live") === "live";
    return { key:"session:" + s.id, type:"session", id:s.id, deckId:s.deckId, deckAccessible:!!deckIds[s.deckId], session:s,
      icon:live ? "📞" : "🎯", title:s.name || "Untitled session",
      subtitle:[s.userName, s.deckName, fmtDay(s.startTs)].filter(Boolean).join(" · ") };
  });
  if (sessionItems.length) sections.push({ label:"Sessions", items:sessionItems });
  return sections;
}
