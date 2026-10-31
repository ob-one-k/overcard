import { useState, useEffect, useRef, useContext } from "react";
import { cachedGet, peek, useCacheVersion, useCachedGet } from "../lib/dataCache";
import { onLive } from "../lib/live";
import { OrgMark } from "./OrgMark";
import { TM, SESS_COLOR, STYPE, OBJ_COLOR, isAdminRole, roleMeta, accentA, themed } from "../lib/constants";
import { apiGet, apiPost, apiPut, apiDel } from "../lib/api";
import { solidBtn, ghostBtn, ghostSm, iconBtn, inputSt, cardBg, badgeSt, labelSt, dividerV } from "../lib/styles";
import { TypeBadge, Handle, SectionHdr, StatBox, BarRow, DarkDatePicker } from "./ui";
import { RichPromptDisplay } from "./Tooltip";
import { markSessionNotificationsRead } from "../lib/notifications";
import { useSessionAudio, AudioMiniBar, AudioPlayback, UploadNotice, CardClipPlayer, wallClockToAudioMs, segColor } from "./AudioPlayer";
import { deleteAudioBlob } from "../lib/audioStore";
import DesktopCtx from "../lib/DesktopCtx";
import { DesktopModal } from "./DesktopModal";
import { SessionsDesktop } from "./desktop/SessionsDesktop";
import { HighlightChip, HighlightBanner, HighlightEditor, canEditHighlight, HL_COLOR } from "./Highlights";

// ─── SESSION STATS HELPERS ────────────────────────────────────────────────────
// Analytics call these for every session on every render — cache per events array
// (session objects are replaced, never mutated, so the array identity is a safe key)
var visitsMemo = new WeakMap(), notesMemo = new WeakMap();
var NO_EVENTS = [];
function eventsOf(s, type, memo) {
  var ev = s.events || NO_EVENTS;
  var hit = memo.get(ev);
  if (!hit) { hit = ev.filter(function(e){ return e.type === type; }); memo.set(ev, hit); }
  return hit;
}
export function sessionVisits(s) { return eventsOf(s, "visit", visitsMemo); }
export function sessionNotes(s)  { return eventsOf(s, "note", notesMemo); }
export function sessionDurSec(s) { return s.endTs ? Math.round((s.endTs-s.startTs)/1000) : null; }
export function fmtSec(s) { if(!s||s<=0)return"0s"; if(s<60)return s+"s"; return Math.floor(s/60)+"m "+(s%60?s%60+"s":""); }
export function fmtMs(ms) { if(!ms||ms<1000)return"<1s"; if(ms<60000)return(ms/1000).toFixed(1)+"s"; return Math.floor(ms/60000)+"m"+(Math.round(ms/1000)%60)+"s"; }
export function fmtDate(ts) { return new Date(ts).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}); }
export function fmtTime(ts) { return new Date(ts).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}); }
export function fmtDateTime(ts) { return fmtDate(ts)+" · "+fmtTime(ts); }

