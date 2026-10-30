import { useState, useEffect, useContext } from "react";
import { DesktopSidebar } from "./DesktopSidebar";
import DesktopCtx from "../lib/DesktopCtx";
import { isAdminRole, roleMeta, SESS_COLOR, accentA } from "../lib/constants";
import { lsGet, lsSet } from "../lib/api";
import { dividerV } from "../lib/styles";
import { NotificationBell } from "./NotificationBell";
import { OrgMark } from "./OrgMark";

// ─── DESKTOP SHELL ────────────────────────────────────────────────────────────
// Root layout wrapper for desktop. Renders the sidebar + top bar + content area.
// Top bar is tab-aware: shows tab icon + title, context zone, ⌘K, save status, profile.
// Tablet (desktop.compact): 72px icon rail + ☰ drawer, a tighter top bar with
// 44px touch targets, and an icon-only search button.
export function DesktopShell({
  tabs, tab, onTabClick,
  deck, decks,
  authUser,
  sessionActive,
  saveStatus, saveLabel, saveColor,
  serverOk,
  onOpenDeckSwitcher, onOpenProfile,
  onOpenCommandPalette,
  onOpenSession,
  tabContextData,
  children
}) {
  var desktop = useContext(DesktopCtx);
  var compact = !!desktop.compact;
  var touch   = !!desktop.isTouchPrimary;
  var [collapsed, setCollapsed] = useState(function() {
    return lsGet("overcard_sidebar_collapsed") === "true";
  });

  function toggleCollapse() {
    var next = !collapsed;
    setCollapsed(next);
    lsSet("overcard_sidebar_collapsed", next ? "true" : "false");
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
      // Tab 1–N shortcuts: skip when typing, and during a session (digits pick answers then)
      var tag = e.target && e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.target && e.target.isContentEditable) return;
      if (sessionActive) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var idx = parseInt(e.key, 10);
      if (idx >= 1 && idx <= tabs.length) {
        onTabClick(tabs[idx - 1].id);
      }
    }
    document.addEventListener("keydown", onKey);
    return function() { document.removeEventListener("keydown", onKey); };
  }, [tabs, onTabClick, onOpenCommandPalette, sessionActive]);

  var tabAccentMap = {};
  tabs.forEach(function(t) { tabAccentMap[t.id] = t.accent; });
  var tabAccent  = tabAccentMap[tab] || "#4DB6AC";
  var activeTab  = tabs.find(function(t) { return t.id === tab; });
  var isMac      = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  var cmdLabel   = isMac ? "⌘K" : "Ctrl+K";
  var ctx        = tabContextData || {};
  var isAdmin    = isAdminRole(authUser.role);
  var rm         = roleMeta(authUser.role);
  var metaSt     = {fontSize:compact?12:13,color:"rgba(255,255,255,.55)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"};

  // ── Tab-aware context zone content ──────────────────────────────────────────
  function renderContextZone() {
    var d = ctx[tab] || {};

    if (tab === "play") {
      if (sessionActive && d.sessionName) {
        return (
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:SESS_COLOR,animation:"savePulse 1.2s ease infinite",flexShrink:0}}/>
            <span style={{fontSize:compact?14:15,fontWeight:700,color:SESS_COLOR,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:compact?260:420}}>{d.sessionName}</span>
            {d.startTs && <ElapsedTimer startTs={d.startTs}/>}
          </div>
        );
      }
      if (deck) {
        return (
          <span style={metaSt}>
            {Object.keys(deck.cards||{}).length} cards · {(deck.objStacks||[]).filter(function(st){ return !st.archivedAt; }).length} stacks
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
        <span style={metaSt}>
          {cc} card{cc!==1?"s":""}{ic != null ? " · " + ic + " intended" : ""}
        </span>
      );
    }

    if (tab === "objections") {
      var sc = d.stackCount != null ? d.stackCount : (deck ? (deck.objStacks||[]).filter(function(st){ return !st.archivedAt; }).length : null);
      var hc = d.healthyCount;
      if (sc == null) return null;
      return (
        <span style={metaSt}>
          {sc} stack{sc!==1?"s":""}
          {hc != null ? " · " + hc + " configured" : ""}
        </span>
      );
    }

    if (tab === "sessions") {
      var fc = d.filteredCount;
      if (fc != null) {
        return <span style={metaSt}>{fc} session{fc!==1?"s":""}</span>;
      }
      return null;
    }

    if (tab === "home") {
      if (d.sessions != null) {
        return (
          <span style={metaSt}>
            {d.sessions} session{d.sessions!==1?"s":""}
            {d.closeRate != null ? " · " + d.closeRate + "% close" : ""}
          </span>
        );
      }
      return null;
    }

    if (tab === "admin") {
      return <span style={metaSt}>Users, teams and organisation settings</span>;
    }

    return null;
  }

  return (
    <div style={{
      // Tracks the visible viewport so a tablet keyboard never covers the editor
      position:"fixed", left:0, right:0, top:"var(--vvt, 0px)", height:"var(--vvh, 100%)",
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
        compact={compact}
        touch={touch}
      />

      {/* ── Main content area ── */}
      <div data-noscroll="1" style={{flex:1,display:"flex",flexDirection:"column",minWidth:0,overflow:"hidden"}}>

        {/* Top bar */}
        <div style={{
          height:compact?56:60, flexShrink:0,
          borderBottom:"1px solid rgba(255,255,255,.07)",
          background:"rgba(8,25,55,.35)",
          backdropFilter:"blur(16px)",
          display:"flex", alignItems:"center",
          padding:compact?"0 12px 0 14px":"0 20px 0 22px",
          gap:compact?10:14
        }}>
          {/* Collapsed desktop sidebar hides the org name — keep the mark beside the title */}
          {collapsed && !compact && <OrgMark authUser={authUser} size={24}/>}
          {/* Tab accent bar */}
          <div style={{width:4,height:compact?22:26,borderRadius:99,background:tabAccent,flexShrink:0}}/>

          {/* Tab icon + title */}
          {activeTab && (
            <div style={{display:"flex",alignItems:"center",gap:9,flexShrink:0}}>
              <span aria-hidden="true" style={{fontSize:compact?18:20,lineHeight:1}}>{activeTab.icon}</span>
              <h1 style={{margin:0,fontSize:compact?18:21,fontWeight:700,color:"#fff",letterSpacing:-.2}}>{activeTab.label}</h1>
            </div>
          )}

          {/* Context zone — tab-aware info */}
          <div style={{flex:1,minWidth:0,overflow:"hidden",paddingLeft:6,borderLeft:"1px solid rgba(255,255,255,.1)",marginLeft:4,display:"flex",alignItems:"center",minHeight:24}}>
            {renderContextZone()}
          </div>

          {/* Server offline badge */}
          {!serverOk && (
            <div style={{
              background:"rgba(239,83,80,.14)",
              border:"1px solid rgba(239,83,80,.25)",
              borderRadius:99, padding:"4px 11px",
              fontSize:13, fontWeight:600, color:"#EF5350",
              whiteSpace:"nowrap", flexShrink:0
            }}>
              ⚠ offline
            </div>
          )}

          {/* ⌘K command palette trigger — icon-only 44px button on tablet */}
          {onOpenCommandPalette && compact && (
            <button
              onClick={onOpenCommandPalette}
              title="Search tabs, cards and sessions"
              aria-label="Search tabs, cards and sessions"
              style={{
                width:44, height:44, flexShrink:0,
                background:"rgba(255,255,255,.06)",
                border:"1px solid rgba(255,255,255,.1)",
                borderRadius:12, cursor:"pointer",
                color:"rgba(255,255,255,.7)", fontSize:18,
                display:"flex", alignItems:"center", justifyContent:"center",
                fontFamily:"inherit"
              }}>
              <span aria-hidden="true">⌕</span>
            </button>
          )}
          {onOpenCommandPalette && !compact && (
            <button
              onClick={onOpenCommandPalette}
              title="Search tabs, cards and sessions"
              style={{
                background:"rgba(255,255,255,.06)",
                border:"1px solid rgba(255,255,255,.1)",
                borderRadius:10, padding:"7px 10px 7px 13px",
                cursor:"pointer", fontSize:13,
                color:"rgba(255,255,255,.55)",
                display:"flex", alignItems:"center", gap:10, minWidth:220,
                fontFamily:"inherit", flexShrink:0
              }}>
              <span aria-hidden="true" style={{fontSize:14}}>⌕</span>
              <span style={{flex:1,textAlign:"left"}}>Search…</span>
              <span style={{fontSize:11,fontWeight:600,border:"1px solid rgba(255,255,255,.16)",borderRadius:6,padding:"2px 7px",color:"rgba(255,255,255,.55)"}}>{cmdLabel}</span>
            </button>
          )}

          {/* Divider */}
          {!compact && <div style={dividerV(24)}/>}

          {/* Save status */}
          <div role="status" style={{display:"flex",alignItems:"center",gap:7,flexShrink:0}}>
            <div style={{
              width:8,height:8,borderRadius:"50%",
              background:saveColor,
              animation:saveStatus==="saving"?"savePulse 1s ease infinite":undefined
            }}/>
            <span style={{fontSize:compact?12:13,color:"rgba(255,255,255,.55)"}}>{saveLabel}</span>
          </div>

          <NotificationBell onOpenSession={onOpenSession} size={compact ? "lg" : undefined}/>

          {/* Profile avatar */}
          <button
            onClick={onOpenProfile}
            title={(authUser.displayName || "Profile") + " · " + rm.label}
            aria-label="Open profile"
            style={{
              width:compact?44:36,height:compact?44:36,borderRadius:"50%",
              background:isAdmin?rm.bg:"rgba(255,255,255,.07)",
              border:"1.5px solid "+(isAdmin?rm.border:"rgba(255,255,255,.14)"),
              display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:14,fontWeight:700,cursor:"pointer",
              color:isAdmin?rm.color:"rgba(255,255,255,.85)",
              fontFamily:"inherit",flexShrink:0
            }}>
            {authUser.displayName ? authUser.displayName[0].toUpperCase() : "?"}
          </button>
        </div>

        {/* Content area */}
        <div data-noscroll="1" style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minHeight:0}}>
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
    <span style={{fontSize:13,fontWeight:600,color:accentA(.85),fontFeatureSettings:'"tnum"',letterSpacing:.5,background:accentA(.1),borderRadius:99,padding:"2px 9px",flexShrink:0}}>
      {str}
    </span>
  );
}
