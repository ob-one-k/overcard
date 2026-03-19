import { useState, useEffect, useRef } from "react";
import { TM, SESS_COLOR, OBJ_COLOR, uid } from "./lib/constants";
import { setUnauthHandler, setSessionReplacedHandler, setStoredToken, apiGet, apiPut, apiPost, SAVE_DELAY, API_BASE } from "./lib/api";
import { solidBtn, ghostBtn, iconBtn, inputSt } from "./lib/styles";
import { TypeBadge, Handle } from "./components/ui";
import { TipCtx, GlobalInflTooltip } from "./components/Tooltip";
import { CardEditorSheet } from "./components/Editor";
import { TreeView, SwimlaneView } from "./components/Viewer";
import { PlayTab } from "./components/Play";
import { SessionReview, SessionsTab, SessionAnalytics } from "./components/Sessions";
import { CardsTab, ObjectionsTab } from "./components/Cards";
import { DeckSwitcherSheet, LoginScreen, ProfileSheet, AdminPanel } from "./components/Panels";
import { HomeTab } from "./components/Home";

// ─── TAB CONFIG ─────────────────────────────────────────────────────────────
// Fixed per-tab accent colors — each represents the tab's purpose, on-theme
var TAB_ACCENTS = {
  home:       "#4DB6AC",  // teal       — overview, performance, home base
  play:       "#A8FF3E",  // lime green — action, go, start
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

  useEffect(function() {
    var storedToken = localStorage.getItem("overcard_token");
    var headers = storedToken ? { "Authorization": "Bearer " + storedToken } : {};
    fetch(API_BASE + "/auth/me", { credentials:"include", headers: headers })
      .then(function(r){ return r.ok ? r.json() : Promise.reject(); })
      .then(function(u){ setAuthUser(u); setAuthChecked(true); })
      .catch(function(){ setAuthUser(false); setAuthChecked(true); });
  }, []);

  // Register 401 handler so api helpers can clear auth state
  useEffect(function() {
    setUnauthHandler(function(){ setStoredToken(null); setAuthUser(false); });
    setSessionReplacedHandler(function(){ setStoredToken(null); setKickReason("replaced"); setAuthUser(false); });
    return function(){ setUnauthHandler(null); setSessionReplacedHandler(null); };
  }, []);

  // Refresh JWT on visibility change and every hour to prevent mid-session logout
  useEffect(function() {
    function doRefresh() {
      var storedToken = localStorage.getItem("overcard_token");
      var headers = { "Content-Type": "application/json" };
      if (storedToken) headers["Authorization"] = "Bearer " + storedToken;
      fetch(API_BASE + "/auth/refresh", { method:"POST", credentials:"include", headers: headers })
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
    </div>
  );
  if (!authUser) return (
    <LoginScreen
      kickReason={kickReason}
      onLogin={function(u){ setKickReason(null); setAuthUser(u); }}
    />
  );
  return <MainApp authUser={authUser} onLogout={function(){ setStoredToken(null); setAuthUser(false); }}/>;
}

// ─── APP ────────────────────────────────────────────────────────────────────
function MainApp({ authUser, onLogout }) {
  var TABS        = authUser.role === "admin" ? ADMIN_TABS : USER_TABS;
  var [decks,     setDecks]    = useState([]);
  var [activeId,  setActiveId] = useState("d1");
  var [tab,       setTab]      = useState(localStorage.getItem("overcard_tab") || "home");
  var [showDS,    setShowDS]   = useState(false);
  var [saveStatus, setSaveStatus] = useState("idle"); // "idle"|"saving"|"saved"|"error"
  var [serverOk,  setServerOk] = useState(true);
  // Portal: when a session finishes, this holds the session ID to open in Sessions tab
  var [pendingReview, setPendingReview] = useState(null);
  // Track whether we're in an active session to lock tab switching
  var [sessionActive, setSessionActive] = useState(false);
  // Play tab state lifted here so it persists across tab switches
  var [playView,       setPlayView]       = useState("new");
  var [activeSession,  setActiveSession]  = useState(null);
  var [sessionEvents,  setSessionEvents]  = useState([]);
  // Admin scope for SessionsTab
  var [viewScope,   setViewScope]   = useState("self");
  // Admin org data
  var [orgUsers,    setOrgUsers]    = useState([]);
  var [orgTeams,    setOrgTeams]    = useState([]);
  // Profile sheet visibility
  var [showProfile, setShowProfile] = useState(false);
  // Dirty deck tracking for per-deck autosave
  var dirtyIds = useRef(new Set());

  // ── Tab switching helper (persists to localStorage) ─────────────────────────
  function switchTab(newTab) {
    localStorage.setItem("overcard_tab", newTab);
    setTab(newTab);
  }

  // ── Load on mount ────────────────────────────────────────────────────────────
  useEffect(function() {
    apiGet("/decks")
      .then(function(data) {
        if (Array.isArray(data) && data.length > 0) {
          setDecks(data);
          var lastId = localStorage.getItem("overcard_activeId");
          if (lastId && data.find(function(d) { return d.id===lastId; })) {
            setActiveId(lastId);
          } else {
            setActiveId(data[0].id);
          }
        }
        setSaveStatus("saved"); setServerOk(true);
      })
      .catch(function() { setServerOk(false); setSaveStatus("error"); });
    refreshOrgUsers();
    if (authUser.role === "admin") {
      refreshOrgTeams();
    }
  }, []);

  function refreshOrgUsers() {
    var url = authUser.role === "admin" ? "/admin/users" : "/sessions/org-users";
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
        .then(function() { setSaveStatus("saved"); setServerOk(true); localStorage.setItem("overcard_activeId", activeId); })
        .catch(function() { setSaveStatus("error"); setServerOk(false); });
    }, SAVE_DELAY);
    return function() { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [decks, activeId]);

  var deck = decks.find(function(d) { return d.id===activeId; }) || decks[0];

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
        Object.values(nc).forEach(function(c) {
          c.answers = c.answers.map(function(a) { return a.next===cardId ? Object.assign({},a,{next:null}) : a; });
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
  function addDeck(newDeckData) {
    apiPost("/decks", newDeckData)
      .then(function(d) {
        setDecks(function(ds){ return ds.concat([d]); });
        switchDeck(d.id);
        switchTab("play");
      })
      .catch(function(err){ console.error("Failed to create deck:", err); });
  }
  function switchDeck(id) {
    localStorage.setItem("overcard_activeId", id);
    setActiveId(id);
    setSessionActive(false);
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
    setSessionActive(false);
    if (sessionId) {
      setPendingReview(sessionId);
      switchTab("sessions");
    }
  }

  // ── Tab switching ─────────────────────────────────────────────────────────────
  function handleTabClick(tabId) {
    if (tabId !== "sessions") setPendingReview(null); // clear portal on manual nav
    switchTab(tabId);
  }

  // ── Tooltip context ───────────────────────────────────────────────────────────
  var [activeTip, setActiveTip] = useState(null);
  var tipCtxVal = { activeTip, setActiveTip };
  function handleAppClick() { setActiveTip(null); }

  // ── Loading / error states ────────────────────────────────────────────────────
  var saveLabel = saveStatus==="saving" ? "Saving…" : saveStatus==="error" ? "⚠ Save failed" : "Saved";
  var saveColor = saveStatus==="saving" ? "rgba(255,255,255,.2)" : saveStatus==="error" ? "#EF5350" : "rgba(102,187,106,.6)";

  if (saveStatus === "idle") {
    return (
      <div style={{width:"100%",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#060d1a",flexDirection:"column",gap:16,fontFamily:"inherit"}}>
        <div style={{width:48,height:48,borderRadius:14,background:"#1565C0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,fontWeight:900,color:"#fff"}}>O</div>
        <div style={{color:"rgba(255,255,255,.5)",fontSize:13,letterSpacing:1}}>Loading…</div>
      </div>
    );
  }
  if (!deck) {
    return (
      <div style={{width:"100%",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#060d1a",flexDirection:"column",gap:16,fontFamily:"inherit",padding:32}}>
        <div style={{fontSize:48}}>⚠️</div>
        <div style={{color:"rgba(255,255,255,.5)",fontSize:13,textAlign:"center",lineHeight:1.7}}>
          No decks available.<br/>Ask your admin to create a deck.
        </div>
      </div>
    );
  }

  var tabAccent = TAB_ACCENTS[tab] || TAB_ACCENTS.home;

  return (
    <TipCtx.Provider value={tipCtxVal}>
      <GlobalInflTooltip/>
      <div onClick={handleAppClick}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Lora:ital,wght@0,400;0,700;1,400&display=swap');
          *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
          html,body,#root{height:100%;width:100%;}
          body{background:#060d1a;font-family:'Inter',sans-serif;color:#fff;overscroll-behavior:none;}
          @keyframes cardIn    {from{opacity:0;transform:translateX(28px) scale(.97)}to{opacity:1;transform:none}}
          @keyframes cardBack  {from{opacity:0;transform:translateX(-28px) scale(.97)}to{opacity:1;transform:none}}
          @keyframes answersIn {from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
          @keyframes answerItem{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
          @keyframes sheetUp   {from{transform:translateY(100%)}to{transform:none}}
          @keyframes fadeIn    {from{opacity:0}to{opacity:1}}
          @keyframes savePulse {0%{opacity:1}50%{opacity:.3}100%{opacity:1}}
          @keyframes btnPop    {0%{transform:scale(1)}40%{transform:scale(0.91)}100%{transform:scale(1)}}
          button{transition:transform 0.11s cubic-bezier(.22,1,.36,1),filter 0.11s ease,opacity 0.11s ease;}
          button:not(:disabled):active{transform:scale(0.92)!important;filter:brightness(0.80);}
          button:not(:disabled):hover{filter:brightness(1.12);}
          button:disabled{opacity:0.45!important;cursor:not-allowed;}
          input,textarea,select{-webkit-appearance:none;}
          input::placeholder,textarea::placeholder{color:rgba(255,255,255,.22);}
          input:focus,textarea:focus{border-color:rgba(255,255,255,.3)!important;outline:none;}
          ::-webkit-scrollbar{width:2px;height:2px;}
          ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:99px;}
        `}</style>

        <div style={{width:"100%",maxWidth:430,margin:"0 auto",height:"100dvh",display:"flex",flexDirection:"column",background:"linear-gradient(180deg, #060d1a 0%, #071025 50%, #060d1a 100%)",boxShadow:"0 0 0 1px rgba(255,255,255,.04)"}}>

          {/* Server offline banner */}
          {!serverOk && (
            <div style={{background:"rgba(239,83,80,.14)",borderBottom:"1px solid rgba(239,83,80,.28)",padding:"5px 16px",fontSize:10,color:"#EF5350",textAlign:"center",flexShrink:0}}>
              ⚠ API server unreachable — changes won't be saved to disk
            </div>
          )}

          {/* Top bar — Deck switcher on left, user avatar on right */}
          <div style={{padding:"10px 14px",flexShrink:0,borderBottom:"1px solid rgba(255,255,255,.06)",background:"rgba(8,25,55,.4)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            {/* Deck switcher button */}
            <button onClick={function(){setShowDS(true);}}
              style={{display:"flex",alignItems:"center",gap:9,background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",borderRadius:13,padding:"7px 12px",cursor:"pointer",fontFamily:"inherit",transition:"background .12s"}}>
              <div style={{width:28,height:28,borderRadius:9,background:deck.color+"22",border:"1.5px solid "+deck.color+"44",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15}}>{deck.icon}</div>
              <div style={{textAlign:"left"}}>
                <div style={{fontSize:13,fontWeight:700,color:"#fff",lineHeight:1}}>{deck.name}</div>
                <div style={{fontSize:9,color:"rgba(255,255,255,.28)",marginTop:1}}>{decks.length} deck{decks.length!==1?"s":""} · tap to switch</div>
              </div>
              <span style={{fontSize:10,color:"rgba(255,255,255,.28)",marginLeft:2}}>⌄</span>
            </button>

            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <button onClick={function(){ setShowProfile(true); }}
                style={{width:34,height:34,borderRadius:"50%",background:authUser.role==="admin"?"rgba(168,255,62,.12)":"rgba(255,255,255,.06)",border:"1px solid "+(authUser.role==="admin"?"rgba(168,255,62,.3)":"rgba(255,255,255,.12)"),display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,cursor:"pointer",color:authUser.role==="admin"?SESS_COLOR:"rgba(255,255,255,.82)",fontFamily:"inherit",fontWeight:700}}
                title="Profile">
                {authUser.displayName ? authUser.displayName[0].toUpperCase() : "?"}
              </button>
            </div>
          </div>

          {/* Content area */}
          <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
            {tab==="home" && (
              <HomeTab
                authUser={authUser}
                decks={decks}
                orgTeams={orgTeams}
                onSwitchDeckAndPlay={handleSwitchDeckAndPlay}
              />
            )}
            <div style={{flex:1,display:tab==="play"?"flex":"none",flexDirection:"column",overflow:"hidden"}}>
              <PlayTab
                deck={deck}
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
                onUpsert={upsertCard}
                onDelete={deleteCard}
                onUpdateDeck={updateDeck}
                readOnly={authUser.role !== "admin"}
              />
            )}
            {tab==="objections" && (
              <ObjectionsTab
                key={deck.id+"-obj"}
                deck={deck}
                onUpdateDeck={updateDeck}
                readOnly={authUser.role !== "admin"}
              />
            )}
            {tab==="admin" && authUser.role === "admin" && (
              <AdminPanel
                authUser={authUser}
                orgUsers={orgUsers}
                orgTeams={orgTeams}
                onRefreshUsers={refreshOrgUsers}
                onRefreshTeams={refreshOrgTeams}
              />
            )}
          </div>

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

        {showDS && (
          <DeckSwitcherSheet
            decks={decks}
            activeDeckId={activeId}
            onSelect={switchDeck}
            onAddDeck={addDeck}
            onClose={function(){setShowDS(false);}}
            isAdmin={authUser.role === "admin"}
            onEditDeck={editDeckMeta}
            orgUsers={orgUsers}
            orgTeams={orgTeams}
          />
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
      </div>
    </TipCtx.Provider>
  );
}
