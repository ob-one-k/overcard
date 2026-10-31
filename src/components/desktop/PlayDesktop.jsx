import { useState, useEffect, useRef, useContext } from "react";
import { cachedGet, peek, useCacheVersion } from "../../lib/dataCache";
import { OrgMark } from "../OrgMark";
import DesktopCtx from "../../lib/DesktopCtx";
import { TM, OBJ_COLOR, SESS_COLOR, STYPE, sid, accentA, themed } from "../../lib/constants";
import { apiPost, apiPostWithRetry, lsGet, lsSet } from "../../lib/api";
import { solidBtn, ghostSm, inputSt } from "../../lib/styles";
import { RichPromptDisplay } from "../Tooltip";
import { useRecorder, buildAudioSegments } from "../../lib/useRecorder";
import { uploadSessionAudio, savePendingAudio, getAudioOwner } from "../../lib/audioUpload";
import { useLiveBeat, onSignedOut } from "../../lib/liveBeat";
import { RecordingSetup, RecIndicator } from "../RecordingSetup";
import { StudyPopout } from "../StudyCard";
import { ReferencePicker, ReferencePanel } from "../ReferenceSession";

// ─── PLAY DESKTOP ─────────────────────────────────────────────────────────────
// Desktop layout for the Play tab.
// Pre-session: two-column workspace that fills the viewport.
//   Left:  deck summary + start-session form (always visible) + objection stacks
//   Right: intended call path outline + recent runs on this deck
// Active session: action bar + three panes.
//   Left rail:  call path (visited trail, jump back, up-next) + objection stacks (one click)
//   Centre:     current card, large, with numbered answers (1–9 hotkeys)
//   Right rail: notes (N to focus) + live session stats
// The in-session navigator is desktop-specific; it emits the same visit/note
// events as Play.jsx's Navigator so session analytics are unchanged.

var MUTED   = "rgba(255,255,255,.55)";
var SUBTLE  = "rgba(255,255,255,.4)";
var PANEL   = { background:"rgba(255,255,255,.045)", border:"1px solid rgba(255,255,255,.08)", borderRadius:16 };

// Hover / focus affordance for the clickable study rows (inline styles can't express :hover)
var STUDY_ROW_CSS =
  ".oc-study-row{transition:background .15s}" +
  ".oc-study-row .oc-study-chev{opacity:0;transition:opacity .15s,transform .15s;transform:translateX(-4px)}" +
  ".oc-study-row:hover:not(:disabled){background:rgba(255,255,255,.06)!important}" +
  ".oc-study-row-obj:hover:not(:disabled){background:rgba(239,83,80,.13)!important}" +
  ".oc-study-row:hover .oc-study-chev,.oc-study-row:focus-visible .oc-study-chev{opacity:1;transform:none}" +
  ".oc-study-row:focus-visible{outline:2px solid rgba(255,255,255,.55);outline-offset:1px}" +
  "@media (hover:none){.oc-study-row .oc-study-chev{opacity:.8;transform:none}}";

function panelHdr(color) {
  return { fontSize:12, fontWeight:700, letterSpacing:1.1, textTransform:"uppercase", color: color || SUBTLE };
}

// Follow intended-path answers from a card, stopping on loops or dead ends
function intendedChain(fromId, cards, skip) {
  var out = [];
  var seen = {};
  (skip || []).forEach(function(id) { seen[id] = true; });
  var cur = cards[fromId];
  var guard = 0;
  while (cur && guard < 40) {
    guard++;
    var nextAns = (cur.answers || []).find(function(a) { return a.next && cards[a.next] && cards[a.next].intendedPath && !seen[a.next]; });
    if (!nextAns) break;
    seen[nextAns.next] = true;
    cur = cards[nextAns.next];
    out.push(cur);
  }
  return out;
}

function fmtClock(sec) {
  var mm = Math.floor(sec / 60);
  var ss = sec % 60;
  return mm + ":" + (ss < 10 ? "0" : "") + ss;
}

function fmtWhen(ts) {
  var d = new Date(ts);
  return d.toLocaleDateString("en-US", { month:"short", day:"numeric" }) + " · " + d.toLocaleTimeString("en-US", { hour:"numeric", minute:"2-digit" });
}

function OutcomePill({ session }) {
  var mode = session.mode || session.sessionType || "live";
  var o = session.outcome || "";
  var spec;
  if (mode === "practice")            spec = { t:"Practice",   c:"#00B4FF" };
  else if (session.sold || o === "sold") spec = { t:"Sold",     c:"#66BB6A" };
  else if (o === "booked")            spec = { t:"Booked",     c:"#FFD54F" };
  else if (o === "not_contacted")     spec = { t:"No contact", c:"rgba(255,255,255,.6)" };
  else if (o === "abandoned")         spec = { t:"Abandoned",  c:"#EF5350" };
  else                                spec = { t:"Completed",  c:"rgba(255,255,255,.7)" };
  return (
    <span style={{fontSize:12,fontWeight:700,color:spec.c,border:"1px solid "+(spec.c.charAt(0)==="#"?spec.c+"55":"rgba(255,255,255,.2)"),background:spec.c.charAt(0)==="#"?spec.c+"18":"rgba(255,255,255,.05)",borderRadius:99,padding:"3px 10px",whiteSpace:"nowrap",flexShrink:0}}>
      {spec.t}
    </span>
  );
}

