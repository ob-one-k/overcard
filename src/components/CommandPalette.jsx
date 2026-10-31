import { useState, useEffect, useRef, useContext } from "react";
import { cachedGet, useCacheVersion } from "../lib/dataCache";
import { OrgMark } from "./OrgMark";
import DesktopCtx from "../lib/DesktopCtx";
import { inputSt } from "../lib/styles";
import { themed } from "../lib/constants";

// ─── COMMAND PALETTE ──────────────────────────────────────────────────────────
// Global ⌘K search palette for desktop.
// Searches: tabs, cards (from all decks), sessions.
// Props: tabs, decks, onNavigateTab, onSwitchDeck, onClose
// Tablet/touch: opened from the top-bar search button; sits higher (room for the
// on-screen keyboard), hides the keyboard-hint footer, 44px clear button.
export function CommandPalette({ tabs, decks, onNavigateTab, onSwitchDeck, onClose }) {
  var touch = !!useContext(DesktopCtx).isTouchPrimary;
  var [query,     setQuery]     = useState("");
  var [debQ,      setDebQ]      = useState("");
  var [selected,  setSelected]  = useState(0);
  var [sessions,  setSessions]  = useState(null);

  var inputRef = useRef(null);
  var debTimer = useRef(null);

  // Autofocus input
  useEffect(function() {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  // Load sessions on mount (for search), and again when sessions change live
  var sv = useCacheVersion("/sessions");
  useEffect(function() {
    // Search only needs recent sessions; cached so reopening ⌘K is instant
    cachedGet("/sessions?limit=200").then(function(data){
      setSessions(Array.isArray(data) ? data : []);
    }).catch(function(){ setSessions([]); });
  }, [sv]);

  // Debounce query → debQ
  useEffect(function() {
    if (debTimer.current) clearTimeout(debTimer.current);
    debTimer.current = setTimeout(function() {
      setDebQ(query);
    }, 120);
    return function() { if (debTimer.current) clearTimeout(debTimer.current); };
  }, [query]);

  // Reset selection when debounced query changes
  useEffect(function() {
    setSelected(0);
  }, [debQ]);

  // Close on overlay click / Escape
  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose();
  }

  // Build result list
  var results = buildResults(debQ, tabs, decks, sessions);
  var totalCount = results.reduce(function(sum, sec){ return sum + sec.items.length; }, 0);

  // Flat index for keyboard nav
  var flatItems = [];
  results.forEach(function(sec) {
    sec.items.forEach(function(item) {
      flatItems.push(item);
    });
  });

  function execute(item) {
    if (!item) return;
    if (item.type === "tab") {
      onNavigateTab(item.id);
    } else if (item.type === "card") {
      onSwitchDeck(item.deckId);
      onNavigateTab("cards");
    } else if (item.type === "session") {
      onNavigateTab("sessions");
    }
    onClose();
  }

  function handleKeyDown(e) {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected(function(s){ return Math.min(s + 1, flatItems.length - 1); });
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected(function(s){ return Math.max(s - 1, 0); });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      execute(flatItems[selected]);
      return;
    }
  }

  return (
    <div
      onClick={handleOverlayClick}
      style={{
        position:"fixed", inset:0,
        background:"rgba(0,0,0,.65)",
        backdropFilter:"blur(6px)",
        zIndex:800,
        display:"flex",
        alignItems:"flex-start",
        justifyContent:"center",
        paddingTop:touch ? "5vh" : "13vh"
      }}>
      <div style={{
        width:680, maxWidth:"90vw",
        background:themed("#0a1830"),
        border:"1px solid rgba(255,255,255,.12)",
        borderRadius:16,
        boxShadow:"0 32px 96px rgba(0,0,0,.9)",
        overflow:"hidden",
        animation:"fadeIn .14s ease both"
      }}>
        {/* Search input */}
        <div style={{display:"flex",alignItems:"center",gap:12,padding:"16px 20px",borderBottom:"1px solid rgba(255,255,255,.08)"}}>
          <OrgMark size={20}/>
          <span aria-hidden="true" style={{fontSize:20,color:"rgba(255,255,255,.45)",flexShrink:0}}>⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={function(e){ setQuery(e.target.value); }}
            onKeyDown={handleKeyDown}
            placeholder="Search tabs, cards, sessions…"
            aria-label="Search tabs, cards and sessions"
            style={{
              flex:1, background:"none", border:"none", outline:"none",
              fontSize:18, color:"#fff", fontFamily:"inherit",
              caretColor:"rgba(255,255,255,.7)"
            }}
          />
          {query && (
            <button onClick={function(){ setQuery(""); }}
              style={{background:"none",border:"none",cursor:"pointer",color:"rgba(255,255,255,.5)",fontSize:20,padding:"2px 6px",minWidth:touch?44:undefined,minHeight:touch?44:undefined,fontFamily:"inherit"}} aria-label="Clear search">
              ×
            </button>
          )}
        </div>

        {/* Results */}
        <div style={{maxHeight:"min(480px, 60vh)",overflowY:"auto",padding:results.length > 0 ? "6px 0" : 0}}>
          {totalCount === 0 && debQ.length > 0 && (
            <div style={{textAlign:"center",padding:"32px 0",color:"rgba(255,255,255,.5)",fontSize:15}}>No results for "{debQ}"</div>
          )}
          {totalCount === 0 && debQ.length === 0 && (
            <div style={{padding:"16px 0"}}>
              <ResultSection section={{label:"Navigate", items: tabs.slice(0, 6).map(function(t){
                return { type:"tab", id:t.id, icon:t.icon, title:t.label, subtitle:null, flatIdx:0 };
              })}} selected={selected} flatItems={flatItems} onSelect={execute}/>
            </div>
          )}
          {results.map(function(sec, si) {
            if (sec.items.length === 0) return null;
            return (
              <ResultSection key={si} section={sec} selected={selected} flatItems={flatItems} onSelect={execute}/>
            );
          })}
        </div>

        {/* Keyboard hint (not on touch) */}
        {!touch && <div style={{display:"flex",gap:18,padding:"10px 20px",borderTop:"1px solid rgba(255,255,255,.06)",background:"rgba(0,0,0,.2)"}}>
          {[["↑↓","Navigate"],["↵","Select"],["Esc","Close"]].map(function(pair) {
            return (
              <div key={pair[0]} style={{display:"flex",alignItems:"center",gap:5}}>
                <span style={{fontSize:12,background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.14)",borderRadius:5,padding:"1px 7px",color:"rgba(255,255,255,.65)",fontFamily:"inherit"}}>{pair[0]}</span>
                <span style={{fontSize:13,color:"rgba(255,255,255,.5)"}}>{pair[1]}</span>
              </div>
            );
          })}
        </div>}
      </div>
    </div>
  );
}

// ─── RESULT SECTION ───────────────────────────────────────────────────────────
function ResultSection({ section, selected, flatItems, onSelect }) {
  return (
    <div>
      <div style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,.45)",letterSpacing:1.1,textTransform:"uppercase",padding:"10px 20px 6px"}}>{section.label}</div>
      {section.items.map(function(item) {
        var globalIdx = flatItems.indexOf(item);
        var isSelected = globalIdx === selected;
        return (
          <button key={item.id + (item.deckId||"")}
            onClick={function(){ onSelect(item); }}
            style={{
              display:"flex", alignItems:"center", gap:12,
              width:"100%", textAlign:"left",
              background:isSelected?"rgba(255,255,255,.09)":"transparent",
              boxShadow:isSelected?"inset 3px 0 0 #4DB6AC":"none",
              border:"none",
              padding:"10px 20px", minHeight:48,
              cursor:"pointer", fontFamily:"inherit",
              transition:"background .1s",
              outline:"none"
            }}>
            <span aria-hidden="true" style={{fontSize:18,flexShrink:0,width:24,textAlign:"center",lineHeight:1}}>{item.icon}</span>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:15,fontWeight:600,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.title}</div>
              {item.subtitle && (
                <div style={{fontSize:13,color:"rgba(255,255,255,.55)",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.subtitle}</div>
              )}
            </div>
            {isSelected && (
              <span style={{fontSize:13,color:"rgba(255,255,255,.5)",flexShrink:0}}>↵</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── BUILD RESULTS ────────────────────────────────────────────────────────────
function buildResults(query, tabs, decks, sessions) {
  var q = (query || "").toLowerCase().trim();

  // Tab matches — always show (no min char requirement)
  var tabItems = tabs.filter(function(t){
    return !q || t.label.toLowerCase().includes(q) || t.id.toLowerCase().includes(q);
  }).map(function(t){
    return { type:"tab", id:t.id, icon:t.icon, title:t.label, subtitle:"Go to " + t.label, flatIdx:0 };
  });

  // Card matches — require 2+ chars
  var cardItems = [];
  if (q.length >= 2 && decks) {
    decks.forEach(function(deck) {
      Object.values(deck.cards || {}).forEach(function(card) {
        if ((card.title || "").toLowerCase().includes(q)) {
          cardItems.push({
            type:"card", id:card.id, deckId:deck.id,
            icon:"🃏",
            title:card.title || "Untitled",
            subtitle:deck.name + " · " + (card.type || "card"),
            flatIdx:0
          });
        }
      });
    });
    cardItems = cardItems.slice(0, 10);
  }

  // Session matches — require 2+ chars
  var sessionItems = [];
  if (q.length >= 2 && sessions) {
    sessions.filter(function(s) {
      return (s.name || "").toLowerCase().includes(q);
    }).slice(0, 5).forEach(function(s) {
      sessionItems.push({
        type:"session", id:s.id,
        icon:(s.mode||"live") === "live" ? "📞" : "🎯",
        title:s.name,
        subtitle:s.deckName || "",
        flatIdx:0
      });
    });
  }

  var sections = [];
  if (tabItems.length > 0) sections.push({ label:"Navigate", items:tabItems });
  if (cardItems.length > 0) sections.push({ label:"Cards", items:cardItems });
  if (sessionItems.length > 0) sections.push({ label:"Sessions", items:sessionItems });
  return sections;
}
