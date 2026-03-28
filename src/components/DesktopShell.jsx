import { useState, useEffect } from "react";
import { DesktopSidebar } from "./DesktopSidebar";
import { SESS_COLOR } from "../lib/constants";

// ─── DESKTOP SHELL ────────────────────────────────────────────────────────────
// Root layout wrapper for desktop. Renders the sidebar + top bar + content area.
// Children = the shared tab content (same components as mobile, just different wrapper).
export function DesktopShell({
  tabs, tab, onTabClick,
  deck, decks,
  authUser,
  sessionActive,
  saveStatus, saveLabel, saveColor,
  serverOk,
  onOpenDeckSwitcher, onOpenProfile,
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

  // Keyboard shortcuts: 1–N to switch tabs (skip when typing in inputs)
  useEffect(function() {
    function onKey(e) {
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
  }, [tabs, onTabClick]);

  var tabAccentMap = {};
  tabs.forEach(function(t) { tabAccentMap[t.id] = t.accent; });
  var tabAccent = tabAccentMap[tab] || "#4DB6AC";
  var activeTab = tabs.find(function(t) { return t.id === tab; });

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
          height:52, flexShrink:0,
          borderBottom:"1px solid rgba(255,255,255,.06)",
          background:"rgba(8,25,55,.35)",
          backdropFilter:"blur(16px)",
          display:"flex",alignItems:"center",
          padding:"0 20px",
          gap:12
        }}>
          {/* Tab accent bar */}
          <div style={{width:3,height:24,borderRadius:99,background:tabAccent,flexShrink:0}}/>

          {/* Tab title */}
          <div style={{
            fontSize:15,fontWeight:700,
            color:"rgba(255,255,255,.85)",
            flex:1,minWidth:0
          }}>
            {activeTab ? activeTab.label : ""}
          </div>

          {/* Server offline badge */}
          {!serverOk && (
            <div style={{
              background:"rgba(239,83,80,.14)",
              border:"1px solid rgba(239,83,80,.25)",
              borderRadius:99, padding:"3px 10px",
              fontSize:10, color:"#EF5350",
              whiteSpace:"nowrap"
            }}>
              ⚠ API unreachable
            </div>
          )}

          {/* Save status */}
          <div style={{display:"flex",alignItems:"center",gap:5,flexShrink:0}}>
            <div style={{
              width:6,height:6,borderRadius:"50%",
              background:saveColor,
              animation:saveStatus==="saving"?"savePulse 1s ease infinite":undefined
            }}/>
            <span style={{fontSize:10,color:"rgba(255,255,255,.28)",letterSpacing:.3}}>{saveLabel}</span>
          </div>

          {/* Profile avatar button */}
          <button
            onClick={onOpenProfile}
            style={{
              width:32,height:32,borderRadius:"50%",
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

        {/* Content area — tab panes live here */}
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minHeight:0}}>
          {children}
        </div>
      </div>
    </div>
  );
}
