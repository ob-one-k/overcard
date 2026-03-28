import { useState, useEffect } from "react";
import { DesktopSidebar } from "./DesktopSidebar";
import { SESS_COLOR } from "../lib/constants";
import { dividerV } from "../lib/styles";

// ─── DESKTOP SHELL ────────────────────────────────────────────────────────────
// Root layout wrapper for desktop. Renders the sidebar + top bar + content area.
// Top bar is tab-aware: shows tab icon + title, context zone, ⌘K, save status, profile.
export function DesktopShell({
  tabs, tab, onTabClick,
  deck, decks,
  authUser,
  sessionActive,
  saveStatus, saveLabel, saveColor,
  serverOk,
  onOpenDeckSwitcher, onOpenProfile,
  onOpenCommandPalette,
  tabContextData,
  children
}) {
  var [collapsed, setCollapsed] = useState(function() {
    return localStorage.getItem("overcard_sidebar_collapsed") === "true";
  });

  function toggleCollapse() {
    var next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("overcard_sidebar_collapsed", next ? "true" : "false");
  }

  // Keyboard shortcuts
  useEffect(function() {
    function onKey(e) {
      // ⌘K / Ctrl+K — fires even from inputs
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (onOpenCommandPalette) onOpenCommandPalette();
        return;
      }
      // Tab 1–N shortcuts: skip when typing
      var tag = e.target && e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var idx = parseInt(e.key, 10);
      if (idx >= 1 && idx <= tabs.length) {
        onTabClick(tabs[idx - 1].id);
      }
    }
    document.addEventListener("keydown", onKey);
    return function() { document.removeEventListener("keydown", onKey); };
  }, [tabs, onTabClick, onOpenCommandPalette]);

  var tabAccentMap = {};
  tabs.forEach(function(t) { tabAccentMap[t.id] = t.accent; });
  var tabAccent  = tabAccentMap[tab] || "#4DB6AC";
  var activeTab  = tabs.find(function(t) { return t.id === tab; });
  var isMac      = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  var cmdLabel   = isMac ? "⌘K" : "Ctrl+K";
  var ctx        = tabContextData || {};

  // ── Tab-aware context zone content ──────────────────────────────────────────
  function renderContextZone() {
    var d = ctx[tab] || {};

    if (tab === "play") {
      if (sessionActive && d.sessionName) {
        return (
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:"#A8FF3E",animation:"savePulse 1.2s ease infinite",flexShrink:0}}/>
            <span style={{fontSize:11,fontWeight:700,color:"#A8FF3E",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:240}}>{d.sessionName}</span>
            {d.startTs && <ElapsedTimer startTs={d.startTs}/>}
          </div>
        );
      }
      if (deck) {
        return (
          <span style={{fontSize:11,color:"rgba(255,255,255,.3)"}}>
            {Object.keys(deck.cards||{}).length} cards · {(deck.objStacks||[]).length} stacks
          </span>
        );
      }
      return null;
    }

    if (tab === "cards") {
      var cc = d.cardCount != null ? d.cardCount : (deck ? Object.keys(deck.cards||{}).length : null);
      var ic = d.intendedCount;
      if (cc == null) return null;
      return (
        <span style={{fontSize:11,color:"rgba(255,255,255,.3)"}}>
          {cc} card{cc!==1?"s":""}{ic != null ? " · " + ic + " intended" : ""}
        </span>
      );
    }

    if (tab === "objections") {
      var sc = d.stackCount != null ? d.stackCount : (deck ? (deck.objStacks||[]).length : null);
      var hc = d.healthyCount;
      if (sc == null) return null;
      return (
        <span style={{fontSize:11,color:"rgba(255,255,255,.3)"}}>
          {sc} stack{sc!==1?"s":""}
          {hc != null ? " · " + hc + " configured" : ""}
        </span>
      );
    }

    if (tab === "sessions") {
      var fc = d.filteredCount;
      if (fc != null) {
        return <span style={{fontSize:11,color:"rgba(255,255,255,.3)"}}>{fc} session{fc!==1?"s":""}</span>;
      }
      return null;
    }

    if (tab === "home") {
      if (d.sessions != null) {
        return (
          <span style={{fontSize:11,color:"rgba(255,255,255,.3)"}}>
            {d.sessions} session{d.sessions!==1?"s":""}
            {d.closeRate != null ? " · " + d.closeRate + "% close" : ""}
          </span>
        );
      }
      return null;
    }

    if (tab === "admin") {
      return <span style={{fontSize:11,color:"rgba(168,255,62,.25)",fontWeight:600,letterSpacing:.5}}>Admin Panel</span>;
    }

    return null;
  }

  return (
    <div style={{
      position:"fixed", inset:0,
      display:"flex", flexDirection:"row",
      background:"linear-gradient(180deg, #060d1a 0%, #071025 50%, #060d1a 100%)"
    }}>
      {/* ── Sidebar ── */}
      <DesktopSidebar
        tabs={tabs}
        tab={tab}
        onTabClick={onTabClick}
        deck={deck}
        decks={decks}
        authUser={authUser}
        sessionActive={sessionActive}
        saveStatus={saveStatus}
        saveLabel={saveLabel}
        serverOk={serverOk}
        onOpenDeckSwitcher={onOpenDeckSwitcher}
        onOpenProfile={onOpenProfile}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
      />

      {/* ── Main content area ── */}
      <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0,overflow:"hidden"}}>

        {/* Top bar */}
        <div style={{
          height:48, flexShrink:0,
          borderBottom:"1px solid rgba(255,255,255,.06)",
          background:"rgba(8,25,55,.35)",
          backdropFilter:"blur(16px)",
          display:"flex", alignItems:"center",
          padding:"0 16px",
          gap:10
        }}>
          {/* Tab accent bar */}
          <div style={{width:3,height:22,borderRadius:99,background:tabAccent,flexShrink:0}}/>

          {/* Tab icon + title */}
          {activeTab && (
            <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
              <span style={{fontSize:14,lineHeight:1}}>{activeTab.icon}</span>
              <span style={{fontSize:14,fontWeight:700,color:"rgba(255,255,255,.85)"}}>{activeTab.label}</span>
            </div>
          )}

          {/* Context zone — tab-aware info */}
          <div style={{flex:1,minWidth:0,overflow:"hidden",paddingLeft:4}}>
            {renderContextZone()}
          </div>

          {/* Server offline badge */}
          {!serverOk && (
            <div style={{
              background:"rgba(239,83,80,.14)",
              border:"1px solid rgba(239,83,80,.25)",
              borderRadius:99, padding:"3px 9px",
              fontSize:10, color:"#EF5350",
              whiteSpace:"nowrap", flexShrink:0
            }}>
              ⚠ offline
            </div>
          )}

          {/* ⌘K command palette trigger */}
          {onOpenCommandPalette && (
            <button
              onClick={onOpenCommandPalette}
              style={{
                background:"rgba(255,255,255,.06)",
                border:"1px solid rgba(255,255,255,.1)",
                borderRadius:8, padding:"4px 10px",
                cursor:"pointer", fontSize:11,
                color:"rgba(255,255,255,.35)",
                display:"flex", alignItems:"center", gap:5,
                fontFamily:"inherit", flexShrink:0
              }}>
              <span style={{fontSize:12}}>⌘</span>
              <span>{cmdLabel}</span>
            </button>
          )}

          {/* Divider */}
          <div style={dividerV(18)}/>

          {/* Save status */}
          <div style={{display:"flex",alignItems:"center",gap:5,flexShrink:0}}>
            <div style={{
              width:6,height:6,borderRadius:"50%",
              background:saveColor,
              animation:saveStatus==="saving"?"savePulse 1s ease infinite":undefined
            }}/>
            <span style={{fontSize:10,color:"rgba(255,255,255,.25)",letterSpacing:.3}}>{saveLabel}</span>
          </div>

          {/* Profile avatar */}
          <button
            onClick={onOpenProfile}
            style={{
              width:30,height:30,borderRadius:"50%",
              background:authUser.role==="admin"?"rgba(168,255,62,.12)":"rgba(255,255,255,.07)",
              border:"1px solid "+(authUser.role==="admin"?"rgba(168,255,62,.3)":"rgba(255,255,255,.12)"),
              display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:12,fontWeight:700,cursor:"pointer",
              color:authUser.role==="admin"?SESS_COLOR:"rgba(255,255,255,.82)",
              fontFamily:"inherit",flexShrink:0
            }}>
            {authUser.displayName ? authUser.displayName[0].toUpperCase() : "?"}
          </button>
        </div>

        {/* Content area */}
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minHeight:0}}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ─── ELAPSED TIMER ────────────────────────────────────────────────────────────
// Small inline chip showing MM:SS elapsed since startTs
function ElapsedTimer({ startTs }) {
  var [elapsed, setElapsed] = useState(function(){ return Math.floor((Date.now() - startTs) / 1000); });
  useEffect(function() {
    var interval = setInterval(function() {
      setElapsed(Math.floor((Date.now() - startTs) / 1000));
    }, 1000);
    return function() { clearInterval(interval); };
  }, [startTs]);
  var mm = Math.floor(elapsed / 60);
  var ss = elapsed % 60;
  var str = mm + ":" + (ss < 10 ? "0" : "") + ss;
  return (
    <span style={{fontSize:10,color:"rgba(168,255,62,.6)",fontFeatureSettings:'"tnum"',letterSpacing:.5,background:"rgba(168,255,62,.08)",borderRadius:99,padding:"2px 7px",flexShrink:0}}>
      {str}
    </span>
  );
}
