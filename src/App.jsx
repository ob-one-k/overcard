import { useState, useEffect, useRef, useMemo } from "react";
import { TM, SESS_COLOR, OBJ_COLOR, uid, isAdminRole, accentA, setAccentColor } from "./lib/constants";
import { setUnauthHandler, setSessionReplacedHandler, setStoredToken, getStoredToken, fetchWithTimeout, lsGet, lsSet, apiGet, apiPut, apiPost, apiDel, SAVE_DELAY, API_BASE } from "./lib/api";
import { solidBtn, ghostBtn, iconBtn, inputSt } from "./lib/styles";
import { TypeBadge, Handle } from "./components/ui";
import { TipCtx, GlobalInflTooltip } from "./components/Tooltip";
import { CardEditorSheet } from "./components/Editor";
import { TreeView } from "./components/Viewer";
import { PlayTab } from "./components/Play";
import { SessionReview, SessionsTab, SessionAnalytics } from "./components/Sessions";
import { CardsTab, ObjectionsTab } from "./components/Cards";
import { DeckSwitcherSheet, LoginScreen, ProfileSheet, AdminPanel } from "./components/Panels";
import { SignupScreen } from "./components/Signup";
import { NotificationBell } from "./components/NotificationBell";
import { OrgMark } from "./components/OrgMark";
import { HomeTab } from "./components/Home";
import { HomeDesktop } from "./components/desktop/HomeDesktop";
import { CommandPalette } from "./components/CommandPalette";
import { useDesktop } from "./lib/useDesktop";
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

  function handleLogin(u) {
    setKickReason(null); setShowSignup(false); setAuthUser(u);
    // Drop ?join= so a reload doesn't reopen signup
    if (joinCode) { try { window.history.replaceState(null, "", window.location.pathname); } catch (_) {} }
  }

  // Only 401/403 mean "logged out". Network errors, timeouts and 5xx mean the server
  // is unavailable — show a retry screen instead of hanging or bouncing to login.
  useEffect(function() {
    var cancelled = false;
    var storedToken = getStoredToken();
    var headers = storedToken ? { "Authorization": "Bearer " + storedToken } : {};
    var slowTimer = setTimeout(function() { if (!cancelled) setSlowServer(true); }, 5000);
    fetchWithTimeout(API_BASE + "/auth/me", { credentials:"include", headers: headers }, 75000)
      .then(function(r) {
        if (r.ok) return r.json().then(function(u) { if (!cancelled) setAuthUser(u); });
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
    setUnauthHandler(function(){ setStoredToken(null); setAuthUser(false); });
    setSessionReplacedHandler(function(){ setStoredToken(null); setKickReason("replaced"); setAuthUser(false); });
    return function(){ setUnauthHandler(null); setSessionReplacedHandler(null); };
  }, []);

  // Refresh JWT on visibility change and every hour to prevent mid-session logout
  useEffect(function() {
    function doRefresh() {
      var storedToken = getStoredToken();
      var headers = { "Content-Type": "application/json" };
      if (storedToken) headers["Authorization"] = "Bearer " + storedToken;
      fetchWithTimeout(API_BASE + "/auth/refresh", { method:"POST", credentials:"include", headers: headers })
        .then(function(r) {
          if (r.status === 401) { setStoredToken(null); setAuthUser(false); return null; }
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
    <div style={{width:"100%",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#060d1a",flexDirection:"column",gap:16,fontFamily:"inherit"}}>
      <div style={{width:48,height:48,borderRadius:14,background:"#1565C0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,fontWeight:900,color:"#fff"}}>O</div>
      <div style={{color:"rgba(255,255,255,.5)",fontSize:13,letterSpacing:1}}>Loading OverCard…</div>
      {slowServer && <div style={{color:"rgba(255,255,255,.35)",fontSize:12,maxWidth:280,textAlign:"center",lineHeight:1.5}}>Waking up the server — this can take up to a minute.</div>}
    </div>
  );
  if (serverDown) return (
    <div style={{width:"100%",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#060d1a",flexDirection:"column",gap:16,fontFamily:"inherit",padding:16,boxSizing:"border-box"}}>
      <div style={{width:48,height:48,borderRadius:14,background:"#1565C0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,fontWeight:900,color:"#fff"}}>O</div>
      <div style={{color:"#fff",fontSize:15,fontWeight:700}}>Can't reach the OverCard server</div>
      <div style={{color:"rgba(255,255,255,.5)",fontSize:13,maxWidth:300,textAlign:"center",lineHeight:1.5}}>The server didn't respond. Check your connection and try again.</div>
      <button onClick={retryAuth} style={solidBtn("#1565C0")}>Retry</button>
    </div>
  );
  // Theme the app with the signed-in org's accent (reset to the default when signed out)
  setAccentColor(authUser ? authUser.orgAccent : null);

  if (!authUser && showSignup) return (
    <SignupScreen
      initialCode={joinCode}
      onLogin={handleLogin}
      onBack={function(){ setShowSignup(false); }}
    />
  );
  if (!authUser) return (
    <LoginScreen
      kickReason={kickReason}
      onLogin={handleLogin}
      onShowSignup={function(){ setShowSignup(true); }}
    />
  );
  return <MainApp authUser={authUser} onLogout={function(){ setStoredToken(null); setAuthUser(false); }}
    onOrgUpdated={function(org){
      // Owner edited branding/name — refresh the signed-in user's org fields so the shell re-themes
      setAuthUser(function(u){ return u ? Object.assign({}, u, { orgName: org.name, orgLogo: org.logo || null, orgAccent: org.accentColor || null }) : u; });
    }}/>;
}

// ─── APP ────────────────────────────────────────────────────────────────────
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
  // Command palette visibility (desktop only)
  var [showCmdPalette, setShowCmdPalette] = useState(false);
  // Dirty deck tracking for per-deck autosave
  var dirtyIds = useRef(new Set());

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
  function editDeckMeta(deckId, attrs) {
    markDirty(deckId);
    setDecks(function(ds) {
      return ds.map(function(d) {
        return d.id === deckId ? Object.assign({}, d, { name:attrs.name, color:attrs.color, icon:attrs.icon, visibility:attrs.visibility||d.visibility, accessList:attrs.accessList||d.accessList||[] }) : d;
      });
    });
  }

  // ── Home tab: switch deck + go to Play ───────────────────────────────────────
  function handleSwitchDeckAndPlay(deckId) {
    switchDeck(deckId);
    switchTab("play");
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
  var tipCtxVal = { activeTip, setActiveTip };
  function handleAppClick() { setActiveTip(null); }

  var deckSwitcher = (
    <DeckSwitcherSheet
      decks={decks}
      activeDeckId={deck ? deck.id : null}
      onSelect={switchDeck}
      onAddDeck={addDeck}
      onClose={function(){setShowDS(false);}}
      isAdmin={isAdminRole(authUser.role)}
      isOwner={authUser.role === "owner"}
      onEditDeck={editDeckMeta}
      onDuplicateDeck={duplicateDeck}
      onArchiveDeck={function(id){ return setDeckArchived(id, true); }}
      onRestoreDeck={function(id){ return setDeckArchived(id, false); }}
      onDeleteDeck={deleteDeck}
      orgUsers={orgUsers}
      orgTeams={orgTeams}
    />
  );

  // ── Loading / error states ────────────────────────────────────────────────────
  var saveLabel = saveStatus==="saving" ? "Saving…" : saveStatus==="error" ? "⚠ Save failed" : "Saved";
  var saveColor = saveStatus==="saving" ? "rgba(255,255,255,.2)" : saveStatus==="error" ? "#EF5350" : "rgba(102,187,106,.6)";

  if (saveStatus === "idle") {
    return (
      <div style={{width:"100%",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#060d1a",flexDirection:"column",gap:16,fontFamily:"inherit"}}>
        <OrgMark authUser={authUser} size={48}/>
        <div style={{color:"rgba(255,255,255,.5)",fontSize:13,letterSpacing:1}}>Loading {authUser.orgName || ""}…</div>
      </div>
    );
  }
  if (!deck && decksError) {
    return (
      <div style={{width:"100%",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#060d1a",flexDirection:"column",gap:16,fontFamily:"inherit",padding:32}}>
        <div style={{fontSize:48}}>⚠️</div>
        <div style={{color:"rgba(255,255,255,.5)",fontSize:13,textAlign:"center",lineHeight:1.7}}>
          Couldn't load your decks.<br/>The server may be unavailable.
        </div>
        <button onClick={loadDecks} style={solidBtn("#1565C0")}>Retry</button>
      </div>
    );
  }
  if (!deck) {
    var canCreate = isAdminRole(authUser.role);
    return (
      <div style={{width:"100%",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#060d1a",flexDirection:"column",gap:16,fontFamily:"'Inter',sans-serif",padding:24,color:"#fff"}}>
        <div style={{fontSize:48}}>{canCreate ? "🃏" : "⚠️"}</div>
        {canCreate ? (
          <form onSubmit={function(e){
              e.preventDefault();
              if (!firstDeckName.trim()) return;
              addDeck({ name:firstDeckName.trim(), icon:"💼", color:"#F5A623", visibility:"public", accessList:[], objStacks:[] });
            }}
            style={{width:"100%",maxWidth:380,display:"flex",flexDirection:"column",gap:12,textAlign:"center"}}>
            <div style={{fontSize:20,fontWeight:700,fontFamily:"'Lora',serif"}}>Welcome{authUser.orgName ? " to " + authUser.orgName : ""}</div>
            <div style={{color:"rgba(255,255,255,.5)",fontSize:14,lineHeight:1.6}}>Create your first sales deck to get started. You can invite your team from the Admin tab afterwards.</div>
            <input value={firstDeckName} onChange={function(e){ setFirstDeckName(e.target.value); }} placeholder="Deck name, e.g. Outbound Pitch"
              autoFocus style={inputSt({marginBottom:0})}/>
            <button type="submit" disabled={!firstDeckName.trim()} style={solidBtn(SESS_COLOR)}>Create deck</button>
            {archivedDecks.length > 0 && (
              <button type="button" onClick={function(){ setShowDS(true); }} style={Object.assign({}, ghostBtn(), {padding:"8px 18px",fontSize:13})}>
                Restore an archived deck ({archivedDecks.length})
              </button>
            )}
          </form>
        ) : (
          <div style={{color:"rgba(255,255,255,.5)",fontSize:14,textAlign:"center",lineHeight:1.7}}>
            No decks available yet.<br/>Ask your admin to create a deck.
          </div>
        )}
        <button onClick={signOut} style={Object.assign({}, ghostBtn(), {padding:"8px 18px",fontSize:13})}>Sign out</button>
        {showDS && deckSwitcher}
      </div>
    );
  }

  var tabAccent = (tab === "play" ? SESS_COLOR : TAB_ACCENTS[tab]) || TAB_ACCENTS.home;

  // Shared tab content — rendered in both mobile and desktop layouts
  var tabContent = (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {tab==="home" && (
        desktop.isDesktop
          ? <HomeDesktop authUser={authUser} decks={liveDecks} orgTeams={orgTeams} orgUsers={orgUsers} onSwitchDeckAndPlay={handleSwitchDeckAndPlay}/>
          : <HomeTab     authUser={authUser} decks={liveDecks} orgTeams={orgTeams} orgUsers={orgUsers} onSwitchDeckAndPlay={handleSwitchDeckAndPlay}/>
      )}
      <div style={{flex:1,display:tab==="play"?"flex":"none",flexDirection:"column",overflow:"hidden"}}>
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
      </div>
      {tab==="sessions" && (
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
      )}
      {tab==="cards" && (
        <CardsTab
          key={deck.id+"-cards"}
          deck={deck}
          decks={liveDecks}
          onUpsert={upsertCard}
          onDelete={deleteCard}
          onUpdateDeck={updateDeck}
          readOnly={!isAdminRole(authUser.role)}
        />
      )}
      {tab==="objections" && (
        <ObjectionsTab
          key={deck.id+"-obj"}
          deck={deck}
          decks={liveDecks}
          onUpdateDeck={updateDeck}
          readOnly={!isAdminRole(authUser.role)}
          isOwner={authUser.role === "owner"}
        />
      )}
      {tab==="admin" && isAdminRole(authUser.role) && (
        <AdminPanel
          authUser={authUser}
          orgUsers={orgUsers}
          orgTeams={orgTeams}
          onRefreshUsers={refreshOrgUsers}
          onRefreshTeams={refreshOrgTeams}
          onOrgUpdated={onOrgUpdated}
        />
      )}
    </div>
  );

  return (
    <DesktopCtx.Provider value={desktop}>
    <TipCtx.Provider value={tipCtxVal}>
      <GlobalInflTooltip/>
      <div onClick={handleAppClick}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Lora:ital,wght@0,400;0,700;1,400&display=swap');
          *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
          html,body,#root{height:100%;width:100%;}
          body{background:#060d1a;font-family:'Inter',sans-serif;color:#fff;overscroll-behavior:none;}
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
          button{transition:transform 0.11s cubic-bezier(.22,1,.36,1),filter 0.11s ease,opacity 0.11s ease;}
          button:not(:disabled):active{transform:scale(0.92)!important;filter:brightness(0.80);}
          @media (hover:hover){button:not(:disabled):hover{filter:brightness(1.12);}}
          button:disabled{opacity:0.45!important;cursor:not-allowed;}
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

        {/* ── MOBILE LAYOUT (unchanged) ── */}
        {!desktop.isDesktop && (
        <div style={{width:"100%",maxWidth:430,margin:"0 auto",height:"100dvh",display:"flex",flexDirection:"column",background:"linear-gradient(180deg, #060d1a 0%, #071025 50%, #060d1a 100%)",boxShadow:"0 0 0 1px rgba(255,255,255,.04)"}}>

          {/* Server offline banner */}
          {!serverOk && (
            <div style={{background:"rgba(239,83,80,.14)",borderBottom:"1px solid rgba(239,83,80,.28)",padding:"5px 16px",fontSize:10,color:"#EF5350",textAlign:"center",flexShrink:0}}>
              ⚠ API server unreachable — changes won't be saved to disk
            </div>
          )}

          {/* Top bar — Deck switcher on left, user avatar on right */}
          <div style={{padding:"10px 14px",flexShrink:0,borderBottom:"1px solid rgba(255,255,255,.06)",background:"rgba(8,25,55,.4)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
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
          <div style={{flexShrink:0,borderTop:"1px solid rgba(255,255,255,.07)",background:"rgba(4,10,28,.98)",backdropFilter:"blur(20px)",padding:"8px 4px",paddingBottom:"calc(8px + env(safe-area-inset-bottom,0px))",display:"flex",justifyContent:"space-around"}}>
            {TABS.map(function(t) {
              var active = tab===t.id;
              var accent = t.accent;
              return (
                <button key={t.id} onClick={function(){handleTabClick(t.id);}}
                  style={{background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,padding:"4px 10px",borderRadius:12,fontFamily:"inherit"}}>
                  <div style={{width:34,height:34,borderRadius:10,background:active?accent+"22":"transparent",border:"1.5px solid "+(active?accent+"66":"transparent"),display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,transition:"all .18s"}}>{t.icon}</div>
                  <span style={{fontSize:8,fontWeight:700,letterSpacing:.5,textTransform:"uppercase",color:active?accent:"rgba(255,255,255,.22)"}}>{t.label}</span>
                </button>
              );
            })}
          </div>
        </div>
        )}

        {showDS && deckSwitcher}
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
          <CommandPalette
            tabs={TABS}
            decks={liveDecks}
            onNavigateTab={function(tabId){ handleTabClick(tabId); }}
            onSwitchDeck={switchDeck}
            onClose={function(){ setShowCmdPalette(false); }}
          />
        )}
      </div>
    </TipCtx.Provider>
    </DesktopCtx.Provider>
  );
}
