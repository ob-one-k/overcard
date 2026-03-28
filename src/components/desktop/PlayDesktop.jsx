import { useState, useEffect, useRef } from "react";
import { TM, OBJ_COLOR, SESS_COLOR, STYPE, sid } from "../../lib/constants";
import { apiPost } from "../../lib/api";
import { solidBtn, ghostBtn, ghostSm, inputSt, labelSt } from "../../lib/styles";
import { SectionHdr } from "../ui";
import { Navigator, ObjPicker } from "../Play";
import { saveAudioBlob } from "../../lib/audioStore";

// ─── PLAY DESKTOP ─────────────────────────────────────────────────────────────
// Desktop layout for the Play tab.
// Pre-session: centered max-width container (720px).
// Active session: left flex:1 Navigator + right 340px four-zone panel.
//   Zone 1: Session header + mini path tracker (flexShrink:0)
//   Zone 2: Objection stacks chip row (flexShrink:0)
//   Zone 3: Interactive notes with inline input (flex:1, scrollable)
//   Zone 4: Outcome buttons — always visible (flexShrink:0)
export function PlayDesktop({ deck, activeId, onPortalToReview, onSwitchDeck,
    playView, setPlayView, activeSession, setActiveSession, sessionEvents, setSessionEvents }) {

  var [pendingType,    setPendingType]    = useState("practice");
  var [newName,        setNewName]        = useState("");
  var [newDesc,        setNewDesc]        = useState("");
  var [saving,         setSaving]         = useState(false);
  var [nameError,      setNameError]      = useState(false);
  var [navDepth,       setNavDepth]       = useState(1);
  var [navInObj,       setNavInObj]       = useState(false);
  var [navCurrentCard, setNavCurrentCard] = useState(null);
  var [panelNote,      setPanelNote]      = useState("");
  var [audioDevices,   setAudioDevices]   = useState([]);
  var [selectedDevice, setSelectedDevice] = useState("");
  var [recordAudio,    setRecordAudio]    = useState(false);
  var [deviceError,    setDeviceError]    = useState(null);
  var [elapsed,        setElapsed]        = useState(0);

  var mediaRecorderRef = useRef(null);
  var audioChunksRef   = useRef([]);
  var recorderStartMs  = useRef(null);

  // Elapsed timer for active session
  useEffect(function() {
    if (playView !== "active" || !activeSession) { setElapsed(0); return; }
    var interval = setInterval(function() {
      setElapsed(Math.floor((Date.now() - activeSession.startTs) / 1000));
    }, 1000);
    return function() { clearInterval(interval); };
  }, [playView, activeSession]);

  // Enumerate audio input devices
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

  // Guard against deck switch during active session
  useEffect(function() {
    if (playView === "active" && activeSession && activeSession.deckId !== deck.id) {
      var rec = mediaRecorderRef.current;
      if (rec && rec.state !== "inactive") {
        rec.onstop = function() { rec.stream.getTracks().forEach(function(t){ t.stop(); }); };
        rec.stop();
      }
      mediaRecorderRef.current = null;
      var finished = Object.assign({}, activeSession, { endTs:Date.now(), status:"completed", outcome:"completed", events:sessionEvents });
      apiPost("/sessions", finished).catch(function(e){ console.error("overcard:", e); });
      setActiveSession(null); setSessionEvents([]);
      setPlayView("home"); setNewName(""); setNewDesc(""); setNameError(false);
    }
  }, [deck.id]);

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
    };
    audioChunksRef.current = []; recorderStartMs.current = null; mediaRecorderRef.current = null;
    if (recordAudio && selectedDevice && typeof MediaRecorder !== "undefined") {
      navigator.mediaDevices.getUserMedia({ audio:{ deviceId:{ exact:selectedDevice } } })
        .then(function(stream) {
          var mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus"
            : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/ogg";
          var recorder = new MediaRecorder(stream, { mimeType:mimeType });
          recorder.ondataavailable = function(e) { if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data); };
          mediaRecorderRef.current = recorder; recorderStartMs.current = Date.now(); recorder.start(1000);
        }).catch(function(err) { console.warn("overcard: audio recording unavailable:", err); mediaRecorderRef.current = null; });
    }
    setNavDepth(1); setNavInObj(false); setNavCurrentCard(null); setPanelNote("");
    setActiveSession(s); setSessionEvents([]); setPlayView("active");
  }

  function handleEvent(ev) {
    setSessionEvents(function(prev) { return prev.concat([ev]); });
  }

  function submitPanelNote() {
    var text = panelNote.trim();
    if (!text || !navCurrentCard) return;
    handleEvent({ type:"note", cardId:navCurrentCard.id, cardTitle:navCurrentCard.title, text:text, ts:Date.now() });
    setPanelNote("");
  }

  function finishSession(sold, soldCard, outcomeOverride) {
    setSaving(true);
    var outcome = outcomeOverride || (sold ? "sold" : "completed");
    var audioSegs = sessionEvents
      .filter(function(ev) { return ev.type === "visit" && ev.audioStartMs !== null && ev.audioStartMs !== undefined; })
      .map(function(ev, i) { return { segmentIndex:i, cardId:ev.cardId, cardTitle:ev.cardTitle, cardType:ev.cardType, isObjCard:!!ev.isObjCard, stackLabel:ev.stackLabel||null, startMs:ev.audioStartMs, endMs:ev.audioEndMs }; });
    var finished = Object.assign({}, activeSession, {
      endTs:Date.now(), status:"completed", outcome:outcome,
      sold:!!sold, soldCardId:sold&&soldCard?soldCard.id:null, soldCardTitle:sold&&soldCard?soldCard.title:null,
      events:sessionEvents, audioSegments:audioSegs.length>0?audioSegs:null,
    });
    function doSave() {
      apiPost("/sessions", finished)
        .then(function() {
          setSaving(false); setActiveSession(null); setSessionEvents([]);
          setPlayView("home"); setNewName(""); setNewDesc(""); setNameError(false);
          onPortalToReview(finished.id);
        })
        .catch(function() {
          setSaving(false); setActiveSession(null); setSessionEvents([]);
          setPlayView("home"); setNameError(false); onPortalToReview(null);
        });
    }
    var recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = function() {
        recorder.stream.getTracks().forEach(function(t){ t.stop(); });
        mediaRecorderRef.current = null;
        if (audioSegs.length > 0) {
          var blob = new Blob(audioChunksRef.current, { type:recorder.mimeType });
          saveAudioBlob(finished.id, blob, recorder.mimeType).catch(function(){}).finally(doSave);
        } else { doSave(); }
      };
      recorder.stop();
    } else {
      if (mediaRecorderRef.current) mediaRecorderRef.current = null;
      doSave();
    }
  }

  // ── Active session: top action bar + two-pane body ───────────────────────────
  if (playView === "active" && activeSession) {
    var st = STYPE[activeSession.sessionType] || STYPE.live;
    var noteEvents  = sessionEvents.filter(function(ev) { return ev.type === "note"; });
    var pathVisits  = sessionEvents.filter(function(ev) { return ev.type === "visit" && !ev.isObjCard; });
    var dotsToShow  = pathVisits.slice(-10);
    var mm = Math.floor(elapsed / 60);
    var ss = elapsed % 60;
    var elapsedStr  = mm + ":" + (ss < 10 ? "0" : "") + ss;

    return (
      <div style={{display:"flex",flexDirection:"column",height:"100%",overflow:"hidden"}}>

        {/* ── TOP ACTION BAR ─────────────────────────────────────────────────────── */}
        <div style={{
          display:"flex",alignItems:"center",gap:0,
          height:52,minHeight:52,flexShrink:0,
          background:"rgba(4,12,30,.85)",
          borderBottom:"1px solid rgba(255,255,255,.07)",
          padding:"0 16px",
        }}>
          {/* Status dot + mode */}
          <div style={{display:"flex",alignItems:"center",gap:7,flexShrink:0,marginRight:14}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:st.color,boxShadow:"0 0 7px "+st.color,animation:"pulse 1.8s ease-in-out infinite"}}/>
            <span style={{fontSize:10,color:st.color,fontWeight:700,letterSpacing:.9,textTransform:"uppercase"}}>{st.label}</span>
          </div>

          {/* Session name */}
          <div style={{fontSize:14,fontWeight:700,color:"#fff",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:200,flexShrink:1,marginRight:10}}>
            {activeSession.name}
          </div>

          {/* Elapsed timer chip */}
          <div style={{background:"rgba(168,255,62,.1)",border:"1px solid rgba(168,255,62,.22)",borderRadius:99,padding:"3px 10px",flexShrink:0,marginRight:14}}>
            <span style={{fontSize:11,color:"#A8FF3E",fontFeatureSettings:'"tnum"',fontWeight:700,letterSpacing:.4}}>{elapsedStr}</span>
          </div>

          {/* Path dots */}
          {dotsToShow.length > 0 && (
            <div style={{display:"flex",alignItems:"center",gap:4,flexShrink:0,marginRight:14}}>
              {pathVisits.length > 10 && (
                <span style={{fontSize:9,color:"rgba(255,255,255,.22)",marginRight:2}}>+{pathVisits.length-10}</span>
              )}
              {dotsToShow.map(function(ev, i) {
                var isLast = i === dotsToShow.length - 1;
                var dotColor = (TM[ev.cardType] || TM.pitch).color;
                return (
                  <div key={i} style={{
                    width: isLast ? 9 : 6, height: isLast ? 9 : 6,
                    borderRadius:"50%", background: dotColor, flexShrink:0,
                    opacity: isLast ? 1 : 0.3 + (i / dotsToShow.length) * 0.5,
                    boxShadow: isLast ? ("0 0 5px "+dotColor) : "none",
                    border: isLast ? "1.5px solid rgba(255,255,255,.5)" : "none",
                  }}/>
                );
              })}
            </div>
          )}

          {/* Spacer */}
          <div style={{flex:1}}/>

          {/* CTA BUTTONS — always visible in top bar */}
          <div style={{display:"flex",alignItems:"center",gap:7,flexShrink:0}}>
            {activeSession.mode === "live" && navDepth === 1 && !navInObj && (
              <button onClick={function(){finishSession(false,null,"not_contacted");}} disabled={saving}
                style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.16)",borderRadius:8,color:"rgba(255,255,255,.5)",fontSize:11,fontWeight:700,padding:"7px 13px",cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>
                📵 No Contact
              </button>
            )}
            <button onClick={function(){finishSession(true,null);}} disabled={saving}
              style={{background:"#66BB6A",border:"none",borderRadius:8,color:"#000",fontSize:12,fontWeight:700,padding:"7px 15px",cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>
              ✓ Sold
            </button>
            <button onClick={function(){finishSession(false,null,"booked");}} disabled={saving}
              style={{background:"rgba(255,213,79,.13)",border:"1px solid rgba(255,213,79,.32)",borderRadius:8,color:"#FFD54F",fontSize:12,fontWeight:700,padding:"7px 13px",cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>
              📅 Booked
            </button>
            <button onClick={function(){finishSession(false,null);}} disabled={saving}
              style={{background:"rgba(255,255,255,.09)",border:"1px solid rgba(255,255,255,.16)",borderRadius:8,color:"rgba(255,255,255,.8)",fontSize:12,fontWeight:700,padding:"7px 13px",cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>
              {saving ? "Saving…" : "End Session"}
            </button>
          </div>
        </div>

        {/* ── BODY: Navigator (flex:1) + right rail (280px) ──────────────────────── */}
        <div style={{flex:1,display:"flex",overflow:"hidden"}}>

          {/* Navigator — maximum vertical real estate */}
          <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",borderRight:"1px solid rgba(255,255,255,.06)"}}>
            <Navigator deck={deck} sessionMode={true} onEvent={handleEvent}
              onNavigationChange={function(info){ setNavDepth(info.depth); setNavInObj(info.inObj); setNavCurrentCard(info.currentCard||null); }}
              getAudioOffset={function() { return recorderStartMs.current !== null ? Date.now() - recorderStartMs.current : null; }}/>
          </div>

          {/* Right rail: objections + notes */}
          <div style={{width:280,minWidth:280,display:"flex",flexDirection:"column",overflow:"hidden",background:"rgba(4,12,30,.5)"}}>

            {/* Objection stacks chip row */}
            {deck.objStacks.length > 0 && (
              <div style={{padding:"10px 14px 10px",borderBottom:"1px solid rgba(255,255,255,.06)",flexShrink:0}}>
                <div style={{fontSize:9,fontWeight:700,color:"rgba(239,83,80,.45)",letterSpacing:1.1,textTransform:"uppercase",marginBottom:7}}>🛡 Objections</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                  {deck.objStacks.map(function(stack) {
                    var cardCount = Object.keys(stack.cards).length;
                    var hasEntry  = !!stack.rootCard;
                    var healthDot = (cardCount > 0 && hasEntry) ? "#66BB6A" : cardCount > 0 ? "#FFD54F" : "#EF5350";
                    return (
                      <div key={stack.id}
                        style={{display:"flex",alignItems:"center",gap:5,padding:"4px 9px 4px 7px",
                          background:"rgba(239,83,80,.07)",border:"1px solid rgba(239,83,80,.16)",borderRadius:99,flexShrink:0}}>
                        <div style={{width:5,height:5,borderRadius:"50%",background:healthDot,flexShrink:0}}/>
                        <span style={{fontSize:13,lineHeight:1}}>{stack.icon}</span>
                        <span style={{fontSize:10,fontWeight:600,color:"rgba(255,255,255,.7)",whiteSpace:"nowrap"}}>{stack.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Notes — flex:1, scrollable */}
            <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",padding:"0 14px"}}>
              {/* Inline note input */}
              <div style={{flexShrink:0,paddingTop:10,paddingBottom:8,borderBottom:"1px solid rgba(255,255,255,.04)"}}>
                <div style={{display:"flex",gap:5,alignItems:"flex-end"}}>
                  <textarea
                    value={panelNote}
                    onChange={function(e){ setPanelNote(e.target.value); }}
                    onKeyDown={function(e){ if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitPanelNote(); } }}
                    placeholder={navCurrentCard ? "Note: " + (navCurrentCard.title || "this card") + "…" : "Navigate first…"}
                    disabled={!navCurrentCard}
                    rows={2}
                    style={Object.assign({},inputSt({resize:"none",fontSize:11,lineHeight:1.4}),{flex:1,minHeight:40,opacity:navCurrentCard?1:.4})}
                  />
                  <button
                    onClick={submitPanelNote}
                    disabled={!panelNote.trim() || !navCurrentCard}
                    style={{background:"rgba(168,255,62,.13)",border:"1px solid rgba(168,255,62,.28)",borderRadius:7,padding:"6px 9px",cursor:(!panelNote.trim()||!navCurrentCard)?"not-allowed":"pointer",color:"#A8FF3E",fontSize:11,fontWeight:700,flexShrink:0,fontFamily:"inherit",opacity:(!panelNote.trim()||!navCurrentCard)?0.3:1,transition:"opacity .12s",marginBottom:1}}>
                    +
                  </button>
                </div>
              </div>
              {/* Notes header */}
              <div style={{fontSize:9,fontWeight:700,color:"rgba(168,255,62,.45)",letterSpacing:1.1,textTransform:"uppercase",paddingTop:7,paddingBottom:5,flexShrink:0}}>
                📝 Notes{noteEvents.length > 0 ? " ("+noteEvents.length+")" : ""}
              </div>
              {/* Scrollable notes list */}
              <div style={{flex:1,overflowY:"auto"}}>
                {noteEvents.length === 0 && (
                  <div style={{fontSize:11,color:"rgba(255,255,255,.18)",lineHeight:1.6}}>
                    Notes appear here as you add them.
                  </div>
                )}
                {noteEvents.slice().reverse().map(function(ev, i) {
                  return (
                    <div key={i} style={{background:"rgba(168,255,62,.05)",border:"1px solid rgba(168,255,62,.1)",borderRadius:7,padding:"7px 9px",marginBottom:5}}>
                      <div style={{fontSize:9,color:"rgba(168,255,62,.4)",marginBottom:3,fontWeight:700}}>{ev.cardTitle || "General"}</div>
                      <div style={{fontSize:11,color:"rgba(255,255,255,.72)",lineHeight:1.5}}>{ev.text}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Pre-session views: centered container ─────────────────────────────────────
  var st2 = STYPE[pendingType] || STYPE.live;

  return (
    <div style={{flex:1,overflowY:"auto"}}>
      <div style={{maxWidth:720,margin:"0 auto",padding:"24px 24px 0"}}>

        {/* Deck info + quick stats card */}
        <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:0,background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.08)",borderLeft:"3px solid "+deck.color,borderRadius:"0 16px 16px 0",padding:"18px 22px",marginBottom:22,alignItems:"start"}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
              <div style={{width:42,height:42,borderRadius:12,background:deck.color+"22",border:"1.5px solid "+deck.color+"44",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>{deck.icon}</div>
              <div>
                <div style={{fontSize:17,fontWeight:700,color:"#fff"}}>{deck.name}</div>
                <div style={{fontSize:11,color:"rgba(255,255,255,.3)",marginTop:2}}>Ready to run</div>
              </div>
            </div>
          </div>
          <div style={{display:"flex",gap:10,alignItems:"center"}}>
            {[
              {v:Object.keys(deck.cards).length, l:"cards", c:deck.color},
              {v:deck.objStacks.length, l:"stacks", c:"#EF5350"},
              {v:deck.objStacks.reduce(function(sum,os){return sum+Object.keys(os.cards).length;},0), l:"obj cards", c:"#66BB6A"},
            ].map(function(item, i) {
              return (
                <div key={i} style={{background:"rgba(0,0,0,.25)",borderRadius:12,padding:"10px 16px",textAlign:"center",minWidth:64}}>
                  <div style={{fontSize:20,fontWeight:700,color:item.c,lineHeight:1}}>{item.v}</div>
                  <div style={{fontSize:9,color:"rgba(255,255,255,.28)",textTransform:"uppercase",letterSpacing:.5,marginTop:3}}>{item.l}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Session type picker */}
        <SectionHdr>Start a session</SectionHdr>
        <div style={{display:"flex",gap:12,marginBottom:18}}>
          {["practice","live"].map(function(key) {
            var stk = STYPE[key]; var on = pendingType === key;
            return (
              <button key={key} onClick={function(){ setPendingType(key); setPlayView("new"); }}
                style={{flex:1,background:on?stk.bg:"rgba(255,255,255,.06)",border:"1.5px solid "+(on?stk.border:"rgba(255,255,255,.08)"),borderRadius:16,padding:"22px 16px",cursor:"pointer",fontFamily:"inherit",textAlign:"center",transition:"all .15s",boxShadow:on?"0 0 0 1px "+stk.border:"none"}}>
                <div style={{fontSize:28,marginBottom:8}}>{key==="live"?"📞":"🎯"}</div>
                <div style={{fontSize:14,fontWeight:700,color:on?stk.color:"rgba(255,255,255,.5)",marginBottom:3}}>{stk.label}</div>
                <div style={{fontSize:11,color:"rgba(255,255,255,.26)"}}>{key==="live"?"Real call":"Dry run"}</div>
              </button>
            );
          })}
        </div>

        {/* New session form */}
        {playView === "new" && (
          <div style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.1)",borderRadius:16,padding:"24px 28px",marginBottom:18,animation:"fadeIn .15s ease both"}}>
            <div style={{fontSize:15,fontWeight:700,color:"#fff",marginBottom:16}}>{pendingType==="live"?"📞":"🎯"} New {st2.label} Session</div>
            <label style={labelSt()}>Title <span style={{color:"#EF5350",fontSize:9}}>*</span></label>
            <input value={newName} onChange={function(e){setNewName(e.target.value);setNameError(false);}}
              onKeyDown={function(e){if(e.key==="Enter")startSession();}}
              placeholder={pendingType==="live"?"e.g. Cold call — Acme Corp":"e.g. Morning practice run"}
              style={inputSt({marginBottom:nameError?4:14,borderColor:nameError?"rgba(239,83,80,.7)":undefined})} autoFocus/>
            {nameError && <div style={{fontSize:10,color:"#EF5350",marginBottom:12}}>Session title is required</div>}
            <label style={labelSt()}>Description <span style={{color:"rgba(255,255,255,.25)",fontWeight:400,textTransform:"none",letterSpacing:0,fontSize:10}}>(optional)</span></label>
            <textarea value={newDesc} onChange={function(e){setNewDesc(e.target.value);}}
              placeholder={pendingType==="live"?"Prospect info, context, goals…":"What you're working on, focus areas…"}
              rows={2} style={Object.assign({},inputSt({resize:"none",fontSize:13,lineHeight:1.5}),{marginBottom:16,minHeight:58})}/>
            {/* Audio recording toggle */}
            {typeof MediaRecorder !== "undefined" && navigator.mediaDevices && (
              <div style={{background:"rgba(168,255,62,.06)",border:"1px solid rgba(168,255,62,.18)",borderRadius:12,padding:"12px 14px",marginBottom:16}}>
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
                          navigator.mediaDevices.getUserMedia({ audio:true })
                            .then(function(stream){stream.getTracks().forEach(function(t){t.stop();});})
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
                          return <option key={d.deviceId} value={d.deviceId}>{d.label||("Microphone "+(i+1))}</option>;
                        })}
                      </select>
                    )}
                    {deviceError && <div style={{fontSize:10,color:"#EF5350",marginTop:5}}>{deviceError}</div>}
                  </div>
                )}
              </div>
            )}
            <div style={{display:"flex",gap:10}}>
              <button onClick={function(){setPlayView("home");}} style={Object.assign({},ghostBtn(),{flex:1,padding:"11px",fontSize:13})}>Cancel</button>
              <button onClick={startSession} style={Object.assign({},solidBtn(st2.color),{flex:2,padding:"11px",fontSize:13})}>▶ Start Session</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
