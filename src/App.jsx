import { useState, useEffect, useRef, useMemo, use, createElement, Suspense } from "react";
import { TM, SESS_COLOR, OBJ_COLOR, uid, isAdminRole, accentA, setAccentColor, themed } from "./lib/constants";
import { setUnauthHandler, setSessionReplacedHandler, setStoredToken, getStoredToken, fetchWithTimeout, lsGet, lsSet, apiGet, apiPut, apiPost, apiDel, SAVE_DELAY, API_BASE } from "./lib/api";
import { solidBtn, ghostBtn, iconBtn, inputSt, overlayFill } from "./lib/styles";
import { DesktopModal } from "./components/DesktopModal";
import { TypeBadge, Handle } from "./components/ui";
import { TipCtx, GlobalInflTooltip } from "./components/Tooltip";
import { PlayTab } from "./components/Play";
import { DeckSwitcherSheet, LoginScreen, ProfileSheet } from "./components/Panels";
import { NotificationBell } from "./components/NotificationBell";
import { OrgMark } from "./components/OrgMark";
import { getBrand, syncBrand, setBrand, cachedLogoVer } from "./lib/brand";
import { clearCache, cachedGet } from "./lib/dataCache";
import { startLive, stopLive, onLive, signalSignedOut } from "./lib/live";
import { setAudioOwner, resumePendingUploads } from "./lib/audioUpload";

// ─── CODE SPLITTING ─────────────────────────────────────────────────────────
// Play stays in the main bundle (it is always mounted). Every other tab, the admin
// panel, signup and the command palette load on demand, and are prefetched while
// the browser is idle so switching tabs never waits on the network.
var loaders = {
  home:     function() { return import("./components/Home"); },
  homeDesk: function() { return import("./components/desktop/HomeDesktop"); },
  sessions: function() { return import("./components/Sessions"); },
  cards:    function() { return import("./components/Cards"); },
  admin:    function() { return import("./components/AdminPanel"); },
  signup:   function() { return import("./components/Signup"); },
  reset:    function() { return import("./components/ResetPassword"); },
  palette:  function() { return import("./components/CommandPalette"); },
};
// Like React.lazy, but once a chunk has loaded (usually by the idle prefetch below) its
// components render synchronously. React.lazy suspends on every component's first
// render even when the chunk is already here, and React holds a revealed Suspense
// boundary for ~300 ms — that was the delay on each tab's first visit.
var chunkMods = {}, chunkLoads = {};
function loadChunk(key) {
  if (!chunkLoads[key]) {
    chunkLoads[key] = loaders[key]().then(
      function(m) { chunkMods[key] = m; return m; },
      function(err) { delete chunkLoads[key]; throw err; }   // a failed download can be retried
    );
  }
  return chunkLoads[key];
}
function lazyNamed(key, name) {
  function LazyChunk(props) {
    var m = chunkMods[key] || use(loadChunk(key));
    return createElement(m[name], props);
  }
  LazyChunk.displayName = name;
  return LazyChunk;
}
var HomeTab        = lazyNamed("home", "HomeTab");
var HomeDesktop    = lazyNamed("homeDesk", "HomeDesktop");
var SessionsTab    = lazyNamed("sessions", "SessionsTab");
var CardsTab       = lazyNamed("cards", "CardsTab");
var ObjectionsTab  = lazyNamed("cards", "ObjectionsTab");
var AdminPanel     = lazyNamed("admin", "AdminPanel");
var SignupScreen   = lazyNamed("signup", "SignupScreen");
var ResetPasswordScreen = lazyNamed("reset", "ResetPasswordScreen");
var CommandPalette = lazyNamed("palette", "CommandPalette");
var SessionReview  = lazyNamed("sessions", "SessionReview");
function prefetchChunks(isAdmin, isDesktop) {
  var keys = ["sessions", "cards", isDesktop ? "homeDesk" : "home"].concat(isAdmin ? ["admin"] : []).concat(isDesktop ? ["palette"] : []);
  var idle = window.requestIdleCallback || function(fn) { return setTimeout(fn, 1200); };
  keys.forEach(function(k, i) { idle(function() { loadChunk(k).catch(function() {}); }, { timeout: 1500 + i * 300 }); });
}
// One tab's container. Its entrance uses the `translate` property with fill-mode
// "backwards" so nothing is left applied afterwards — a lingering transform would
// make this pane the containing block for every position:fixed sheet inside it.
function TabPane({ hidden, children }) {
  return (
    <div style={{flex:1,display:hidden?"none":"flex",flexDirection:"column",overflow:"hidden",minHeight:0,
      animation:"tabIn .28s cubic-bezier(.22,1,.36,1) backwards"}}>
      {children}
    </div>
  );
}

function TabFallback() {
  return <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"rgba(255,255,255,.35)",fontSize:13,letterSpacing:.5}}>Loading…</div>;
}
import { useDesktop } from "./lib/useDesktop";
import { PRESS_CSS } from "./lib/pressFeedback";
import { useSlidingIndicator } from "./lib/useSlidingIndicator";
import { useKeyboardOpen } from "./lib/useViewport";
import { TabIcon } from "./components/TabIcons";
import { newDeckTemplate, duplicateDeck as duplicateDeckData, activeDecks, liveStacks } from "./lib/deckOps";
import DesktopCtx from "./lib/DesktopCtx";
import { DesktopShell } from "./components/DesktopShell";

// ─── TAB CONFIG ─────────────────────────────────────────────────────────────
// Fixed per-tab accent colors — each represents the tab's purpose, on-theme
var TAB_ACCENTS = {
  home:       "#4DB6AC",  // teal       — overview, performance, home base
  play:       null,       // org accent (SESS_COLOR) — resolved at render, since it's themed per org
  sessions:   "#FFD54F",  // yellow     — review, history, analytics
  cards:      "#00B4FF",  // electric blue — building, structure
  objections: "#EF5350",  // red        — defense, conflict handling
  admin:      "#7C4DFF",  // indigo     — elevated access (only allowed purple)
};
var USER_TABS  = [
  { id:"home",       label:"Home",       icon:"🏠",  accent: TAB_ACCENTS.home       },
  { id:"play",       label:"Play",       icon:"▶️", accent: TAB_ACCENTS.play       },
  { id:"sessions",   label:"Sessions",   icon:"📋", accent: TAB_ACCENTS.sessions   },
  { id:"cards",      label:"Cards",      icon:"🃏",  accent: TAB_ACCENTS.cards      },
  { id:"objections", label:"Objections", icon:"🛡️", accent: TAB_ACCENTS.objections },
];
var ADMIN_TABS = [
  { id:"home",       label:"Home",       icon:"🏠",  accent: TAB_ACCENTS.home       },
  { id:"play",       label:"Play",       icon:"▶️",  accent: TAB_ACCENTS.play       },
  { id:"sessions",   label:"Sessions",   icon:"📋",  accent: TAB_ACCENTS.sessions   },
  { id:"cards",      label:"Cards",      icon:"🃏",  accent: TAB_ACCENTS.cards      },
  { id:"objections", label:"Objections", icon:"🛡️", accent: TAB_ACCENTS.objections },
  { id:"admin",      label:"Admin",      icon:"⚙️", accent: TAB_ACCENTS.admin      },
];