export function PlayDesktop({ deck, activeId, onPortalToReview, onSwitchDeck,
    playView, setPlayView, activeSession, setActiveSession, sessionEvents, setSessionEvents }) {

  var [pendingType,    setPendingType]    = useState("practice");
  var [newName,        setNewName]        = useState("");
  var [newDesc,        setNewDesc]        = useState("");
  var [saving,         setSaving]         = useState(false);
  var [nameError,      setNameError]      = useState(false);
  var [panelNote,      setPanelNote]      = useState("");
  var [recordAudio,    setRecordAudio]    = useState(false);
  var [elapsed,        setElapsed]        = useState(0);
  var [recent,         setRecent]         = useState(null);
  var [recentScope,    setRecentScope]    = useState("self");
  var [vw,             setVw]             = useState(function() { return window.innerWidth; });
  var [study,          setStudy]          = useState(null);   // null | { kind:"path", index } | { kind:"stack", stackId }
  var [refSel,         setRefSel]         = useState(null);   // chosen reference-session option (live sessions only)

  // In-session navigation state (desktop navigator)
  var [pitchHist, setPitchHist] = useState(deck.rootCard ? [deck.rootCard] : []);
  var [objMode,   setObjMode]   = useState(null);
  var [animKey,   setAnimKey]   = useState(0);
  var [dir,       setDir]       = useState(1);
  var cardEnterTime = useRef(Date.now());
  var noteRef       = useRef(null);
  var keyHandlerRef = useRef(null);

  // Shared recorder (device list, call-audio mixing, level meter); releases the mic on unmount
  var rec = useRecorder();
  // Tablet (compact): the side rails become slide-over drawers so the card keeps the width
  var desktop = useContext(DesktopCtx);
  var compact = !!(desktop && desktop.compact);
  var touch   = !!(desktop && desktop.isTouchPrimary);
  var [drawer, setDrawer] = useState(null);   // null | "path" | "notes"
  // Key points (card overview) collapse — shared with the phone layout, expanded by default
  var [ovCollapsed, setOvCollapsed] = useState(function(){ return lsGet("overcard_play_overviewCollapsed") === "1"; });
  function toggleOv() { var v = !ovCollapsed; setOvCollapsed(v); lsSet("overcard_play_overviewCollapsed", v ? "1" : "0"); }
  useEffect(function() { setDrawer(null); }, [animKey]);

  // Track viewport width for responsive pane layout
  useEffect(function() {
    var timer = null;
    function onResize() { clearTimeout(timer); timer = setTimeout(function(){ setVw(window.innerWidth); }, 60); }
    window.addEventListener("resize", onResize);
    return function() { window.removeEventListener("resize", onResize); clearTimeout(timer); };
  }, []);

  // Elapsed timer for active session
  useEffect(function() {
    if (playView !== "active" || !activeSession) { setElapsed(0); return; }
    setElapsed(Math.floor((Date.now() - activeSession.startTs) / 1000));
    var interval = setInterval(function() {
      setElapsed(Math.floor((Date.now() - activeSession.startTs) / 1000));
    }, 1000);
    return function() { clearInterval(interval); };
  }, [playView, activeSession]);

  // Recent runs on this deck — own sessions first, org-wide fallback (admins only; others get 403 → empty)
  var isActiveView = playView === "active";
  var sv = useCacheVersion("/sessions");
  useEffect(function() {
    if (isActiveView) return;
    var cancelled = false;
    var mineUrl = "/sessions?deckId=" + encodeURIComponent(deck.id);
    var orgUrl  = "/sessions?scope=org&deckId=" + encodeURIComponent(deck.id);
    // Show cached runs immediately (revisits / deck switches back), then refresh
    var cMine = peek(mineUrl), cOrg = peek(orgUrl);
    if (cMine && cMine.length) { setRecentScope("self"); setRecent(cMine); }
    else if (cMine && cOrg) { setRecentScope("org"); setRecent(cOrg); }
    else setRecent(null);
    cachedGet(mineUrl)
      .then(function(data) {
        var mine = Array.isArray(data) ? data : [];
        if (cancelled) return;
        if (mine.length > 0) { setRecentScope("self"); setRecent(mine); return; }
        return cachedGet(orgUrl)
          .then(function(org) { if (!cancelled) { setRecentScope("org"); setRecent(Array.isArray(org) ? org : []); } })
          .catch(function() { if (!cancelled) { setRecentScope("self"); setRecent([]); } });
      })
      .catch(function() { if (!cancelled) setRecent([]); });
    return function() { cancelled = true; };
  }, [deck.id, isActiveView, sv]);

  // Guard against deck switch during active session
  useEffect(function() {
    if (playView === "active" && activeSession && activeSession.deckId !== deck.id) {
      rec.abort();
      var finished = Object.assign({}, activeSession, { endTs:Date.now(), status:"completed", outcome:"completed", events:sessionEvents });
      apiPost("/sessions", finished).catch(function(e){ console.error("overcard:", e); });
      setActiveSession(null); setSessionEvents([]);
      setPlayView("home"); setNewName(""); setNewDesc(""); setNameError(false);
    }
    // Keep navigator state pointed at the current deck
    setPitchHist(deck.rootCard ? [deck.rootCard] : []);
    setObjMode(null);
    setStudy(null);
  }, [deck.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts while a session is active (handler kept in a ref so it sees fresh state)
  useEffect(function() {
    function onKey(e) { if (keyHandlerRef.current) keyHandlerRef.current(e); }
    document.addEventListener("keydown", onKey);
    return function() { document.removeEventListener("keydown", onKey); };
  }, []);

  // ── Session lifecycle ─────────────────────────────────────────────────────────
  function startSession() {
    var trimmed = (newName || "").trim();
    if (!trimmed) { setNameError(true); return; }
    var s = {
      id:sid(), deckId:deck.id, deckName:deck.name,
      deckColor:deck.color, deckIcon:deck.icon,
      name:trimmed, description:(newDesc||"").trim(),
      sessionType:pendingType, mode:pendingType,
      startTs:Date.now(), endTs:null,
      status:"active", outcome:"in_progress",
      sold:false, soldCardId:null, soldCardTitle:null, events:[],
      referenceSessionId: pendingType === "live" && refSel ? refSel.id : null,
    };
    setStudy(null);
    // Called from the Start click/Enter so the screen-share prompt (call audio) has its user gesture
    if (recordAudio) rec.start(s.id);
    setPitchHist(deck.rootCard ? [deck.rootCard] : []);
    setObjMode(null); setDir(1); setAnimKey(function(k){ return k + 1; });
    cardEnterTime.current = Date.now();
    setPanelNote("");
    setActiveSession(s); setSessionEvents([]); setPlayView("active");
  }

  function handleEvent(ev) {
    setSessionEvents(function(prev) { return prev.concat([ev]); });
  }

  function finishSession(sold, soldCard, outcomeOverride) {
    setSaving(true);
    var owner = getAudioOwner();   // captured now: a sign-out mid-save clears it
    var outcome = outcomeOverride || (sold ? "sold" : "completed");
    // The card on screen hasn't been "left" yet — record it so the last segment isn't lost
    var lastVisit = leaveCurrent();
    var events = sessionEvents.concat(lastVisit ? [lastVisit] : []);

    rec.stop().then(function(audio) {
      var segs = audio ? buildAudioSegments(events, audio.durationMs) : [];
      var finished = Object.assign({}, activeSession, {
        endTs:Date.now(), status:"completed", outcome:outcome,
        sold:!!sold, soldCardId:sold&&soldCard?soldCard.id:null, soldCardTitle:sold&&soldCard?soldCard.title:null,
        events:events, audioSegments:segs.length>0?segs:null,
        audioDurationMs: audio ? audio.durationMs : null,
      });
      apiPostWithRetry("/sessions", finished, 3)
        .then(function() {
          // Upload runs in the background; the review shows its progress / retry
          if (audio) uploadSessionAudio(finished.id, audio.blob, audio.mimeType, audio.durationMs);
          setSaving(false); setActiveSession(null); setSessionEvents([]);
          setPlayView("home"); setNewName(""); setNewDesc(""); setNameError(false); setRefSel(null);
          onPortalToReview(finished.id);
        })
        .catch(function() {
          // Couldn't save (offline, signed out): keep the recording on this device — the
          // server has the run from its heartbeats, and the audio uploads after next sign-in
          if (audio) savePendingAudio(finished.id, audio, owner);
          setSaving(false); setActiveSession(null); setSessionEvents([]);
          setPlayView("home"); setNameError(false); onPortalToReview(null);
        });
    });
  }

  // ── Desktop navigator (mirrors Play.jsx Navigator semantics) ─────────────────
  var inObj    = !!objMode;
  var curCards = inObj ? objMode.stack.cards : deck.cards;
  var curId    = inObj ? objMode.history[objMode.history.length-1] : pitchHist[pitchHist.length-1];
  var card     = curId ? curCards[curId] : null;
  var meta     = card ? (TM[card.type] || TM.pitch) : TM.pitch;

  function emitVisit(c, dur) {
    var audioEnd   = rec.offsetMs();
    var audioStart = audioEnd !== null ? Math.max(0, audioEnd - dur) : null;
    var ev = { type:"visit", cardId:c.id, cardTitle:c.title, cardType:c.type, isObjCard:inObj, stackLabel:inObj&&objMode?objMode.stack.label:null, intendedPath:!!c.intendedPath, ts:Date.now(), durationMs:dur, audioStartMs:audioStart, audioEndMs:audioEnd };
    handleEvent(ev);
    return ev;
  }
  // Every card change (forward, back, jump, leaving an objection, restart) closes the current
  // card's visit so audio segments tile the whole recording with no gaps
  function leaveCurrent() {
    var dur = Date.now() - cardEnterTime.current;
    var ev = card ? emitVisit(card, dur) : null;
    cardEnterTime.current = Date.now();
    return ev;
  }
  function bump(d) { setDir(d); setAnimKey(function(k){ return k + 1; }); }

  function goAnswer(ans) {
    if (!ans) return;
    if (inObj) {
      leaveCurrent();
      if (!ans.next) {
        bump(-1);
        var tc = objMode && objMode.stack && objMode.stack.targetCard;
        var validTc = tc && tc !== "__pick" && deck.cards[tc];
        if (validTc) setPitchHist(function(h) { return h.concat([tc]); });
        setObjMode(null);
      } else {
        bump(1);
        setObjMode(function(o) { return Object.assign({}, o, { history:o.history.concat([ans.next]) }); });
      }
    } else {
      if (!ans.next) return;
      leaveCurrent(); bump(1);
      setPitchHist(function(h) { return h.concat([ans.next]); });
    }
  }
  function goBack() {
    if (inObj || pitchHist.length > 1) leaveCurrent();
    if (inObj) {
      bump(-1);
      if (objMode.history.length <= 1) setObjMode(null);
      else setObjMode(function(o) { return Object.assign({}, o, { history:o.history.slice(0,-1) }); });
    } else if (pitchHist.length > 1) {
      bump(-1);
      setPitchHist(function(h) { return h.slice(0,-1); });
    }
  }
  function jumpTo(idx) {
    if (inObj || idx >= pitchHist.length - 1) return;
    leaveCurrent(); bump(-1);
    setPitchHist(function(h) { return h.slice(0, idx + 1); });
  }
  function openStack(stack) {
    if (!stack.rootCard || !stack.cards[stack.rootCard]) return;
    leaveCurrent(); bump(1);
    setObjMode({ stack:stack, history:[stack.rootCard], returnCard:curId });
  }
  function exitObj() { leaveCurrent(); bump(-1); setObjMode(null); }
  function restart() { leaveCurrent(); bump(-1); setPitchHist(deck.rootCard ? [deck.rootCard] : []); }

  function submitPanelNote() {
    var text = panelNote.trim();
    if (!text || !card) return;
    handleEvent({ type:"note", cardId:card.id, cardTitle:card.title, text:text, ts:Date.now() });
    setPanelNote("");
  }

  // Refresh key handler every render
  keyHandlerRef.current = function(e) {
    if (playView !== "active" || !activeSession || saving) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target; var tag = t && t.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) {
      if (e.key === "Escape" && t.blur) t.blur();
      return;
    }
    if (!card) return;
    var n = parseInt(e.key, 10);
    if (n >= 1 && n <= 9) {
      var ans = card.answers[n - 1];
      if (ans) { e.preventDefault(); goAnswer(ans); }
      return;
    }
    if (e.key === "Backspace" || e.key === "ArrowLeft") { e.preventDefault(); goBack(); return; }
    if (e.key === "Escape" && inObj) { e.preventDefault(); exitObj(); return; }
    if ((e.key === "n" || e.key === "N") && noteRef.current) { e.preventDefault(); noteRef.current.focus(); }
  };

  // Live: the server keeps a copy of the run so admins can watch it and nothing is lost
  var liveRun = playView === "active" && activeSession && !saving ? activeSession : null;
  useLiveBeat(liveRun, sessionEvents, card ? {
    cardId: card.id, cardTitle: card.title, cardType: card.type,
    inObjection: inObj, stackLabel: inObj && objMode ? objMode.stack.label : null,
  } : null);
  // Signed out mid-call (this account signed in elsewhere): the server already saved the
  // path; keep the recording on this device — it uploads after the next sign-in
  var signedOutRef = useRef(null);
  signedOutRef.current = function() {
    if (!activeSession) return;
    var id = activeSession.id, who = getAudioOwner();
    rec.stop().then(function(audio) { if (audio) savePendingAudio(id, audio, who); });
  };
  useEffect(function() { return onSignedOut(function() { if (signedOutRef.current) signedOutRef.current(); }); }, []);

  // ════════════════════════════════════════════════════════════════════════════
  // ── ACTIVE SESSION ──────────────────────────────────────────────────────────
  // ════════════════════════════════════════════════════════════════════════════
  if (playView === "active" && activeSession) {
    var st = STYPE[activeSession.sessionType] || STYPE.live;
    var noteEvents   = sessionEvents.filter(function(ev) { return ev.type === "note"; });
    var visitEvents  = sessionEvents.filter(function(ev) { return ev.type === "visit"; });
    var mainVisits   = visitEvents.filter(function(ev) { return !ev.isObjCard; });
    var onPathPct    = mainVisits.length > 0 ? Math.round(mainVisits.filter(function(v){ return v.intendedPath; }).length / mainVisits.length * 100) : null;
    var objHandled   = {};
    visitEvents.forEach(function(ev) { if (ev.isObjCard && ev.stackLabel) objHandled[ev.stackLabel] = true; });
    if (inObj) objHandled[objMode.stack.label] = true;
    var objCount     = Object.keys(objHandled).length;
    var upNext       = (!inObj && curId) ? intendedChain(curId, deck.cards, pitchHist).slice(0, 4) : [];
    var isEnd        = card && !inObj && card.answers.every(function(a) { return !a.next; });
    var showNoContact = activeSession.mode === "live" && pitchHist.length === 1 && !inObj;
    var sideBySide   = vw >= 1680;
    var railL        = vw >= 1600 ? 300 : 264;
    var railR        = vw >= 1600 ? 340 : 296;
    var animName     = dir > 0 ? "cardIn" : "cardBack";
    var big          = vw >= 1680;

    var barBtn = { borderRadius:10, fontSize:compact?13:14, fontWeight:700, padding:compact?"0 12px":"0 18px", height:compact?44:40, cursor:saving?"wait":"pointer", fontFamily:"inherit", flexShrink:0, display:"inline-flex", alignItems:"center", gap:7 };

    return (
      <div style={{display:"flex",flexDirection:"column",height:"100%",overflow:"hidden"}}>

        {/* ── ACTION BAR ───────────────────────────────────────────────────────── */}
        <div style={{display:"flex",alignItems:"center",gap:compact?10:16,height:64,flexShrink:0,background:themed("rgba(4,12,30,.85)"),borderBottom:"1px solid rgba(255,255,255,.08)",padding:compact?"0 12px":"0 20px"}}>
          {compact && (
            <button onClick={function(){ setDrawer(drawer === "path" ? null : "path"); }} aria-label="Call path and objections" aria-expanded={drawer === "path"}
              style={{width:44,height:44,borderRadius:10,border:"1px solid rgba(255,255,255,.15)",background:drawer==="path"?"rgba(255,255,255,.14)":"rgba(255,255,255,.06)",color:"#fff",fontSize:17,cursor:"pointer",flexShrink:0}}>☰</button>
          )}
          <OrgMark size={22}/>
          <div style={{display:"flex",alignItems:"center",gap:8,background:st.bg,border:"1px solid "+st.border,borderRadius:99,padding:"5px 13px",flexShrink:0}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:st.color,boxShadow:"0 0 7px "+st.color,animation:"pulse 1.8s ease-in-out infinite"}}/>
            <span style={{fontSize:13,color:st.color,fontWeight:700,letterSpacing:.6,textTransform:"uppercase"}}>{st.label} session</span>
          </div>
          <div style={{fontSize:22,fontWeight:700,color:"#fff",fontFeatureSettings:'"tnum"',letterSpacing:.5,flexShrink:0}} aria-label="Elapsed time">{fmtClock(elapsed)}</div>
          <RecIndicator rec={rec} size="lg"/>
          {!compact && <div style={{width:1,height:26,background:"rgba(255,255,255,.1)",flexShrink:0}}/>}
          <div style={{fontSize:14,color:MUTED,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",minWidth:0,display:compact?"none":undefined}}>
            {inObj
              ? <span><span style={{color:OBJ_COLOR,fontWeight:700}}>Handling objection:</span> {objMode.stack.label}</span>
              : <span>Step <strong style={{color:"#fff"}}>{pitchHist.length}</strong>{card ? " · " + card.title : ""}</span>}
          </div>
          <div style={{flex:1}}/>
          {showNoContact && (
            <button onClick={function(){finishSession(false,null,"not_contacted");}} disabled={saving}
              style={Object.assign({},barBtn,{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.18)",color:"rgba(255,255,255,.75)"})}>
              📵 No Contact
            </button>
          )}
          <button onClick={function(){finishSession(true,null);}} disabled={saving}
            style={Object.assign({},barBtn,{background:"#66BB6A",border:"none",color:"#000"})}>
            ✓ Sold
          </button>
          <button onClick={function(){finishSession(false,null,"booked");}} disabled={saving}
            style={Object.assign({},barBtn,{background:"rgba(255,213,79,.13)",border:"1px solid rgba(255,213,79,.4)",color:"#FFD54F"})}>
            📅 Booked
          </button>
          <button onClick={function(){finishSession(false,null);}} disabled={saving}
            style={Object.assign({},barBtn,{background:"rgba(255,255,255,.1)",border:"1px solid rgba(255,255,255,.2)",color:"#fff"})}>
            {saving ? "Saving…" : compact ? "End" : "End Session"}
          </button>
          {compact && (
            <button onClick={function(){ setDrawer(drawer === "notes" ? null : "notes"); }} aria-label="Notes and stats" aria-expanded={drawer === "notes"}
              style={{width:44,height:44,borderRadius:10,border:"1px solid rgba(255,255,255,.15)",background:drawer==="notes"?"rgba(255,255,255,.14)":"rgba(255,255,255,.06)",color:"#fff",fontSize:17,cursor:"pointer",flexShrink:0}}>📝</button>
          )}
        </div>

        {/* ── BODY: left rail | card | right rail ─────────────────────────────── */}
        <div style={{flex:1,display:"flex",overflow:"hidden",minHeight:0,position:"relative"}}>
          {compact && drawer && (
            <div onClick={function(){ setDrawer(null); }} style={{position:"absolute",inset:0,background:"rgba(0,0,0,.5)",zIndex:15}} aria-hidden="true"/>
          )}

          {/* LEFT RAIL — call path + objections (drawer on tablet) */}
          <aside aria-label="Call path and objections" style={Object.assign({width:railL,minWidth:railL,display:"flex",flexDirection:"column",borderRight:"1px solid rgba(255,255,255,.07)",background:themed("rgba(4,12,30,.45)"),overflow:"hidden"},
            compact ? {position:"absolute",left:0,top:0,bottom:0,zIndex:20,width:Math.min(railL + 20, 320),minWidth:0,background:themed("#081428"),boxShadow:"8px 0 32px rgba(0,0,0,.6)",display:drawer==="path"?"flex":"none"} : {})}>
            <div style={{flex:1,overflowY:"auto",padding:"18px 16px 12px"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                <span style={panelHdr()}>Call path</span>
                <button onClick={goBack} disabled={!inObj && pitchHist.length <= 1}
                  title="Back (← or Backspace)"
                  style={ghostSm({fontSize:13,padding:"5px 12px",opacity:(!inObj && pitchHist.length <= 1)?.35:1,cursor:(!inObj && pitchHist.length <= 1)?"default":"pointer"})}>← Back</button>
              </div>
              <ol style={{listStyle:"none",margin:0,padding:0}}>
                {pitchHist.map(function(hid, i) {
                  var hc = deck.cards[hid]; if (!hc) return null;
                  var hm = TM[hc.type] || TM.pitch;
                  var isCur = !inObj && i === pitchHist.length - 1;
                  var canJump = !inObj && i < pitchHist.length - 1;
                  return (
                    <li key={hid + "-" + i}>
                      <button onClick={function(){ jumpTo(i); }} disabled={!canJump}
                        title={canJump ? "Jump back to this card" : undefined}
                        style={{display:"flex",alignItems:"center",gap:10,width:"100%",textAlign:"left",background:isCur?hm.color+"1f":"transparent",border:"1px solid "+(isCur?hm.color+"55":"transparent"),borderRadius:10,padding:"8px 10px",marginBottom:2,cursor:canJump?"pointer":"default",fontFamily:"inherit"}}>
                        <span style={{width:24,height:24,borderRadius:"50%",border:"2px solid "+hm.color,background:isCur?hm.color:"transparent",color:isCur?"#000":hm.color,fontSize:12,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{i + 1}</span>
                        <span style={{fontSize:14,fontWeight:isCur?700:500,color:isCur?"#fff":"rgba(255,255,255,.7)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{hc.title}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              {inObj && (
                <div style={{margin:"6px 0 0 14px",paddingLeft:12,borderLeft:"2px solid rgba(239,83,80,.4)"}}>
                  <div style={{fontSize:12,fontWeight:700,color:OBJ_COLOR,margin:"4px 0 6px",letterSpacing:.4}}>🛡️ {objMode.stack.label}</div>
                  {objMode.history.map(function(oid, i) {
                    var oc = objMode.stack.cards[oid]; if (!oc) return null;
                    var isCur = i === objMode.history.length - 1;
                    return (
                      <div key={oid + "-" + i} style={{fontSize:14,padding:"6px 8px",borderRadius:8,marginBottom:2,color:isCur?"#fff":"rgba(255,255,255,.6)",fontWeight:isCur?700:500,background:isCur?"rgba(239,83,80,.14)":"transparent",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{oc.title}</div>
                    );
                  })}
                </div>
              )}
              {upNext.length > 0 && (
                <div style={{marginTop:16}}>
                  <div style={Object.assign({},panelHdr("rgba(102,187,106,.75)"),{marginBottom:8})}>★ Up next on intended path</div>
                  {upNext.map(function(uc, i) {
                    var um = TM[uc.type] || TM.pitch;
                    return (
                      <div key={uc.id} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 10px",opacity:1 - i * .15}}>
                        <span style={{width:24,height:24,borderRadius:"50%",border:"1.5px dashed "+um.color+"88",color:um.color,fontSize:12,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{pitchHist.length + i + 1}</span>
                        <span style={{fontSize:14,color:"rgba(255,255,255,.55)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{uc.title}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Objection stacks — one click to open */}
            <div style={{flexShrink:0,borderTop:"1px solid rgba(255,255,255,.07)",padding:"14px 16px 16px",maxHeight:"45%",overflowY:"auto"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                <span style={panelHdr("rgba(239,83,80,.85)")}>🛡️ Objections</span>
                {inObj && <button onClick={exitObj} title="Exit objection (Esc)" style={ghostSm({fontSize:12,padding:"4px 11px",color:OBJ_COLOR,borderColor:"rgba(239,83,80,.4)"})}>Exit</button>}
              </div>
              {deck.objStacks.length === 0 && <div style={{fontSize:13,color:SUBTLE}}>No objection stacks in this deck.</div>}
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {deck.objStacks.map(function(stack) {
                  var ready = !!(stack.rootCard && stack.cards[stack.rootCard]);
                  var active = inObj && objMode.stack.id === stack.id;
                  var handled = objHandled[stack.label];
                  return (
                    <button key={stack.id} onClick={function(){ if (!active) openStack(stack); }} disabled={!ready}
                      aria-current={active || undefined}
                      title={!ready ? "This stack has no entry card yet" : active ? "Currently handling" : "Handle this objection"}
                      style={{display:"flex",alignItems:"center",gap:10,width:"100%",textAlign:"left",minHeight:44,background:active?"rgba(239,83,80,.18)":"rgba(239,83,80,.07)",border:"1px solid "+(active?"rgba(239,83,80,.55)":"rgba(239,83,80,.2)"),borderRadius:11,padding:"8px 12px",cursor:(!ready||active)?"default":"pointer",fontFamily:"inherit",opacity:ready?1:.45}}>
                      <span style={{fontSize:18,lineHeight:1,flexShrink:0}}>{stack.icon}</span>
                      <span style={{flex:1,fontSize:14,fontWeight:600,color:"rgba(255,255,255,.88)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{stack.label}</span>
                      {active && <span style={{fontSize:11,fontWeight:700,color:OBJ_COLOR,textTransform:"uppercase",letterSpacing:.5}}>Active</span>}
                      {handled && !active && <span title="Handled this session" style={{fontSize:12,color:"#66BB6A",fontWeight:700}}>✓</span>}
                      {!active && ready && <span aria-hidden="true" style={{fontSize:16,color:"rgba(239,83,80,.7)"}}>›</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </aside>

          {/* CENTRE — current card + answers */}
          <main style={{flex:1,minWidth:0,overflowY:"auto",padding:"24px 28px 28px"}}>
            {!card && (
              <div style={{height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:14,color:MUTED,textAlign:"center"}}>
                <div style={{fontSize:48}}>📭</div>
                <div style={{fontSize:16,lineHeight:1.6}}>This deck has no cards yet.<br/>Go to <strong style={{color:"#fff"}}>Cards</strong> to build it, then come back.</div>
              </div>
            )}
            {card && (
              <div style={{display:"grid",gridTemplateColumns:sideBySide?"minmax(0,1.35fr) minmax(0,1fr)":"minmax(0,1fr)",gap:sideBySide?28:20,alignItems:"start",maxWidth:sideBySide?1500:1000,margin:"0 auto"}}>
                {/* Card */}
                <div key={animKey} style={{animation:animName+" .3s cubic-bezier(.22,1,.36,1) both"}}>
                  {inObj && (
                    <div style={{marginBottom:14,padding:"12px 16px",background:"rgba(239,83,80,.1)",border:"1px solid rgba(239,83,80,.3)",borderRadius:14,display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}>
                      <div style={{fontSize:14,color:"rgba(255,255,255,.7)"}}>
                        <strong style={{color:OBJ_COLOR}}>🛡️ {objMode.stack.label}</strong>
                        <span style={{margin:"0 8px",color:"rgba(255,255,255,.25)"}}>·</span>
                        {(function(){
                          var tc = objMode.stack.targetCard;
                          if (tc && tc !== "__pick" && deck.cards[tc]) return <span>Then continues to <strong style={{color:"#fff"}}>{deck.cards[tc].title}</strong></span>;
                          return <span>Returns to <strong style={{color:"#fff"}}>{deck.cards[objMode.returnCard] ? deck.cards[objMode.returnCard].title : "current card"}</strong></span>;
                        })()}
                      </div>
                      <button onClick={exitObj} style={ghostSm({fontSize:13,color:OBJ_COLOR,borderColor:"rgba(239,83,80,.4)"})}>Exit objection</button>
                    </div>
                  )}
                  <article style={{background:"linear-gradient(145deg,rgba(255,255,255,.075),rgba(255,255,255,.03))",border:"1px solid rgba(255,255,255,"+(inObj?".16":".11")+")",borderRadius:22,overflow:"hidden",boxShadow:"0 0 48px "+meta.glow+",0 20px 50px rgba(0,0,0,.45)"}}>
                    <div style={{height:4,background:"linear-gradient(90deg,"+meta.color+" 0%,"+meta.color+"99 55%,transparent 100%)"}}/>
                    <div style={{padding:"20px 28px 0",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                      <span style={{display:"inline-flex",alignItems:"center",gap:6,background:meta.color+"22",border:"1px solid "+meta.color+"55",color:meta.color,borderRadius:99,fontSize:13,fontWeight:700,letterSpacing:.6,padding:"4px 12px",textTransform:"uppercase"}}>{meta.icon} {meta.label}</span>
                      {card.intendedPath && <span style={{fontSize:13,fontWeight:700,color:"#66BB6A",background:"rgba(102,187,106,.14)",border:"1px solid rgba(102,187,106,.35)",borderRadius:99,padding:"4px 12px"}}>★ Intended path</span>}
                      {inObj && <span style={{fontSize:13,fontWeight:700,color:OBJ_COLOR,background:"rgba(239,83,80,.12)",border:"1px solid rgba(239,83,80,.3)",borderRadius:99,padding:"4px 12px"}}>Objection response</span>}
                    </div>
                    <h2 style={{margin:0,padding:"14px 28px 16px",fontSize:big?36:30,fontWeight:700,color:"#fff",lineHeight:1.2,fontFamily:"'Lora',Georgia,serif"}}>{card.title}</h2>
                    {(function() {
                      // Key points: collapsible (expanded by default); the choice carries across cards
                      var pts = (card.overview || []).filter(function(b){ return b && b.trim(); });
                      if (!pts.length) return null;
                      return (
                        <div style={{margin:"0 24px 16px",padding:ovCollapsed ? "10px 18px" : "12px 18px 14px",background:"rgba(255,255,255,.06)",borderRadius:14,borderLeft:"3px solid "+meta.color+"99"}}>
                          <button onClick={toggleOv} aria-expanded={!ovCollapsed}
                            style={{display:"flex",alignItems:"center",gap:8,width:"100%",background:"none",border:"none",padding:0,minHeight:compact ? 36 : undefined,marginBottom:ovCollapsed ? 0 : 10,cursor:"pointer",fontFamily:"inherit",color:MUTED,fontSize:12,fontWeight:700,letterSpacing:1,textTransform:"uppercase"}}>
                            <span style={{color:meta.color,fontSize:13}}>{ovCollapsed ? "▸" : "▾"}</span> Key points · {pts.length}
                          </button>
                          {!ovCollapsed && (
                            <ul style={{listStyle:"none",margin:0,padding:0}}>
                              {pts.map(function(b, i) {
                                return (
                                  <li key={i} style={{display:"flex",alignItems:"flex-start",gap:10,marginBottom:i<pts.length-1?8:0}}>
                                    <span aria-hidden="true" style={{color:meta.color,fontSize:11,marginTop:5,flexShrink:0}}>◆</span>
                                    <span style={{fontSize:big?18:16,color:"rgba(255,255,255,.88)",lineHeight:1.5}}>{b}</span>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      );
                    })()}
                    <div style={{margin:"0 24px 24px",padding:big?"28px 30px":"22px 24px",background:"rgba(0,0,0,.3)",borderRadius:16,borderLeft:"4px solid "+meta.color}}>
                      <p style={{margin:0,fontSize:big?25:21,lineHeight:1.7,color:"rgba(255,255,255,.95)",fontFamily:"'Lora',Georgia,serif"}}>
                        <RichPromptDisplay text={card.prompt} accentColor={meta.color}/>
                      </p>
                    </div>
                  </article>
                </div>

                {/* Answers */}
                <section aria-label="Prospect responses" key={animKey + "a"} style={{animation:"answersIn .35s cubic-bezier(.22,1,.36,1) .08s both",marginTop:sideBySide?(inObj?66:0):0}}>
                  <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:10,padding:"0 2px"}}>
                    <span style={panelHdr()}>{inObj ? "Navigate objection" : "Prospect responds"}</span>
                    <span style={{fontSize:12,color:SUBTLE}}>Press 1–{Math.min(9, Math.max(1, card.answers.length))}</span>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {card.answers.length === 0 && <div style={{fontSize:14,color:SUBTLE,padding:"8px 2px"}}>No responses on this card.</div>}
                    {card.answers.map(function(ans, i) {
                      var nextCard   = ans.next ? curCards[ans.next] : null;
                      var nm         = nextCard ? (TM[nextCard.type] || TM.pitch) : null;
                      var isTerminal = !ans.next;
                      var disabled   = isTerminal && !inObj;
                      var isIntended = !inObj && nextCard && !!nextCard.intendedPath;
                      return (
                        <button key={ans.id} onClick={function(){ goAnswer(ans); }} disabled={disabled}
                          style={{background:isIntended?"rgba(102,187,106,.09)":"rgba(255,255,255,.05)",border:"1.5px solid "+(isIntended?"rgba(102,187,106,.4)":disabled?"rgba(255,255,255,.06)":"rgba(255,255,255,.12)"),borderRadius:14,padding:big?"16px 18px":"14px 16px",minHeight:big?66:58,cursor:disabled?"default":"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:14,fontFamily:"inherit",opacity:disabled?.5:1,animation:"answerItem .32s cubic-bezier(.22,1,.36,1) "+(.06+i*.04)+"s both"}}>
                          <span style={{width:30,height:30,borderRadius:8,background:isIntended?"rgba(102,187,106,.2)":meta.color+"22",border:"1.5px solid "+(isIntended?"rgba(102,187,106,.55)":meta.color+"55"),color:isIntended?"#66BB6A":meta.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:800,flexShrink:0}}>{i + 1}</span>
                          <span style={{flex:1,minWidth:0}}>
                            <span style={{display:"block",color:"rgba(255,255,255,.95)",fontSize:big?17:16,lineHeight:1.4,fontWeight:500}}>{ans.label}</span>
                            {(nm || isTerminal) && (
                              <span style={{display:"block",fontSize:13,marginTop:3,color:nm?(isIntended?"#66BB6A":nm.color):SUBTLE,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                {nm ? "→ " + nextCard.title + (isIntended ? "  ★" : "") : inObj ? "↩ Resolve objection" : "End of path"}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {isEnd && (
                    <div style={{marginTop:14,padding:"16px 18px",background:"rgba(102,187,106,.08)",border:"1px solid rgba(102,187,106,.25)",borderRadius:14,display:"flex",alignItems:"center",gap:14}}>
                      <span style={{fontSize:24}}>✅</span>
                      <div style={{flex:1,fontSize:15,color:"rgba(255,255,255,.75)",lineHeight:1.5}}>End of this path. Record an outcome above, or restart the script.</div>
                      <button onClick={restart} style={Object.assign({},solidBtn("#66BB6A"),{fontSize:14,padding:"9px 16px",borderRadius:10})}>↺ Restart</button>
                    </div>
                  )}
                </section>
              </div>
            )}
          </main>

          {/* RIGHT RAIL — notes + stats */}
          <aside aria-label="Session notes and stats" style={Object.assign({width:railR,minWidth:railR,display:"flex",flexDirection:"column",borderLeft:"1px solid rgba(255,255,255,.07)",background:themed("rgba(4,12,30,.45)"),overflow:"hidden"},
            compact ? {position:"absolute",right:0,top:0,bottom:0,zIndex:20,width:Math.min(railR + 20, 340),minWidth:0,background:themed("#081428"),boxShadow:"-8px 0 32px rgba(0,0,0,.6)",display:drawer==="notes"?"flex":"none"} : {})}>
            {/* Live stats */}
            <div style={{flexShrink:0,display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,padding:"18px 16px 14px",borderBottom:"1px solid rgba(255,255,255,.07)"}}>
              {[
                { v: visitEvents.length + (card ? 1 : 0), l:"Cards seen", c:"#fff" },
                { v: onPathPct !== null ? onPathPct + "%" : "—", l:"On path", c:"#66BB6A" },
                { v: objCount, l:"Objections", c:OBJ_COLOR },
                { v: noteEvents.length, l:"Notes", c:SESS_COLOR },
              ].map(function(s) {
                return (
                  <div key={s.l} style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.07)",borderRadius:12,padding:"10px 12px"}}>
                    <div style={{fontSize:22,fontWeight:700,color:s.c,lineHeight:1.1}}>{s.v}</div>
                    <div style={{fontSize:12,color:MUTED,marginTop:3}}>{s.l}</div>
                  </div>
                );
              })}
            </div>

            {/* Note composer */}
            <div style={{flexShrink:0,padding:"14px 16px",borderBottom:"1px solid rgba(255,255,255,.06)"}}>
              <label htmlFor="desk-note" style={Object.assign({},panelHdr(accentA(.8)),{display:"block",marginBottom:8})}>📝 Add note</label>
              <textarea
                id="desk-note"
                ref={noteRef}
                value={panelNote}
                onChange={function(e){ setPanelNote(e.target.value); }}
                onKeyDown={function(e){ if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitPanelNote(); } }}
                placeholder={card ? "Note on “" + (card.title || "this card") + "”…" : "Navigate to a card first…"}
                disabled={!card}
                rows={3}
                style={Object.assign({},inputSt({resize:"none",fontSize:14,lineHeight:1.5,padding:"10px 12px"}),{opacity:card?1:.4})}
              />
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:8}}>
                <span style={{fontSize:12,color:SUBTLE}}>Enter to save · N to focus</span>
                <button onClick={submitPanelNote} disabled={!panelNote.trim() || !card}
                  style={{background:accentA(.14),border:("1px solid "+accentA(.35)),borderRadius:9,padding:"6px 14px",cursor:(!panelNote.trim()||!card)?"not-allowed":"pointer",color:SESS_COLOR,fontSize:13,fontWeight:700,fontFamily:"inherit",opacity:(!panelNote.trim()||!card)?.35:1}}>
                  Save note
                </button>
              </div>
            </div>

            {/* Reference session — their path synced to the card on screen */}
            {activeSession.referenceSessionId && (
              <div style={{flex:"2 1 0",minHeight:180,display:"flex",flexDirection:"column",borderBottom:"1px solid rgba(255,255,255,.06)",background:"rgba(179,157,219,.035)"}}>
                <ReferencePanel refId={activeSession.referenceSessionId} currentCardId={card ? card.id : null} variant="rail"/>
              </div>
            )}

            {/* Notes list */}
            <div style={{flex:1,overflowY:"auto",padding:"14px 16px",minHeight:activeSession.referenceSessionId?100:undefined}}>
              <div style={Object.assign({},panelHdr(),{marginBottom:10})}>Notes{noteEvents.length > 0 ? " (" + noteEvents.length + ")" : ""}</div>
              {noteEvents.length === 0 && (
                <div style={{fontSize:14,color:SUBTLE,lineHeight:1.6}}>Notes you add are pinned to the card you're on and show up in the session review.</div>
              )}
              {noteEvents.slice().reverse().map(function(ev, i) {
                return (
                  <div key={i} style={{background:accentA(.05),border:("1px solid "+accentA(.13)),borderRadius:10,padding:"10px 12px",marginBottom:8}}>
                    <div style={{display:"flex",justifyContent:"space-between",gap:8,marginBottom:4}}>
                      <span style={{fontSize:12,color:accentA(.75),fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ev.cardTitle || "General"}</span>
                      <span style={{fontSize:12,color:SUBTLE,flexShrink:0,fontFeatureSettings:'"tnum"'}}>{fmtClock(Math.max(0, Math.floor((ev.ts - activeSession.startTs) / 1000)))}</span>
                    </div>
                    <div style={{fontSize:14,color:"rgba(255,255,255,.85)",lineHeight:1.5,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{ev.text}</div>
                  </div>
                );
              })}
            </div>
          </aside>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ── PRE-SESSION WORKSPACE ───────────────────────────────────────────────────
  // ════════════════════════════════════════════════════════════════════════════
  var st2        = STYPE[pendingType] || STYPE.live;
  var cardCount  = Object.keys(deck.cards).length;
  var objCards   = deck.objStacks.reduce(function(sum, os){ return sum + Object.keys(os.cards).length; }, 0);
  var rootCard   = deck.rootCard ? deck.cards[deck.rootCard] : null;
  var outline    = rootCard ? [rootCard].concat(intendedChain(rootCard.id, deck.cards, [rootCard.id])) : [];
  var recentList = (recent || []).slice().sort(function(a, b){ return b.startTs - a.startTs; }).slice(0, 25);
  var liveRecent = (recent || []).filter(function(s){ return (s.mode || s.sessionType || "live") === "live"; });
  var soldRecent = liveRecent.filter(function(s){ return s.sold || s.outcome === "sold"; });
  var deckWin    = liveRecent.length > 0 ? Math.round(soldRecent.length / liveRecent.length * 100) : null;
  var narrow     = vw < 1240;

  return (
    <div style={{flex:1,minHeight:0,height:"100%",overflowY:narrow?"auto":"hidden",padding:compact?"16px":"22px 24px 24px",boxSizing:"border-box",
      display:"grid",gridTemplateColumns:narrow?"minmax(0,1fr)":"minmax(0,1.1fr) minmax(0,1fr)",gap:compact?16:22,
      // Stacked (narrow) rows must size to their content — with height:100% auto rows shrink and panels overlap
      alignContent:narrow?"start":undefined,gridAutoRows:narrow?"max-content":undefined}}>

      {/* ── LEFT: deck summary + start form + objections ── */}
      <div style={{display:"flex",flexDirection:"column",gap:20,minHeight:0,overflowY:narrow?"visible":"auto",paddingRight:narrow?0:2}}>

        {/* Deck summary */}
        <section style={Object.assign({},PANEL,{borderLeft:"4px solid "+deck.color,padding:"20px 22px",flexShrink:0})}>
          <div style={{display:"flex",alignItems:"center",gap:16}}>
            <div style={{width:56,height:56,borderRadius:15,background:deck.color+"22",border:"1.5px solid "+deck.color+"55",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,flexShrink:0}}>{deck.icon}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:24,fontWeight:700,color:"#fff",fontFamily:"'Lora',Georgia,serif",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{deck.name}</div>
              <div style={{fontSize:14,color:MUTED,marginTop:3}}>
                {rootCard ? "Opens with “" + rootCard.title + "”" : "No entry card set — add cards to start"}
              </div>
            </div>
            <OrgMark wide size={compact ? 44 : 56}/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,minmax(0,1fr))",gap:10,marginTop:18}}>
            {[
              { v:cardCount,              l:"Cards",          c:deck.color },
              { v:outline.length,         l:"Intended steps", c:"#66BB6A" },
              { v:deck.objStacks.length,  l:"Objection stacks", c:OBJ_COLOR },
              { v:deckWin !== null ? deckWin + "%" : "—", l:"Close rate", c:SESS_COLOR },
            ].map(function(item) {
              return (
                <div key={item.l} style={{background:"rgba(0,0,0,.22)",borderRadius:12,padding:"12px 14px"}}>
                  <div style={{fontSize:24,fontWeight:700,color:item.c,lineHeight:1}}>{item.v}</div>
                  <div style={{fontSize:13,color:MUTED,marginTop:5}}>{item.l}</div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Start a session */}
        <section aria-label="Start a session" style={Object.assign({},PANEL,{padding:"20px 22px 22px",flexShrink:0})}>
          <h2 style={{margin:"0 0 14px",fontSize:18,fontWeight:700,color:"#fff"}}>Start a session</h2>
          <div role="radiogroup" aria-label="Session type" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:18}}>
            {["practice","live"].map(function(key) {
              var stk = STYPE[key]; var on = pendingType === key;
              return (
                <button key={key} role="radio" aria-checked={on} onClick={function(){ setPendingType(key); setPlayView("new"); }}
                  style={{display:"flex",alignItems:"center",gap:14,background:on?stk.bg:"rgba(255,255,255,.04)",border:"1.5px solid "+(on?stk.color:"rgba(255,255,255,.1)"),borderRadius:14,padding:"14px 16px",cursor:"pointer",fontFamily:"inherit",textAlign:"left",transition:"all .15s"}}>
                  <span style={{fontSize:26,flexShrink:0}}>{key==="live"?"📞":"🎯"}</span>
                  <span style={{flex:1}}>
                    <span style={{display:"block",fontSize:16,fontWeight:700,color:on?stk.color:"rgba(255,255,255,.85)"}}>{stk.label}</span>
                    <span style={{display:"block",fontSize:13,color:MUTED,marginTop:2}}>{key==="live"?"A real call with a prospect":"Dry run — rehearse the script"}</span>
                  </span>
                  <span aria-hidden="true" style={{width:18,height:18,borderRadius:"50%",border:"2px solid "+(on?stk.color:"rgba(255,255,255,.3)"),display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    {on && <span style={{width:8,height:8,borderRadius:"50%",background:stk.color}}/>}
                  </span>
                </button>
              );
            })}
          </div>

          <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)",gap:14}}>
            <div>
              <label htmlFor="desk-sess-title" style={{display:"block",fontSize:13,fontWeight:600,color:"rgba(255,255,255,.75)",marginBottom:7}}>Title <span style={{color:"#EF5350"}}>*</span></label>
              <input id="desk-sess-title" value={newName} onChange={function(e){setNewName(e.target.value);setNameError(false);}}
                onKeyDown={function(e){if(e.key==="Enter")startSession();}}
                placeholder={pendingType==="live"?"e.g. Cold call — Acme Corp":"e.g. Morning practice run"}
                aria-invalid={nameError || undefined}
                style={inputSt({fontSize:15,padding:"12px 14px",borderColor:nameError?"rgba(239,83,80,.75)":undefined})} autoFocus/>
              {nameError && <div role="alert" style={{fontSize:13,color:"#EF5350",marginTop:6}}>Give this session a title to start.</div>}
            </div>
            <div>
              <label htmlFor="desk-sess-desc" style={{display:"block",fontSize:13,fontWeight:600,color:"rgba(255,255,255,.75)",marginBottom:7}}>Description <span style={{color:SUBTLE,fontWeight:400}}>(optional)</span></label>
              <input id="desk-sess-desc" value={newDesc} onChange={function(e){setNewDesc(e.target.value);}}
                onKeyDown={function(e){if(e.key==="Enter")startSession();}}
                placeholder={pendingType==="live"?"Prospect info, context, goals…":"What you're working on, focus areas…"}
                style={inputSt({fontSize:15,padding:"12px 14px"})}/>
            </div>
          </div>

          {/* Reference session (live only) */}
          {pendingType === "live" && (
            <div style={{marginTop:14}}>
              <ReferencePicker deckId={deck.id} value={refSel} onChange={setRefSel} size="lg"/>
            </div>
          )}

          {/* Audio recording */}
          <div style={{marginTop:14}}>
            <RecordingSetup rec={rec} enabled={recordAudio} setEnabled={setRecordAudio} size="lg"/>
          </div>

          <div style={{display:"flex",alignItems:"center",gap:14,marginTop:18}}>
            <button onClick={startSession}
              style={Object.assign({},solidBtn(st2.color),{flex:1,padding:"14px 20px",fontSize:16,borderRadius:12})}>
              ▶ Start {st2.label} Session
            </button>
            {!touch && <span style={{fontSize:13,color:SUBTLE,whiteSpace:"nowrap"}}>or press Enter</span>}
          </div>
        </section>

        {/* Objection stacks */}
        <section style={Object.assign({},PANEL,{padding:"18px 22px",flex:narrow?"none":1,minHeight:140,display:"flex",flexDirection:"column"})}>
          <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:12}}>
            <h2 style={{margin:0,fontSize:17,fontWeight:700,color:"#fff"}}>Objection stacks</h2>
            <span style={{fontSize:13,color:MUTED}}>{deck.objStacks.length} stack{deck.objStacks.length!==1?"s":""} · {objCards} response card{objCards!==1?"s":""}</span>
          </div>
          {deck.objStacks.length === 0 && <div style={{fontSize:14,color:SUBTLE}}>No objection stacks yet. Add them in the Objections tab.</div>}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:8}}>
            {deck.objStacks.map(function(stack) {
              var n = Object.keys(stack.cards).length;
              var ready = !!(stack.rootCard && stack.cards[stack.rootCard]);
              var tc = stack.targetCard && stack.targetCard !== "__pick" ? deck.cards[stack.targetCard] : null;
              return (
                <button key={stack.id} className="oc-study-row oc-study-row-obj" onClick={function(){ setStudy({ kind:"stack", stackId:stack.id }); }} disabled={n === 0}
                  title={n > 0 ? "Study this objection stack" : "This stack has no cards yet"}
                  style={{display:"flex",alignItems:"center",gap:11,width:"100%",textAlign:"left",fontFamily:"inherit",background:"rgba(239,83,80,.06)",border:"1px solid rgba(239,83,80,.18)",borderRadius:12,padding:"10px 12px",minHeight:touch?52:undefined,cursor:n>0?"pointer":"default",opacity:n>0?1:.6}}>
                  <span style={{fontSize:20,flexShrink:0}}>{stack.icon}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:14,fontWeight:600,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{stack.label}</div>
                    <div style={{fontSize:12,color:ready?MUTED:"#FFD54F",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                      {ready ? n + " card" + (n!==1?"s":"") + (tc ? " · then " + tc.title : " · returns to card") : "No entry card yet"}
                    </div>
                  </div>
                  {n > 0 && <span className="oc-study-chev" aria-hidden="true" style={{fontSize:13,color:"rgba(239,83,80,.75)",flexShrink:0}}>Study ›</span>}
                </button>
              );
            })}
          </div>
        </section>
      </div>

      {/* ── RIGHT: intended path + recent runs ── */}
      <div style={{display:"flex",flexDirection:"column",gap:20,minHeight:0}}>

        {/* Intended call path outline */}
        <section style={Object.assign({},PANEL,{flex:narrow?"none":"1 1 0",minHeight:narrow?0:200,display:"flex",flexDirection:"column",overflow:"hidden"})}>
          <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",padding:"18px 22px 12px",flexShrink:0}}>
            <h2 style={{margin:0,fontSize:17,fontWeight:700,color:"#fff"}}>Intended call path</h2>
            <span style={{fontSize:13,color:MUTED}}>{outline.length} step{outline.length!==1?"s":""}{outline.length > 0 ? " · " + (touch ? "tap" : "click") + " a step to study" : ""}</span>
          </div>
          <ol style={{listStyle:"none",margin:0,padding:"0 14px 16px",overflowY:"auto",flex:1}}>
            {outline.length === 0 && <li style={{fontSize:14,color:SUBTLE,padding:"0 8px"}}>Mark cards as “intended path” in the Cards tab to outline the ideal call here.</li>}
            {outline.map(function(oc, i) {
              var om = TM[oc.type] || TM.pitch;
              var first = (oc.overview || []).filter(function(b){ return b && b.trim(); })[0];
              return (
                <li key={oc.id}>
                <button className="oc-study-row" onClick={function(){ setStudy({ kind:"path", index:i }); }} title="Study this card"
                  style={{display:"flex",gap:12,width:"100%",textAlign:"left",background:"transparent",border:"none",fontFamily:"inherit",cursor:"pointer",padding:"8px 8px",borderRadius:10,minHeight:touch?52:undefined}}>
                  <div style={{display:"flex",flexDirection:"column",alignItems:"center",flexShrink:0}}>
                    <span style={{width:28,height:28,borderRadius:"50%",border:"2px solid "+om.color,color:om.color,fontSize:13,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center"}}>{i + 1}</span>
                    {i < outline.length - 1 && <span style={{width:2,flex:1,minHeight:10,background:"rgba(255,255,255,.1)",marginTop:4}}/>}
                  </div>
                  <div style={{flex:1,minWidth:0,paddingTop:3}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:15,fontWeight:600,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{oc.title}</span>
                      <span style={{fontSize:11,fontWeight:700,color:om.color,textTransform:"uppercase",letterSpacing:.5,flexShrink:0}}>{om.label}</span>
                    </div>
                    {first && <div style={{fontSize:13,color:MUTED,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{first}</div>}
                  </div>
                  <span className="oc-study-chev" aria-hidden="true" style={{alignSelf:"center",fontSize:13,color:"rgba(255,255,255,.35)",flexShrink:0}}>Study ›</span>
                </button>
                </li>
              );
            })}
          </ol>
        </section>

        {/* Recent runs on this deck */}
        <section style={Object.assign({},PANEL,{flex:narrow?"none":"1 1 0",minHeight:narrow?0:200,display:"flex",flexDirection:"column",overflow:"hidden"})}>
          <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",padding:"18px 22px 12px",flexShrink:0}}>
            <h2 style={{margin:0,fontSize:17,fontWeight:700,color:"#fff"}}>{recentScope === "org" ? "Recent team runs on this deck" : "Your recent runs"}</h2>
            {recent && recent.length > 0 && (
              <span style={{fontSize:13,color:MUTED}}>{recent.length} total{deckWin !== null ? " · " + deckWin + "% close" : ""}</span>
            )}
          </div>
          <div style={{overflowY:"auto",flex:1,padding:"0 12px 14px"}}>
            {recent === null && <div style={{fontSize:14,color:SUBTLE,padding:"4px 10px"}}>Loading sessions…</div>}
            {recent !== null && recentList.length === 0 && (
              <div style={{fontSize:14,color:SUBTLE,padding:"4px 10px",lineHeight:1.6}}>No sessions on this deck yet. Your runs will appear here.</div>
            )}
            {recentList.map(function(s) {
              var mine = recentScope === "self";
              var visits = (s.events || []).filter(function(e){ return e.type === "visit"; }).length;
              var dur = s.endTs ? Math.round((s.endTs - s.startTs) / 1000) : null;
              var Row = mine ? "button" : "div";
              return (
                <Row key={s.id} onClick={mine ? function(){ onPortalToReview(s.id); } : undefined}
                  title={mine ? "Open session review" : undefined}
                  style={{display:"flex",alignItems:"center",gap:12,width:"100%",textAlign:"left",background:"transparent",border:"none",borderBottom:"1px solid rgba(255,255,255,.05)",padding:"10px 10px",cursor:mine?"pointer":"default",fontFamily:"inherit",boxSizing:"border-box"}}>
                  <span style={{fontSize:18,flexShrink:0}}>{(s.mode||s.sessionType||"live") === "live" ? "📞" : "🎯"}</span>
                  <span style={{flex:1,minWidth:0}}>
                    <span style={{display:"block",fontSize:14,fontWeight:600,color:"rgba(255,255,255,.92)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name || "Untitled session"}</span>
                    <span style={{display:"block",fontSize:13,color:MUTED,marginTop:2}}>
                      {fmtWhen(s.startTs)}{dur !== null ? " · " + fmtClock(dur) : ""}{" · " + visits + " card" + (visits!==1?"s":"")}
                    </span>
                  </span>
                  <OutcomePill session={s}/>
                </Row>
              );
            })}
          </div>
        </section>
      </div>

      <style>{STUDY_ROW_CSS}</style>
      {study && <StudyPopout deck={deck} start={study} onClose={function(){ setStudy(null); }}/>}
    </div>
  );
}
