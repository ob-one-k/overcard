import { useState, useEffect, useRef } from "react";
import { isAdminRole, roleMeta, SESS_COLOR, accentA, themed } from "../lib/constants";
import { OrgMark } from "./OrgMark";
import { useSlidingIndicator } from "../lib/useSlidingIndicator";
import { TabIcon } from "./TabIcons";

// Tab list with one org-accent highlight that slides between the rows
function SlideList({ activeKey, collapsed, children }) {
  var ref = useRef(null);
  var ind = useSlidingIndicator(ref, activeKey, [collapsed]);
  return (
    <div ref={ref} style={{position:"relative"}}>
      {ind.style && <div aria-hidden="true" style={Object.assign({}, ind.style, {borderRadius:10,background:accentA(.13),border:"1.5px solid "+accentA(.6),boxSizing:"border-box"})}/>}
      {children}
    </div>
  );
}

// ─── DESKTOP SIDEBAR ──────────────────────────────────────────────────────────
// Left sidebar navigation for desktop layout.
// Section A (top): Logo + deck switcher + save status
// Section B (mid): Tab nav items with active state, hover, keyboard hint, session lock
// Section C (bot): User block (avatar, name, role badge) + collapse toggle
//
// Tablet (compact): always a 72px icon rail. A ☰ button at the top opens a
// slide-over drawer with the full labelled navigation. No hover-only
// affordances on touch; every control is >= 44px.
export function DesktopSidebar({
  tabs, tab, onTabClick,
  deck, decks,
  authUser,
  sessionActive,
  saveStatus, saveLabel,
  serverOk,
  onOpenDeckSwitcher, onOpenProfile,
  collapsed, onToggleCollapse,
  compact, touch
}) {
  var [hovered,    setHovered]    = useState(null);
  var [drawerOpen, setDrawerOpen] = useState(false);

  // Close the drawer with Escape; also drop it if we leave tablet mode
  useEffect(function() {
    if (!drawerOpen) return;
    function onKey(e) { if (e.key === "Escape") setDrawerOpen(false); }
    document.addEventListener("keydown", onKey);
    return function() { document.removeEventListener("keydown", onKey); };
  }, [drawerOpen]);
  useEffect(function() { if (!compact) setDrawerOpen(false); }, [compact]);

  var saveColor = !serverOk
    ? "#EF5350"
    : saveStatus === "saving"
    ? "#FFD54F"
    : saveStatus === "error"
    ? "#EF5350"
    : "rgba(102,187,106,.9)";

  var saveDot = saveStatus === "saving"
    ? { animation:"savePulse 1s ease infinite" }
    : {};

  var role     = authUser.role;
  var rm       = roleMeta(role);
  var isAdmin  = isAdminRole(role);
  var deckCount = (decks || []).length;

  // ── Nav body ────────────────────────────────────────────────────────────────
  // mode: "desktop" (collapsible sidebar), "rail" (tablet icon rail),
  //       "drawer" (tablet slide-over with labels)
  function renderNav(isCollapsed, mode) {
    var inDrawer = mode === "drawer";
    var isRail   = mode === "rail";
    var hoverOk  = !touch;                 // hover affordances only with a mouse
    var showKeys = !touch && !compact;     // 1–N shortcut hints are a desktop thing
    function after(fn) {
      return function() { if (inDrawer) setDrawerOpen(false); if (fn) fn(); };
    }

    return (
      <>
        {/* ── Section A: Logo + Deck switcher + Save status ── */}
        <div style={{padding: isCollapsed ? "16px 12px 14px" : "18px 16px 16px", borderBottom:"1px solid rgba(255,255,255,.07)", flexShrink:0}}>
          {/* Logo row (tablet rail/drawer: ☰ / ✕ toggle) */}
          <div style={{display:"flex",alignItems:"center",gap:isCollapsed?0:11,marginBottom:isRail?12:16,justifyContent:isCollapsed?"center":"flex-start"}}>
            {isRail ? (
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10}}>
              <OrgMark authUser={authUser} size={32}/>
              <button
                onClick={function(){ setDrawerOpen(true); }}
                aria-label="Open navigation menu"
                aria-expanded={drawerOpen}
                style={{width:44,height:44,borderRadius:12,background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.12)",color:"#fff",fontSize:20,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>
                <span aria-hidden="true">☰</span>
              </button>
              </div>
            ) : (
              <>
                <OrgMark authUser={authUser} size={36}/>
                {!isCollapsed && <span title={authUser.orgName || "OverCard"} style={{fontSize:18,fontWeight:800,color:"#fff",letterSpacing:-.3,flex:inDrawer?1:undefined,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{authUser.orgName || "OverCard"}</span>}
                {inDrawer && (
                  <button
                    onClick={function(){ setDrawerOpen(false); }}
                    aria-label="Close navigation menu"
                    style={{width:44,height:44,borderRadius:12,background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.12)",color:"rgba(255,255,255,.8)",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>
                    <span aria-hidden="true">✕</span>
                  </button>
                )}
              </>
            )}
          </div>

          {/* Deck switcher */}
          {!isCollapsed && (
            <div style={{fontSize:12,fontWeight:700,letterSpacing:1.1,textTransform:"uppercase",color:"rgba(255,255,255,.45)",marginBottom:7,paddingLeft:2}}>Active deck</div>
          )}
          <button
            onClick={after(onOpenDeckSwitcher)}
            title={isCollapsed ? (deck ? deck.name + " — switch deck" : "Switch deck") : "Switch deck"}
            aria-label={deck ? "Active deck: " + deck.name + ". Switch deck" : "Switch deck"}
            style={{
              display:"flex", alignItems:"center", gap:isCollapsed?0:11,
              background:"rgba(255,255,255,.06)", border:"1px solid " + (deck ? deck.color + "40" : "rgba(255,255,255,.12)"),
              borderRadius:12, padding: isCollapsed ? "8px" : "10px 12px",
              minHeight: compact ? 48 : undefined,
              cursor:"pointer", fontFamily:"inherit", width:"100%",
              justifyContent: isCollapsed ? "center" : "flex-start",
              transition:"background .12s"
            }}>
            {deck && (
              <div style={{width:32,height:32,borderRadius:9,background:deck.color+"22",border:"1.5px solid "+deck.color+"66",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,flexShrink:0}}>
                {deck.icon}
              </div>
            )}
            {!isCollapsed && deck && (
              <>
                <div style={{flex:1,minWidth:0,textAlign:"left"}}>
                  <div style={{fontSize:14,fontWeight:700,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{deck.name}</div>
                  <div style={{fontSize:12,color:"rgba(255,255,255,.5)",marginTop:1}}>{deckCount} deck{deckCount!==1?"s":""} available</div>
                </div>
                <span aria-hidden="true" style={{fontSize:14,color:"rgba(255,255,255,.45)"}}>⇅</span>
              </>
            )}
          </button>

          {/* Save status */}
          {!isCollapsed && (
            <div role="status" style={{display:"flex",alignItems:"center",gap:7,marginTop:11,paddingLeft:2}}>
              <div style={Object.assign({},{width:7,height:7,borderRadius:"50%",background:saveColor,flexShrink:0},saveDot)}/>
              <span style={{fontSize:12,color:"rgba(255,255,255,.5)"}}>{serverOk ? saveLabel : "Server offline"}</span>
            </div>
          )}
        </div>

        {/* ── Section B: Tab navigation ── */}
        <div style={{flex:1,overflowY:"auto",overflowX:"hidden",padding: isCollapsed ? "12px 10px" : "14px 12px"}}>
          {!isCollapsed && (
            <div style={{fontSize:12,fontWeight:700,letterSpacing:1.1,textTransform:"uppercase",color:"rgba(255,255,255,.45)",margin:"0 0 8px 6px"}}>Navigate</div>
          )}
          <SlideList activeKey={tab} collapsed={isCollapsed}>
          {tabs.map(function(t, idx) {
            var active = tab === t.id;
            var isHov  = hoverOk && hovered === t.id;
            var locked = sessionActive && t.id !== "play";

            return (
              <button
                key={t.id}
                data-tab={t.id}
                onClick={function(){ if (!locked) { onTabClick(t.id); if (inDrawer) setDrawerOpen(false); } }}
                onMouseEnter={hoverOk ? function(){ setHovered(t.id); } : undefined}
                onMouseLeave={hoverOk ? function(){ setHovered(null); } : undefined}
                aria-current={active ? "page" : undefined}
                aria-disabled={locked || undefined}
                aria-label={isCollapsed ? t.label + (locked ? " (finish your session first)" : "") : undefined}
                title={locked ? "Finish your session first" : (isCollapsed ? t.label + (showKeys ? " (" + (idx + 1) + ")" : "") : undefined)}
                style={{
                  display:"flex", alignItems:"center",
                  gap: isCollapsed ? 0 : 12,
                  width:"100%", minHeight: compact ? 50 : 44,
                  border:"none",
                  borderRadius:10, padding: isCollapsed ? "10px 8px" : "10px 12px",
                  cursor: locked ? "not-allowed" : "pointer",
                  fontFamily:"inherit", textAlign:"left",
                  position:"relative", zIndex:1, marginBottom: compact ? 4 : 3,
                  // The active highlight is the sliding indicator behind the rows
                  background: !active && isHov && !locked ? "rgba(255,255,255,.06)" : "transparent",
                  opacity: locked ? 0.45 : 1,
                  transition:"background .12s, opacity .12s",
                  justifyContent: isCollapsed ? "center" : "flex-start"
                }}>
                <span aria-hidden="true" style={{flexShrink:0,width:22,display:"flex",justifyContent:"center",color:active?SESS_COLOR:"rgba(255,255,255,.6)",transition:"color .25s"}}><TabIcon id={t.id} size={compact?22:20}/></span>
                {!isCollapsed && (
                  <span style={{fontSize:15,fontWeight:active?700:500,color:active?SESS_COLOR:"rgba(255,255,255,.78)",transition:"color .25s",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {t.label}
                  </span>
                )}
                {t.id === "play" && sessionActive && (
                  <span aria-label="Session in progress" style={{width:8,height:8,borderRadius:"50%",background:SESS_COLOR,flexShrink:0,animation:"savePulse 1.2s ease infinite",position:isCollapsed?"absolute":"static",top:8,right:8}}/>
                )}
                {locked && !isCollapsed && (
                  <span aria-hidden="true" style={{fontSize:12,color:"rgba(255,255,255,.35)",flexShrink:0}}>🔒</span>
                )}
                {showKeys && !locked && !isCollapsed && !(t.id === "play" && sessionActive) && (isHov || active) && (
                  <span aria-hidden="true" style={{fontSize:11,fontWeight:600,color:"rgba(255,255,255,.4)",border:"1px solid rgba(255,255,255,.14)",borderRadius:5,padding:"1px 6px",flexShrink:0}}>{idx + 1}</span>
                )}
              </button>
            );
          })}
          </SlideList>
        </div>

        {/* ── Section C: User block + collapse toggle ── */}
        <div style={{borderTop:"1px solid rgba(255,255,255,.07)",padding: isCollapsed ? "12px 10px" : "12px 12px",flexShrink:0}}>
          <button
            onClick={after(onOpenProfile)}
            title={isCollapsed ? (authUser.displayName || "Profile") + " · " + rm.label : "Open profile"}
            aria-label={isCollapsed ? "Open profile" : undefined}
            style={{
              display:"flex", alignItems:"center",
              gap: isCollapsed ? 0 : 11,
              width:"100%", background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.07)",
              borderRadius:12, padding: isCollapsed ? "8px" : "10px 10px",
              cursor:"pointer", fontFamily:"inherit", textAlign:"left",
              transition:"background .12s",
              justifyContent: isCollapsed ? "center" : "flex-start"
            }}>
            <div style={{
              width:38, height:38, borderRadius:"50%",
              background: isAdmin ? rm.bg : "rgba(255,255,255,.08)",
              border:"1.5px solid " + (isAdmin ? rm.border : "rgba(255,255,255,.18)"),
              display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:15,fontWeight:700,
              color: isAdmin ? rm.color : "rgba(255,255,255,.85)",
              flexShrink:0
            }}>
              {authUser.displayName ? authUser.displayName[0].toUpperCase() : "?"}
            </div>
            {!isCollapsed && (
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:14,fontWeight:600,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {authUser.displayName || authUser.email}
                </div>
                <div style={{display:"flex",alignItems:"center",gap:6,marginTop:4,minWidth:0}}>
                  <span style={{fontSize:11,fontWeight:700,letterSpacing:.4,textTransform:"uppercase",color:rm.color,background:rm.bg,border:"1px solid "+rm.border,borderRadius:99,padding:"1px 8px",flexShrink:0}}>{rm.label}</span>
                  {authUser.teamName && (
                    <span style={{fontSize:12,color:"rgba(255,255,255,.45)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{authUser.teamName}</span>
                  )}
                </div>
              </div>
            )}
          </button>

          {/* Collapse toggle — desktop only (the tablet rail is always collapsed) */}
          {mode === "desktop" && (
            <button
              onClick={onToggleCollapse}
              title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              style={{
                display:"flex",alignItems:"center",justifyContent:"center",gap:8,
                width:"100%",background:"none",border:"none",
                borderRadius:8,padding:"8px",marginTop:6,
                cursor:"pointer",color:"rgba(255,255,255,.45)",fontSize:13,
                fontFamily:"inherit",transition:"background .12s"
              }}>
              <span aria-hidden="true" style={{fontSize:15}}>{isCollapsed ? "»" : "«"}</span>
              {!isCollapsed && <span>Collapse</span>}
            </button>
          )}
        </div>
      </>
    );
  }

  var navBase = {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    background: themed("rgba(4,10,28,.98)"),
    borderRight: "1px solid rgba(255,255,255,.07)",
    overflow: "hidden",
    flexShrink: 0
  };

  // ── Tablet: icon rail + slide-over drawer ───────────────────────────────────
  if (compact) {
    return (
      <>
        <nav aria-label="Main navigation" style={Object.assign({}, navBase, { width:72, minWidth:72, zIndex:10 })}>
          {renderNav(true, "rail")}
        </nav>
        {drawerOpen && (
          <div
            onClick={function(e){ if (e.target === e.currentTarget) setDrawerOpen(false); }}
            style={{position:"fixed",inset:0,zIndex:900,background:"rgba(0,0,0,.55)",animation:"fadeIn .16s ease both"}}>
            <nav aria-label="Main navigation (expanded)" role="dialog" aria-modal="true"
              style={Object.assign({}, navBase, {
                position:"absolute", top:0, left:0, bottom:0,
                width:360, maxWidth:"88vw",
                boxShadow:"12px 0 48px rgba(0,0,0,.6)",
                animation:"drawerIn .2s cubic-bezier(.22,1,.36,1) both"
              })}>
              <style>{"@keyframes drawerIn{from{transform:translateX(-100%)}to{transform:none}}"}</style>
              {renderNav(false, "drawer")}
            </nav>
          </div>
        )}
      </>
    );
  }

  // ── Desktop: collapsible sidebar ────────────────────────────────────────────
  var sidebarW = collapsed ? 72 : 320;   // expanded: a quarter wider than the original 256
  return (
    <nav aria-label="Main navigation" style={Object.assign({}, navBase, {
      width: sidebarW,
      minWidth: sidebarW,
      transition: "width .2s cubic-bezier(.22,1,.36,1), min-width .2s cubic-bezier(.22,1,.36,1)",
      zIndex: 10
    })}>
      {renderNav(collapsed, "desktop")}
    </nav>
  );
}
