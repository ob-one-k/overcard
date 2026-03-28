import { useState, useEffect } from "react";
import { SESS_COLOR } from "../lib/constants";

// ─── DESKTOP SIDEBAR ──────────────────────────────────────────────────────────
// Left sidebar navigation for desktop layout.
// Section A (top): Logo + deck indicator + save status
// Section B (mid): Tab nav items with active state, hover, session lock
// Section C (bot): User profile row + collapse toggle
export function DesktopSidebar({
  tabs, tab, onTabClick,
  deck, decks,
  authUser,
  sessionActive,
  saveStatus, saveLabel,
  serverOk,
  onOpenDeckSwitcher, onOpenProfile,
  collapsed, onToggleCollapse
}) {
  var [hovered, setHovered] = useState(null);

  var saveColor = saveStatus === "saving"
    ? "#FFD54F"
    : saveStatus === "error"
    ? "#EF5350"
    : "rgba(102,187,106,.8)";

  var saveDot = saveStatus === "saving"
    ? { animation:"savePulse 1s ease infinite" }
    : {};

  var sidebarW = collapsed ? 60 : 240;

  return (
    <div style={{
      width: sidebarW,
      minWidth: sidebarW,
      height: "100%",
      display: "flex",
      flexDirection: "column",
      background: "rgba(4,10,28,.98)",
      borderRight: "1px solid rgba(255,255,255,.06)",
      transition: "width .2s cubic-bezier(.22,1,.36,1), min-width .2s cubic-bezier(.22,1,.36,1)",
      overflow: "hidden",
      flexShrink: 0,
      zIndex: 10
    }}>

      {/* ── Section A: Logo + Deck + Save status ── */}
      <div style={{padding: collapsed ? "16px 10px 14px" : "16px 14px 14px", borderBottom:"1px solid rgba(255,255,255,.06)", flexShrink:0}}>
        {/* Logo row */}
        <div style={{display:"flex",alignItems:"center",gap:collapsed?0:9,marginBottom:12,justifyContent:collapsed?"center":"flex-start"}}>
          <div style={{width:32,height:32,borderRadius:10,background:"#1565C0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,fontWeight:900,color:"#fff",flexShrink:0}}>O</div>
          {!collapsed && <span style={{fontSize:14,fontWeight:800,color:"#fff",letterSpacing:-.3}}>OverCard</span>}
        </div>

        {/* Deck switcher pill */}
        <button
          onClick={onOpenDeckSwitcher}
          title={collapsed ? (deck ? deck.name : "Switch Deck") : undefined}
          style={{
            display:"flex", alignItems:"center", gap:collapsed?0:9,
            background:"rgba(255,255,255,.06)", border:"1px solid rgba(255,255,255,.1)",
            borderRadius:11, padding: collapsed ? "7px" : "7px 10px",
            cursor:"pointer", fontFamily:"inherit", width:"100%",
            justifyContent: collapsed ? "center" : "flex-start",
            transition:"background .12s"
          }}>
          {deck && (
            <div style={{width:24,height:24,borderRadius:7,background:deck.color+"22",border:"1.5px solid "+deck.color+"55",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,flexShrink:0}}>
              {deck.icon}
            </div>
          )}
          {!collapsed && deck && (
            <>
              <div style={{flex:1,minWidth:0,textAlign:"left"}}>
                <div style={{fontSize:12,fontWeight:700,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{deck.name}</div>
                <div style={{fontSize:9,color:"rgba(255,255,255,.28)"}}>{decks.length} deck{decks.length!==1?"s":""}</div>
              </div>
              <span style={{fontSize:9,color:"rgba(255,255,255,.25)"}}>⌄</span>
            </>
          )}
        </button>

        {/* Save status dot */}
        {!collapsed && (
          <div style={{display:"flex",alignItems:"center",gap:5,marginTop:8}}>
            <div style={Object.assign({},{width:6,height:6,borderRadius:"50%",background:saveColor,flexShrink:0},saveDot)}/>
            <span style={{fontSize:9,color:"rgba(255,255,255,.3)",letterSpacing:.3}}>{serverOk ? saveLabel : "Server offline"}</span>
          </div>
        )}
      </div>

      {/* ── Section B: Tab navigation ── */}
      <div style={{flex:1,overflowY:"auto",overflowX:"hidden",padding: collapsed ? "10px 8px" : "10px 8px"}}>
        {tabs.map(function(t) {
          var active = tab === t.id;
          var isHov  = hovered === t.id;
          var locked = sessionActive && t.id !== "play";
          var accent = t.accent;

          return (
            <button
              key={t.id}
              onClick={function(){ if (!locked) onTabClick(t.id); }}
              onMouseEnter={function(){ setHovered(t.id); }}
              onMouseLeave={function(){ setHovered(null); }}
              title={collapsed ? t.label : (locked ? "Finish your session first" : undefined)}
              style={{
                display:"flex", alignItems:"center",
                gap: collapsed ? 0 : 10,
                width:"100%", border:"none",
                borderRadius:10, padding: collapsed ? "9px 8px" : "9px 10px",
                cursor: locked ? "not-allowed" : "pointer",
                fontFamily:"inherit", textAlign:"left",
                position:"relative", marginBottom:2,
                background: active
                  ? accent + "18"
                  : isHov && !locked
                  ? "rgba(255,255,255,.05)"
                  : "transparent",
                borderLeft: active ? "3px solid " + accent : "3px solid transparent",
                opacity: locked ? 0.45 : 1,
                transition:"background .12s, opacity .12s",
                justifyContent: collapsed ? "center" : "flex-start"
              }}>
              {/* Icon */}
              <span style={{fontSize:17,flexShrink:0,lineHeight:1}}>{t.icon}</span>
              {/* Label */}
              {!collapsed && (
                <span style={{fontSize:13,fontWeight:active?700:500,color:active?accent:"rgba(255,255,255,.65)",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {t.label}
                </span>
              )}
              {/* Session active pulse on Play */}
              {t.id === "play" && sessionActive && (
                <span style={{width:7,height:7,borderRadius:"50%",background:"#A8FF3E",flexShrink:0,animation:"savePulse 1.2s ease infinite",marginLeft:collapsed?0:2}}/>
              )}
              {/* Lock icon */}
              {locked && !collapsed && (
                <span style={{fontSize:10,color:"rgba(255,255,255,.25)",flexShrink:0}}>🔒</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Section C: User profile + collapse toggle ── */}
      <div style={{borderTop:"1px solid rgba(255,255,255,.06)",padding: collapsed ? "12px 8px" : "12px 10px",flexShrink:0}}>
        {/* Profile row */}
        <button
          onClick={onOpenProfile}
          title={collapsed ? (authUser.displayName || "Profile") : undefined}
          style={{
            display:"flex", alignItems:"center",
            gap: collapsed ? 0 : 9,
            width:"100%", background:"none", border:"none",
            borderRadius:10, padding: collapsed ? "7px" : "7px 6px",
            cursor:"pointer", fontFamily:"inherit", textAlign:"left",
            transition:"background .12s",
            justifyContent: collapsed ? "center" : "flex-start"
          }}>
          {/* Avatar */}
          <div style={{
            width:32, height:32, borderRadius:"50%",
            background: authUser.role==="admin" ? "rgba(168,255,62,.15)" : "rgba(255,255,255,.08)",
            border:"1px solid "+(authUser.role==="admin"?"rgba(168,255,62,.35)":"rgba(255,255,255,.15)"),
            display:"flex",alignItems:"center",justifyContent:"center",
            fontSize:13,fontWeight:700,
            color: authUser.role==="admin" ? SESS_COLOR : "rgba(255,255,255,.82)",
            flexShrink:0
          }}>
            {authUser.displayName ? authUser.displayName[0].toUpperCase() : "?"}
          </div>
          {!collapsed && (
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:12,fontWeight:600,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {authUser.displayName || authUser.email}
              </div>
              <div style={{fontSize:9,color:"rgba(255,255,255,.3)",textTransform:"capitalize"}}>{authUser.role}</div>
            </div>
          )}
        </button>

        {/* Collapse toggle */}
        <button
          onClick={onToggleCollapse}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          style={{
            display:"flex",alignItems:"center",justifyContent:"center",
            width:"100%",background:"none",border:"none",
            borderRadius:8,padding:"6px",marginTop:4,
            cursor:"pointer",color:"rgba(255,255,255,.25)",fontSize:13,
            fontFamily:"inherit",transition:"background .12s"
          }}>
          {collapsed ? "›" : "‹"}
        </button>
      </div>
    </div>
  );
}
