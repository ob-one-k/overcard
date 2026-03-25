import { useState, useEffect, useRef, useContext } from "react";
import { TM, OBJ_COLOR, SESS_COLOR, STYPE, OBJ_ICONS, uid, sid } from "../lib/constants";
import { apiPost } from "../lib/api";
import { solidBtn, ghostBtn, ghostSm, iconBtn, inputSt, cardBg, badgeSt, dividerV, labelSt } from "../lib/styles";
import { TypeBadge, Handle, SectionHdr, IntendedBadge as IntendedBadgeComp } from "./ui";
import { TipCtx, RichPromptDisplay, OverviewDisplay } from "./Tooltip";

// ─── OBJECTION PICKER (in-session sheet) ──────────────────────────────────────
export function ObjPicker({ stacks, onSelect, onClose, deckCards }) {
  return (
    <div style={{position:"fixed",inset:0,zIndex:250,display:"flex",flexDirection:"column"}}>
      <div onClick={onClose} style={{flex:1,background:"rgba(0,0,0,.55)",backdropFilter:"blur(6px)"}}/>
      <div style={{background:"#081428",borderRadius:"24px 24px 0 0",border:"1px solid rgba(239,83,80,.25)",borderBottom:"none",padding:"0 20px 0",animation:"sheetUp .28s cubic-bezier(.22,1,.36,1) both"}}>
        <Handle/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,paddingTop:4}}>
          <div>
            <div style={{fontSize:16,fontWeight:700,color:"#fff",fontFamily:"'Lora',serif"}}>Handle an Objection</div>
            <div style={{fontSize:11,color:"rgba(255,255,255,.3)",marginTop:2}}>Select a stack to handle the objection</div>
          </div>
          <button onClick={onClose} style={iconBtn()}>✕</button>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:8,paddingBottom:28,maxHeight:"62vh",overflowY:"auto"}}>
          {stacks.length === 0 && <div style={{textAlign:"center",color:"rgba(255,255,255,.3)",padding:"28px 0",fontSize:14}}>No objection stacks yet.</div>}
          {stacks.map(function(stack, i) {
            return (
              <button key={stack.id} onClick={function(){onSelect(stack);}}
                style={{background:"rgba(239,83,80,.06)",border:"1.5px solid rgba(239,83,80,.18)",borderRadius:16,padding:"15px 17px",cursor:"pointer",textAlign:"left",fontFamily:"inherit",display:"flex",alignItems:"center",gap:14,animation:"answerItem .3s cubic-bezier(.22,1,.36,1) "+(i*.06)+"s both"}}>
                <div style={{width:44,height:44,borderRadius:14,background:"rgba(239,83,80,.15)",border:"1px solid rgba(239,83,80,.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>{stack.icon}</div>
                <div>
                  <div style={{fontSize:15,fontWeight:700,color:"#fff",marginBottom:2}}>{stack.label}</div>
                  <div style={{fontSize:11,color:"rgba(255,255,255,.3)",marginBottom:2}}>{Object.keys(stack.cards).length} response paths</div>
                  {stack.targetCard && stack.targetCard !== "__pick" && deckCards && deckCards[stack.targetCard]
                    ? <div style={{fontSize:10,color:"rgba(239,83,80,.55)"}}>→ then: {deckCards[stack.targetCard].title}</div>
                    : <div style={{fontSize:10,color:"rgba(255,255,255,.22)"}}>↩ returns to current card</div>
                  }
                </div>
                <span style={{marginLeft:"auto",color:"rgba(239,83,80,.6)",fontSize:18}}>›</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── NAVIGATOR ────────────────────────────────────────────────────────────────
// Core card navigator — used inside active Play sessions.
// sessionMode=true records visit events and shows the + Note button.
// cardEnterTime tracks dwell time per card.
export function Navigator({ deck, sessionMode, onEvent, onNavigationChange, getAudioOffset }) {
  var [pitchHist, setPitchHist] = useState(deck.rootCard ? [deck.rootCard] : []);
  var [objMode,   setObjMode]   = useState(null);
  var [showPicker, setShowPicker] = useState(false);
  var [animKey, setAnimKey] = useState(0);
  var [dir, setDir] = useState(1);
  var [showNote, setShowNote] = useState(false);
  var [noteText, setNoteText] = useState("");
  var cardEnterTime = useRef(Date.now());

  useEffect(function() {
    setPitchHist(deck.rootCard ? [deck.rootCard] : []);
    setObjMode(null);
    setAnimKey(function(k) { return k + 1; });
  }, [deck.id, deck.rootCard]);

  // Report current depth/obj state to parent so PlayTab can show "No Contact" button
  useEffect(function() {
    if (onNavigationChange && sessionMode) {
      onNavigationChange({ depth: pitchHist.length, inObj: !!objMode });
    }
  }, [pitchHist.length, objMode]);

  var inObj = !!objMode;
  var curCards = inObj ? objMode.stack.cards : deck.cards;
  var curId = inObj ? objMode.history[objMode.history.length-1] : pitchHist[pitchHist.length-1];
  var card = curId ? curCards[curId] : null;
  var meta = card ? (TM[card.type] || TM.pitch) : TM.pitch;

  function emitVisit(c, dur) {
    if (!sessionMode || !onEvent) return;
    var audioEnd   = getAudioOffset ? getAudioOffset() : null;
    var audioStart = audioEnd !== null ? Math.max(0, audioEnd - dur) : null;
    onEvent({ type:"visit", cardId:c.id, cardTitle:c.title, cardType:c.type, isObjCard:inObj, stackLabel:inObj&&objMode?objMode.stack.label:null, intendedPath:!!c.intendedPath, ts:Date.now(), durationMs:dur, audioStartMs:audioStart, audioEndMs:audioEnd });
  }

  function navigate(nextCardId, isObj, newObjMode) {
    var dur = Date.now() - cardEnterTime.current;
    if (card) emitVisit(card, dur);
    cardEnterTime.current = Date.now();
    setDir(1); setAnimKey(function(k) { return k + 1; });
    if (isObj) { setObjMode(newObjMode); }
    else if (nextCardId) { setPitchHist(function(h) { return h.concat([nextCardId]); }); }
  }

  function goAnswer(ans) {
    if (inObj) {
      var dur = Date.now() - cardEnterTime.current;
      if (card) emitVisit(card, dur);
      cardEnterTime.current = Date.now();
      if (!ans.next) {
        setDir(-1); setAnimKey(function(k) { return k+1; });
        var tc = objMode && objMode.stack && objMode.stack.targetCard;
        var validTc = tc && tc !== "__pick" && deck.cards[tc];
        setTimeout(function() {
          if (validTc) setPitchHist(function(h) { return h.concat([tc]); });
          setObjMode(null);
        }, 30);
      } else {
        setDir(1); setAnimKey(function(k) { return k+1; });
        setObjMode(function(o) { return Object.assign({}, o, {history: o.history.concat([ans.next])}); });
      }
    } else {
      if (!ans.next) return;
      navigate(ans.next, false, null);
    }
  }

  function goBack() {
    setDir(-1); setAnimKey(function(k) { return k+1; });
    if (inObj) {
      if (objMode.history.length <= 1) setTimeout(function() { setObjMode(null); }, 30);
      else setObjMode(function(o) { return Object.assign({}, o, {history: o.history.slice(0,-1)}); });
    } else {
      if (pitchHist.length > 1) setPitchHist(function(h) { return h.slice(0,-1); });
    }
  }
  function jumpTo(idx) { setDir(-1); setAnimKey(function(k){return k+1;}); setPitchHist(function(h){return h.slice(0,idx+1);}); }
  function openStack(stack) { setShowPicker(false); navigate(null, true, {stack, history:[stack.rootCard], returnCard:curId}); }
  function exitObj() { setDir(-1); setAnimKey(function(k){return k+1;}); setTimeout(function(){setObjMode(null);},30); }
  function restart() { setDir(-1); setAnimKey(function(k){return k+1;}); setTimeout(function(){setPitchHist(deck.rootCard?[deck.rootCard]:[]);},30); }

  function submitNote() {
    if (!noteText.trim()) return;
    if (sessionMode && onEvent && card) {
      onEvent({ type:"note", cardId:card.id, cardTitle:card.title, text:noteText.trim(), ts:Date.now() });
    }
    setNoteText(""); setShowNote(false);
  }

  if (!deck.rootCard || !card) {
    return (
      <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:32,gap:16}}>
        <div style={{fontSize:52}}>📭</div>
        <div style={{color:"rgba(255,255,255,.4)",fontSize:15,textAlign:"center",lineHeight:1.6}}>No cards yet.<br/>Go to <strong style={{color:"#fff"}}>Cards</strong> to build your deck.</div>
      </div>
    );
  }

  var isEnd = !inObj && card.answers.every(function(a) { return !a.next; });
  var animName = dir > 0 ? "cardIn" : "cardBack";

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflowY:"auto",position:"relative"}}>
      {/* Objection mode banner */}
      {inObj && (
        <div style={{margin:"12px 16px 0",padding:"10px 16px",background:"rgba(239,83,80,.1)",border:"1px solid rgba(239,83,80,.25)",borderRadius:14,display:"flex",justifyContent:"space-between",alignItems:"center",animation:"fadeIn .2s ease both"}}>
          <div>
            <div style={{fontSize:11,color:OBJ_COLOR,fontWeight:700,letterSpacing:.7,textTransform:"uppercase"}}>🛡️ {objMode.stack.label}</div>
            <div style={{fontSize:11,color:"rgba(255,255,255,.3)",marginTop:2}}>Returns to: <span style={{color:"rgba(255,255,255,.55)"}}>{deck.cards[objMode.returnCard]?deck.cards[objMode.returnCard].title:""}</span></div>
          </div>
          <button onClick={exitObj} style={ghostSm({color:OBJ_COLOR,borderColor:"rgba(239,83,80,.3)"})}>Exit</button>
        </div>
      )}
      {/* Breadcrumb + nav controls */}
      {!inObj && pitchHist.length > 0 && (
        <div style={{padding:"12px 20px 0",display:"flex",flexDirection:"column",gap:8}}>
          <div style={{display:"flex",gap:4,alignItems:"center",overflowX:"auto",paddingBottom:2}}>
            {pitchHist.map(function(hid, i) {
              var hc = deck.cards[hid]; var hm = hc ? (TM[hc.type]||TM.pitch) : TM.pitch; var isLast = i===pitchHist.length-1;
              return (
                <div key={hid+i} style={{display:"flex",alignItems:"center",gap:4,flexShrink:0}}>
                  <button onClick={function(){if(!isLast)jumpTo(i);}}
                    style={{width:isLast?30:20,height:isLast?30:20,borderRadius:"50%",border:"2px solid "+hm.color,background:isLast?hm.color+"33":"transparent",cursor:isLast?"default":"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:isLast?11:8,color:hm.color,transition:"all .2s",flexShrink:0}}>
                    {isLast ? hm.icon : "●"}
                  </button>
                  {i < pitchHist.length-1 && <div style={{width:14,height:1,background:"rgba(255,255,255,.12)",flexShrink:0}}/>}
                </div>
              );
            })}
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:10,color:"rgba(255,255,255,.25)",letterSpacing:.4}}>Step {pitchHist.length}</span>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <button onClick={function(){setShowPicker(true);}}
                style={{background:"rgba(239,83,80,.12)",border:"1px solid rgba(239,83,80,.35)",borderRadius:99,color:OBJ_COLOR,padding:"5px 13px",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700,display:"flex",alignItems:"center",gap:6}}>
                🛡️ Objection
                {deck.objStacks.length > 0 && <span style={{background:"rgba(239,83,80,.28)",borderRadius:99,fontSize:10,padding:"0 6px"}}>{deck.objStacks.length}</span>}
              </button>
              {pitchHist.length > 1 && <button onClick={goBack} style={ghostSm()}>← Back</button>}
            </div>
          </div>
        </div>
      )}
      {inObj && (
        <div style={{padding:"10px 20px 0",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:10,color:"rgba(239,83,80,.6)",letterSpacing:.4}}>Step {objMode.history.length}</span>
          <button onClick={goBack} style={ghostSm({borderColor:"rgba(239,83,80,.3)",color:"rgba(239,83,80,.7)"})}>← Back</button>
        </div>
      )}
      {/* Card */}
      <div key={animKey} style={{margin:"12px 16px 0",animation:animName+" .3s cubic-bezier(.22,1,.36,1) both"}}>
        <div style={{background:"linear-gradient(145deg,rgba(255,255,255,.07),rgba(255,255,255,.03))",border:"1px solid rgba(255,255,255,"+(inObj?".15":".1")+")",borderRadius:22,overflow:"hidden",boxShadow:"0 0 40px "+meta.glow+",0 20px 50px rgba(0,0,0,.5)"}}>
          <div style={{height:3,background:"linear-gradient(90deg,"+meta.color+" 0%,"+meta.color+"99 55%,transparent 100%)"}}/>
          <div style={{padding:"14px 20px 8px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <TypeBadge type={card.type}/>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              {card.intendedPath && <IntendedBadgeComp/>}
              {inObj && <span style={{fontSize:10,color:"rgba(239,83,80,.5)",background:"rgba(239,83,80,.1)",padding:"2px 8px",borderRadius:99}}>🛡️ objection</span>}
              {sessionMode && (
                <button onClick={function(){setShowNote(true);}}
                  style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.12)",borderRadius:8,padding:"4px 9px",cursor:"pointer",fontSize:10,color:"rgba(255,255,255,.5)",fontFamily:"inherit"}}>+ Note</button>
              )}
            </div>
          </div>
          <div style={{padding:"0 20px 10px"}}>
            <h2 style={{margin:0,fontSize:22,fontWeight:700,color:"#fff",lineHeight:1.25,fontFamily:"'Lora',Georgia,serif"}}>{card.title}</h2>
          </div>
          <OverviewDisplay bullets={card.overview} color={meta.color}/>
          <div style={{margin:"0 14px 16px",padding:"15px 17px",background:"rgba(0,0,0,.3)",borderRadius:14,borderLeft:"3px solid "+meta.color}}>
            <p style={{margin:0,fontSize:15,lineHeight:1.75,color:"rgba(255,255,255,.92)",fontFamily:"'Lora',Georgia,serif"}}>
              <RichPromptDisplay text={card.prompt} accentColor={meta.color}/>
            </p>
          </div>
        </div>
      </div>
      {/* Quick note input */}
      {showNote && sessionMode && (
        <div style={{margin:"10px 16px 0",background:"rgba(168,255,62,.08)",border:"1px solid rgba(168,255,62,.22)",borderRadius:14,padding:"12px 14px",animation:"fadeIn .15s ease both"}}>
          <div style={{fontSize:10,fontWeight:700,color:SESS_COLOR,letterSpacing:.7,textTransform:"uppercase",marginBottom:7}}>📝 Note on: {card.title}</div>
          <textarea value={noteText} onChange={function(e){setNoteText(e.target.value);}}
            placeholder="Type your note…" rows={2}
            style={Object.assign({},inputSt({resize:"none",fontSize:13,padding:"9px 12px"}),{marginBottom:8,minHeight:58})}
            autoFocus/>
          <div style={{display:"flex",gap:8}}>
            <button onClick={function(){setShowNote(false);setNoteText("");}} style={Object.assign({},ghostBtn(),{flex:1,padding:"8px",fontSize:12})}>Cancel</button>
            <button onClick={submitNote} style={Object.assign({},solidBtn(SESS_COLOR),{flex:2,padding:"8px",fontSize:12})}>Save Note</button>
          </div>
        </div>
      )}
      {/* Answer buttons */}
      <div key={animKey+"a"} style={{padding:"13px 16px 0",animation:"answersIn .35s cubic-bezier(.22,1,.36,1) .1s both"}}>
        <div style={{fontSize:10,fontWeight:700,letterSpacing:2,color:"rgba(255,255,255,.2)",textTransform:"uppercase",marginBottom:8,paddingLeft:2}}>
          {inObj ? "Navigate objection:" : "Prospect responds:"}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:7}}>
          {card.answers.map(function(ans, i) {
            var nextCard = ans.next ? curCards[ans.next] : null;
            var nm = nextCard ? (TM[nextCard.type] || TM.pitch) : null;
            var isTerminal = !ans.next;
            var isIntended = !inObj && nextCard && !!nextCard.intendedPath;
            return (
              <button key={ans.id} onClick={function(){goAnswer(ans);}}
                style={{background:isIntended?"rgba(102,187,106,.08)":"rgba(255,255,255,.05)",border:"1.5px solid "+(isIntended?"rgba(102,187,106,.35)":isTerminal?"rgba(255,255,255,.06)":"rgba(255,255,255,.11)"),borderRadius:14,padding:"14px 16px",cursor:isTerminal?"default":"pointer",textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center",fontFamily:"inherit",gap:10,animation:"answerItem .32s cubic-bezier(.22,1,.36,1) "+(.08+i*.05)+"s both",opacity:(isTerminal&&!inObj)?0.45:1}}>
                <div style={{display:"flex",alignItems:"center",gap:11,flex:1,minWidth:0}}>
                  <span style={{width:25,height:25,borderRadius:"50%",background:isIntended?"rgba(102,187,106,.2)":meta.color+"22",border:"1.5px solid "+(isIntended?"rgba(102,187,106,.5)":meta.color+"44"),color:isIntended?"#66BB6A":meta.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,flexShrink:0}}>{i+1}</span>
                  <span style={{color:isIntended?"rgba(255,255,255,.95)":"rgba(255,255,255,.85)",fontSize:14,lineHeight:1.4}}>{ans.label}</span>
                </div>
                {isIntended && <span style={{fontSize:10,color:"#66BB6A",flexShrink:0,fontWeight:700}}>★</span>}
                {inObj && isTerminal && <span style={{fontSize:10,color:"rgba(239,83,80,.5)",background:"rgba(239,83,80,.1)",padding:"2px 8px",borderRadius:99,flexShrink:0}}>↩ return</span>}
                {!inObj && isTerminal && <span style={{fontSize:10,color:"rgba(255,255,255,.2)",flexShrink:0}}>end</span>}
                {nm && <span style={{fontSize:10,color:isIntended?"#66BB6A":nm.color,background:isIntended?"rgba(102,187,106,.15)":nm.color+"18",padding:"2px 8px",borderRadius:99,flexShrink:0,border:"1px solid "+(isIntended?"rgba(102,187,106,.3)":nm.color+"30")}}>{nm.icon} {nextCard.title}</span>}
              </button>
            );
          })}
        </div>
      </div>
      {/* End of path */}
      {isEnd && (
        <div style={{margin:"18px 16px 0",padding:"18px",background:"rgba(102,187,106,.07)",border:"1px solid rgba(102,187,106,.2)",borderRadius:16,textAlign:"center"}}>
          <div style={{fontSize:26,marginBottom:6}}>✅</div>
          <div style={{color:"rgba(255,255,255,.6)",fontSize:13,marginBottom:14,lineHeight:1.5}}>End of this path.</div>
          <button onClick={restart} style={solidBtn("#66BB6A")}>↺ Restart</button>
        </div>
      )}
      <div style={{height:24}}/>
      {showPicker && <ObjPicker stacks={deck.objStacks} onSelect={openStack} onClose={function(){setShowPicker(false);}} deckCards={deck.cards}/>}
    </div>
  );
}

// ─── PLAY TAB ─────────────────────────────────────────────────────────────────
// Three sub-views: home (dashboard), active (live session), ended (auto-redirect)
// From home, user picks Live or Practice and fills in title + description.
// While active, navigation is locked — no tab switching until End or Sold.
// On finish, auto-portals the user to the Session review in Sessions tab.
export function PlayTab({ deck, activeId, onPortalToReview, onSwitchDeck,
    playView, setPlayView, activeSession, setActiveSession, sessionEvents, setSessionEvents }) {
  var [pendingType, setPendingType]   = useState("practice");
  var [newName, setNewName]           = useState("");
  var [newDesc, setNewDesc]           = useState("");
  var [saving, setSaving]             = useState(false);
  var [nameError, setNameError]       = useState(false);
  var [navDepth,  setNavDepth]        = useState(1);
  var [navInObj,  setNavInObj]        = useState(false);
  // Audio recording state
  var [audioDevices,   setAudioDevices]   = useState([]);
  var [selectedDevice, setSelectedDevice] = useState("");
  var [recordAudio,    setRecordAudio]    = useState(false);
  var [deviceError,    setDeviceError]    = useState(null);
  // Audio recording refs
  var mediaRecorderRef = useRef(null);
  var audioChunksRef   = useRef([]);
  var recorderStartMs  = useRef(null);

  // Enumerate audio input devices when new-session form is shown
  useEffect(function() {
    if (playView !== "new") return;
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices) return;
    setDeviceError(null);
    navigator.mediaDevices.enumerateDevices()
      .then(function(devices) {
        var mics = devices.filter(function(d) { return d.kind === "audioinput"; });
        setAudioDevices(mics);
        if (mics.length > 0 && !selectedDevice) setSelectedDevice(mics[0].deviceId);
      })
      .catch(function() { setDeviceError("Could not list audio devices"); });
  }, [playView]);

  // Handle deck changes: deck switch is handled in MainApp's switchDeck, so this effect
  // only fires if deck.id changes while an active session exists (should not happen normally)
  useEffect(function() {
    if (playView === "active" && activeSession && activeSession.deckId !== deck.id) {
      // Stop any active recording without saving audio
      var rec = mediaRecorderRef.current;
      if (rec && rec.state !== "inactive") {
        rec.onstop = function() { rec.stream.getTracks().forEach(function(t){ t.stop(); }); };
        rec.stop();
      }
      mediaRecorderRef.current = null;
      var finished = Object.assign({}, activeSession, {
        endTs: Date.now(),
        status: "completed",
        outcome: "completed",
        events: sessionEvents,
      });
      apiPost("/sessions", finished).catch(function(e){ console.error("overcard:", e); });
      setActiveSession(null);
      setSessionEvents([]);
      setPlayView("home");
      setNewName(""); setNewDesc(""); setNameError(false);
    }
  }, [deck.id]);

  function startSession() {
    var trimmed = (newName || "").trim();
    if (!trimmed) { setNameError(true); return; }
    var s = {
      id: sid(), deckId: deck.id, deckName: deck.name,
      deckColor: deck.color, deckIcon: deck.icon,
      name: trimmed, description: (newDesc || "").trim(),
      sessionType: pendingType, mode: pendingType,
      startTs: Date.now(), endTs: null,
      status: "active", outcome: "in_progress",
      sold: false, soldCardId: null, soldCardTitle: null,
      events: [],
    };
    // Reset recorder state
    audioChunksRef.current = [];
    recorderStartMs.current = null;
    mediaRecorderRef.current = null;
    // Start microphone recording if opted in
    if (recordAudio && selectedDevice && typeof MediaRecorder !== "undefined") {
      navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: selectedDevice } } })
        .then(function(stream) {
          var mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
            ? "audio/webm;codecs=opus"
            : MediaRecorder.isTypeSupported("audio/webm")
              ? "audio/webm"
              : "audio/ogg";
          var recorder = new MediaRecorder(stream, { mimeType: mimeType });
          recorder.ondataavailable = function(e) {
            if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
          };
          mediaRecorderRef.current = recorder;
          recorderStartMs.current = Date.now();
          recorder.start(1000); // collect a chunk every second
        })
        .catch(function(err) {
          console.warn("overcard: audio recording unavailable:", err);
          mediaRecorderRef.current = null;
        });
    }
    setNavDepth(1);
    setNavInObj(false);
    setActiveSession(s);
    setSessionEvents([]);
    setPlayView("active");
  }

  function handleEvent(ev) {
    setSessionEvents(function(prev) { return prev.concat([ev]); });
  }

  function finishSession(sold, soldCard, outcomeOverride) {
    setSaving(true);
    var outcome = outcomeOverride || (sold ? "sold" : "completed");

    // Build audio segment metadata from visit events that have audio offsets
    var audioSegs = sessionEvents
      .filter(function(ev) { return ev.type === "visit" && ev.audioStartMs !== null && ev.audioStartMs !== undefined; })
      .map(function(ev, i) {
        return {
          segmentIndex: i,
          cardId:       ev.cardId,
          cardTitle:    ev.cardTitle,
          cardType:     ev.cardType,
          isObjCard:    !!ev.isObjCard,
          stackLabel:   ev.stackLabel || null,
          startMs:      ev.audioStartMs,
          endMs:        ev.audioEndMs,
        };
      });

    var finished = Object.assign({}, activeSession, {
      endTs:          Date.now(),
      status:         "completed",
      outcome:        outcome,
      sold:           !!sold,
      soldCardId:     sold && soldCard ? soldCard.id : null,
      soldCardTitle:  sold && soldCard ? soldCard.title : null,
      events:         sessionEvents,
      audioSegments:  audioSegs.length > 0 ? audioSegs : null,
    });

    function doSave() {
      apiPost("/sessions", finished)
        .then(function() {
          setSaving(false);
          setActiveSession(null);
          setSessionEvents([]);
          setPlayView("home");
          setNewName(""); setNewDesc(""); setNameError(false);
          onPortalToReview(finished.id);
        })
        .catch(function() {
          setSaving(false);
          setActiveSession(null);
          setSessionEvents([]);
          setPlayView("home");
          setNameError(false);
          onPortalToReview(null);
        });
    }

    var recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = function() {
        // Release mic
        recorder.stream.getTracks().forEach(function(t) { t.stop(); });
        mediaRecorderRef.current = null;
        // Only save blob if we have segments (i.e. recording actually captured card visits)
        if (audioSegs.length > 0) {
          var blob = new Blob(audioChunksRef.current, { type: recorder.mimeType });
          import("../lib/audioStore.js").then(function(mod) {
            mod.saveAudioBlob(finished.id, blob, recorder.mimeType)
              .catch(function() {}) // silent fail — session saves regardless
              .finally(doSave);
          }).catch(doSave);
        } else {
          doSave();
        }
      };
      recorder.stop();
    } else {
      if (mediaRecorderRef.current) mediaRecorderRef.current = null;
      doSave();
    }
  }

  if (playView === "active" && activeSession) {
    var st = STYPE[activeSession.sessionType] || STYPE.live;
    return (
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{padding:"9px 16px",background:st.bg,borderBottom:"1px solid "+st.border,display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
          <div>
            <div style={{fontSize:9,color:st.color,fontWeight:700,letterSpacing:.8,textTransform:"uppercase",marginBottom:1}}>● {st.label} · Recording</div>
            <div style={{fontSize:13,color:"#fff",fontWeight:700,lineHeight:1.2}}>{activeSession.name}</div>
            {activeSession.description && <div style={{fontSize:10,color:"rgba(255,255,255,.4)",marginTop:1}}>{activeSession.description}</div>}
          </div>
          <div style={{display:"flex",gap:6}}>
            {activeSession.mode === "live" && navDepth === 1 && !navInObj && (
              <button onClick={function(){finishSession(false, null, "not_contacted");}} disabled={saving}
                style={{background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.18)",borderRadius:9,color:"rgba(255,255,255,.55)",fontSize:11,fontWeight:700,padding:"7px 10px",cursor:"pointer",fontFamily:"inherit"}}>
                📵 No Contact
              </button>
            )}
            <button onClick={function(){finishSession(true, null);}} disabled={saving}
              style={{background:"#66BB6A",border:"none",borderRadius:9,color:"#000",fontSize:11,fontWeight:700,padding:"7px 13px",cursor:"pointer",fontFamily:"inherit"}}>
              ✓ Sold
            </button>
            <button onClick={function(){finishSession(false, null);}} disabled={saving}
              style={{background:"rgba(255,255,255,.1)",border:"1px solid rgba(255,255,255,.15)",borderRadius:9,color:"#fff",fontSize:11,fontWeight:700,padding:"7px 13px",cursor:"pointer",fontFamily:"inherit"}}>
              {saving ? "Saving…" : "End"}
            </button>
          </div>
        </div>
        <Navigator deck={deck} sessionMode={true} onEvent={handleEvent}
          onNavigationChange={function(info){ setNavDepth(info.depth); setNavInObj(info.inObj); }}
          getAudioOffset={function() { return recorderStartMs.current !== null ? Date.now() - recorderStartMs.current : null; }}/>
      </div>
    );
  }

  // Home dashboard
  var st2 = STYPE[pendingType] || STYPE.live;

  return (
    <div style={{flex:1,overflowY:"auto"}}>
      <div style={{padding:"14px 16px 0"}}>
        {/* Deck quick stats box */}
        <div style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.08)",borderLeft:"3px solid "+deck.color,borderRadius:"0 14px 14px 0",padding:"14px 16px",marginBottom:16}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
            <div style={{width:36,height:36,borderRadius:10,background:deck.color+"22",border:"1.5px solid "+deck.color+"44",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17}}>{deck.icon}</div>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:"#fff"}}>{deck.name}</div>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:7}}>
            <div style={{background:"rgba(0,0,0,.3)",borderRadius:10,padding:"9px 11px"}}>
              <div style={{fontSize:16,fontWeight:700,color:deck.color}}>{Object.keys(deck.cards).length}</div>
              <div style={{fontSize:9,color:"rgba(255,255,255,.3)",textTransform:"uppercase",letterSpacing:.5}}>cards</div>
            </div>
            <div style={{background:"rgba(0,0,0,.3)",borderRadius:10,padding:"9px 11px"}}>
              <div style={{fontSize:16,fontWeight:700,color:"#EF5350"}}>{deck.objStacks.length}</div>
              <div style={{fontSize:9,color:"rgba(255,255,255,.3)",textTransform:"uppercase",letterSpacing:.5}}>obj stacks</div>
            </div>
            <div style={{background:"rgba(0,0,0,.3)",borderRadius:10,padding:"9px 11px"}}>
              <div style={{fontSize:16,fontWeight:700,color:"#66BB6A"}}>{deck.objStacks.reduce(function(sum,os){return sum+Object.keys(os.cards).length;},0)}</div>
              <div style={{fontSize:9,color:"rgba(255,255,255,.3)",textTransform:"uppercase",letterSpacing:.5}}>obj cards</div>
            </div>
          </div>
        </div>

        {/* Session type picker */}
        <SectionHdr>Start a session</SectionHdr>
        <div style={{display:"flex",gap:9,marginBottom:14}}>
          {["practice","live"].map(function(key) {
            var st3 = STYPE[key]; var on = pendingType===key;
            return (
              <button key={key} onClick={function(){setPendingType(key); setPlayView("new");}}
                style={{flex:1,background:on?st3.bg:"rgba(255,255,255,.07)",border:"1.5px solid "+(on?st3.border:"rgba(255,255,255,.09)"),borderRadius:14,padding:"15px 10px",cursor:"pointer",fontFamily:"inherit",textAlign:"center",transition:"all .15s"}}>
                <div style={{fontSize:22,marginBottom:5}}>{key==="live"?"📞":"🎯"}</div>
                <div style={{fontSize:12,fontWeight:700,color:on?st3.color:"rgba(255,255,255,.5)"}}>{st3.label}</div>
                <div style={{fontSize:9,color:"rgba(255,255,255,.28)",marginTop:2}}>{key==="live"?"Real call":"Dry run"}</div>
              </button>
            );
          })}
        </div>

        {/* New session form (shown when a type is picked) */}
        {playView === "new" && (
          <div style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.1)",borderRadius:14,padding:"14px 16px",marginBottom:14,animation:"fadeIn .15s ease both"}}>
            <div style={{fontSize:13,fontWeight:700,color:"#fff",marginBottom:12}}>{st2.label === "Live" ? "📞" : "🎯"} New {st2.label} Session</div>
            <label style={labelSt()}>Title <span style={{color:"#EF5350",fontSize:9}}>*</span></label>
            <input value={newName} onChange={function(e){setNewName(e.target.value);setNameError(false);}} onKeyDown={function(e){if(e.key==="Enter")startSession();}}
              placeholder={pendingType==="live"?"e.g. Cold call — Acme Corp":"e.g. Morning practice run"}
              style={inputSt({marginBottom:nameError?4:10,borderColor:nameError?"rgba(239,83,80,.7)":undefined})} autoFocus/>
            {nameError && <div style={{fontSize:10,color:"#EF5350",marginBottom:8}}>Session title is required</div>}
            <label style={labelSt()}>Description <span style={{color:"rgba(255,255,255,.25)",fontWeight:400,textTransform:"none",letterSpacing:0,fontSize:10}}>(optional)</span></label>
            <textarea value={newDesc} onChange={function(e){setNewDesc(e.target.value);}}
              placeholder={pendingType==="live"?"Prospect info, context, goals…":"What you're working on, focus areas…"}
              rows={2}
              style={Object.assign({},inputSt({resize:"none",fontSize:13,lineHeight:1.5}),{marginBottom:12,minHeight:58})}/>
            {/* Audio recording toggle — only shown when MediaRecorder API is available */}
            {typeof MediaRecorder !== "undefined" && navigator.mediaDevices && (
              <div style={{background:"rgba(168,255,62,.06)",border:"1px solid rgba(168,255,62,.18)",borderRadius:12,padding:"11px 14px",marginBottom:12}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:recordAudio?10:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:14}}>🎙️</span>
                    <div>
                      <div style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,.85)"}}>Record audio</div>
                      <div style={{fontSize:10,color:"rgba(255,255,255,.3)"}}>Segment by card visit</div>
                    </div>
                  </div>
                  <button onClick={function(){setRecordAudio(function(v){return !v;});}}
                    style={{width:38,height:22,borderRadius:99,border:"none",cursor:"pointer",background:recordAudio?"#A8FF3E":"rgba(255,255,255,.15)",transition:"background .15s",position:"relative",flexShrink:0}}>
                    <div style={{position:"absolute",top:3,left:recordAudio?18:3,width:16,height:16,borderRadius:"50%",background:recordAudio?"#000":"rgba(255,255,255,.7)",transition:"left .15s"}}/>
                  </button>
                </div>
                {recordAudio && (
                  <div>
                    {audioDevices.length === 0 ? (
                      <div>
                        <div style={{fontSize:11,color:"rgba(255,255,255,.4)",marginBottom:7}}>No devices listed yet.</div>
                        <button onClick={function(){
                          navigator.mediaDevices.getUserMedia({ audio: true })
                            .then(function(stream){ stream.getTracks().forEach(function(t){t.stop();}); })
                            .catch(function(){})
                            .finally(function(){
                              navigator.mediaDevices.enumerateDevices().then(function(devices){
                                var mics = devices.filter(function(d){return d.kind==="audioinput";});
                                setAudioDevices(mics);
                                if (mics.length > 0) setSelectedDevice(mics[0].deviceId);
                              });
                            });
                        }} style={Object.assign({},ghostSm({color:"#A8FF3E",borderColor:"rgba(168,255,62,.35)"}),{width:"100%",justifyContent:"center"})}>
                          Allow microphone access
                        </button>
                      </div>
                    ) : (
                      <select value={selectedDevice} onChange={function(e){setSelectedDevice(e.target.value);}}
                        style={inputSt({marginBottom:0,fontSize:12,padding:"7px 10px"})}>
                        {audioDevices.map(function(d, i){
                          return <option key={d.deviceId} value={d.deviceId}>{d.label || ("Microphone " + (i+1))}</option>;
                        })}
                      </select>
                    )}
                    {deviceError && <div style={{fontSize:10,color:"#EF5350",marginTop:5}}>{deviceError}</div>}
                  </div>
                )}
              </div>
            )}
            <div style={{display:"flex",gap:8}}>
              <button onClick={function(){setPlayView("home");setNewName("");setNewDesc("");}} style={Object.assign({},ghostBtn(),{flex:1,padding:"10px"})}>Cancel</button>
              <button onClick={startSession}
                style={Object.assign({},solidBtn(st2.color),{flex:2})}>
                {st2.label === "Live" ? "📞" : "🎯"} Start {st2.label}
              </button>
            </div>
          </div>
        )}

        <div style={{height:20}}/>
      </div>
    </div>
  );
}
