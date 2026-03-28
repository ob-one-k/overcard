import { useState, useEffect, useRef } from "react";
import { TM, OBJ_COLOR, SESS_COLOR, STYPE, sid } from "../../lib/constants";
import { apiPost } from "../../lib/api";
import { solidBtn, ghostBtn, ghostSm, inputSt, labelSt } from "../../lib/styles";
import { SectionHdr } from "../ui";
import { Navigator, ObjPicker } from "../Play";
import { saveAudioBlob } from "../../lib/audioStore";

// ─── PLAY DESKTOP ─────────────────────────────────────────────────────────────
// Desktop layout for the Play tab.
// Pre-session (home/new): centered max-width container.
// Active session: two-pane — left 65% Navigator, right 35% session panel.
export function PlayDesktop({ deck, activeId, onPortalToReview, onSwitchDeck,
    playView, setPlayView, activeSession, setActiveSession, sessionEvents, setSessionEvents }) {

  var [pendingType,    setPendingType]    = useState("practice");
  var [newName,        setNewName]        = useState("");
  var [newDesc,        setNewDesc]        = useState("");
  var [saving,         setSaving]         = useState(false);
  var [nameError,      setNameError]      = useState(false);
  var [navDepth,       setNavDepth]       = useState(1);
  var [navInObj,       setNavInObj]       = useState(false);
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
    setNavDepth(1); setNavInObj(false); setActiveSession(s); setSessionEvents([]); setPlayView("active");
  }

  function handleEvent(ev) {
    setSessionEvents(function(prev) { return prev.concat([ev]); });
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

  // ── Active session: two-pane layout ──────────────────────────────────────────
  if (playView === "active" && activeSession) {
    var st = STYPE[activeSession.sessionType] || STYPE.live;
    var noteEvents = sessionEvents.filter(function(ev) { return ev.type === "note"; });
    var mm = Math.floor(elapsed / 60);
    var ss = elapsed % 60;
    var elapsedStr = mm + ":" + (ss < 10 ? "0" : "") + ss;

    return (
      <div style={{display:"flex",height:"100%",overflow:"hidden"}}>

        {/* ── Left pane: Navigator ── */}
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",borderRight:"1px solid rgba(255,255,255,.06)"}}>
          <Navigator deck={deck} sessionMode={true} onEvent={handleEvent}
            onNavigationChange={function(info){ setNavDepth(info.depth); setNavInObj(info.inObj); }}
            getAudioOffset={function() { return recorderStartMs.current !== null ? Date.now() - recorderStartMs.current : null; }}/>
        </div>

        {/* ── Right pane: session panel ── */}
        <div style={{width:340,minWidth:340,display:"flex",flexDirection:"column",overflow:"hidden",background:"rgba(4,12,30,.6)"}}>

          {/* Session header */}
          <div style={{padding:"16px 18px 14px",borderBottom:"1px solid rgba(255,255,255,.06)",flexShrink:0}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:st.color,boxShadow:"0 0 6px "+st.color,flexShrink:0,animation:"pulse 1.5s ease-in-out infinite"}}/>
              <span style={{fontSize:10,color:st.color,fontWeight:700,letterSpacing:.8,textTransform:"uppercase"}}>{st.label}</span>
              <span style={{fontSize:10,color:"rgba(255,255,255,.3)",marginLeft:"auto",fontFeatureSettings:'"tnum"'}}>{elapsedStr}</span>
            </div>
            <div style={{fontSize:14,fontWeight:700,color:"#fff",lineHeight:1.3}}>{activeSession.name}</div>
            {activeSession.description && <div style={{fontSize:10,color:"rgba(255,255,255,.35)",marginTop:3}}>{activeSession.description}</div>}
          </div>

          {/* Objection stacks */}
          <div style={{padding:"12px 18px 0",flexShrink:0}}>
            <div style={{fontSize:9,fontWeight:700,color:"rgba(239,83,80,.5)",letterSpacing:1.1,textTransform:"uppercase",marginBottom:7}}>🛡️ Objection Stacks</div>
            {deck.objStacks.length === 0 && (
              <div style={{fontSize:11,color:"rgba(255,255,255,.2)",marginBottom:10}}>No stacks configured.</div>
            )}
            <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:10}}>
              {deck.objStacks.map(function(stack) {
                return (
                  <div key={stack.id}
                    style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",background:"rgba(239,83,80,.06)",border:"1px solid rgba(239,83,80,.16)",borderRadius:10}}>
                    <span style={{fontSize:16,flexShrink:0}}>{stack.icon}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:600,color:"rgba(255,255,255,.8)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{stack.label}</div>
                      <div style={{fontSize:9,color:"rgba(255,255,255,.25)"}}>{Object.keys(stack.cards).length} paths</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Notes log */}
          <div style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column",padding:"0 18px"}}>
            <div style={{fontSize:9,fontWeight:700,color:"rgba(168,255,62,.5)",letterSpacing:1.1,textTransform:"uppercase",marginBottom:7,flexShrink:0}}>📝 Notes ({noteEvents.length})</div>
            <div style={{flex:1,overflowY:"auto"}}>
              {noteEvents.length === 0 && (
                <div style={{fontSize:11,color:"rgba(255,255,255,.2)"}}>No notes yet. Use + Note on a card.</div>
              )}
              {noteEvents.map(function(ev, i) {
                return (
                  <div key={i} style={{background:"rgba(168,255,62,.06)",border:"1px solid rgba(168,255,62,.14)",borderRadius:8,padding:"8px 10px",marginBottom:6}}>
                    <div style={{fontSize:9,color:"rgba(168,255,62,.5)",marginBottom:3}}>{ev.cardTitle}</div>
                    <div style={{fontSize:11,color:"rgba(255,255,255,.75)",lineHeight:1.5}}>{ev.text}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Outcome buttons */}
          <div style={{padding:"12px 18px 18px",borderTop:"1px solid rgba(255,255,255,.06)",flexShrink:0,display:"flex",flexDirection:"column",gap:7}}>
            {activeSession.mode === "live" && navDepth === 1 && !navInObj && (
              <button onClick={function(){finishSession(false,null,"not_contacted");}} disabled={saving}
                style={{background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.18)",borderRadius:10,color:"rgba(255,255,255,.55)",fontSize:12,fontWeight:700,padding:"9px",cursor:"pointer",fontFamily:"inherit"}}>
                📵 No Contact
              </button>
            )}
            <div style={{display:"flex",gap:7}}>
              <button onClick={function(){finishSession(true,null);}} disabled={saving}
                style={{flex:1,background:"#66BB6A",border:"none",borderRadius:10,color:"#000",fontSize:13,fontWeight:700,padding:"10px",cursor:"pointer",fontFamily:"inherit"}}>
                ✓ Sold
              </button>
              <button onClick={function(){finishSession(false,null,"booked");}} disabled={saving}
                style={{flex:1,background:"rgba(255,213,79,.12)",border:"1px solid rgba(255,213,79,.3)",borderRadius:10,color:"#FFD54F",fontSize:13,fontWeight:700,padding:"10px",cursor:"pointer",fontFamily:"inherit"}}>
                Booked
              </button>
            </div>
            <button onClick={function(){finishSession(false,null);}} disabled={saving}
              style={{background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.15)",borderRadius:10,color:"#fff",fontSize:13,fontWeight:700,padding:"10px",cursor:"pointer",fontFamily:"inherit"}}>
              {saving ? "Saving…" : "End Session"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Pre-session views: centered container ─────────────────────────────────────
  var st2 = STYPE[pendingType] || STYPE.live;

  return (
    <div style={{flex:1,overflowY:"auto"}}>
      <div style={{maxWidth:600,margin:"0 auto",padding:"20px 20px 0"}}>
        {/* Deck stats */}
        <div style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.08)",borderLeft:"3px solid "+deck.color,borderRadius:"0 14px 14px 0",padding:"16px 18px",marginBottom:20}}>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
            <div style={{width:40,height:40,borderRadius:12,background:deck.color+"22",border:"1.5px solid "+deck.color+"44",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>{deck.icon}</div>
            <div style={{fontSize:16,fontWeight:700,color:"#fff"}}>{deck.name}</div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
            <div style={{background:"rgba(0,0,0,.3)",borderRadius:10,padding:"10px 12px"}}>
              <div style={{fontSize:18,fontWeight:700,color:deck.color}}>{Object.keys(deck.cards).length}</div>
              <div style={{fontSize:9,color:"rgba(255,255,255,.3)",textTransform:"uppercase",letterSpacing:.5}}>cards</div>
            </div>
            <div style={{background:"rgba(0,0,0,.3)",borderRadius:10,padding:"10px 12px"}}>
              <div style={{fontSize:18,fontWeight:700,color:"#EF5350"}}>{deck.objStacks.length}</div>
              <div style={{fontSize:9,color:"rgba(255,255,255,.3)",textTransform:"uppercase",letterSpacing:.5}}>obj stacks</div>
            </div>
            <div style={{background:"rgba(0,0,0,.3)",borderRadius:10,padding:"10px 12px"}}>
              <div style={{fontSize:18,fontWeight:700,color:"#66BB6A"}}>{deck.objStacks.reduce(function(sum,os){return sum+Object.keys(os.cards).length;},0)}</div>
              <div style={{fontSize:9,color:"rgba(255,255,255,.3)",textTransform:"uppercase",letterSpacing:.5}}>obj cards</div>
            </div>
          </div>
        </div>

        {/* Session type picker */}
        <SectionHdr>Start a session</SectionHdr>
        <div style={{display:"flex",gap:10,marginBottom:16}}>
          {["practice","live"].map(function(key) {
            var stk = STYPE[key]; var on = pendingType === key;
            return (
              <button key={key} onClick={function(){ setPendingType(key); setPlayView("new"); }}
                style={{flex:1,background:on?stk.bg:"rgba(255,255,255,.07)",border:"1.5px solid "+(on?stk.border:"rgba(255,255,255,.09)"),borderRadius:14,padding:"18px 12px",cursor:"pointer",fontFamily:"inherit",textAlign:"center",transition:"all .15s"}}>
                <div style={{fontSize:26,marginBottom:6}}>{key==="live"?"📞":"🎯"}</div>
                <div style={{fontSize:13,fontWeight:700,color:on?stk.color:"rgba(255,255,255,.5)"}}>{stk.label}</div>
                <div style={{fontSize:10,color:"rgba(255,255,255,.28)",marginTop:3}}>{key==="live"?"Real call":"Dry run"}</div>
              </button>
            );
          })}
        </div>

        {/* New session form */}
        {playView === "new" && (
          <div style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.1)",borderRadius:14,padding:"18px",marginBottom:16,animation:"fadeIn .15s ease both"}}>
            <div style={{fontSize:14,fontWeight:700,color:"#fff",marginBottom:14}}>{pendingType==="live"?"📞":"🎯"} New {st2.label} Session</div>
            <label style={labelSt()}>Title <span style={{color:"#EF5350",fontSize:9}}>*</span></label>
            <input value={newName} onChange={function(e){setNewName(e.target.value);setNameError(false);}}
              onKeyDown={function(e){if(e.key==="Enter")startSession();}}
              placeholder={pendingType==="live"?"e.g. Cold call — Acme Corp":"e.g. Morning practice run"}
              style={inputSt({marginBottom:nameError?4:12,borderColor:nameError?"rgba(239,83,80,.7)":undefined})} autoFocus/>
            {nameError && <div style={{fontSize:10,color:"#EF5350",marginBottom:10}}>Session title is required</div>}
            <label style={labelSt()}>Description <span style={{color:"rgba(255,255,255,.25)",fontWeight:400,textTransform:"none",letterSpacing:0,fontSize:10}}>(optional)</span></label>
            <textarea value={newDesc} onChange={function(e){setNewDesc(e.target.value);}}
              placeholder={pendingType==="live"?"Prospect info, context, goals…":"What you're working on, focus areas…"}
              rows={2} style={Object.assign({},inputSt({resize:"none",fontSize:13,lineHeight:1.5}),{marginBottom:14,minHeight:58})}/>
            {/* Audio recording toggle */}
            {typeof MediaRecorder !== "undefined" && navigator.mediaDevices && (
              <div style={{background:"rgba(168,255,62,.06)",border:"1px solid rgba(168,255,62,.18)",borderRadius:12,padding:"12px 14px",marginBottom:14}}>
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
              <button onClick={function(){setPlayView("home");}} style={Object.assign({},ghostBtn(),{flex:1,padding:"10px",fontSize:13})}>Cancel</button>
              <button onClick={startSession} style={Object.assign({},solidBtn(st2.color),{flex:2,padding:"10px",fontSize:13})}>▶ Start</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
