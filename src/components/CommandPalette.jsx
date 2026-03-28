import { useState, useEffect, useRef } from "react";
import { apiGet } from "../lib/api";
import { inputSt } from "../lib/styles";

// ─── COMMAND PALETTE ──────────────────────────────────────────────────────────
// Global ⌘K search palette for desktop.
// Searches: tabs, cards (from all decks), sessions.
// Props: tabs, decks, onNavigateTab, onSwitchDeck, onClose
export function CommandPalette({ tabs, decks, onNavigateTab, onSwitchDeck, onClose }) {
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

  // Load sessions on mount (for search)
  useEffect(function() {
    apiGet("/sessions").then(function(data){
      setSessions(Array.isArray(data) ? data : []);
    }).catch(function(){ setSessions([]); });
  }, []);

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
        paddingTop:"13vh"
      }}>
      <div style={{
        width:560, maxWidth:"90vw",
        background:"#0a1830",
        border:"1px solid rgba(255,255,255,.12)",
        borderRadius:16,
        boxShadow:"0 32px 96px rgba(0,0,0,.9)",
        overflow:"hidden",
        animation:"modalIn .12s ease both"
      }}>
        {/* Search input */}
        <div style={{display:"flex",alignItems:"center",gap:12,padding:"14px 18px",borderBottom:"1px solid rgba(255,255,255,.08)"}}>
          <span style={{fontSize:16,color:"rgba(255,255,255,.25)",flexShrink:0}}>⌘</span>
          <input
            ref={inputRef}
            value={query}
            onChange={function(e){ setQuery(e.target.value); }}
            onKeyDown={handleKeyDown}
            placeholder="Search tabs, cards, sessions…"
            style={{
              flex:1, background:"none", border:"none", outline:"none",
              fontSize:16, color:"#fff", fontFamily:"inherit",
              caretColor:"rgba(255,255,255,.7)"
            }}
          />
          {query && (
            <button onClick={function(){ setQuery(""); }}
              style={{background:"none",border:"none",cursor:"pointer",color:"rgba(255,255,255,.3)",fontSize:16,padding:"2px 6px",fontFamily:"inherit"}}>
              ×
            </button>
          )}
        </div>

        {/* Results */}
        <div style={{maxHeight:380,overflowY:"auto",padding:results.length > 0 ? "6px 0" : 0}}>
          {totalCount === 0 && debQ.length > 0 && (
            <div style={{textAlign:"center",padding:"28px 0",color:"rgba(255,255,255,.25)",fontSize:13}}>No results for "{debQ}"</div>
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

        {/* Keyboard hint */}
        <div style={{display:"flex",gap:14,padding:"8px 18px",borderTop:"1px solid rgba(255,255,255,.06)",background:"rgba(0,0,0,.2)"}}>
          {[["↑↓","Navigate"],["↵","Select"],["Esc","Close"]].map(function(pair) {
            return (
              <div key={pair[0]} style={{display:"flex",alignItems:"center",gap:5}}>
                <span style={{fontSize:10,background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.12)",borderRadius:5,padding:"1px 6px",color:"rgba(255,255,255,.5)",fontFamily:"inherit"}}>{pair[0]}</span>
                <span style={{fontSize:10,color:"rgba(255,255,255,.25)"}}>{pair[1]}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── RESULT SECTION ───────────────────────────────────────────────────────────
function ResultSection({ section, selected, flatItems, onSelect }) {
  return (
    <div>
      <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,.3)",letterSpacing:1.2,textTransform:"uppercase",padding:"7px 18px 4px"}}>{section.label}</div>
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
              border:"none",
              padding:"9px 18px",
              cursor:"pointer", fontFamily:"inherit",
              transition:"background .1s",
              outline:"none"
            }}>
            <span style={{fontSize:16,flexShrink:0,width:22,textAlign:"center",lineHeight:1}}>{item.icon}</span>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:600,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.title}</div>
              {item.subtitle && (
                <div style={{fontSize:10,color:"rgba(255,255,255,.35)",marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.subtitle}</div>
              )}
            </div>
            {isSelected && (
              <span style={{fontSize:10,color:"rgba(255,255,255,.3)",flexShrink:0}}>↵</span>
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