// ─── SHARE MODAL ──────────────────────────────────────────────────────────────
export function ShareModal({ session, orgUsers, orgTeams, authUser, onClose }) {
  var desktop = useContext(DesktopCtx);
  var [shares, setShares]       = useState(null);
  var [selected, setSelected]   = useState([]);
  var [context, setContext]     = useState("");
  var [submitting, setSubmitting] = useState(false);
  var [error, setError]         = useState("");

  useEffect(function() {
    function load() {
      apiGet("/sessions/" + session.id + "/shares")
        .then(function(data){ setShares(data); })
        .catch(function(){ setShares(function(prev){ return prev || []; }); });
    }
    load();
    // Someone else shared or revoked while this is open
    return onLive("share.changed", function(d) { if (d && d.sessionId === session.id) load(); });
  }, [session.id]);

  var alreadySharedIds = (shares||[]).map(function(s){ return s.toUserId; });

  var availableUsers = (orgUsers||[]).filter(function(u){
    return u.id !== (authUser||{}).id && !alreadySharedIds.includes(u.id) && !selected.includes(u.id);
  });

  var selectedUsers = selected.map(function(uid){
    return (orgUsers||[]).find(function(u){ return u.id===uid; });
  }).filter(Boolean);

  function toggleUser(uid) {
    setSelected(function(prev){
      return prev.includes(uid) ? prev.filter(function(x){return x!==uid;}) : prev.concat([uid]);
    });
  }

  function addTeam(team) {
    var toAdd = (team.memberIds||[]).filter(function(uid){
      var u = (orgUsers||[]).find(function(x){return x.id===uid;});
      return u && u.id !== (authUser||{}).id && !alreadySharedIds.includes(uid) && !selected.includes(uid);
    });
    if (!toAdd.length) return;
    setSelected(function(prev){ return prev.concat(toAdd); });
  }

  function submitShare() {
    if (!selected.length) { setError("Select at least one person"); return; }
    setError(""); setSubmitting(true);
    var ctx = context.trim() || null;
    Promise.all(selected.map(function(uid){
      return apiPost("/sessions/" + session.id + "/share", { toUserId: uid, context: ctx });
    }))
      .then(function(newShares){
        setShares(function(prev){ return (prev||[]).concat(newShares); });
        setSelected([]); setContext("");
      })
      .catch(function(e){ setError(e.message||"Failed to share"); })
      .finally(function(){ setSubmitting(false); });
  }

  function revokeShare(shareId) {
    apiDel("/sessions/" + session.id + "/shares/" + shareId)
      .then(function(){ setShares(function(prev){ return prev.filter(function(s){ return s.id!==shareId; }); }); })
      .catch(function(e){ console.error("overcard:", e); });
  }

  var teams = (orgTeams||[]).filter(function(t){
    return (t.memberIds||[]).some(function(uid){
      return uid !== (authUser||{}).id && !alreadySharedIds.includes(uid) && !selected.includes(uid);
    });
  });

  var shareContent = (
    <div style={{padding:"16px 16px 24px"}}>
      <div style={{fontSize:10,color:"rgba(255,255,255,.35)",marginBottom:14,lineHeight:1.5}}>
        Share <span style={{color:"#fff",fontWeight:700}}>{session.name}</span> with teammates or managers. They can view the session and leave feedback.
      </div>

        {/* ── Add entire team ── */}
        {teams.length > 0 && (
          <div style={{marginBottom:12}}>
            <div style={{fontSize:9,color:"rgba(255,255,255,.3)",textTransform:"uppercase",letterSpacing:.8,marginBottom:6}}>Add entire team</div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {teams.map(function(t){
                var addCount = (t.memberIds||[]).filter(function(uid){
                  return uid !== (authUser||{}).id && !alreadySharedIds.includes(uid) && !selected.includes(uid);
                }).length;
                return (
                  <button key={t.id} onClick={function(){addTeam(t);}}
                    style={{background:"rgba(0,180,255,.1)",border:"1px solid rgba(0,180,255,.25)",borderRadius:99,padding:"4px 11px",fontSize:11,color:"#00B4FF",cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:4}}>
                    <span>🏷️</span><span>{t.name}</span><span style={{opacity:.55}}>+{addCount}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Selected recipients chips ── */}
        {selectedUsers.length > 0 && (
          <div style={{marginBottom:10}}>
            <div style={{fontSize:9,color:"rgba(255,255,255,.3)",textTransform:"uppercase",letterSpacing:.8,marginBottom:6}}>Sharing with ({selectedUsers.length})</div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {selectedUsers.map(function(u){
                return (
                  <span key={u.id} style={{display:"inline-flex",alignItems:"center",gap:4,background:isAdminRole(u.role)?accentA(.12):"rgba(0,180,255,.1)",border:"1px solid "+(isAdminRole(u.role)?accentA(.3):"rgba(0,180,255,.25)"),borderRadius:99,padding:"3px 8px",fontSize:11,color:isAdminRole(u.role)?SESS_COLOR:"#00B4FF"}}>
                    {u.displayName}
                    <button onClick={function(){toggleUser(u.id);}} style={{background:"none",border:"none",cursor:"pointer",color:"inherit",opacity:.6,fontSize:12,padding:"0 0 0 2px",fontFamily:"inherit",lineHeight:1}}>×</button>
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Available user list ── */}
        {availableUsers.length > 0 && (
          <div style={{marginBottom:12}}>
            <div style={{fontSize:9,color:"rgba(255,255,255,.3)",textTransform:"uppercase",letterSpacing:.8,marginBottom:6}}>Add people</div>
            <div style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:12,overflow:"hidden",maxHeight:190,overflowY:"auto"}}>
              {availableUsers.map(function(u){
                return (
                  <button key={u.id} onClick={function(){toggleUser(u.id);}}
                    style={{display:"flex",alignItems:"center",gap:9,width:"100%",background:"transparent",border:"none",borderBottom:"1px solid rgba(255,255,255,.05)",padding:"9px 12px",cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}>
                    <div style={{width:26,height:26,borderRadius:"50%",background:isAdminRole(u.role)?accentA(.15):"rgba(0,180,255,.12)",border:"1px solid "+(isAdminRole(u.role)?accentA(.3):"rgba(0,180,255,.2)"),display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:isAdminRole(u.role)?SESS_COLOR:"#00B4FF",flexShrink:0}}>
                      {(u.displayName || "?")[0].toUpperCase()}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:600,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.displayName}</div>
                      <div style={{fontSize:9,color:"rgba(255,255,255,.3)"}}>{u.email || u.role}</div>
                    </div>
                    <span style={{fontSize:16,color:"rgba(255,255,255,.2)",flexShrink:0}}>+</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {availableUsers.length === 0 && selectedUsers.length === 0 && (shares||[]).length === 0 && (
          <div style={{textAlign:"center",color:"rgba(255,255,255,.25)",fontSize:11,padding:"12px 0",marginBottom:12}}>No users available to share with.</div>
        )}

        {/* ── Context ── */}
        <label style={labelSt()}>Context <span style={{color:"rgba(255,255,255,.25)",fontWeight:400,textTransform:"none",letterSpacing:0,fontSize:10}}>(optional)</span></label>
        <input value={context} onChange={function(e){setContext(e.target.value);}}
          placeholder="e.g. Check my objection handling here…"
          style={inputSt({marginBottom:10})}/>
        {error && <div style={{fontSize:10,color:"#EF5350",marginBottom:8}}>{error}</div>}

        <button onClick={submitShare} disabled={submitting||!selected.length}
          style={Object.assign({},solidBtn(SESS_COLOR),{width:"100%",opacity:(!selected.length||submitting)?0.45:1,marginBottom:16})}>
          {submitting?"Sharing…":selected.length?"Share with "+selected.length+" person"+(selected.length>1?"s":""):"Select recipients above"}
        </button>

        {/* ── Already shared list ── */}
        {shares && shares.length > 0 && (
          <div>
            <SectionHdr>Shared with</SectionHdr>
            {shares.map(function(s){
              return (
                <div key={s.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.08)",borderRadius:10,padding:"9px 12px",marginBottom:7}}>
                  <div>
                    <div style={{fontSize:12,color:"#fff",fontWeight:600}}>{s.toUserName}</div>
                    <div style={{fontSize:9,color:"rgba(255,255,255,.3)"}}>{s.toUserEmail || ""}{s.context?(s.toUserEmail?" · ":"")+s.context:""}</div>
                  </div>
                  <button onClick={function(){revokeShare(s.id);}} style={ghostSm({color:"rgba(239,83,80,.5)",borderColor:"rgba(239,83,80,.2)",fontSize:10,padding:"4px 8px"})}>Revoke</button>
                </div>
              );
            })}
          </div>
        )}
    </div>
  );

  if (desktop.isDesktop) {
    return (
      <DesktopModal title="Share Session" width={500} onClose={onClose}>
        {shareContent}
      </DesktopModal>
    );
  }

  return (
    <div style={{position:"fixed",inset:0,zIndex:500,display:"flex",alignItems:"flex-end",justifyContent:"center",background:"rgba(0,0,0,.55)"}}
      onClick={function(e){if(e.target===e.currentTarget)onClose();}}>
      <div style={{background:themed("#13151c"),border:"1px solid rgba(255,255,255,.1)",borderRadius:"18px 18px 0 0",width:"100%",maxWidth:430,maxHeight:"85vh",overflowY:"auto",padding:"18px 16px 32px",animation:"sheetUp .2s ease both"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div style={{fontSize:13,fontWeight:700,color:"#fff"}}>Share session</div>
          <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",color:"rgba(255,255,255,.4)",fontSize:18,padding:"2px 6px",fontFamily:"inherit"}}>×</button>
        </div>
        {shareContent}
      </div>
    </div>
  );
}

// ─── SESSION REVIEW ───────────────────────────────────────────────────────────
export function SessionReview({ session, onBack, authUser, orgUsers, orgTeams, onMarkFeedbackSeen }) {
  var [tab, setTab] = useState("overview");
  var [feedbackSeenOnce, setFeedbackSeenOnce] = useState(false);
  var [feedback, setFeedback] = useState(null);
  var [fbText, setFbText] = useState("");
  var [fbCardId, setFbCardId] = useState("");
  var [fbSubmitting, setFbSubmitting] = useState(false);
  var [fbEditId, setFbEditId] = useState(null);
  var [fbEditText, setFbEditText] = useState("");
  var [showShare, setShowShare] = useState(false);
  var [pathCardIdx, setPathCardIdx] = useState(null);
  var [reviewShares, setReviewShares] = useState(null);
  var [hlOpen, setHlOpen] = useState(false);
  // Desktop renders the same review at a larger type scale; mobile sizes are unchanged
  var desktop = useContext(DesktopCtx);
  // Tablet (compact) uses one step less than desktop; touch gets 44px targets on the controls below
  function fz(n) {
    if (!desktop || !desktop.isDesktop) return n;
    if (desktop.compact) return n <= 9 ? n + 2 : n + 1;
    return n <= 9 ? n + 3 : n + 2;
  }
  var touchMin = desktop && desktop.isTouchPrimary ? 44 : undefined;
  // Opening your own session's review clears its feedback notifications
  useEffect(function() {
    if (session && authUser && session.userId === authUser.id) markSessionNotificationsRead(session.id);
  }, [session.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // One audio player shared by every tab (mini-bar, Playback, Path clips, Notes "hear this")
  var audio = useSessionAudio(session);
  var audioSize = desktop && desktop.isDesktop ? "lg" : undefined;
  // Visit → its audio segment (segId is the visit's ts; older sessions match on start offset)
  function segForVisit(x) {
    if (audio.state !== "ready") return null;
    for (var si = 0; si < audio.segments.length; si++) {
      var sg = audio.segments[si];
      if (sg.segId === x.ts || (x.audioStartMs != null && sg.startMs === x.audioStartMs && sg.cardId === x.cardId)) return sg;
    }
    return null;
  }
  function noteAudioMs(note) {
    return audio.state === "ready" ? wallClockToAudioMs(note.ts, audio.segments) : null;
  }

  var isAdmin = !!(authUser && isAdminRole(authUser.role));
  var isOwner = !!(authUser && session.userId === authUser.id);

  // Load shares for display in overview (owner or admin only)
  useEffect(function() {
    if (!isOwner && !isAdmin) return;
    function load() {
      apiGet("/sessions/" + session.id + "/shares")
        .then(function(data){ setReviewShares(data); })
        .catch(function(){ setReviewShares(function(prev){ return prev || []; }); });
    }
    load();
    return onLive("share.changed", function(d) { if (d && d.sessionId === session.id) load(); });
  }, [session.id]);

  var st = STYPE[session.mode||session.sessionType||"live"] || STYPE.live;
  var v = sessionVisits(session), n = sessionNotes(session), d = sessionDurSec(session);
  var pv = v.filter(function(x){return !x.isObjCard;}), ov = v.filter(function(x){return x.isObjCard;});
  var iv = v.filter(function(x){return x.intendedPath;});
  var intPct = v.length ? Math.round(iv.length/v.length*100) : 0;
  var reachedClose = pv.some(function(x){return x.cardType==="close";});
  var lastPitch = pv[pv.length-1];
  // One outcome line for every session type (practice used to read "Not sold")
  var outcomeLine = session.sold || session.outcome === "sold" ? { text:"✓ Sold", color:"#66BB6A" }
    : session.outcome === "booked"        ? { text:"📅 Booked", color:"#FFD54F" }
    : session.outcome === "not_contacted" ? { text:"📵 No contact", color:"rgba(255,255,255,.55)" }
    : session.outcome === "abandoned"     ? { text:"✗ Abandoned", color:"#EF5350" }
    : (session.mode || "live") === "practice" ? { text:"🎯 Practice run completed", color:"#00B4FF" }
    : { text:"✗ Not sold", color:"rgba(255,255,255,.45)" };

  var tbc = {};
  v.forEach(function(x) {
    if (!tbc[x.cardId]) tbc[x.cardId]={title:x.cardTitle,type:x.cardType,obj:x.isObjCard,ms:0,ct:0};
    tbc[x.cardId].ms += x.durationMs||0;
    tbc[x.cardId].ct++;
  });
  var allT = Object.values(tbc).sort(function(a,b){return b.ms-a.ms;});
  var top3 = allT.filter(function(c){return !c.obj;}).slice(0,3);
  var topObj = allT.filter(function(c){return c.obj;})[0];
  var maxMs = allT.length ? allT[0].ms : 1;
  var objStacks = {};
  ov.forEach(function(x){if(x.stackLabel)objStacks[x.stackLabel]=(objStacks[x.stackLabel]||0)+1;});
  var topVisitedStackEntry = Object.entries(objStacks).sort(function(a,b){return b[1]-a[1];})[0];
  var topVisitedStack = topVisitedStackEntry ? { label: topVisitedStackEntry[0], count: topVisitedStackEntry[1] } : null;

  // Deduplicated card list from visited path (for feedback card selector)
  var visitedCards = [];
  var _seenCards = {};
  v.forEach(function(x) {
    if (!_seenCards[x.cardId]) { _seenCards[x.cardId]=true; visitedCards.push({id:x.cardId,title:x.cardTitle,type:x.cardType}); }
  });

  var isSharedRecipient = !!(session._shared);
  var canWriteFeedback = isAdmin || isSharedRecipient;

  // Fetch feedback once per session, then live: the server announces every new, edited
  // or deleted comment (feedback.changed), and a reconnect reloads in case one was missed
  function loadFeedback() {
    apiGet("/sessions/" + session.id + "/feedback")
      .then(function(data) { setFeedback(data); })
      .catch(function() {});
  }
  useEffect(function() {
    loadFeedback();
    var offA = onLive("feedback.changed", function(d) { if (d && d.sessionId === session.id) loadFeedback(); });
    var offB = onLive("live.resync", loadFeedback);
    return function() { offA(); offB(); };
  }, [session.id]); // eslint-disable-line react-hooks/exhaustive-deps

  var hasFeedback = feedback && feedback.length > 0;
  var showFbBadge = hasFeedback && !feedbackSeenOnce;

  function submitFeedback() {
    var trimmed = fbText.trim();
    if (!trimmed) return;
    setFbSubmitting(true);
    var selectedCard = visitedCards.find(function(c){ return c.id === fbCardId; });
    apiPost("/sessions/" + session.id + "/feedback", {
      text: trimmed,
      cardId: selectedCard ? selectedCard.id : null,
      cardTitle: selectedCard ? selectedCard.title : null,
    })
      .then(function(fb) {
        setFeedback(function(prev){ return (prev||[]).concat([fb]); });
        setFbText(""); setFbCardId("");
      })
      .catch(function(e){ console.error("overcard:", e); })
      .finally(function(){ setFbSubmitting(false); });
  }

  function saveFbEdit(fbId) {
    var trimmed = fbEditText.trim();
    if (!trimmed) return;
    var existing = (feedback||[]).find(function(f){ return f.id===fbId; });
    apiPut("/sessions/" + session.id + "/feedback/" + fbId, {
      text: trimmed,
      cardId: existing ? existing.cardId : null,
      cardTitle: existing ? existing.cardTitle : null,
    })
      .then(function(updated) {
        setFeedback(function(prev){ return prev.map(function(f){ return f.id===fbId?updated:f; }); });
        setFbEditId(null); setFbEditText("");
      })
      .catch(function(e){ console.error("overcard:", e); });
  }

  function deleteFeedbackItem(fbId) {
    apiDel("/sessions/" + session.id + "/feedback/" + fbId)
      .then(function() { setFeedback(function(prev){ return prev.filter(function(f){ return f.id!==fbId; }); }); })
      .catch(function(e){ console.error("overcard:", e); });
  }

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,.07)",borderLeft:"3px solid "+st.color,display:"flex",alignItems:"center",gap:9,flexShrink:0}}>
        <button onClick={onBack} aria-label="Back" style={Object.assign({},iconBtn(),{padding:"5px 8px",minWidth:touchMin,minHeight:touchMin})}>←</button>
        <OrgMark size={desktop.isDesktop ? (desktop.compact ? 24 : 28) : 22}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap",marginBottom:1}}>
            <span style={{fontSize:fz(13),fontWeight:700,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{session.name}</span>
            {session.sold && <span style={{fontSize:fz(9),fontWeight:700,background:"rgba(102,187,106,.15)",border:"1px solid rgba(102,187,106,.3)",color:"#66BB6A",padding:"1px 7px",borderRadius:99,textTransform:"uppercase",letterSpacing:.4}}>sold</span>}
            <span style={{fontSize:fz(9),fontWeight:700,color:st.color,background:st.bg,border:"1px solid "+st.border,padding:"1px 7px",borderRadius:99,textTransform:"uppercase",letterSpacing:.4}}>{st.label}</span>
            {session._shared && <span style={{fontSize:fz(9),color:"rgba(255,255,255,.35)",background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",padding:"1px 7px",borderRadius:99}}>shared</span>}
            <HighlightChip highlight={session.highlight} fontSize={fz(9)}/>
          </div>
          {session._shared && session._shareFromName && <div style={{fontSize:fz(9),color:"rgba(255,255,255,.28)",marginBottom:1}}>From: {session._shareFromName}{session._shareContext ? " · "+session._shareContext : ""}</div>}
          {session.description && <div style={{fontSize:fz(10),color:"rgba(255,255,255,.32)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{session.description}</div>}
          <div style={{fontSize:fz(9),color:"rgba(255,255,255,.25)"}}>
            {session.userName && <span style={{color:"rgba(255,255,255,.55)",fontWeight:600}}>👤 {session.userName} · </span>}
            {fmtDateTime(session.startTs)}
          </div>
        </div>
        {(isOwner || isAdmin) && (
          <div style={{display:"flex",gap:5,alignItems:"center",flexShrink:0}}>
            {isAdmin && session.status !== "active" && canEditHighlight(authUser, orgTeams, session.highlight) && (
              <button onClick={function(){ setHlOpen(function(o){ return !o; }); }} aria-expanded={hlOpen}
                title={session.highlight ? "Edit highlight" : "Highlight this session for your org or a team"}
                style={ghostSm({fontSize:fz(10),padding:"5px 10px",minHeight:touchMin,color:session.highlight?HL_COLOR:undefined,borderColor:session.highlight?"rgba(255,201,64,.4)":undefined})}>
                {session.highlight ? "★ Highlighted" : "☆ Highlight"}
              </button>
            )}
            {reviewShares && reviewShares.length > 0 && (
              <button onClick={function(){setShowShare(true);}}
                style={{background:"rgba(0,180,255,.12)",border:"1px solid rgba(0,180,255,.3)",borderRadius:99,padding:"4px 9px",fontSize:fz(10),color:"#00B4FF",cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:4}}>
                <span>👥</span><span>{reviewShares.length}</span>
              </button>
            )}
            <button onClick={function(){setShowShare(true);}}
              style={ghostSm({fontSize:fz(10),padding:"5px 10px",minHeight:touchMin})}>Share</button>
          </div>
        )}
      </div>
      {hlOpen
        ? <HighlightEditor key={session.id} session={session} authUser={authUser} orgTeams={orgTeams} fz={fz} onClose={function(){ setHlOpen(false); }}/>
        : <HighlightBanner highlight={session.highlight} fz={fz}/>}
      <div style={{display:"flex",borderBottom:"1px solid rgba(255,255,255,.06)",flexShrink:0}}>
        {[["overview","Overview"],["path","Path"],["playback","Playback"],["notes","Notes"],["feedback","Feedback"]].map(function(t) {
          var on = tab===t[0];
          var isFbTab = t[0]==="feedback";
          var isPlaybackTab = t[0]==="playback";
          return (
            <button key={t[0]} onClick={function(){setTab(t[0]);if(isFbTab){setFeedbackSeenOnce(true);if(onMarkFeedbackSeen)onMarkFeedbackSeen(session.id);}}}
              style={{flex:1,minHeight:touchMin,background:"none",border:"none",borderBottom:"2px solid "+(on?SESS_COLOR:"transparent"),padding:"9px 2px",cursor:"pointer",fontFamily:"inherit",fontSize:fz(10),fontWeight:on?700:400,color:on?SESS_COLOR:"rgba(255,255,255,.35)",transition:"background .15s,border-color .15s,color .15s,box-shadow .15s,opacity .15s,width .15s,height .15s",position:"relative"}}>
              {t[1]}
              {isFbTab && showFbBadge && <span style={{position:"absolute",top:6,right:"calc(50% - 20px)",width:6,height:6,borderRadius:"50%",background:"#EF5350",display:"inline-block"}}/>}
              {isPlaybackTab && (audio.state === "ready" || session.hasAudio) && <span style={{position:"absolute",top:6,right:"calc(50% - 20px)",width:6,height:6,borderRadius:"50%",background:SESS_COLOR,display:"inline-block"}}/>}
            </button>
          );
        })}
      </div>
      {showShare && <ShareModal session={session} orgUsers={orgUsers} orgTeams={orgTeams} authUser={authUser} onClose={function(){setShowShare(false);}}/>}
      {audio.element}
      <AudioMiniBar ctl={audio} size={audioSize}/>
      {tab !== "playback" && audio.upload && audio.upload.state !== "done" && (
        <div style={{padding:"8px 14px 0",flexShrink:0}}><UploadNotice ctl={audio} size={audioSize}/></div>
      )}
      <div style={{flex:1,overflowY:"auto",padding:"14px 14px 0"}}>
        {/* OVERVIEW */}
        {tab==="overview" && (
          <div>
            {/* Same sections, same order for every session (live or practice) — empty ones show a placeholder */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(4, minmax(0,1fr))",gap:8,marginBottom:12}}>
              <StatBox value={d?fmtSec(d):"—"} label="Duration" color="rgba(255,255,255,.65)"/>
              <StatBox value={pv.length} label="Cards visited" color={SESS_COLOR}/>
              <StatBox value={ov.length} label="Obj visits" color={OBJ_COLOR}/>
              <StatBox value={n.length} label="Notes" color="#00B4FF"/>
            </div>
            <div style={{background:session.sold?"rgba(102,187,106,.08)":"rgba(255,255,255,.05)",border:"1px solid "+(session.sold?"rgba(102,187,106,.22)":"rgba(255,255,255,.07)"),borderRadius:12,padding:"12px 14px",marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontSize:fz(13),fontWeight:700,color:outcomeLine.color,marginBottom:2}}>{outcomeLine.text}</div>
                {session.sold && session.soldCardTitle && <div style={{fontSize:fz(10),color:"rgba(255,255,255,.32)"}}>Closed on: {session.soldCardTitle}</div>}
                {!session.sold && lastPitch && <div style={{fontSize:fz(10),color:"rgba(255,255,255,.28)"}}>Last card: {lastPitch.cardTitle}</div>}
              </div>
              <span style={{fontSize:fz(10),fontWeight:700,color:reachedClose?"#66BB6A":"rgba(255,255,255,.3)",background:reachedClose?"rgba(102,187,106,.1)":"rgba(255,255,255,.05)",padding:"2px 9px",borderRadius:99,border:"1px solid "+(reachedClose?"rgba(102,187,106,.25)":"rgba(255,255,255,.07)")}}>{reachedClose?"Reached close":"No close"}</span>
            </div>
            <div style={{background:"rgba(102,187,106,.06)",border:"1px solid rgba(102,187,106,.15)",borderRadius:12,padding:"12px 14px",marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><span style={{fontSize:fz(12),fontWeight:700,color:"#66BB6A"}}>★ Intended Path</span><span style={{fontSize:fz(12),color:"#66BB6A"}}>{intPct}%</span></div>
              <div style={{height:5,background:"rgba(255,255,255,.07)",borderRadius:99,overflow:"hidden"}}><div style={{height:"100%",background:"#66BB6A",borderRadius:99,width:intPct+"%",transition:"width .4s"}}/></div>
              <div style={{fontSize:fz(9),color:"rgba(255,255,255,.28)",marginTop:5}}>{iv.length} of {v.length} card visits on intended path</div>
            </div>
            {(
              <div style={{marginBottom:12}}>
                <SectionHdr>Objections hit</SectionHdr>
                <div style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.08)",borderRadius:12,padding:"11px 13px"}}>
                  {Object.keys(objStacks).length === 0 && <div style={{fontSize:fz(12),color:"rgba(255,255,255,.35)"}}>No objections raised</div>}
                  {Object.entries(objStacks).map(function(entry, i, arr) {
                    return <div key={entry[0]} style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingBottom:i<arr.length-1?8:0,marginBottom:i<arr.length-1?8:0,borderBottom:i<arr.length-1?"1px solid rgba(255,255,255,.05)":"none"}}>
                      <span style={{fontSize:fz(12),color:"rgba(255,255,255,.65)"}}>{entry[0]}</span>
                      <span style={{fontSize:fz(10),fontWeight:700,color:OBJ_COLOR,background:"rgba(239,83,80,.1)",padding:"2px 8px",borderRadius:99}}>{entry[1]} card{entry[1]>1?"s":""}</span>
                    </div>;
                  })}
                </div>
              </div>
            )}
            {(
              <div style={{marginBottom:12}}>
                <SectionHdr>Top cards by time</SectionHdr>
                <div style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.08)",borderRadius:12,padding:"12px 14px"}}>
                  {top3.length === 0 && <div style={{fontSize:fz(12),color:"rgba(255,255,255,.35)"}}>No card timings recorded</div>}
                  {top3.map(function(c, i) { var m=TM[c.type]||TM.pitch; var pct=Math.round(c.ms/maxMs*100); return (
                    <div key={c.title} style={{marginBottom:i<top3.length-1?10:0}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                        <div style={{display:"flex",alignItems:"center",gap:5}}><span style={{fontSize:fz(10),color:m.color}}>■</span><span style={{fontSize:fz(12),color:i===0?"#fff":"rgba(255,255,255,.65)",fontWeight:i===0?700:400}}>{c.title}</span></div>
                        <span style={{fontSize:fz(11),color:"rgba(255,255,255,.4)"}}>{fmtMs(c.ms)}</span>
                      </div>
                      <div style={{height:4,background:"rgba(255,255,255,.07)",borderRadius:99,overflow:"hidden"}}><div style={{height:"100%",background:m.color,borderRadius:99,width:pct+"%"}}/></div>
                    </div>
                  );})}
                </div>
              </div>
            )}
            {(
              <div style={{background:"rgba(239,83,80,.06)",border:"1px solid rgba(239,83,80,.15)",borderRadius:12,padding:"12px 14px",marginBottom:12}}>
                <SectionHdr style={{color:OBJ_COLOR,marginBottom:10}}>🛡️ Objection Highlights</SectionHdr>
                {!topObj && !topVisitedStack && <div style={{fontSize:fz(12),color:"rgba(255,255,255,.35)"}}>No objection time recorded</div>}
                {topObj && (
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:topVisitedStack?8:0}}>
                    <div>
                      <div style={{fontSize:fz(9),color:"rgba(239,83,80,.6)",textTransform:"uppercase",letterSpacing:.8,marginBottom:2}}>Most time in</div>
                      <span style={{fontSize:fz(12),color:"#fff"}}>{topObj.title}</span>
                    </div>
                    <span style={{fontSize:fz(12),color:OBJ_COLOR,flexShrink:0}}>{fmtMs(topObj.ms)}</span>
                  </div>
                )}
                {topObj && topVisitedStack && <div style={{height:1,background:"rgba(239,83,80,.15)",margin:"8px 0"}}/>}
                {topVisitedStack && (
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div>
                      <div style={{fontSize:fz(9),color:"rgba(239,83,80,.6)",textTransform:"uppercase",letterSpacing:.8,marginBottom:2}}>Most visited stack</div>
                      <span style={{fontSize:fz(12),color:"#fff"}}>{topVisitedStack.label}</span>
                    </div>
                    <span style={{fontSize:fz(11),color:OBJ_COLOR,background:"rgba(239,83,80,.12)",padding:"2px 8px",borderRadius:99,flexShrink:0}}>{topVisitedStack.count} visit{topVisitedStack.count!==1?"s":""}</span>
                  </div>
                )}
              </div>
            )}
            {n.length > 0 ? (
              <div style={{marginBottom:12}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <SectionHdr style={{margin:0}}>Notes ({n.length})</SectionHdr>
                  <button onClick={function(){setTab("notes");}} style={ghostSm({fontSize:fz(10),padding:"3px 9px"})}>See all</button>
                </div>
                {n.slice(0,2).map(function(note, i) {
                  return <div key={i} style={{background:accentA(.07),border:("1px solid "+accentA(.18)),borderRadius:11,padding:"10px 13px",marginBottom:7}}>
                    <div style={{fontSize:fz(10),fontWeight:700,color:SESS_COLOR,marginBottom:3}}>{note.cardTitle}</div>
                    <div style={{fontSize:fz(12),color:"rgba(255,255,255,.82)",lineHeight:1.5}}>{note.text}</div>
                  </div>;
                })}
              </div>
            ) : (
              <div style={{marginBottom:12}}>
                <SectionHdr>Notes (0)</SectionHdr>
                <div style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.07)",borderRadius:11,padding:"10px 13px",fontSize:fz(12),color:"rgba(255,255,255,.35)"}}>No notes recorded</div>
              </div>
            )}
            {/* ── Shared with (owner/admin only) ── */}
            {(isOwner || isAdmin) && reviewShares !== null && reviewShares.length > 0 && (
              <div style={{marginTop:12}}>
                <SectionHdr>Shared with ({reviewShares.length})</SectionHdr>
                <div style={{background:"rgba(0,180,255,.05)",border:"1px solid rgba(0,180,255,.15)",borderRadius:12,overflow:"hidden"}}>
                  {reviewShares.map(function(sh, i){
                    return (
                      <div key={sh.id} style={{display:"flex",alignItems:"center",gap:9,padding:"9px 12px",borderBottom:i<reviewShares.length-1?"1px solid rgba(0,180,255,.1)":"none"}}>
                        <div style={{width:26,height:26,borderRadius:"50%",background:"rgba(0,180,255,.15)",border:"1px solid rgba(0,180,255,.25)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:fz(11),fontWeight:700,color:"#00B4FF",flexShrink:0}}>
                          {(sh.toUserName||"?")[0].toUpperCase()}
                        </div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:fz(12),fontWeight:600,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{sh.toUserName}</div>
                          {sh.context && <div style={{fontSize:fz(9),color:"rgba(255,255,255,.35)",marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{sh.context}</div>}
                        </div>
                        <span style={{fontSize:fz(9),color:"rgba(255,255,255,.25)",flexShrink:0}}>{fmtDate(sh.createdAt||sh.sharedAt||0)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {(isOwner || isAdmin) && reviewShares !== null && reviewShares.length === 0 && (
              <div style={{marginTop:12,textAlign:"center",color:"rgba(255,255,255,.2)",fontSize:fz(11),padding:"8px 0"}}>Not shared with anyone yet.</div>
            )}
          </div>
        )}
        {/* PATH */}
        {tab==="path" && (
          <div>
            <SectionHdr>{v.length} card visits · <span style={{fontWeight:400,color:"rgba(255,255,255,.3)",fontSize:fz(9)}}>tap a card for details</span></SectionHdr>
            {v.length===0 && <div style={{textAlign:"center",color:"rgba(255,255,255,.25)",padding:"24px 0",fontSize:fz(12)}}>No visits recorded.</div>}
            {v.map(function(x, i) {
              var m = TM[x.cardType]||TM.pitch;
              var isSelected = pathCardIdx === i;
              var cardNotes = (session.notes||[]).concat(n).filter(function(note){ return note.cardId === x.cardId; });
              var cardFeedback = (feedback||[]).filter(function(fb){ return fb.cardId === x.cardId; });
              return (
                <div key={i}>
                  <div onClick={function(){setPathCardIdx(isSelected ? null : i);}}
                    style={{display:"flex",gap:9,cursor:"pointer",borderRadius:9,padding:"3px 5px 3px 2px",background:isSelected?"rgba(255,255,255,.06)":"transparent",transition:"background .12s"}}>
                    <div style={{display:"flex",flexDirection:"column",alignItems:"center",flexShrink:0}}>
                      <div style={{width:22,height:22,borderRadius:"50%",background:x.isObjCard?"rgba(239,83,80,.16)":m.color+"1a",border:"1.5px solid "+(x.isObjCard?OBJ_COLOR:m.color),display:"flex",alignItems:"center",justifyContent:"center",fontSize:fz(9),color:x.isObjCard?OBJ_COLOR:m.color,boxShadow:isSelected?"0 0 0 2px "+(x.isObjCard?OBJ_COLOR:m.color)+"44":"none",transition:"box-shadow .12s"}}>
                        {x.isObjCard?"!":m.icon}
                      </div>
                      {i<v.length-1 && <div style={{width:1,background:"rgba(255,255,255,.07)",flex:1,minHeight:6,margin:"1px auto"}}/>}
                    </div>
                    <div style={{flex:1,paddingBottom:i<v.length-1?2:0,minWidth:0}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:5,paddingBottom:i<v.length-1?5:0}}>
                        <div>
                          <div style={{display:"flex",alignItems:"center",gap:4,flexWrap:"wrap"}}>
                            <span style={{fontSize:fz(12),color:"#fff",fontWeight:(i===0||i===v.length-1)?700:400}}>{x.cardTitle}</span>
                            {x.intendedPath && <span style={{fontSize:fz(8),color:"#66BB6A",background:"rgba(102,187,106,.12)",padding:"1px 4px",borderRadius:99}}>★</span>}
                            {x.isObjCard && x.stackLabel && <span style={{fontSize:fz(9),color:OBJ_COLOR,background:"rgba(239,83,80,.1)",padding:"1px 5px",borderRadius:99}}>{x.stackLabel}</span>}
                            {i===v.length-1 && <span style={{fontSize:fz(8),color:"rgba(255,255,255,.4)",background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.1)",padding:"1px 5px",borderRadius:99}}>ended here</span>}
                            {(cardNotes.length>0||cardFeedback.length>0) && <span style={{fontSize:fz(9),color:"rgba(255,255,255,.28)"}}>{cardNotes.length>0?"📝":""}{cardFeedback.length>0?"💬":""}</span>}
                          </div>
                          <div style={{fontSize:fz(9),color:"rgba(255,255,255,.22)"}}>{fmtTime(x.ts)}</div>
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:5,flexShrink:0}}>
                          {(function() {
                            var sg = segForVisit(x);
                            if (!sg) return null;
                            var isClip = audio.clip && audio.clip.segId === sg.segId;
                            var c = segColor(sg);
                            return (
                              <button onClick={function(e){ e.stopPropagation(); if (isClip && audio.playing) audio.toggle(); else audio.playClip(sg); }}
                                title="Play only this card's audio" aria-label={"Play audio for " + x.cardTitle}
                                style={{background:isClip?c:"transparent",border:"1px solid "+c+"66",color:isClip?"#000":c,borderRadius:99,fontSize:fz(9),fontWeight:700,padding:"2px 7px",cursor:"pointer",fontFamily:"inherit"}}>
                                {isClip && audio.playing ? "❚❚" : "▶"}
                              </button>
                            );
                          })()}
                          <span style={{fontSize:fz(10),color:"rgba(255,255,255,.32)",background:"rgba(255,255,255,.05)",padding:"2px 6px",borderRadius:99}}>{fmtMs(x.durationMs||0)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* ── Card detail expansion ── */}
                  {isSelected && (
                    <div style={{marginLeft:31,marginBottom:8,background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.09)",borderLeft:"2px solid "+(x.isObjCard?OBJ_COLOR:m.color),borderRadius:"0 10px 10px 0",padding:"11px 12px"}}>
                      {/* Stats row */}
                      <div style={{display:"flex",gap:7,marginBottom:10,flexWrap:"wrap",alignItems:"center"}}>
                        <div style={{background:"rgba(255,255,255,.08)",borderRadius:8,padding:"5px 11px",textAlign:"center"}}>
                          <div style={{fontSize:fz(14),fontWeight:700,color:"#fff"}}>{fmtMs(x.durationMs||0)}</div>
                          <div style={{fontSize:fz(8),color:"rgba(255,255,255,.35)",textTransform:"uppercase",letterSpacing:.5}}>Time spent</div>
                        </div>
                        <div style={{background:m.color+"18",borderRadius:8,padding:"5px 11px",textAlign:"center"}}>
                          <div style={{fontSize:fz(14),fontWeight:700,color:m.color}}>{m.icon}</div>
                          <div style={{fontSize:fz(8),color:"rgba(255,255,255,.35)",textTransform:"uppercase",letterSpacing:.5}}>{m.label}</div>
                        </div>
                      </div>
                      {/* Card audio: this visit first, then the card's other visits */}
                      <div style={{marginBottom:10}}>
                        <CardClipPlayer ctl={audio} size={audioSize} segs={(function() {
                          var own = segForVisit(x);
                          var all = audio.segments.filter(function(sg) { return sg.cardId === x.cardId && !!sg.isObjCard === !!x.isObjCard; });
                          return own ? [own].concat(all.filter(function(sg) { return sg.segId !== own.segId; })) : all;
                        })()}/>
                      </div>
                      {/* Flow: came from / led to */}
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:10}}>
                        <div style={{background:"rgba(255,255,255,.05)",borderRadius:8,padding:"7px 9px"}}>
                          <div style={{fontSize:fz(8),color:"rgba(255,255,255,.28)",textTransform:"uppercase",letterSpacing:.5,marginBottom:3}}>← Came from</div>
                          <div style={{fontSize:fz(11),color:i>0?"rgba(255,255,255,.75)":"rgba(255,255,255,.28)",fontStyle:i===0?"italic":"normal",lineHeight:1.3}}>{i>0?v[i-1].cardTitle:"Start of session"}</div>
                        </div>
                        <div style={{background:"rgba(255,255,255,.05)",borderRadius:8,padding:"7px 9px"}}>
                          <div style={{fontSize:fz(8),color:"rgba(255,255,255,.28)",textTransform:"uppercase",letterSpacing:.5,marginBottom:3}}>Led to →</div>
                          <div style={{fontSize:fz(11),color:i<v.length-1?"rgba(255,255,255,.75)":"rgba(255,255,255,.28)",fontStyle:i===v.length-1?"italic":"normal",lineHeight:1.3}}>{i<v.length-1?v[i+1].cardTitle:"End of session"}</div>
                        </div>
                      </div>
                      {/* Notes on this card */}
                      {cardNotes.length > 0 && (
                        <div style={{marginBottom:8}}>
                          <div style={{fontSize:fz(8),color:SESS_COLOR,textTransform:"uppercase",letterSpacing:.5,marginBottom:5}}>📝 Notes ({cardNotes.length})</div>
                          {cardNotes.map(function(note, ni){
                            return <div key={ni} style={{background:accentA(.07),border:("1px solid "+accentA(.15)),borderRadius:8,padding:"7px 9px",marginBottom:5,fontSize:fz(11),color:"rgba(255,255,255,.8)",lineHeight:1.5}}>{note.text}</div>;
                          })}
                        </div>
                      )}
                      {/* Feedback on this card */}
                      {cardFeedback.length > 0 && (
                        <div>
                          <div style={{fontSize:fz(8),color:"#00B4FF",textTransform:"uppercase",letterSpacing:.5,marginBottom:5}}>💬 Feedback ({cardFeedback.length})</div>
                          {cardFeedback.map(function(fb, fi){
                            return (
                              <div key={fi} style={{background:"rgba(0,180,255,.06)",border:"1px solid rgba(0,180,255,.15)",borderRadius:8,padding:"7px 9px",marginBottom:5}}>
                                <div style={{fontSize:fz(10),fontWeight:700,color:"#00B4FF",marginBottom:3}}>{fb.authorName}</div>
                                <div style={{fontSize:fz(11),color:"rgba(255,255,255,.75)",lineHeight:1.5}}>{fb.text}</div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {cardNotes.length === 0 && cardFeedback.length === 0 && (
                        <div style={{fontSize:fz(10),color:"rgba(255,255,255,.22)",fontStyle:"italic"}}>No notes or feedback on this card.</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {/* PLAYBACK */}
        {tab==="playback" && (
          <AudioPlayback ctl={audio} size={audioSize} canDownload={isOwner || isAdmin} sessionName={session.name}/>
        )}
        {/* NOTES */}
        {tab==="notes" && (function() {
          // Build cardId → { isObjCard, stackLabel } from visit events
          var cardCtx = {};
          v.forEach(function(x) { cardCtx[x.cardId] = { isObjCard: !!x.isObjCard, stackLabel: x.stackLabel||null }; });

          var callNotes = n.filter(function(note) { return !cardCtx[note.cardId] || !cardCtx[note.cardId].isObjCard; });
          var objNotesList = n.filter(function(note) { return cardCtx[note.cardId] && cardCtx[note.cardId].isObjCard; });

          // Group objection notes by stack label
          var stackGroups = {};
          var stackOrder = [];
          objNotesList.forEach(function(note) {
            var label = (cardCtx[note.cardId] && cardCtx[note.cardId].stackLabel) || "Objection";
            if (!stackGroups[label]) { stackGroups[label] = []; stackOrder.push(label); }
            stackGroups[label].push(note);
          });

          var hasObjNotes = objNotesList.length > 0;

          return (
            <div>
              <SectionHdr>{n.length} note{n.length!==1?"s":""}</SectionHdr>
              {n.length===0 && <div style={{textAlign:"center",color:"rgba(255,255,255,.25)",padding:"24px 0",fontSize:fz(12)}}>No notes in this session.</div>}

              {/* Call notes section */}
              {callNotes.length > 0 && (
                <div style={{marginBottom: hasObjNotes ? 18 : 0}}>
                  {hasObjNotes && <div style={{fontSize:fz(9),fontWeight:700,color:"rgba(255,255,255,.3)",textTransform:"uppercase",letterSpacing:1.1,marginBottom:8}}>Call Notes ({callNotes.length})</div>}
                  {callNotes.map(function(note, i) { return (
                    <div key={i} style={{background:accentA(.07),border:("1px solid "+accentA(.18)),borderRadius:11,padding:"11px 13px",marginBottom:9}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                        <span style={{fontSize:fz(11),fontWeight:700,color:SESS_COLOR}}>{note.cardTitle}</span>
                        <span style={{display:"inline-flex",alignItems:"center",gap:6}}>
                          {noteAudioMs(note) !== null && (
                            <button onClick={function(){ audio.playFrom(Math.max(0, noteAudioMs(note) - 3000)); }} title="Hear the moment this note was taken"
                              style={{background:"none",border:("1px solid "+accentA(.3)),color:SESS_COLOR,borderRadius:99,fontSize:fz(9),padding:"1px 7px",cursor:"pointer",fontFamily:"inherit"}}>▶ hear this</button>
                          )}
                          <span style={{fontSize:fz(9),color:"rgba(255,255,255,.25)"}}>{fmtTime(note.ts)}</span>
                        </span>
                      </div>
                      <div style={{fontSize:fz(13),color:"rgba(255,255,255,.85)",lineHeight:1.5}}>{note.text}</div>
                    </div>
                  );})}
                </div>
              )}

              {/* Objection stack note sections */}
              {stackOrder.map(function(label) {
                var stackNotes = stackGroups[label];
                return (
                  <div key={label} style={{marginBottom:18}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
                      <span style={{fontSize:fz(9),fontWeight:700,color:OBJ_COLOR,textTransform:"uppercase",letterSpacing:1.1}}>🛡️ {label}</span>
                      <span style={{fontSize:fz(9),color:"rgba(255,255,255,.28)"}}>({stackNotes.length} note{stackNotes.length!==1?"s":""})</span>
                    </div>
                    {stackNotes.map(function(note, i) { return (
                      <div key={i} style={{background:"rgba(239,83,80,.06)",border:"1px solid rgba(239,83,80,.2)",borderRadius:11,padding:"11px 13px",marginBottom:9}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                          <span style={{fontSize:fz(11),fontWeight:700,color:OBJ_COLOR}}>{note.cardTitle}</span>
                          <span style={{display:"inline-flex",alignItems:"center",gap:6}}>
                          {noteAudioMs(note) !== null && (
                            <button onClick={function(){ audio.playFrom(Math.max(0, noteAudioMs(note) - 3000)); }} title="Hear the moment this note was taken"
                              style={{background:"none",border:("1px solid "+accentA(.3)),color:SESS_COLOR,borderRadius:99,fontSize:fz(9),padding:"1px 7px",cursor:"pointer",fontFamily:"inherit"}}>▶ hear this</button>
                          )}
                          <span style={{fontSize:fz(9),color:"rgba(255,255,255,.25)"}}>{fmtTime(note.ts)}</span>
                        </span>
                        </div>
                        <div style={{fontSize:fz(13),color:"rgba(255,255,255,.85)",lineHeight:1.5}}>{note.text}</div>
                      </div>
                    );})}
                  </div>
                );
              })}
            </div>
          );
        })()}
        {/* FEEDBACK */}
        {tab==="feedback" && (
          <div>
            <SectionHdr>{(feedback||[]).length} feedback item{(feedback||[]).length!==1?"s":""}</SectionHdr>
            {feedback===null && <div style={{textAlign:"center",color:"rgba(255,255,255,.3)",padding:"24px 0",fontSize:fz(12)}}>Loading…</div>}
            {feedback!==null && feedback.length===0 && <div style={{textAlign:"center",color:"rgba(255,255,255,.25)",padding:"24px 0",fontSize:fz(12)}}>No feedback yet.</div>}
            {(feedback||[]).map(function(fb) {
              var cardType = fb.cardId ? (visitedCards.find(function(c){return c.id===fb.cardId;})||{type:"pitch"}).type : null;
              var ctm = cardType ? (TM[cardType]||TM.pitch) : null;
              var isEditing = fbEditId === fb.id;
              var isMine = authUser && fb.authorId === authUser.id;
              return (
                <div key={fb.id} style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.09)",borderRadius:12,padding:"12px 13px",marginBottom:9}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                      <span style={{fontSize:fz(11),fontWeight:700,color:SESS_COLOR}}>{fb.authorName}</span>
                      {fb.cardId && ctm && (
                        <span style={{fontSize:fz(9),background:ctm.color+"22",border:"1px solid "+ctm.color+"44",color:ctm.color,padding:"1px 7px",borderRadius:99}}>{fb.cardTitle}</span>
                      )}
                      {!fb.cardId && <span style={{fontSize:fz(9),color:"rgba(255,255,255,.28)",background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.08)",padding:"1px 7px",borderRadius:99}}>General</span>}
                    </div>
                    <div style={{display:"flex",gap:4,flexShrink:0}}>
                      <span style={{fontSize:fz(9),color:"rgba(255,255,255,.22)"}}>{fmtDateTime(fb.updatedAt)}</span>
                      {canWriteFeedback && isMine && !isEditing && (
                        <button onClick={function(){setFbEditId(fb.id);setFbEditText(fb.text);}}
                          style={{background:"none",border:"none",cursor:"pointer",color:"rgba(255,255,255,.3)",fontSize:fz(11),padding:"0 3px",fontFamily:"inherit"}}>✎</button>
                      )}
                      {(isAdmin || (canWriteFeedback && isMine)) ? (
                        <button onClick={function(){deleteFeedbackItem(fb.id);}}
                          style={{background:"none",border:"none",cursor:"pointer",color:"rgba(239,83,80,.4)",fontSize:fz(11),padding:"0 3px",fontFamily:"inherit"}}>🗑</button>
                      ) : null}
                    </div>
                  </div>
                  {isEditing ? (
                    <div>
                      <textarea value={fbEditText} onChange={function(e){setFbEditText(e.target.value);}} rows={2}
                        style={Object.assign({},inputSt({resize:"none",fontSize:fz(12),lineHeight:1.5}),{marginBottom:6,minHeight:48})}/>
                      <div style={{display:"flex",gap:6}}>
                        <button onClick={function(){setFbEditId(null);setFbEditText("");}} style={Object.assign({},ghostBtn(),{flex:1,padding:"6px",fontSize:fz(11)})}>Cancel</button>
                        <button onClick={function(){saveFbEdit(fb.id);}} style={Object.assign({},solidBtn(SESS_COLOR),{flex:2,padding:"6px",fontSize:fz(11)})}>Save</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{fontSize:fz(13),color:"rgba(255,255,255,.82)",lineHeight:1.55,whiteSpace:"pre-wrap"}}>{fb.text}</div>
                  )}
                </div>
              );
            })}
            {canWriteFeedback && (
              <div style={{background:accentA(.06),border:("1px solid "+accentA(.18)),borderRadius:12,padding:"12px 13px",marginBottom:12}}>
                <div style={{fontSize:fz(11),fontWeight:700,color:SESS_COLOR,marginBottom:8}}>Add feedback</div>
                {visitedCards.length > 0 && (
                  <div style={{marginBottom:8}}>
                    <div style={{fontSize:fz(9),color:"rgba(255,255,255,.3)",marginBottom:3,textTransform:"uppercase",letterSpacing:.6}}>Link to card (optional)</div>
                    <select value={fbCardId} onChange={function(e){setFbCardId(e.target.value);}}
                      style={{width:"100%",background:themed("#081428"),border:("1px solid "+accentA(.25)),borderRadius:8,padding:"7px 10px",color:"rgba(255,255,255,.7)",fontSize:fz(11),fontFamily:"inherit",outline:"none",appearance:"none"}}>
                      <option value="">General feedback</option>
                      {visitedCards.map(function(c){
                        return <option key={c.id} value={c.id}>{c.title}</option>;
                      })}
                    </select>
                  </div>
                )}
                <textarea value={fbText} onChange={function(e){setFbText(e.target.value);}}
                  placeholder="Leave feedback on this session…" rows={3}
                  style={Object.assign({},inputSt({resize:"none",fontSize:fz(12),lineHeight:1.5}),{marginBottom:8,minHeight:58})}/>
                <button onClick={submitFeedback} disabled={fbSubmitting||!fbText.trim()}
                  style={Object.assign({},solidBtn(SESS_COLOR),{width:"100%",opacity:(!fbText.trim()||fbSubmitting)?0.45:1})}>
                  {fbSubmitting?"Submitting…":"Submit feedback"}
                </button>
              </div>
            )}
          </div>
        )}
        <div style={{height:16}}/>
      </div>
    </div>
  );
}

// ─── SESSIONS TAB ─────────────────────────────────────────────────────────────
// Three sub-views: list, review (single session), analytics (aggregate)
// All data is scoped to the currently active deck.
// Desktop and mobile layouts are separate components so switching across the
// breakpoint never changes the number of hooks called in one component.
export function SessionsTab(props) {
  var desktop = useContext(DesktopCtx);
  return desktop.isDesktop ? <SessionsDesktop {...props}/> : <SessionsMobile {...props}/>;
}

function SessionsMobile({ deckId, deckName, deckColor, deckRootCard, onInitialReview, viewScope, setViewScope, authUser, orgUsers, orgTeams }) {
  var desktop = useContext(DesktopCtx);

  var [view,           setView]           = useState("list");
  var [sessions,       setSessions]       = useState(null);
  var [reviewId,       setReviewId]       = useState(onInitialReview || null);
  var [filtersOpen,    setFiltersOpen]    = useState(false);
  var [fType,          setFType]          = useState("all");
  var [fFrom,          setFFrom]          = useState("");
  var [fTo,            setFTo]            = useState("");
  var [userSearch,     setUserSearch]     = useState("");
  var [suggestOpen,    setSuggestOpen]    = useState(false);
  var [collapsedUsers, setCollapsedUsers] = useState({});
  var [shareTarget, setShareTarget] = useState(null);
  var [hlOnly, setHlOnly] = useState(false);   // analytics over highlighted sessions only
  // Highlights this user may see for the current deck (any rep's sessions, read-only)
  var hlRes = useCachedGet("/sessions/highlights?deckId=" + encodeURIComponent(deckId));
  var highlights = Array.isArray(hlRes.data) ? hlRes.data : null;
  var [fbSeenTs, setFbSeenTs] = useState(function(){
    try { return JSON.parse(localStorage.getItem("rc_fb_seen") || "{}"); } catch(e){ return {}; }
  });

  function markFbSeen(sessionId) {
    var now = Date.now();
    setFbSeenTs(function(prev) {
      var next = Object.assign({}, prev, {[sessionId]: now});
      try { localStorage.setItem("rc_fb_seen", JSON.stringify(next)); } catch(e){}
      return next;
    });
  }

  var isAdmin      = !!(authUser && isAdminRole(authUser.role));
  var isAdminScope = !!(isAdmin && viewScope && viewScope !== "self");

  // Auto-open review if portaled from Play
  useEffect(function() {
    if (onInitialReview) { setReviewId(onInitialReview); setView("review"); }
  }, [onInitialReview]);

  function buildSessionUrl() {
    var url = "/sessions?deckId=" + deckId;
    if (isAdminScope) url += "&scope=" + encodeURIComponent(viewScope === "org" || /^(team|user):/.test(viewScope) ? viewScope : "team:" + viewScope);
    return url;
  }
  var sv = useCacheVersion("/sessions");
  useEffect(function() {
    // Ignore responses from a superseded request (deck/scope changed mid-flight)
    var cancelled = false;
    if (view === "list" || view === "analytics" || view === "shared" || (view === "review" && sessions === null)) {
      var url = buildSessionUrl();
      var sorted = function(data) { return (Array.isArray(data) ? data : []).slice().sort(function(a,b){return b.startTs-a.startTs;}); };
      if (peek(url) !== undefined) setSessions(sorted(peek(url)));
      cachedGet(url)
        .then(function(data) { if (!cancelled) setSessions(sorted(data)); })
        .catch(function() { if (!cancelled) setSessions([]); });
    }
    return function() { cancelled = true; };
  }, [deckId, view, viewScope, sv]);

  function deleteSession(id) {
    apiDel("/sessions/" + id).then(function() {
      setSessions(function(prev) { return prev.filter(function(s){return s.id!==id;}); });
      deleteAudioBlob(id).catch(function(){}); // clean up local IndexedDB recording
    }).catch(function(e){ console.error("overcard:", e); });
  }

  function toggleCollapse(userId) {
    setCollapsedUsers(function(prev) {
      var next = Object.assign({}, prev);
      // Default (undefined) is collapsed; toggle to false (expanded) or back to true (collapsed)
      var currentlyCollapsed = prev[userId] !== false;
      next[userId] = !currentlyCollapsed;
      return next;
    });
  }

  function applyDateFilter(s) {
    if (fFrom) { var d=new Date(fFrom); d.setHours(0,0,0,0); if(s.startTs<d.getTime())return false; }
    if (fTo)   { var d2=new Date(fTo);  d2.setHours(23,59,59,999); if(s.startTs>d2.getTime())return false; }
    return true;
  }

  function getFiltered() {
    if (!sessions) return [];
    return sessions.filter(function(s) {
      if (s._shared) return false; // shared-with-me handled separately
      if (fType !== "all" && (s.mode||"live") !== fType) return false;
      return applyDateFilter(s);
    });
  }

  function getHighlighted() {
    if (!highlights) return [];
    return highlights.filter(function(s) {
      if (fType !== "all" && (s.mode||"live") !== fType) return false;
      return applyDateFilter(s);
    });
  }

  function getSharedWithMe() {
    if (!sessions) return [];
    return sessions.filter(function(s) {
      if (!s._shared) return false;
      if (fType !== "all" && (s.mode||"live") !== fType) return false;
      return applyDateFilter(s);
    });
  }

  if (view === "review" && reviewId) {
    var reviewSess = (sessions && sessions.find(function(s){return s.id===reviewId;})) ||
      (highlights && highlights.find(function(s){return s.id===reviewId;})) || null;
    if (!reviewSess && sessions === null) {
      // Sessions are loaded by the effect below — never fetch during render
      return <div style={{padding:40,textAlign:"center",color:"rgba(255,255,255,.3)",fontSize:13}}>Loading…</div>;
    }
    if (!reviewSess) { setView("list"); return null; }
    return <SessionReview session={reviewSess} onBack={function(){setView("list");}} authUser={authUser} orgUsers={orgUsers} orgTeams={orgTeams} onMarkFeedbackSeen={markFbSeen}/>;
  }

  if (view === "analytics") {
    return <SessionAnalytics sessions={hlOnly ? getHighlighted() : getFiltered()} deckColor={deckColor} deckName={deckName} deckRootCard={deckRootCard}
      hlOnly={hlOnly} setHlOnly={setHlOnly} highlightedCount={getFiltered().filter(function(s){ return !!s.highlight; }).length}
      fType={fType} setFType={setFType}
      fFrom={fFrom} setFFrom={setFFrom} fTo={fTo} setFTo={setFTo}
      filtersOpen={filtersOpen} setFiltersOpen={setFiltersOpen}
      onBack={function(){setView("list");}}/>;
  }

  var filtered      = getFiltered();
  var filtLive      = filtered.filter(function(s){ return (s.mode||"live") === "live"; });
  var filtSold      = filtLive.filter(function(s){ return s.sold; });
  var filtPrac      = filtered.filter(function(s){ return s.mode === "practice"; });
  var filtCr        = filtLive.length ? Math.round(filtSold.length / filtLive.length * 100) : 0;
  var filtPracSold  = filtPrac.filter(function(s){ return s.sold; });
  var filtPracCr    = filtPrac.length ? Math.round(filtPracSold.length / filtPrac.length * 100) : 0;
  var filtAvgDur    = (function(){
    var ds = filtered.filter(function(s){return s.endTs;}).map(function(s){return Math.round((s.endTs-s.startTs)/1000);});
    return ds.length ? Math.round(ds.reduce(function(a,b){return a+b;},0)/ds.length) : null;
  })();
  var filtLiveAvgDur = (function(){
    var ds = filtLive.filter(function(s){return s.endTs;}).map(function(s){return Math.round((s.endTs-s.startTs)/1000);});
    return ds.length ? Math.round(ds.reduce(function(a,b){return a+b;},0)/ds.length) : null;
  })();
  var activeFilters = fType!=="all"||fFrom||fTo;
  var sharedWithMe = !isAdminScope ? getSharedWithMe() : [];

  // Build filter-aware stat boxes
  var statBoxes;
  if (fType === "practice") {
    statBoxes = [
      { value: filtPrac.length, label: "Practice runs", color: "#00B4FF" },
      { value: filtAvgDur ? fmtSec(filtAvgDur) : "—", label: "Avg duration", color: "rgba(255,255,255,.65)" },
      { value: filtPracCr + "%", label: "Practice CR%", color: "#66BB6A" },
    ];
  } else if (fType === "live") {
    statBoxes = [
      { value: filtLive.length, label: "Live sessions", color: SESS_COLOR },
      { value: filtCr + "%", label: "Close rate", color: "#66BB6A" },
      { value: filtLiveAvgDur ? fmtSec(filtLiveAvgDur) : "—", label: "Avg duration", color: "rgba(255,255,255,.65)" },
    ];
  } else {
    statBoxes = [
      { value: filtered.length, label: "Total", color: SESS_COLOR },
      { value: filtCr + "%", label: "Close rate", color: "#66BB6A" },
      { value: filtAvgDur ? fmtSec(filtAvgDur) : "—", label: "Avg duration", color: "rgba(255,255,255,.65)" },
    ];
  }

  // Build user map for group lookups
  var userMap = {};
  (orgUsers||[]).forEach(function(u){ userMap[u.id] = u; });

  // Autocomplete suggestions — users present in filtered sessions
  var presentUserIds = {};
  filtered.forEach(function(s){ if (s.userId) presentUserIds[s.userId] = true; });
  var searchTerm = userSearch.trim().toLowerCase();
  var suggestions = (orgUsers||[]).filter(function(u) {
    return presentUserIds[u.id] && searchTerm && u.displayName.toLowerCase().includes(searchTerm) && u.displayName.toLowerCase() !== searchTerm;
  }).slice(0, 6);

  // For admin scope, build groups filtered by user search
  function buildGroups() {
    var groups = {};
    filtered.forEach(function(s) {
      var key = s.userId || "__unknown";
      if (!groups[key]) groups[key] = { user: userMap[s.userId] || { id:s.userId, displayName:"Unknown", email:"" }, sessions:[] };
      groups[key].sessions.push(s);
    });
    var sorted = Object.values(groups).sort(function(a,b){ return a.user.displayName.localeCompare(b.user.displayName); });
    if (searchTerm) {
      sorted = sorted.filter(function(g){ return g.user.displayName.toLowerCase().includes(searchTerm); });
    }
    return sorted;
  }

  // API sends userName on every session; fall back to the org user list for older payloads
  function sessionOwnerName(s) {
    return s.userName || (userMap[s.userId] && userMap[s.userId].displayName) || null;
  }

  function renderSessionRow(s) {
    var st = STYPE[s.mode||"live"] || STYPE.live;
    var d = sessionDurSec(s), v = sessionVisits(s), n = sessionNotes(s), ov = v.filter(function(x){return x.isObjCard;});
    var isOwner = authUser && s.userId === authUser.id && !s._shared;
    var hasFbNotif = isOwner && (s.feedbackCount||0) > 0 && (!fbSeenTs[s.id] || (s.latestFeedbackAt && s.latestFeedbackAt > fbSeenTs[s.id]));
    return (
      <div key={s.id} onClick={function(){setReviewId(s.id);setView("review");}}
        style={{background:themed("#081428"),border:"1px solid rgba(255,255,255,.08)",borderLeft:"3px solid "+st.color,borderRadius:"0 12px 12px 0",padding:"11px 12px",marginBottom:8,cursor:"pointer",transition:"background .12s",position:"relative"}}>
        {hasFbNotif && <span style={{position:"absolute",top:10,right:10,width:8,height:8,borderRadius:"50%",background:"#EF5350",display:"block",boxShadow:"0 0 0 2px rgba(239,83,80,.3)"}} title="New feedback"/>}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:5}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap",marginBottom:2}}>
              <span style={{fontSize:13,fontWeight:700,color:"#fff"}}>{s.name}</span>
              {s.sold && <span style={{fontSize:9,fontWeight:700,background:"rgba(102,187,106,.15)",border:"1px solid rgba(102,187,106,.3)",color:"#66BB6A",padding:"1px 7px",borderRadius:99,textTransform:"uppercase",letterSpacing:.4}}>sold</span>}
              {s.outcome==="not_contacted" && <span style={{fontSize:9,fontWeight:700,background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.14)",color:"rgba(255,255,255,.4)",padding:"1px 7px",borderRadius:99}}>📵 no contact</span>}
              {s._shared && <span style={{fontSize:9,color:"rgba(255,255,255,.32)",background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",padding:"1px 7px",borderRadius:99}}>shared</span>}
              <HighlightChip highlight={s.highlight}/>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}>
              {sessionOwnerName(s) && (
                <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:10,fontWeight:600,color:"rgba(255,255,255,.7)"}}>
                  <span style={{width:15,height:15,borderRadius:"50%",background:"rgba(0,180,255,.15)",border:"1px solid rgba(0,180,255,.3)",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:8,fontWeight:700,color:"#00B4FF"}}>{sessionOwnerName(s)[0].toUpperCase()}</span>
                  {sessionOwnerName(s)}{authUser && s.userId === authUser.id ? " (you)" : ""}
                </span>
              )}
              <span style={{fontSize:9,fontWeight:700,color:st.color,background:st.bg,border:"1px solid "+st.border,padding:"1px 7px",borderRadius:99,textTransform:"uppercase",letterSpacing:.4}}>{st.label}</span>
              {s._shared && s._shareFromName && s._shareFromName !== sessionOwnerName(s) && <span style={{fontSize:9,color:"rgba(255,255,255,.25)"}}>shared by {s._shareFromName}</span>}
              <span style={{fontSize:9,color:"rgba(255,255,255,.25)"}}>{fmtDateTime(s.startTs)}</span>
              {s.deckName && <span style={{fontSize:9,color:"rgba(255,255,255,.18)",background:"rgba(255,255,255,.04)",padding:"1px 6px",borderRadius:99,border:"1px solid rgba(255,255,255,.07)"}}>{s.deckName}</span>}
            </div>
          </div>
          <div style={{display:"flex",gap:4,flexShrink:0,alignItems:"center"}}>
            {(isOwner || isAdmin) && !s._shared && (
              <button onClick={function(e){e.stopPropagation();setShareTarget(s);}}
                style={ghostSm({fontSize:10,padding:"4px 8px",color:accentA(.7),borderColor:accentA(.2)})}>Share</button>
            )}
            {isOwner && (
              <button onClick={function(e){e.stopPropagation();deleteSession(s.id);}} style={ghostSm({color:"rgba(239,83,80,.5)",borderColor:"rgba(239,83,80,.2)",fontSize:10,padding:"4px 7px"})}>🗑</button>
            )}
          </div>
        </div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          {d && <span style={{fontSize:10,color:"rgba(255,255,255,.35)",background:"rgba(255,255,255,.05)",padding:"2px 6px",borderRadius:99}}>{fmtSec(d)}</span>}
          <span style={{fontSize:10,color:st.color,background:st.bg,padding:"2px 6px",borderRadius:99}}>{v.length} cards</span>
          {ov.length>0 && <span style={{fontSize:10,color:OBJ_COLOR,background:"rgba(239,83,80,.08)",padding:"2px 6px",borderRadius:99}}>{ov.length} obj</span>}
          {n.length>0 && <span style={{fontSize:10,color:"rgba(255,255,255,.3)",background:"rgba(255,255,255,.05)",padding:"2px 6px",borderRadius:99}}>📝 {n.length}</span>}
          {(s.feedbackCount||0) > 0 && <span style={{fontSize:10,color:hasFbNotif?"#EF5350":"rgba(255,255,255,.3)",background:hasFbNotif?"rgba(239,83,80,.1)":"rgba(255,255,255,.05)",padding:"2px 6px",borderRadius:99}}>💬 {s.feedbackCount}</span>}
          {(s.shareCount||0) > 0 && !s._shared && <span style={{fontSize:10,color:"rgba(0,180,255,.7)",background:"rgba(0,180,255,.08)",padding:"2px 6px",borderRadius:99}}>👥 {s.shareCount}</span>}
        </div>
      </div>
    );
  }

  if (view === "highlights") {
    var hlList = getHighlighted();
    return (
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{padding:"10px 14px 10px",borderBottom:"1px solid rgba(255,255,255,.07)",flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
            <button onClick={function(){setView("list");}} aria-label="Back" style={Object.assign({},iconBtn(),{padding:"5px 8px"})}>←</button>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:700,color:HL_COLOR}}>★ Highlights</div>
              <div style={{fontSize:9,color:"rgba(255,255,255,.3)",marginTop:1}}>
                {highlights===null ? "Loading…" : hlList.length+" session"+(hlList.length!==1?"s":"")+" · "+deckName}
              </div>
            </div>
          </div>
          <div style={{display:"flex",background:"rgba(255,255,255,.05)",borderRadius:10,padding:2,gap:1}}>
            {[["all","All","#FFD54F"],["live","📞 Live","#A8FF3E"],["practice","🎯 Practice","#00B4FF"]].map(function(t){
              var on=fType===t[0];
              return <button key={t[0]} onClick={function(){setFType(t[0]);}}
                style={{flex:1,background:on?"rgba(255,255,255,.1)":"transparent",border:"none",borderRadius:8,padding:"7px 4px",cursor:"pointer",fontFamily:"inherit",color:on?t[2]:"rgba(255,255,255,.4)",fontSize:11,fontWeight:on?700:400}}>{t[1]}</button>;
            })}
          </div>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"10px 14px 0"}}>
          {highlights===null && <div style={{textAlign:"center",color:"rgba(255,255,255,.3)",padding:"32px 0"}}>Loading…</div>}
          {highlights!==null && hlList.length===0 && (
            <div style={{textAlign:"center",padding:"48px 20px",lineHeight:1.8}}>
              <div style={{fontSize:32,marginBottom:12,color:HL_COLOR}}>★</div>
              <div style={{fontSize:14,color:"rgba(255,255,255,.45)",fontWeight:700,marginBottom:6}}>No highlights for this deck yet</div>
              <div style={{fontSize:12,color:"rgba(255,255,255,.25)"}}>When an admin highlights a session for your org or team, it appears here.</div>
            </div>
          )}
          {hlList.map(renderSessionRow)}
          <div style={{height:16}}/>
        </div>
      </div>
    );
  }

  if (view === "shared") {
    var sharedList = getSharedWithMe();
    var sharedLive = sharedList.filter(function(s){ return (s.mode||"live")==="live"; });
    var sharedPrac = sharedList.filter(function(s){ return s.mode==="practice"; });
    return (
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{padding:"10px 14px 10px",borderBottom:"1px solid rgba(255,255,255,.07)",flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
            <button onClick={function(){setView("list");}} style={Object.assign({},iconBtn(),{padding:"5px 8px"})}>←</button>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:700,color:"#00B4FF"}}>👥 Shared with me</div>
              <div style={{fontSize:9,color:"rgba(255,255,255,.3)",marginTop:1}}>
                {sessions===null?"Loading…":sharedList.length+" session"+(sharedList.length!==1?"s":"")+(sharedLive.length?" · "+sharedLive.length+" live":"")+(sharedPrac.length?" · "+sharedPrac.length+" practice":"")}
              </div>
            </div>
          </div>
          <div style={{display:"flex",background:"rgba(255,255,255,.05)",borderRadius:10,padding:2,gap:1}}>
            {[["all","All","#FFD54F"],["live","📞 Live","#A8FF3E"],["practice","🎯 Practice","#00B4FF"]].map(function(t){
              var on=fType===t[0];
              return <button key={t[0]} onClick={function(){setFType(t[0]);}}
                style={{flex:1,background:on?"rgba(255,255,255,.1)":"transparent",border:"none",borderRadius:8,padding:"7px 4px",cursor:"pointer",fontFamily:"inherit",color:on?t[2]:"rgba(255,255,255,.4)",fontSize:11,fontWeight:on?700:400}}>{t[1]}</button>;
            })}
          </div>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"10px 14px 0"}}>
          {sessions===null && <div style={{textAlign:"center",color:"rgba(255,255,255,.3)",padding:"32px 0"}}>Loading…</div>}
          {sessions!==null && sharedList.length===0 && (
            <div style={{textAlign:"center",padding:"48px 20px",lineHeight:1.8}}>
              <div style={{fontSize:32,marginBottom:12}}>👥</div>
              <div style={{fontSize:14,color:"rgba(255,255,255,.45)",fontWeight:700,marginBottom:6}}>Nothing shared yet</div>
              <div style={{fontSize:12,color:"rgba(255,255,255,.25)"}}>When a teammate shares a session with you, it will appear here.</div>
            </div>
          )}
          {sharedList.map(renderSessionRow)}
          <div style={{height:16}}/>
        </div>
      </div>
    );
  }

  var groups = isAdminScope ? buildGroups() : null;
  var displayCount = isAdminScope
    ? groups.reduce(function(a,g){return a+g.sessions.length;},0)
    : filtered.length;

  return (
    <div style={{flex:1,overflowY:"auto"}} onClick={function(){ if(suggestOpen) setSuggestOpen(false); }}>
      {/* ── HEADER STRIP: count + analytics ── */}
      <div style={{padding:"10px 14px 0",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:"rgba(255,255,255,.55)",letterSpacing:.3}}>
              {sessions===null ? "Loading…" : displayCount+" session"+(displayCount!==1?"s":"")+(isAdminScope&&groups?" · "+groups.length+" rep"+(groups.length!==1?"s":""):"")}
            </div>
            {activeFilters && <div style={{fontSize:9,color:SESS_COLOR,marginTop:1}}>Filters active</div>}
          </div>
          <div style={{display:"flex",gap:6}}>
            {!isAdminScope && (
              <button onClick={function(){setView("shared");}} style={{background:"rgba(0,180,255,.1)",border:"1px solid rgba(0,180,255,.25)",borderRadius:10,color:"#00B4FF",fontSize:11,fontWeight:700,padding:"6px 10px",cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:5}}>
                👥{sharedWithMe.length > 0 && <span style={{background:"rgba(0,180,255,.25)",borderRadius:99,padding:"0 5px",fontSize:9,minWidth:14,textAlign:"center"}}>{sharedWithMe.length}</span>}
              </button>
            )}
            <button onClick={function(){setView("highlights");}} aria-label="Highlights"
              style={{background:"rgba(255,201,64,.1)",border:"1px solid rgba(255,201,64,.28)",borderRadius:10,color:HL_COLOR,fontSize:11,fontWeight:700,padding:"6px 10px",cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:4}}>
              ★{highlights && highlights.length > 0 && <span style={{background:"rgba(255,201,64,.22)",borderRadius:99,padding:"0 5px",fontSize:9,minWidth:14,textAlign:"center"}}>{highlights.length}</span>}
            </button>
            <button onClick={function(){setView("analytics");}} style={{background:accentA(.1),border:("1px solid "+accentA(.25)),borderRadius:10,color:SESS_COLOR,fontSize:11,fontWeight:700,padding:"6px 12px",cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:5}}>
              📊 Analytics
            </button>
          </div>
        </div>

        {/* ── TYPE FILTER: always visible pill tabs ── */}
        <div style={{display:"flex",background:"rgba(255,255,255,.05)",borderRadius:10,padding:2,gap:1,marginBottom:10}}>
          {[["all","All","#FFD54F"],["live","📞 Live","#A8FF3E"],["practice","🎯 Practice","#00B4FF"]].map(function(t){
            var on=fType===t[0];
            return <button key={t[0]} onClick={function(){setFType(t[0]);}}
              style={{flex:1,background:on?"rgba(255,255,255,.1)":"transparent",border:"none",borderRadius:8,padding:"7px 4px",cursor:"pointer",fontFamily:"inherit",color:on?t[2]:"rgba(255,255,255,.4)",fontSize:11,fontWeight:on?700:400}}>{t[1]}</button>;
          })}
        </div>

        {/* ── STAT BOXES: filter-aware ── */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:7,marginBottom:10}}>
          {statBoxes.map(function(sb,i){
            return <StatBox key={i} value={sessions?sb.value:"…"} label={sb.label} color={sb.color}/>;
          })}
        </div>

        {/* ── ADMIN SCOPE ── */}
        {isAdmin && (
          <div style={{marginBottom:8}}>
            <select value={viewScope||"self"} onChange={function(e){ setViewScope(e.target.value); setSessions(null); }}
              style={{width:"100%",background:themed("#081428"),border:("1px solid "+accentA(.2)),borderRadius:10,padding:"8px 12px",color:SESS_COLOR,fontSize:11,fontFamily:"inherit",cursor:"pointer",outline:"none",appearance:"none",backgroundImage:"url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='"+SESS_COLOR.replace("#","%23")+"'/%3E%3C/svg%3E\")",backgroundRepeat:"no-repeat",backgroundPosition:"right 12px center"}}>
              <option value="self">👤 My sessions</option>
              <option value="org">🌐 Entire org</option>
              {(orgTeams||[]).map(function(t){ return <option key={t.id} value={"team:"+t.id}>🏷️ {t.name}</option>; })}
              {(orgUsers||[]).filter(function(u){ return u.id !== authUser.id; }).map(function(u){ return <option key={u.id} value={"user:"+u.id}>👤 {u.displayName}</option>; })}
            </select>
          </div>
        )}

        {/* ── USER SEARCH (admin multi-user scope) ── */}
        {isAdminScope && (
          <div style={{position:"relative",marginBottom:8}} onClick={function(e){e.stopPropagation();}}>
            <div style={{position:"relative"}}>
              <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",color:"rgba(255,255,255,.3)",fontSize:13,pointerEvents:"none"}}>🔎</span>
              <input value={userSearch} onChange={function(e){ setUserSearch(e.target.value); setSuggestOpen(true); }}
                onFocus={function(){ setSuggestOpen(true); }}
                placeholder="Filter by rep name…"
                style={inputSt({paddingLeft:32,height:34,fontSize:11})}
              />
              {userSearch && (
                <button onClick={function(){ setUserSearch(""); setSuggestOpen(false); }}
                  style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"rgba(255,255,255,.35)",fontSize:14,padding:"2px 4px",fontFamily:"inherit"}}>×</button>
              )}
            </div>
            {suggestOpen && suggestions.length > 0 && (
              <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:200,background:themed("#1a1d24"),border:"1px solid rgba(255,255,255,.12)",borderRadius:10,marginTop:3,overflow:"hidden",boxShadow:"0 8px 24px rgba(0,0,0,.5)"}}>
                {suggestions.map(function(u) {
                  return (
                    <button key={u.id}
                      onMouseDown={function(e){ e.preventDefault(); setUserSearch(u.displayName); setSuggestOpen(false); }}
                      style={{display:"flex",alignItems:"center",gap:9,width:"100%",background:"none",border:"none",borderBottom:"1px solid rgba(255,255,255,.06)",padding:"8px 12px",cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}>
                      <div style={{width:22,height:22,borderRadius:"50%",background:accentA(.15),border:("1px solid "+accentA(.3)),display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:SESS_COLOR,flexShrink:0}}>
                        {(u.displayName || "?")[0].toUpperCase()}
                      </div>
                      <div>
                        <div style={{fontSize:12,fontWeight:600,color:"#fff"}}>{u.displayName}</div>
                        <div style={{fontSize:9,color:"rgba(255,255,255,.3)"}}>{u.email || u.role}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── DATE FILTER (collapsible) ── */}
        <div style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.07)",borderRadius:10,marginBottom:10,overflow:"hidden"}}>
          <button onClick={function(){setFiltersOpen(function(p){return !p;});}}
            style={{display:"flex",justifyContent:"space-between",alignItems:"center",width:"100%",background:"none",border:"none",padding:"8px 11px",cursor:"pointer",fontFamily:"inherit"}}>
            <div style={{display:"flex",alignItems:"center",gap:7}}>
              <span style={{fontSize:11,color:"rgba(255,255,255,.45)",fontWeight:600}}>📅 Date range</span>
              {(fFrom||fTo) && <span style={{background:accentA(.15),border:("1px solid "+accentA(.25)),color:SESS_COLOR,fontSize:9,fontWeight:700,padding:"1px 6px",borderRadius:99}}>active</span>}
            </div>
            <span style={{color:"rgba(255,255,255,.3)",fontSize:10}}>{filtersOpen?"▲":"▼"}</span>
          </button>
          {filtersOpen && (
            <div style={{padding:"0 11px 11px",borderTop:"1px solid rgba(255,255,255,.06)"}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginTop:8}}>
                <div><div style={{fontSize:9,color:"rgba(255,255,255,.3)",marginBottom:3,textTransform:"uppercase",letterSpacing:.6}}>From</div><DarkDatePicker value={fFrom} onChange={function(e){setFFrom(e.target.value);}} style={{fontSize:11,padding:"6px 8px"}}/></div>
                <div><div style={{fontSize:9,color:"rgba(255,255,255,.3)",marginBottom:3,textTransform:"uppercase",letterSpacing:.6}}>To</div><DarkDatePicker value={fTo} onChange={function(e){setFTo(e.target.value);}} style={{fontSize:11,padding:"6px 8px"}}/></div>
              </div>
              {(fFrom||fTo) && <button onClick={function(){setFFrom("");setFTo("");}} style={{width:"100%",background:"none",border:"1px solid rgba(255,255,255,.1)",borderRadius:8,color:"rgba(255,255,255,.3)",fontSize:11,padding:"6px",cursor:"pointer",fontFamily:"inherit",marginTop:6}}>Clear date filter</button>}
            </div>
          )}
        </div>

        {sessions===null && <div style={{textAlign:"center",color:"rgba(255,255,255,.3)",padding:"28px 0"}}>Loading…</div>}
        {sessions!==null && displayCount===0 && <div style={{textAlign:"center",color:"rgba(255,255,255,.25)",padding:"32px 0",fontSize:13,lineHeight:1.7}}>No sessions match your filters.</div>}
      </div>

      {/* ── SESSION LIST ── */}
      <div style={{padding:"0 14px"}}>
        {!isAdminScope && filtered.map(renderSessionRow)}
        {isAdminScope && groups && groups.map(function(g) {
          var isCollapsed = collapsedUsers[g.user.id] !== false;
          var liveCt = g.sessions.filter(function(s){ return (s.mode||"live")==="live"; }).length;
          var soldCt = g.sessions.filter(function(s){ return s.sold; }).length;
          var pracCt = g.sessions.filter(function(s){ return s.mode==="practice"; }).length;
          return (
            <div key={g.user.id} style={{marginBottom:isCollapsed?8:16}}>
              <button onClick={function(){ toggleCollapse(g.user.id); }}
                style={{display:"flex",alignItems:"center",gap:9,width:"100%",background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)",borderRadius:10,padding:"9px 12px",cursor:"pointer",fontFamily:"inherit",marginBottom:isCollapsed?0:8,textAlign:"left"}}>
                <div style={{width:28,height:28,borderRadius:"50%",background:accentA(.15),border:("1px solid "+accentA(.3)),display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:SESS_COLOR,flexShrink:0}}>
                  {(g.user.displayName || "?")[0].toUpperCase()}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:700,color:"#fff"}}>{g.user.displayName}</div>
                  <div style={{fontSize:9,color:"rgba(255,255,255,.3)",marginTop:1}}>
                    {g.user.email}
                    <span style={{marginLeft:6}}>{g.sessions.length} session{g.sessions.length!==1?"s":""}</span>
                    {liveCt>0 && <span style={{marginLeft:6,color:accentA(.6)}}>{soldCt}/{liveCt} sold</span>}
                    {pracCt>0 && <span style={{marginLeft:6,color:"rgba(0,180,255,.5)"}}>{pracCt} practice</span>}
                  </div>
                </div>
                <span style={{fontSize:10,color:"rgba(255,255,255,.3)",flexShrink:0}}>{isCollapsed?"▶":"▼"}</span>
              </button>
              {!isCollapsed && g.sessions.slice().sort(function(a,b){return b.startTs-a.startTs;}).map(renderSessionRow)}
            </div>
          );
        })}
        <div style={{height:16}}/>
      </div>
      {shareTarget && <ShareModal session={shareTarget} orgUsers={orgUsers} orgTeams={orgTeams} authUser={authUser} onClose={function(){setShareTarget(null);}}/>}
    </div>
  );
}

// ─── SESSION ANALYTICS ────────────────────────────────────────────────────────
// hlOnly / setHlOnly switch every metric to the highlighted sessions; highlightedCount is
// how many of the current (non-highlight) list are highlighted
export function SessionAnalytics({ sessions, deckColor, deckName, deckRootCard, fType, setFType, fFrom, setFFrom, fTo, setFTo, filtersOpen, setFiltersOpen, onBack, hlOnly, setHlOnly, highlightedCount }) {
  var live = sessions.filter(function(s){return (s.sessionType||s.mode||"live")==="live";});
  var practice = sessions.filter(function(s){return (s.sessionType||s.mode||"live")==="practice";});
  var sold = live.filter(function(s){return s.sold;});
  var cr = live.length ? Math.round(sold.length/live.length*100) : 0;
  var allV = sessions.flatMap(function(s){return sessionVisits(s);});
  var intPct = allV.length ? Math.round(allV.filter(function(v){return v.intendedPath;}).length/allV.length*100) : 0;
  var completedSess = sessions.filter(function(s){return s.endTs;});
  var avgSec = completedSess.length ? Math.round(completedSess.reduce(function(sum,s){return sum+sessionDurSec(s);},0)/completedSess.length) : 0;

  var notContacted = live.filter(function(s){return s.outcome==="not_contacted";}).length;
  var contacted    = live.length - notContacted;
  var contactRate  = live.length ? Math.round(contacted/live.length*100) : 0;
  var pastIntro = live.filter(function(s){return sessionVisits(s).some(function(v){return v.cardType==="discovery"&&!v.isObjCard;});}).length;
  var reachedClose = live.filter(function(s){return sessionVisits(s).some(function(v){return v.cardType==="close"&&!v.isObjCard;});}).length;

  var objC = {};
  sessions.forEach(function(s){sessionVisits(s).filter(function(v){return v.isObjCard&&v.stackLabel;}).forEach(function(v){objC[v.stackLabel]=(objC[v.stackLabel]||0)+1;});});
  var topObjs = Object.entries(objC).sort(function(a,b){return b[1]-a[1];});
  var topObjLabel = topObjs.length ? topObjs[0][0] : "—";
  var topObjCount = topObjs.length ? topObjs[0][1] : 0;
  var maxObj = topObjs.length ? topObjs[0][1] : 1;

  var cardT = {};
  sessions.forEach(function(s){sessionVisits(s).filter(function(v){return !v.isObjCard && v.cardId !== deckRootCard;}).forEach(function(v){
    if(!cardT[v.cardId])cardT[v.cardId]={title:v.cardTitle,type:v.cardType,ms:0,ct:0};
    cardT[v.cardId].ms+=v.durationMs||0; cardT[v.cardId].ct++;
  });});
  var topCards = Object.values(cardT).sort(function(a,b){return b.ct-a.ct;}).slice(0,10);
  var maxCt = topCards.length ? topCards[0].ct : 1;
  var hasDateFilter = !!(fFrom||fTo);

  function renderKeyMetrics() {
    if (fType === "live") {
      return (
        <div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
            <StatBox value={cr+"%"} label="Close rate" color="#66BB6A"/>
            <StatBox value={sold.length+"/"+live.length} label="Sold / Live" color={SESS_COLOR}/>
            <StatBox value={fmtSec(avgSec)||"—"} label="Avg duration" color={SESS_COLOR}/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
            <StatBox value={contactRate+"%"} label="Contact rate" color="#FFD54F"/>
            <StatBox value={notContacted} label="No contact" color="rgba(255,255,255,.4)"/>
            <StatBox value={intPct+"%"} label="Intended path" color="#66BB6A"/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
            <StatBox value={topObjCount||"—"} label={"Top obj: "+(topObjLabel.length>10?topObjLabel.slice(0,10)+"…":topObjLabel)} color={OBJ_COLOR}/>
          </div>
        </div>
      );
    }
    if (fType === "practice") {
      return (
        <div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
            <StatBox value={practice.length} label="Practice runs" color="#00B4FF"/>
            <StatBox value={fmtSec(avgSec)||"—"} label="Avg duration" color={SESS_COLOR}/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
            <StatBox value={intPct+"%"} label="Intended path" color="#66BB6A"/>
            <StatBox value={topObjCount||"—"} label={topObjCount?"Most practiced obj":"Top objection"} color={OBJ_COLOR}/>
          </div>
        </div>
      );
    }
    // All
    return (
      <div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
          <StatBox value={sessions.length} label="Total sessions" color={SESS_COLOR}/>
          <StatBox value={fmtSec(avgSec)||"—"} label="Avg duration" color={SESS_COLOR}/>
          <StatBox value={intPct+"%"} label="Intended path" color="#66BB6A"/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
          <StatBox value={cr+"%"} label="Close rate" color="#66BB6A"/>
          <StatBox value={contactRate+"%"} label="Contact rate" color="#FFD54F"/>
          <StatBox value={notContacted} label="No contact" color="rgba(255,255,255,.4)"/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
          <StatBox value={topObjCount||"—"} label={"Top objection"} color={OBJ_COLOR}/>
        </div>
      </div>
    );
  }

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,.07)",display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
        <button onClick={onBack} style={Object.assign({},iconBtn(),{padding:"5px 8px"})}>←</button>
        <span style={{fontSize:13,fontWeight:700,color:"#fff",flex:1}}>Analytics · {deckName}{hlOnly ? <span style={{color:HL_COLOR}}> · ★ Highlights</span> : null}</span>
        <span style={{fontSize:9,color:"rgba(255,255,255,.25)"}}>{sessions.length} session{sessions.length!==1?"s":""}</span>
      </div>
      {/* Prominent type filter tabs */}
      <div style={{padding:"10px 14px 0",flexShrink:0}}>
        <div style={{display:"flex",background:"rgba(255,255,255,.05)",borderRadius:10,padding:2,gap:1,marginBottom:10}}>
          {[["all","All","#FFD54F"],["live","📞 Live","#A8FF3E"],["practice","🎯 Practice","#00B4FF"]].map(function(t){
            var on=fType===t[0];
            return <button key={t[0]} onClick={function(){setFType(t[0]);}} style={{flex:1,background:on?"rgba(255,255,255,.1)":"transparent",border:"none",borderRadius:8,padding:"7px",cursor:"pointer",fontFamily:"inherit",color:on?t[2]:"rgba(255,255,255,.4)",fontSize:12,fontWeight:on?700:400}}>{t[1]}</button>;
          })}
        </div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"0 14px 0"}}>
        {/* All sessions ↔ highlighted sessions only */}
        {setHlOnly && (
          <div role="radiogroup" aria-label="Sessions to analyse" style={{display:"flex",gap:6,marginBottom:10}}>
            {[[false,"All sessions"],[true,"★ Highlights"]].map(function(o){
              var on = !!hlOnly === o[0];
              return <button key={o[1]} role="radio" aria-checked={on} onClick={function(){ setHlOnly(o[0]); }}
                style={{flex:1,minHeight:36,background:on?(o[0]?"rgba(255,201,64,.12)":"rgba(255,255,255,.1)"):"transparent",border:"1px solid "+(on?(o[0]?"rgba(255,201,64,.4)":"rgba(255,255,255,.18)"):"rgba(255,255,255,.08)"),borderRadius:10,color:on?(o[0]?HL_COLOR:"#fff"):"rgba(255,255,255,.4)",fontSize:11,fontWeight:on?700:500,cursor:"pointer",fontFamily:"inherit"}}>{o[1]}</button>;
            })}
          </div>
        )}
        {!hlOnly && highlightedCount != null && sessions.length > 0 && (
          <div style={{display:"flex",alignItems:"center",gap:8,background:"rgba(255,201,64,.05)",border:"1px solid rgba(255,201,64,.18)",borderRadius:10,padding:"9px 12px",marginBottom:12}}>
            <span style={{fontSize:18,fontWeight:700,color:HL_COLOR,lineHeight:1}}>{highlightedCount}</span>
            <span style={{fontSize:11,color:"rgba(255,255,255,.5)"}}>highlighted · {Math.round(highlightedCount / sessions.length * 100)}% of these sessions</span>
          </div>
        )}
        {/* Date filter (collapsible) */}
        <div style={{background:themed("#081428"),border:"1px solid rgba(255,255,255,.08)",borderRadius:10,marginBottom:12,overflow:"hidden"}}>
          <button onClick={function(){setFiltersOpen(function(p){return !p;});}}
            style={{display:"flex",justifyContent:"space-between",alignItems:"center",width:"100%",background:"none",border:"none",padding:"10px 12px",cursor:"pointer",fontFamily:"inherit"}}>
            <div style={{display:"flex",alignItems:"center",gap:7}}>
              <span style={{fontSize:12,color:"rgba(255,255,255,.5)",fontWeight:700}}>Date filter</span>
              {hasDateFilter && <span style={{background:accentA(.18),border:("1px solid "+accentA(.3)),color:SESS_COLOR,fontSize:9,fontWeight:700,padding:"1px 7px",borderRadius:99}}>active</span>}
            </div>
            <span style={{color:"rgba(255,255,255,.35)",fontSize:11}}>{filtersOpen?"▲":"▼"}</span>
          </button>
          {filtersOpen && (
            <div style={{padding:"0 12px 12px",borderTop:"1px solid rgba(255,255,255,.06)"}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:hasDateFilter?8:0,marginTop:10}}>
                <div><div style={{fontSize:9,color:"rgba(255,255,255,.3)",marginBottom:3,textTransform:"uppercase",letterSpacing:.6}}>From</div><DarkDatePicker value={fFrom} onChange={function(e){setFFrom(e.target.value);}} style={{fontSize:11,padding:"6px 8px"}}/></div>
                <div><div style={{fontSize:9,color:"rgba(255,255,255,.3)",marginBottom:3,textTransform:"uppercase",letterSpacing:.6}}>To</div><DarkDatePicker value={fTo} onChange={function(e){setFTo(e.target.value);}} style={{fontSize:11,padding:"6px 8px"}}/></div>
              </div>
              {hasDateFilter && <button onClick={function(){setFFrom("");setFTo("");}} style={{width:"100%",background:"none",border:"1px solid rgba(255,255,255,.1)",borderRadius:8,color:"rgba(255,255,255,.35)",fontSize:11,padding:"7px",cursor:"pointer",fontFamily:"inherit",marginTop:4}}>Clear date filter</button>}
            </div>
          )}
        </div>
        {/* Key metrics */}
        <SectionHdr>Key metrics</SectionHdr>
        {renderKeyMetrics()}
        {/* Funnel — only for live/all */}
        {fType !== "practice" && (
          <div style={{marginBottom:14}}>
            <SectionHdr>Live funnel</SectionHdr>
            <div style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.08)",borderRadius:12,padding:"13px 14px"}}>
              <BarRow label="Contacted"       value={contacted}     denom={live.length}    color={SESS_COLOR}/>
              <BarRow label="Into discovery"  value={pastIntro}     denom={contacted}      color="#00B4FF"/>
              <BarRow label="Reached close"   value={reachedClose}  denom={pastIntro}      color="#66BB6A"/>
              <BarRow label="Sold"            value={sold.length}   denom={reachedClose}   color={SESS_COLOR}/>
            </div>
          </div>
        )}
        {/* Top objections */}
        {topObjs.length > 0 && (
          <div style={{marginBottom:14}}>
            <SectionHdr>Most common objections</SectionHdr>
            <div style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.08)",borderRadius:12,padding:"13px 14px"}}>
              {topObjs.slice(0,5).map(function(entry, i) {
                var pct = Math.round(entry[1]/maxObj*100);
                return <div key={entry[0]} style={{marginBottom:i<Math.min(topObjs.length,5)-1?9:0}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:11,color:"rgba(255,255,255,.65)"}}>{entry[0]}</span><span style={{fontSize:11,color:OBJ_COLOR,fontWeight:700}}>{entry[1]}x</span></div>
                  <div style={{height:4,background:"rgba(255,255,255,.07)",borderRadius:99,overflow:"hidden"}}><div style={{height:"100%",background:OBJ_COLOR,borderRadius:99,width:pct+"%"}}/></div>
                </div>;
              })}
            </div>
          </div>
        )}
        {/* Top cards */}
        {topCards.length > 0 && (
          <div style={{marginBottom:14}}>
            <SectionHdr>Most visited cards</SectionHdr>
            <div style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.08)",borderRadius:12,padding:"13px 14px"}}>
              {topCards.map(function(c, i) { var m=TM[c.type]||TM.pitch; var pct=Math.round(c.ct/maxCt*100); return (
                <div key={c.title} style={{marginBottom:i<topCards.length-1?9:0}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
                    <div style={{display:"flex",alignItems:"center",gap:5,flex:1,minWidth:0}}>
                      <span style={{fontSize:10,color:m.color,flexShrink:0}}>■</span>
                      <span style={{fontSize:11,color:i===0?"#fff":"rgba(255,255,255,.65)",fontWeight:i===0?700:400,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.title}</span>
                    </div>
                    <span style={{fontSize:11,color:m.color,fontWeight:700,flexShrink:0,marginLeft:6}}>{c.ct}x</span>
                  </div>
                  <div style={{height:4,background:"rgba(255,255,255,.07)",borderRadius:99,overflow:"hidden"}}><div style={{height:"100%",background:m.color,borderRadius:99,width:pct+"%"}}/></div>
                </div>
              );})}
            </div>
          </div>
        )}
        <div style={{height:16}}/>
      </div>
    </div>
  );
}