export default function App() {
  var [authUser,    setAuthUser]    = useState(null);
  var [authChecked, setAuthChecked] = useState(false);
  var [kickReason,  setKickReason]  = useState(null); // "replaced" when session kicked by another login
  var [serverDown,  setServerDown]  = useState(false); // backend unreachable / erroring during auth check
  var [slowServer,  setSlowServer]  = useState(false); // auth check taking long (e.g. free-tier cold start)
  var [authAttempt, setAuthAttempt] = useState(0);
  // Invite links look like /?join=ABCD2345 — open straight into signup with the code filled in
  var [joinCode]   = useState(function() {
    try { return new URLSearchParams(window.location.search).get("join") || ""; } catch (_) { return ""; }
  });
  var [showSignup, setShowSignup] = useState(!!joinCode);
  var [joinDismissed, setJoinDismissed] = useState(false);
  function dropJoin() {
    setJoinDismissed(true);
    try { window.history.replaceState(null, "", window.location.pathname); } catch (_) {}
  }
  // Password reset links look like /?reset=TOKEN
  var [resetToken, setResetToken] = useState(function() {
    try { return new URLSearchParams(window.location.search).get("reset") || ""; } catch (_) { return ""; }
  });

  function handleLogin(u) {
    clearCache(); setKickReason(null); setShowSignup(false); setAuthUser(syncBrand(u));
    // Drop ?join= so a reload doesn't reopen signup (and the code is spent/irrelevant now)
    if (joinCode) dropJoin();
  }

  // Only 401/403 mean "logged out". Network errors, timeouts and 5xx mean the server
  // is unavailable — show a retry screen instead of hanging or bouncing to login.
  useEffect(function() {
    var cancelled = false;
    var storedToken = getStoredToken();
    var headers = storedToken ? { "Authorization": "Bearer " + storedToken } : {};
    var slowTimer = setTimeout(function() { if (!cancelled) setSlowServer(true); }, 5000);
    var logoVer = cachedLogoVer();
    fetchWithTimeout(API_BASE + "/auth/me" + (logoVer ? "?logoVer=" + encodeURIComponent(logoVer) : ""), { credentials:"include", headers: headers }, 75000)
      .then(function(r) {
        if (r.ok) return r.json().then(function(u) { if (!cancelled) setAuthUser(syncBrand(u)); });
        if (r.status === 401 || r.status === 403) { if (!cancelled) setAuthUser(false); return; }
        throw new Error("API " + r.status);
      })
      .then(function() { if (!cancelled) { setServerDown(false); setAuthChecked(true); } })
      .catch(function() { if (!cancelled) { setServerDown(true); setAuthChecked(true); } })
      .finally(function() { clearTimeout(slowTimer); if (!cancelled) setSlowServer(false); });
    return function() { cancelled = true; clearTimeout(slowTimer); };
  }, [authAttempt]);

  function retryAuth() { setServerDown(false); setAuthChecked(false); setAuthAttempt(function(n) { return n + 1; }); }

  // Register 401 handler so api helpers can clear auth state
  useEffect(function() {
    // Signed out by the server: also forget the cached org brand (shared devices)
    // signalSignedOut first: Play keeps an in-progress recording before the app unmounts
    setUnauthHandler(function(){ signalSignedOut("unauthenticated"); setStoredToken(null); clearCache(); setBrand(null); setAuthUser(false); });
    setSessionReplacedHandler(function(){ signalSignedOut("replaced"); setStoredToken(null); clearCache(); setBrand(null); setKickReason("replaced"); setAuthUser(false); });
    return function(){ setUnauthHandler(null); setSessionReplacedHandler(null); };
  }, []);

  // Live updates for the signed-in user. The server ends the stream with auth.ended when
  // this device is signed out elsewhere (another device signed in, password reset, account removed).
  var liveUserId = authUser ? authUser.id : null;
  useEffect(function() {
    setAudioOwner(liveUserId);
    if (!liveUserId) { stopLive(); return; }
    // Recordings left on this device (signed out mid-call, closed before uploading) go up now
    resumePendingUploads();
    var off = onLive("auth.ended", function(d) {
      setStoredToken(null); clearCache(); setBrand(null);
      if (d && d.reason === "replaced") setKickReason("replaced");
      else if (d && d.reason === "password") setKickReason("password");
      setAuthUser(false);
    });
    // Role or teams changed by an admin: refresh the profile in place
    var offChanged = onLive("auth.changed", function() {
      var v = cachedLogoVer();
      apiGet("/auth/me" + (v ? "?logoVer=" + encodeURIComponent(v) : "")).then(function(u) {
        if (u && u.id) setAuthUser(function(prev) { return prev ? syncBrand(u) : prev; });
      }).catch(function() {});
    });
    startLive();
    return function() { off(); offChanged(); stopLive(); };
  }, [liveUserId]);

  // Refresh JWT on visibility change and every hour to prevent mid-session logout
  useEffect(function() {
    function doRefresh() {
      var storedToken = getStoredToken();
      var headers = { "Content-Type": "application/json" };
      if (storedToken) headers["Authorization"] = "Bearer " + storedToken;
      fetchWithTimeout(API_BASE + "/auth/refresh", { method:"POST", credentials:"include", headers: headers })
        .then(function(r) {
          if (r.status === 401) {
            return r.json().catch(function() { return null; }).then(function(b) {
              signalSignedOut(b && b.error === "session_replaced" ? "replaced" : "unauthenticated");
              setStoredToken(null); clearCache(); setBrand(null);
              if (b && b.error === "session_replaced") setKickReason("replaced");
              setAuthUser(false);
              return null;
            });
          }
          return r.ok ? r.json() : null;
        })
        .then(function(data) { if (data && data._token) setStoredToken(data._token); })
        .catch(function() {});
    }
    var interval = setInterval(doRefresh, 60 * 60 * 1000); // every hour
    function onVisible() { if (document.visibilityState === "visible") doRefresh(); }
    document.addEventListener("visibilitychange", onVisible);
    return function() { clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  if (!authChecked) return (
    <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",background:themed("#060d1a"),flexDirection:"column",gap:16,fontFamily:"inherit"}}>
      <BootMark/>
      <div style={{color:"rgba(255,255,255,.5)",fontSize:13,letterSpacing:1}}>Loading {(getBrand() && getBrand().orgName) || "OverCard"}…</div>
      {slowServer && <div style={{color:"rgba(255,255,255,.35)",fontSize:12,maxWidth:280,textAlign:"center",lineHeight:1.5}}>Waking up the server — this can take up to a minute.</div>}
    </div>
  );
  if (serverDown) return (
    <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",background:themed("#060d1a"),flexDirection:"column",gap:16,fontFamily:"inherit",padding:16,boxSizing:"border-box"}}>
      <BootMark/>
      <div style={{color:"#fff",fontSize:15,fontWeight:700}}>Can't reach the OverCard server</div>
      <div style={{color:"rgba(255,255,255,.5)",fontSize:13,maxWidth:300,textAlign:"center",lineHeight:1.5}}>The server didn't respond. Check your connection and try again.</div>
      <button onClick={retryAuth} style={solidBtn("#1565C0")}>Retry</button>
    </div>
  );
  // Theme the app with the signed-in org's accent (reset to the default when signed out)
  setAccentColor(authUser ? authUser.orgAccent : null);

  if (resetToken) return (
    <Suspense fallback={<div style={{height:"100%",background:themed("#060d1a")}}/>}>
    <ResetPasswordScreen token={resetToken} onDone={function() {
      try { window.history.replaceState(null, "", window.location.pathname); } catch (_) {}
      setResetToken("");
      retryAuth();   // a completed reset signed this account out everywhere — re-check
    }}/>
    </Suspense>
  );
  // Signed in already, but opened someone's invite link: say so instead of silently ignoring it
  if (authUser && joinCode && !joinDismissed) return (
    <div style={{width:"100%",minHeight:"100%",display:"flex",alignItems:"center",justifyContent:"center",background:themed("#060d1a"),padding:16,boxSizing:"border-box"}}>
      <div style={{maxWidth:420,width:"100%",background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:20,padding:"28px 24px",display:"flex",flexDirection:"column",gap:14}}>
        <OrgMark authUser={authUser} size={44}/>
        <div style={{fontSize:20,fontWeight:700,color:"#fff"}}>You're already signed in</div>
        <div style={{fontSize:14,color:"rgba(255,255,255,.65)",lineHeight:1.6}}>
          You're signed in as <strong style={{color:"#fff"}}>{authUser.displayName}</strong> ({authUser.orgName}). This invite link is for creating a new account — to use it, sign out first.
        </div>
        <button onClick={function() { dropJoin(); }} style={solidBtn("#1565C0")}>Continue as {authUser.firstName || authUser.displayName}</button>
        <button onClick={function() {
          setJoinDismissed(true);
          var t = getStoredToken();
          fetchWithTimeout(API_BASE + "/auth/logout", { method:"POST", credentials:"include", headers: t ? { Authorization: "Bearer " + t } : {} }, 10000)
            .catch(function() {})
            .then(function() { setStoredToken(null); clearCache(); setBrand(null); setAuthUser(false); setShowSignup(true); });
        }} style={ghostBtn()}>Sign out and use the invite</button>
      </div>
    </div>
  );
  if (!authUser && showSignup) return (
    <Suspense fallback={<div style={{height:"100%",background:themed("#060d1a")}}/>}>
    <SignupScreen
      initialCode={joinCode}
      onLogin={handleLogin}
      onBack={function(){ setShowSignup(false); }}
    />
    </Suspense>
  );
  if (!authUser) return (
    <LoginScreen
      kickReason={kickReason}
      onLogin={handleLogin}
      onShowSignup={function(){ setShowSignup(true); }}
    />
  );
  return <MainApp authUser={authUser} onLogout={function(){ setStoredToken(null); setBrand(null); clearCache(); setAuthUser(false); }}
    onOrgUpdated={function(org){
      // Owner edited branding/name — refresh the signed-in user's org fields so the shell re-themes
      setBrand({ orgName: org.name, orgLogo: org.logo || null, orgAccent: org.accentColor || null, orgLogoVer: null });
      setAuthUser(function(u){ return u ? Object.assign({}, u, { orgName: org.name, orgLogo: org.logo || null, orgAccent: org.accentColor || null }) : u; });
    }}/>;
}

// Boot / server-down screens: the cached org mark (tinted with the cached accent)
// when this device has signed in before, otherwise the OverCard "O"
function BootMark() {
  var b = getBrand();
  var w = typeof window !== "undefined" ? window.innerWidth : 1024;
  var size = w >= 1024 ? 64 : w >= 768 ? 56 : 48;
  if (b && (b.orgLogo || b.orgName)) {
    setAccentColor(b.orgAccent);
    return <OrgMark authUser={b} size={size}/>;
  }
  return <div style={{width:size,height:size,borderRadius:14,background:"#1565C0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:Math.round(size*0.54),fontWeight:900,color:"#fff"}}>O</div>;
}

// ─── APP ────────────────────────────────────────────────────────────────────
// ─── PHONE TAB BAR ────────────────────────────────────────────────────────────
// One org-accent pill slides behind the active tab's icon. Its own component so the
// indicator hook never sits after MainApp's early returns.
function MobileTabBar({ tabs, tab, onTabClick }) {
  var barRef = useRef(null);
  var ind = useSlidingIndicator(barRef, tab, [tabs.length]);
  // Typing: the keyboard covers the bottom of the screen — give that room to the content
  // (hidden, not unmounted, so the indicator keeps measuring)
  var kbOpen = useKeyboardOpen();
  return (
    // Opaque background, no backdrop blur: a blur over scrolling content janks on phones
    <div ref={barRef} style={Object.assign({position:"relative",flexShrink:0,borderTop:"1px solid rgba(255,255,255,.07)",background:themed("rgba(4,10,28,.98)"),padding:"8px 4px",paddingBottom:"calc(8px + env(safe-area-inset-bottom,0px))",display:"flex",justifyContent:"space-around"},
      kbOpen ? {height:0,padding:0,borderTop:"none",visibility:"hidden",overflow:"hidden"} : {})}>
      {ind.style && <div aria-hidden="true" style={Object.assign({}, ind.style, {borderRadius:10,background:accentA(.13),border:"1.5px solid "+accentA(.6),boxSizing:"border-box"})}/>}
      {tabs.map(function(t) {
        var active = tab === t.id;
        return (
          <button key={t.id} onClick={function(){ onTabClick(t.id); }} aria-current={active ? "page" : undefined}
            style={{position:"relative",zIndex:1,background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,padding:"4px 10px",borderRadius:12,fontFamily:"inherit"}}>
            <div data-tab={t.id} style={{width:34,height:34,borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",color:active?SESS_COLOR:"rgba(255,255,255,.4)",transition:"color .25s"}}><TabIcon id={t.id} size={19}/></div>
            <span style={{fontSize:8,fontWeight:700,letterSpacing:.5,textTransform:"uppercase",color:active?SESS_COLOR:"rgba(255,255,255,.22)",transition:"color .25s"}}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── PHONE LANDSCAPE NAV RAIL ─────────────────────────────────────────────────
// Landscape phones are short, so the top bar and bottom tab bar fold into one left
// rail: the deck switcher on top, the tabs (same sliding org-accent indicator as the
// tab bar) in the middle, notifications + profile at the bottom. Tab labels drop out
// on very short screens.
function LandscapeRail({ tabs, tab, onTabClick, deck, decksCount, authUser, onOpenDeck, onOpenProfile, onOpenSession }) {
  var listRef = useRef(null);
  var ind = useSlidingIndicator(listRef, tab, [tabs.length]);
  var admin = isAdminRole(authUser.role);
  return (
    <nav aria-label="Main navigation" style={{width:72,flexShrink:0,display:"flex",flexDirection:"column",alignItems:"center",gap:6,padding:"8px 0",
      paddingBottom:"calc(8px + env(safe-area-inset-bottom,0px))",background:themed("rgba(4,10,28,.98)"),borderRight:"1px solid rgba(255,255,255,.07)"}}>
      <style>{"@media (max-height:340px){[data-rail-label]{display:none!important}}"}</style>
      <button onClick={onOpenDeck} aria-label={"Active deck: " + deck.name + " (" + decksCount + " decks). Switch deck"} title={deck.name}
        style={{width:48,height:44,borderRadius:13,background:deck.color+"22",border:"1.5px solid "+deck.color+"77",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",cursor:"pointer",fontFamily:"inherit",flexShrink:0,gap:0,padding:0}}>
        <span style={{fontSize:18,lineHeight:1}}>{deck.icon}</span>
        <span aria-hidden="true" style={{fontSize:8,color:"rgba(255,255,255,.45)",lineHeight:1,marginTop:2}}>⇅</span>
      </button>
      <div ref={listRef} style={{position:"relative",flex:1,minHeight:0,width:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2}}>
        {ind.style && <div aria-hidden="true" style={Object.assign({}, ind.style, {borderRadius:12,background:accentA(.13),border:"1.5px solid "+accentA(.6),boxSizing:"border-box"})}/>}
        {tabs.map(function(t) {
          var active = tab === t.id;
          return (
            <button key={t.id} data-tab={t.id} onClick={function(){ onTabClick(t.id); }} aria-current={active ? "page" : undefined} aria-label={t.label}
              style={{position:"relative",zIndex:1,width:58,flex:"1 1 0",maxHeight:50,minHeight:30,background:"none",border:"none",borderRadius:12,cursor:"pointer",
                display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,fontFamily:"inherit",padding:0}}>
              <span aria-hidden="true" style={{color:active?SESS_COLOR:"rgba(255,255,255,.4)",transition:"color .25s"}}><TabIcon id={t.id} size={19}/></span>
              <span data-rail-label aria-hidden="true" style={{fontSize:7.5,fontWeight:700,letterSpacing:.4,textTransform:"uppercase",color:active?SESS_COLOR:"rgba(255,255,255,.3)",transition:"color .25s"}}>{t.label}</span>
            </button>
          );
        })}
      </div>
      <div style={{display:"flex",gap:4,alignItems:"center",flexShrink:0}}>
        <NotificationBell onOpenSession={onOpenSession} side="right"/>
        <button onClick={onOpenProfile} aria-label="Profile"
          style={{width:30,height:30,borderRadius:"50%",background:admin?accentA(.12):"rgba(255,255,255,.06)",border:"1px solid "+(admin?accentA(.3):"rgba(255,255,255,.12)"),display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,cursor:"pointer",color:admin?SESS_COLOR:"rgba(255,255,255,.82)",fontFamily:"inherit",fontWeight:700,padding:0}}>
          {authUser.displayName ? authUser.displayName[0].toUpperCase() : "?"}
        </button>
      </div>
    </nav>
  );
}

function MainApp({ authUser, onLogout, onOrgUpdated }) {
  var layout      = useDesktop();
  // Tablet = compact desktop: hand the context isDesktop:true so every
  // `isDesktop ? <XDesktop/> : <XMobile/>` switch renders the desktop UI;
  // compact-aware code reads desktop.compact / desktop.layout.
  var desktop     = useMemo(function() {
    return layout.layout === "tablet" ? Object.assign({}, layout, { isDesktop: true }) : layout;
  }, [layout]);
  // The Play tab takes the org's accent, which is only known after login
  var TABS        = (isAdminRole(authUser.role) ? ADMIN_TABS : USER_TABS).map(function(t) {
    return t.id === "play" ? Object.assign({}, t, { accent: SESS_COLOR }) : t;
  });
  var [decks,     setDecks]    = useState([]);
  var [activeId,  setActiveId] = useState("d1");
  var [tab,       setTab]      = useState(function() {
    var stored = lsGet("overcard_tab");
    return TABS.some(function(t) { return t.id === stored; }) ? stored : "home";
  });
  var [decksError, setDecksError] = useState(false);
  var [showDS,    setShowDS]   = useState(false);
  var [saveStatus, setSaveStatus] = useState("idle"); // "idle"|"saving"|"saved"|"error"
  var [serverOk,  setServerOk] = useState(true);
  // Portal: when a session finishes, this holds the session ID to open in Sessions tab
  var [pendingReview, setPendingReview] = useState(null);
  // Play tab state lifted here so it persists across tab switches
  var [playView,       setPlayView]       = useState("new");
  var [activeSession,  setActiveSession]  = useState(null);
  var [sessionEvents,  setSessionEvents]  = useState([]);
  // Track whether we're in an active session — must come after activeSession is declared
  var sessionActive = !!activeSession;
  // Admin scope for SessionsTab
  var [viewScope,   setViewScope]   = useState("self");
  // Admin org data
  var [orgUsers,    setOrgUsers]    = useState([]);
  var [orgTeams,    setOrgTeams]    = useState([]);
  // Profile sheet visibility
  var [showProfile, setShowProfile] = useState(false);
  // A highlighted session whose deck this user can't open here: reviewed in an overlay
  var [hlOverlay, setHlOverlay] = useState(null);
  // Command palette visibility (desktop only)
  var [showCmdPalette, setShowCmdPalette] = useState(false);
  // Dirty deck tracking for per-deck autosave
  var dirtyIds = useRef(new Set());
  // Tab transition direction: +1 when moving to a tab further along the nav, -1 back
  var tabDirRef = useRef({ tab: null, dir: 1 });
  // Deck switch dissolve: { deck, key } while the full-screen cross-fade runs
  var [deckFade, setDeckFade] = useState(null);
  var fadeTimers = useRef([]);

  // ── Tab switching helper (persists to localStorage) ─────────────────────────
  function switchTab(newTab) {
    lsSet("overcard_tab", newTab);
    setTab(newTab);
  }

  // ── Load on mount ────────────────────────────────────────────────────────────
  function loadDecks() {
    setDecksError(false);
    apiGet("/decks")
      .then(function(data) {
        if (Array.isArray(data) && data.length > 0) {
          setDecks(data);
          var live = activeDecks(data);
          var lastId = lsGet("overcard_activeId");
          if (lastId && live.find(function(d) { return d.id===lastId; })) {
            setActiveId(lastId);
          } else if (live.length) {
            setActiveId(live[0].id);
          }
        }
        setSaveStatus("saved"); setServerOk(true);
      })
      .catch(function(err) {
        if (err && err.status === 401) return; // unauth handler already routes to login
        setServerOk(false); setDecksError(true); setSaveStatus("error");
      });
  }
  useEffect(function() { prefetchChunks(isAdminRole(authUser.role), layout.isDesktop || layout.layout === "tablet"); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Warm the data the deck's tabs open with (Sessions list + highlights; the admin Cards
  // performance view), so a first visit renders from cache instead of waiting on the API
  var decksLoaded = decks.length > 0;
  useEffect(function() {
    if (!decksLoaded || !activeId) return;
    var idle = window.requestIdleCallback || function(fn) { return setTimeout(fn, 600); };
    var cancelId = idle(function() {
      var d = encodeURIComponent(activeId);
      var urls = ["/sessions?deckId=" + d, "/sessions/highlights?deckId=" + d];
      if (isAdminRole(authUser.role)) urls.push("/sessions?deckId=" + d + "&scope=org");
      urls.forEach(function(u) { cachedGet(u).catch(function() {}); });
    }, { timeout: 2500 });
    return function() { if (window.cancelIdleCallback) window.cancelIdleCallback(cancelId); else clearTimeout(cancelId); };
  }, [activeId, decksLoaded]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(function() {
    loadDecks();
    refreshOrgUsers();
    if (isAdminRole(authUser.role)) {
      refreshOrgTeams();
    }
  }, []);

  function refreshOrgUsers() {
    var url = isAdminRole(authUser.role) ? "/admin/users" : "/sessions/org-users";
    apiGet(url).then(function(u){ setOrgUsers(u); }).catch(function(){});
  }
  function refreshOrgTeams() {
    apiGet("/admin/teams").then(function(t){ setOrgTeams(t); }).catch(function(){});
  }
  // Someone joined with a share code, or another admin changed people/teams: refresh live
  useEffect(function() {
    if (!isAdminRole(authUser.role)) return;
    return onLive("users.changed", function() { refreshOrgUsers(); refreshOrgTeams(); });
  }, [authUser.role]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Autosave decks with debounce (per-deck dirty tracking) ───────────────────
  var saveTimer = useRef(null);
  function markDirty(deckId) { dirtyIds.current.add(deckId); }
  useEffect(function() {
    if (decks.length === 0) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(function() {
      var dirty = Array.from(dirtyIds.current);
      if (dirty.length === 0) return;
      dirtyIds.current.clear();
      setSaveStatus("saving");
      var toSave = decks.filter(function(d){ return dirty.indexOf(d.id) !== -1; });
      Promise.all(toSave.map(function(d){ return apiPut("/decks/" + d.id, d); }))
        .then(function() { setSaveStatus("saved"); setServerOk(true); lsSet("overcard_activeId", activeId); })
        .catch(function() {
          // Re-mark as dirty so the failed edits are retried on the next change instead of lost
          dirty.forEach(function(id) { dirtyIds.current.add(id); });
          setSaveStatus("error"); setServerOk(false);
        });
    }, SAVE_DELAY);
    return function() { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [decks, activeId]);

  // Archived decks stay in state (admins manage them from the deck switcher) but never drive the app
  var liveDecks = useMemo(function() { return activeDecks(decks); }, [decks]);
  var archivedDecks = decks.filter(function(d) { return !!d.archivedAt; });
  var deck = liveDecks.find(function(d) { return d.id===activeId; }) || liveDecks[0];
  // Play only ever sees live (non-archived) objection stacks
  var playDeck = useMemo(function() {
    return deck ? Object.assign({}, deck, { objStacks: liveStacks(deck) }) : deck;
  }, [deck]);

  // ── Deck mutation helpers ─────────────────────────────────────────────────────
  function upsertCard(deckId, card) {
    markDirty(deckId);
    setDecks(function(ds) {
      return ds.map(function(d) {
        if (d.id !== deckId) return d;
        var nc = Object.assign({}, d.cards, {[card.id]: card});
        return Object.assign({}, d, { cards:nc, rootCard: d.rootCard||card.id });
      });
    });
  }
  function deleteCard(deckId, cardId) {
    markDirty(deckId);
    setDecks(function(ds) {
      return ds.map(function(d) {
        if (d.id !== deckId) return d;
        var nc = Object.assign({}, d.cards);
        delete nc[cardId];
        Object.keys(nc).forEach(function(k) {
          var c = nc[k];
          nc[k] = Object.assign({}, c, { answers: (c.answers || []).map(function(a) { return a.next===cardId ? Object.assign({},a,{next:null}) : a; }) });
        });
        var nr = d.rootCard===cardId ? (Object.keys(nc)[0]||null) : d.rootCard;
        return Object.assign({}, d, { cards:nc, rootCard:nr });
      });
    });
  }
  function updateDeck(deckId, fn) {
    markDirty(deckId);
    setDecks(function(ds) { return ds.map(function(d) { return d.id===deckId ? fn(d) : d; }); });
  }
  // New decks start from the Opening → Discovery → Close template unless content is supplied
  function addDeck(newDeckData, opts) {
    var data = newDeckData.cards && Object.keys(newDeckData.cards).length
      ? newDeckData
      : Object.assign({}, newDeckData, newDeckTemplate());
    return apiPost("/decks", data)
      .then(function(d) {
        setDecks(function(ds){ return ds.concat([d]); });
        switchDeck(d.id);
        switchTab((opts && opts.tab) || "cards");
        return d;
      })
      .catch(function(err){ console.error("Failed to create deck:", err); window.alert("Couldn't create the deck: " + err.message); });
  }
  // Owner drag-to-reorder (deck switcher, Home): ids are the new order. Applied locally at
  // once; decks not listed (archived ones) keep their order after the listed ones.
  function reorderDecks(ids) {
    var pos = {};
    ids.forEach(function(id, i) { pos[id] = i; });
    setDecks(function(ds) {
      var listed = ds.filter(function(d) { return pos[d.id] !== undefined; }).sort(function(a, b) { return pos[a.id] - pos[b.id]; });
      return listed.concat(ds.filter(function(d) { return pos[d.id] === undefined; }));
    });
    apiPut("/decks/order", { ids: ids }).catch(function(err) {
      console.error("overcard:", err);
      window.alert("Couldn't save the deck order: " + err.message);
      loadDecks();
    });
  }
  function duplicateDeck(deckId) {
    var src = decks.find(function(d) { return d.id === deckId; });
    if (src) addDeck(duplicateDeckData(src));
  }
  // Archive / restore only flip archivedAt — local card edits awaiting autosave are kept
  function setDeckArchived(deckId, archived) {
    return apiPost("/decks/" + deckId + (archived ? "/archive" : "/restore"), {})
      .then(function(res) {
        setDecks(function(ds) { return ds.map(function(d) { return d.id === deckId ? Object.assign({}, d, { archivedAt: res.archivedAt || null }) : d; }); });
        if (archived && deckId === activeId) {
          var next = liveDecks.find(function(d) { return d.id !== deckId; });
          if (next) switchDeck(next.id);
        }
      })
      .catch(function(err) { window.alert("Couldn't " + (archived ? "archive" : "restore") + " the deck: " + err.message); });
  }
  function deleteDeck(deckId) {
    return apiDel("/decks/" + deckId)
      .then(function() {
        dirtyIds.current.delete(deckId);
        setDecks(function(ds) { return ds.filter(function(d) { return d.id !== deckId; }); });
        if (deckId === activeId) {
          var next = liveDecks.find(function(d) { return d.id !== deckId; });
          if (next) switchDeck(next.id);
        }
      })
      .catch(function(err) { window.alert("Couldn't delete the deck: " + err.message); });
  }
  function switchDeck(id) {
    if (activeSession && id !== activeId) return; // navigation is locked until the session ends
    lsSet("overcard_activeId", id);
    setActiveId(id);
    setPendingReview(null);
    // Reset play state when deck changes (mirrors existing PlayTab useEffect logic)
    setPlayView("home");
    setActiveSession(null);
    setSessionEvents([]);
  }
  // Picking a deck (switcher, Home): the whole screen dissolves to the new deck. The swap
  // happens while the cover is opaque, so the old deck's screen never flashes into the new
  function switchDeckWithDissolve(id, then) {
    if (id === activeId || (activeSession && id !== activeId)) { switchDeck(id); if (then) then(); return; }
    var target = decks.find(function(d) { return d.id === id; });
    fadeTimers.current.forEach(clearTimeout);
    setDeckFade({ deck: target || null, key: Date.now() });
    fadeTimers.current = [
      setTimeout(function() { switchDeck(id); if (then) then(); }, 200),
      setTimeout(function() { setDeckFade(null); }, 640),
    ];
  }
  useEffect(function() { return function() { fadeTimers.current.forEach(clearTimeout); }; }, []);

  // Name / colour / icon: anyone who may edit. Who can use it + editors: owner and creator only
  function editDeckMeta(deckId, attrs) {
    var cur = decks.find(function(d) { return d.id === deckId; });
    var manage = !!(cur && cur.canManage);
    markDirty(deckId);
    setDecks(function(ds) {
      return ds.map(function(d) {
        if (d.id !== deckId) return d;
        var next = Object.assign({}, d, { name:attrs.name, color:attrs.color, icon:attrs.icon });
        if (manage) Object.assign(next, { visibility:attrs.visibility||d.visibility, accessList:attrs.accessList||d.accessList||[] });
        return next;
      });
    });
    var before = (cur && cur.editorIds || []).slice().sort().join(",");
    if (manage && attrs.editorIds && attrs.editorIds.slice().sort().join(",") !== before) {
      apiPut("/decks/" + deckId + "/editors", { userIds: attrs.editorIds })
        .then(function(r) { setDecks(function(ds) { return ds.map(function(d) { return d.id === deckId ? Object.assign({}, d, { editorIds: r.editorIds || [] }) : d; }); }); })
        .catch(function(err) { window.alert("Couldn't save who can edit this deck: " + err.message); });
    }
  }

  // ── Home tab: switch deck + go to Play ───────────────────────────────────────
  function handleSwitchDeckAndPlay(deckId) {
    switchDeckWithDissolve(deckId, function() { switchTab("play"); });
  }

  // ── Portal from Play → Sessions ──────────────────────────────────────────────
  function handlePortalToReview(sessionId) {
    if (sessionId) {
      setPendingReview(sessionId);
      switchTab("sessions");
    }
  }

  // ── Notification → open that session's review (switching deck first if needed) ─
  function openSessionFromNotification(sessionId, deckId) {
    if (activeSession) return;   // never yank the rep out of a live call
    if (deckId && deckId !== activeId && decks.some(function(d) { return d.id === deckId; })) switchDeck(deckId);
    setPendingReview(sessionId);
    switchTab("sessions");
  }

  // Home highlight cards: open in the Sessions tab when the deck is one of ours,
  // otherwise (private or archived deck) read-only in an overlay
  function openHighlight(s) {
    if (activeSession) return;
    if (liveDecks.some(function(d) { return d.id === s.deckId; })) openSessionFromNotification(s.id, s.deckId);
    else setHlOverlay(s);
  }

  // ── Tab switching ─────────────────────────────────────────────────────────────
  function handleTabClick(tabId) {
    if (tabId !== "sessions") setPendingReview(null); // clear portal on manual nav
    switchTab(tabId);
  }

  // ── Tooltip context ───────────────────────────────────────────────────────────
  var [activeTip, setActiveTip] = useState(null);
  // Empty-org state: an admin names the first deck before the main app can render
  var [firstDeckName, setFirstDeckName] = useState("");
  function signOut() {
    apiPost("/auth/logout", {}).catch(function(){});
    onLogout();
  }
  // Stable context value — a fresh object every render re-rendered every tooltip consumer
  var tipCtxVal = useMemo(function() { return { activeTip:activeTip, setActiveTip:setActiveTip }; }, [activeTip]);
  function handleAppClick() { setActiveTip(null); }

  var deckSwitcher = (
    <DeckSwitcherSheet
      decks={decks}
      activeDeckId={deck ? deck.id : null}
      onSelect={function(id){ switchDeckWithDissolve(id); }}
      onAddDeck={addDeck}
      onClose={function(){setShowDS(false);}}
      isAdmin={isAdminRole(authUser.role)}
      isOwner={authUser.role === "owner"}
      onEditDeck={editDeckMeta}
      onDuplicateDeck={duplicateDeck}
      onReorderDecks={authUser.role === "owner" ? reorderDecks : null}
      onArchiveDeck={function(id){ return setDeckArchived(id, true); }}
      onRestoreDeck={function(id){ return setDeckArchived(id, false); }}
      onDeleteDeck={deleteDeck}
      orgUsers={orgUsers}
      orgTeams={orgTeams}
    />
  );

  // Org mark size on full-screen states: desktop 64 · tablet 56 · phone 48
  var screenMark = layout.layout === "desktop" ? 64 : layout.layout === "tablet" ? 56 : 48;

  // ── Loading / error states ────────────────────────────────────────────────────
  var saveLabel = saveStatus==="saving" ? "Saving…" : saveStatus==="error" ? "⚠ Save failed" : "Saved";
  var saveColor = saveStatus==="saving" ? "rgba(255,255,255,.2)" : saveStatus==="error" ? "#EF5350" : "rgba(102,187,106,.6)";

  if (saveStatus === "idle") {
    return (
      <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",background:themed("#060d1a"),flexDirection:"column",gap:16,fontFamily:"inherit"}}>
        <OrgMark authUser={authUser} size={screenMark}/>
        <div style={{color:"rgba(255,255,255,.5)",fontSize:13,letterSpacing:1}}>Loading {authUser.orgName || ""}…</div>
      </div>
    );
  }
  if (!deck && decksError) {
    return (
      <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",background:themed("#060d1a"),flexDirection:"column",gap:16,fontFamily:"inherit",padding:32,boxSizing:"border-box"}}>
        <OrgMark authUser={authUser} size={screenMark}/>
        <div style={{color:"rgba(255,255,255,.5)",fontSize:13,textAlign:"center",lineHeight:1.7}}>
          Couldn't load your decks.<br/>The server may be unavailable.
        </div>
        <button onClick={loadDecks} style={solidBtn("#1565C0")}>Retry</button>
      </div>
    );
  }
  if (!deck) {
    var canCreate = isAdminRole(authUser.role);
    // Landscape phones put the welcome text beside the form so it fits the short screen
    var phoneLand = layout.isMobile && layout.landscape;
    var signOutBtn = <button type="button" onClick={signOut} style={Object.assign({}, ghostBtn(), {padding:"8px 18px",fontSize:13})}>Sign out</button>;
    var welcome = (
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:phoneLand ? 10 : 12,textAlign:"center"}}>
        <OrgMark authUser={authUser} size={screenMark}/>
        <div style={{fontSize:20,fontWeight:700,fontFamily:"'Lora',serif",overflowWrap:"anywhere"}}>Welcome{authUser.orgName ? " to " + authUser.orgName : ""}</div>
        <div style={{color:"rgba(255,255,255,.5)",fontSize:14,lineHeight:1.6}}>Create your first sales deck to get started. You can invite your team from the Admin tab afterwards.</div>
      </div>
    );
    var deckForm = (
      <form onSubmit={function(e){
          e.preventDefault();
          if (!firstDeckName.trim()) return;
          addDeck({ name:firstDeckName.trim(), icon:"💼", color:"#F5A623", visibility:"public", accessList:[], objStacks:[] });
        }}
        style={{width:"100%",display:"flex",flexDirection:"column",gap:12}}>
        <input value={firstDeckName} onChange={function(e){ setFirstDeckName(e.target.value); }} placeholder="Deck name, e.g. Outbound Pitch"
          autoFocus={!layout.isTouchPrimary} style={inputSt({marginBottom:0})}/>
        <button type="submit" disabled={!firstDeckName.trim()} style={solidBtn(SESS_COLOR)}>Create deck</button>
        {archivedDecks.length > 0 && (
          <button type="button" onClick={function(){ setShowDS(true); }} style={Object.assign({}, ghostBtn(), {padding:"8px 18px",fontSize:13})}>
            Restore an archived deck ({archivedDecks.length})
          </button>
        )}
        {phoneLand && signOutBtn}
      </form>
    );
    // height:100% (not 100vh) fits the visible screen; box-sizing keeps the padding inside
    // the width (MainApp's global reset isn't mounted yet); margin:auto centres without
    // clipping when the keyboard leaves less room than the content needs
    return (
      <div style={{position:"fixed",left:0,right:0,top:"var(--vvt, 0px)",height:"var(--vvh, 100%)",display:"flex",overflowY:"auto",background:themed("#060d1a"),fontFamily:"'Inter',sans-serif",padding:phoneLand ? "12px 24px" : 24,boxSizing:"border-box",color:"#fff"}}>
        {canCreate && phoneLand ? (
          <div style={{margin:"auto",width:"100%",maxWidth:760,display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(280px,1fr)",gap:28,alignItems:"center"}}>
            {welcome}
            {deckForm}
          </div>
        ) : (
          <div style={{margin:"auto",width:"100%",maxWidth:380,display:"flex",flexDirection:"column",alignItems:"center",gap:16}}>
            {canCreate ? (
              <>
                {welcome}
                {deckForm}
              </>
            ) : (
              <>
                <OrgMark authUser={authUser} size={screenMark}/>
                <div style={{color:"rgba(255,255,255,.5)",fontSize:14,textAlign:"center",lineHeight:1.7}}>
                  No decks available yet.<br/>Ask your admin to create a deck.
                </div>
              </>
            )}
            {signOutBtn}
          </div>
        )}
        {showDS && deckSwitcher}
      </div>
    );
  }

  var tabAccent = (tab === "play" ? SESS_COLOR : TAB_ACCENTS[tab]) || TAB_ACCENTS.home;

  // Shared tab content — rendered in both mobile and desktop layouts
  // Direction-aware entrance for the tab being shown (phones slide sideways, desktop/
  // tablet rise slightly — their nav is vertical). Computed once per tab change.
  if (tabDirRef.current.tab !== tab) {
    var fromIdx = TABS.findIndex(function(t) { return t.id === tabDirRef.current.tab; });
    var toIdx   = TABS.findIndex(function(t) { return t.id === tab; });
    tabDirRef.current = { tab: tab, dir: fromIdx > toIdx ? -1 : 1 };
  }
  var tabMotion = desktop.isDesktop || desktop.landscape   // vertical nav (sidebar / landscape rail) → rise
    ? { "--tab-dx": "0px", "--tab-dy": "8px" }
    : { "--tab-dx": (tabDirRef.current.dir * 18) + "px", "--tab-dy": "0px" };

  var tabContent = (
    <div style={Object.assign({flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}, tabMotion)}>
      {/* Each lazy tab has its own Suspense boundary so a loading chunk never touches
          the always-mounted Play tab (a live call keeps running underneath) */}
      {tab==="home" && (
        <TabPane>
        <Suspense fallback={<TabFallback/>}>
        {desktop.isDesktop
          ? <HomeDesktop authUser={authUser} decks={liveDecks} orgTeams={orgTeams} orgUsers={orgUsers} onSwitchDeckAndPlay={handleSwitchDeckAndPlay} onOpenSession={openSessionFromNotification} onOpenHighlight={openHighlight} onReorderDecks={authUser.role === "owner" ? reorderDecks : null}/>
          : <HomeTab     authUser={authUser} decks={liveDecks} orgTeams={orgTeams} orgUsers={orgUsers} onSwitchDeckAndPlay={handleSwitchDeckAndPlay} onOpenSession={openSessionFromNotification} onOpenHighlight={openHighlight} onReorderDecks={authUser.role === "owner" ? reorderDecks : null}/>}
        </Suspense>
        </TabPane>
      )}
      {/* Always mounted (a live call keeps running); display:none → flex replays the entrance */}
      <TabPane hidden={tab!=="play"}>
        <PlayTab
          deck={playDeck}
          activeId={activeId}
          onPortalToReview={handlePortalToReview}
          onSwitchDeck={switchDeck}
          playView={playView}
          setPlayView={setPlayView}
          activeSession={activeSession}
          setActiveSession={setActiveSession}
          sessionEvents={sessionEvents}
          setSessionEvents={setSessionEvents}
        />
      </TabPane>
      {tab==="sessions" && (
        <TabPane>
        <Suspense fallback={<TabFallback/>}>
        <SessionsTab
          key={deck.id+"-sessions"}
          deckId={deck.id}
          deckName={deck.name}
          deckColor={deck.color}
          deckRootCard={deck.rootCard}
          onInitialReview={pendingReview}
          viewScope={viewScope}
          setViewScope={setViewScope}
          authUser={authUser}
          orgUsers={orgUsers}
          orgTeams={orgTeams}
        />
        </Suspense>
        </TabPane>
      )}
      {tab==="cards" && (
        <TabPane>
        <Suspense fallback={<TabFallback/>}>
        <CardsTab
          key={deck.id+"-cards"}
          deck={deck}
          decks={liveDecks}
          onUpsert={upsertCard}
          onDelete={deleteCard}
          onUpdateDeck={updateDeck}
          readOnly={!deck.canEdit}
        />
        </Suspense>
        </TabPane>
      )}
      {tab==="objections" && (
        <TabPane>
        <Suspense fallback={<TabFallback/>}>
        <ObjectionsTab
          key={deck.id+"-obj"}
          deck={deck}
          decks={liveDecks}
          onUpdateDeck={updateDeck}
          readOnly={!deck.canEdit}
          isOwner={authUser.role === "owner"}
        />
        </Suspense>
        </TabPane>
      )}
      {tab==="admin" && isAdminRole(authUser.role) && (
        <TabPane>
        <Suspense fallback={<TabFallback/>}>
        <AdminPanel
          authUser={authUser}
          orgUsers={orgUsers}
          orgTeams={orgTeams}
          onRefreshUsers={refreshOrgUsers}
          onRefreshTeams={refreshOrgTeams}
          onOrgUpdated={onOrgUpdated}
          onOpenSession={openSessionFromNotification}
        />
        </Suspense>
        </TabPane>
      )}
    </div>
  );

  return (
    <DesktopCtx.Provider value={desktop}>
    <TipCtx.Provider value={tipCtxVal}>
      <GlobalInflTooltip/>
      <div onClick={handleAppClick}>
        <style>{`
          *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
          html,body,#root{height:100%;width:100%;}
          body{background:#060d1a;font-family:'Inter',sans-serif;color:#fff;overscroll-behavior:none;}
          @keyframes deckDissolve{0%{opacity:0}30%{opacity:1}60%{opacity:1}100%{opacity:0}}
          @keyframes deckPop     {0%{opacity:0;transform:scale(.88)}35%{opacity:1;transform:scale(1)}100%{opacity:1;transform:scale(1.03)}}
          @keyframes tabIn       {from{opacity:0;translate:var(--tab-dx,0px) var(--tab-dy,0px)}to{opacity:1;translate:0 0}}
          @keyframes cardIn      {from{opacity:0;transform:translateX(28px) scale(.97)}to{opacity:1;transform:none}}
          @keyframes cardBack    {from{opacity:0;transform:translateX(-28px) scale(.97)}to{opacity:1;transform:none}}
          @keyframes cardSwipeIn {from{opacity:0;transform:translateX(62px)}to{opacity:1;transform:none}}
          @keyframes cardSwipeBack{from{opacity:0;transform:translateX(-62px)}to{opacity:1;transform:none}}
          @keyframes answersIn {from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
          @keyframes answerItem{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
          @keyframes sheetUp   {from{transform:translateY(100%)}to{transform:none}}
          @keyframes fadeIn    {from{opacity:0}to{opacity:1}}
          @keyframes savePulse {0%{opacity:1}50%{opacity:.3}100%{opacity:1}}
          @keyframes btnPop    {0%{transform:scale(1)}40%{transform:scale(0.91)}100%{transform:scale(1)}}
          @keyframes modalIn   {from{opacity:0;transform:translate(-50%,-55%)}to{opacity:1;transform:translate(-50%,-50%)}}
          @keyframes pulse     {0%{box-shadow:0 0 0 0 currentColor}70%{box-shadow:0 0 0 5px transparent}100%{box-shadow:0 0 0 0 transparent}}
          ${PRESS_CSS}
          /* Multi-column flows (landscape phones): a section never splits across columns */
          [data-cols] > *{break-inside:avoid;}
          /* Scroll areas keep their scroll to themselves (no chaining into the page behind) */
          [style*="overflow-y: auto"],[style*="overflow: auto"]{overscroll-behavior:contain;}
          input,textarea,select{-webkit-appearance:none;}
          input::placeholder,textarea::placeholder{color:rgba(255,255,255,.22);}
          input:focus,textarea:focus{border-color:rgba(255,255,255,.3)!important;outline:none;}
          ::-webkit-scrollbar{width:2px;height:2px;}
          ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:99px;}
        `}</style>

        {/* ── DESKTOP LAYOUT ── */}
        {desktop.isDesktop && (
          <DesktopShell
            tabs={TABS}
            tab={tab}
            onTabClick={handleTabClick}
            deck={deck}
            decks={liveDecks}
            authUser={authUser}
            sessionActive={sessionActive}
            saveStatus={saveStatus}
            saveLabel={saveLabel}
            saveColor={saveColor}
            serverOk={serverOk}
            onOpenDeckSwitcher={function(){setShowDS(true);}}
            onOpenProfile={function(){setShowProfile(true);}}
            onOpenCommandPalette={function(){setShowCmdPalette(true);}}
            onOpenSession={openSessionFromNotification}
            tabContextData={{
              play: {
                sessionName: activeSession ? activeSession.name : null,
                startTs:     activeSession ? activeSession.startTs : null,
              },
              cards: {
                cardCount:    deck ? Object.keys(deck.cards||{}).length : null,
                intendedCount: deck ? Object.values(deck.cards||{}).filter(function(c){ return c.intendedPath; }).length : null,
              },
              objections: {
                stackCount:   deck ? liveStacks(deck).length : null,
                healthyCount: deck ? liveStacks(deck).filter(function(s){ return !!s.rootCard && Object.keys(s.cards||{}).length > 0; }).length : null,
              },
            }}
          >
            {tabContent}
          </DesktopShell>
        )}

        {/* ── PHONE, LANDSCAPE: left nav rail + full-height, full-width content ── */}
        {!desktop.isDesktop && desktop.landscape && (
        <div style={{position:"fixed",left:0,right:0,top:"var(--vvt, 0px)",height:"var(--vvh, 100dvh)",display:"flex",background:themed("linear-gradient(180deg, #060d1a 0%, #071025 50%, #060d1a 100%)")}}>
          <LandscapeRail tabs={TABS} tab={tab} onTabClick={handleTabClick} deck={deck} decksCount={liveDecks.length}
            authUser={authUser} onOpenDeck={function(){setShowDS(true);}} onOpenProfile={function(){ setShowProfile(true); }}
            onOpenSession={openSessionFromNotification}/>
          <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",overflow:"hidden"}}>
            {!serverOk && (
              <div style={{background:"rgba(239,83,80,.14)",borderBottom:"1px solid rgba(239,83,80,.28)",padding:"4px 16px",fontSize:10,color:"#EF5350",textAlign:"center",flexShrink:0}}>
                ⚠ API server unreachable — changes won't be saved to disk
              </div>
            )}
            {tabContent}
          </div>
        </div>
        )}

        {/* ── PHONE, PORTRAIT ── pinned to the visible area: with the keyboard up the app
            shrinks above it (one scroll, no page panning) and the tab bar steps aside */}
        {!desktop.isDesktop && !desktop.landscape && (
        <div style={{position:"fixed",left:0,right:0,top:"var(--vvt, 0px)",height:"var(--vvh, 100dvh)",width:"100%",maxWidth:430,margin:"0 auto",display:"flex",flexDirection:"column",background:themed("linear-gradient(180deg, #060d1a 0%, #071025 50%, #060d1a 100%)"),boxShadow:"0 0 0 1px rgba(255,255,255,.04)"}}>

          {/* Server offline banner */}
          {!serverOk && (
            <div style={{background:"rgba(239,83,80,.14)",borderBottom:"1px solid rgba(239,83,80,.28)",padding:"5px 16px",fontSize:10,color:"#EF5350",textAlign:"center",flexShrink:0}}>
              ⚠ API server unreachable — changes won't be saved to disk
            </div>
          )}

          {/* Top bar — Deck switcher on left, user avatar on right */}
          <div style={{padding:"10px 14px",flexShrink:0,borderBottom:"1px solid rgba(255,255,255,.06)",background:themed("rgba(8,25,55,.4)"),display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
            <OrgMark authUser={authUser} size={30}/>
            {/* Deck switcher button */}
            <button onClick={function(){setShowDS(true);}}
              style={{display:"flex",alignItems:"center",gap:9,background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",borderRadius:13,padding:"7px 12px",cursor:"pointer",fontFamily:"inherit",transition:"background .12s"}}>
              <div style={{width:28,height:28,borderRadius:9,background:deck.color+"22",border:"1.5px solid "+deck.color+"44",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15}}>{deck.icon}</div>
              <div style={{textAlign:"left"}}>
                <div style={{fontSize:13,fontWeight:700,color:"#fff",lineHeight:1}}>{deck.name}</div>
                <div style={{fontSize:9,color:"rgba(255,255,255,.28)",marginTop:1}}>{liveDecks.length} deck{liveDecks.length!==1?"s":""} · tap to switch</div>
              </div>
              <span style={{fontSize:10,color:"rgba(255,255,255,.28)",marginLeft:2}}>⌄</span>
            </button>
            </div>

            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <NotificationBell onOpenSession={openSessionFromNotification}/>
              <button onClick={function(){ setShowProfile(true); }}
                style={{width:34,height:34,borderRadius:"50%",background:isAdminRole(authUser.role)?accentA(.12):"rgba(255,255,255,.06)",border:"1px solid "+(isAdminRole(authUser.role)?accentA(.3):"rgba(255,255,255,.12)"),display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,cursor:"pointer",color:isAdminRole(authUser.role)?SESS_COLOR:"rgba(255,255,255,.82)",fontFamily:"inherit",fontWeight:700}}
                title="Profile">
                {authUser.displayName ? authUser.displayName[0].toUpperCase() : "?"}
              </button>
            </div>
          </div>

          {/* Content area */}
          {tabContent}

          {/* Tab bar */}
          <MobileTabBar tabs={TABS} tab={tab} onTabClick={handleTabClick}/>
        </div>
        )}

        {showDS && deckSwitcher}
        {deckFade && (
          <div key={deckFade.key} aria-live="polite" style={{position:"fixed",inset:0,zIndex:950,background:themed("#060d1a"),display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:14,
            animation:"deckDissolve .64s cubic-bezier(.4,0,.2,1) both",pointerEvents:"none"}}>
            {deckFade.deck && (
              <>
                <div style={{width:72,height:72,borderRadius:22,background:deckFade.deck.color+"26",border:"1.5px solid "+deckFade.deck.color+"88",boxShadow:"0 0 60px "+deckFade.deck.color+"40",
                  display:"flex",alignItems:"center",justifyContent:"center",fontSize:34,animation:"deckPop .64s cubic-bezier(.22,1,.36,1) both"}}>{deckFade.deck.icon}</div>
                <div style={{fontSize:16,fontWeight:700,color:"#fff",fontFamily:"'Lora',serif",animation:"deckPop .64s cubic-bezier(.22,1,.36,1) .03s both"}}>{deckFade.deck.name}</div>
              </>
            )}
          </div>
        )}
        {hlOverlay && (
          <Suspense fallback={null}>
          {desktop.isDesktop ? (
            <DesktopModal title="★ Highlighted session" width={960} onClose={function(){ setHlOverlay(null); }}>
              <div style={{height:"min(76vh, 780px)",display:"flex",flexDirection:"column"}}>
                <SessionReview session={hlOverlay} onBack={function(){ setHlOverlay(null); }} authUser={authUser} orgUsers={orgUsers} orgTeams={orgTeams}/>
              </div>
            </DesktopModal>
          ) : (
            <div style={Object.assign({}, overlayFill(600), {background:themed("#060d1a"),animation:"sheetUp .3s cubic-bezier(.22,1,.36,1) both"})}>
              <SessionReview session={hlOverlay} onBack={function(){ setHlOverlay(null); }} authUser={authUser} orgUsers={orgUsers} orgTeams={orgTeams}/>
            </div>
          )}
          </Suspense>
        )}
        {showProfile && (
          <ProfileSheet
            authUser={authUser}
            teamName={authUser.teamName || null}
            onLogout={function(){
              apiPost("/auth/logout", {}).catch(function(){});
              onLogout();
            }}
            onClose={function(){ setShowProfile(false); }}
          />
        )}
        {desktop.isDesktop && showCmdPalette && (
          <Suspense fallback={null}>
          <CommandPalette
            tabs={TABS}
            decks={liveDecks}
            onNavigateTab={function(tabId){ handleTabClick(tabId); }}
            onSwitchDeck={switchDeck}
            onClose={function(){ setShowCmdPalette(false); }}
          />
          </Suspense>
        )}
      </div>
    </TipCtx.Provider>
    </DesktopCtx.Provider>
  );
}
