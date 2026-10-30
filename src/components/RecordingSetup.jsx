import { useState, useEffect, useRef } from "react";
import { ghostSm, inputSt } from "../lib/styles";

// ─── RECORDING SETUP + LIVE INDICATOR ─────────────────────────────────────────
// Shared by PlayMobile (Play.jsx) and PlayDesktop. `rec` is the object from useRecorder().
// size "lg" = desktop/tablet type scale, anything else = phone scale.

function LevelBar({ level, height, color }) {
  var pct = Math.round(Math.min(1, level || 0) * 100);
  return (
    <div style={{flex:1,height:height||6,background:"rgba(255,255,255,.1)",borderRadius:99,overflow:"hidden"}} aria-hidden="true">
      <div style={{width:pct+"%",height:"100%",background:pct>85?"#FFB300":(color||"#A8FF3E"),borderRadius:99,transition:"width .1s linear"}}/>
    </div>
  );
}

export function RecordingSetup({ rec, enabled, setEnabled, size }) {
  var lg = size === "lg";
  var fs = lg ? { title:14, body:13, small:12 } : { title:12, body:11, small:10 };
  var [testUrl,  setTestUrl]  = useState(null);
  var [testing,  setTesting]  = useState(false);
  var audioRef = useRef(null);

  // Meter the selected input while the recording toggle is on
  useEffect(function() {
    rec.setMonitoring(!!enabled);
    return function() { rec.setMonitoring(false); };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(function() {
    return function() { if (testUrl) URL.revokeObjectURL(testUrl); };
  }, [testUrl]);

  if (!rec.supported) {
    return (
      <div style={{fontSize:fs.body,color:"rgba(255,255,255,.4)",padding:"10px 0"}}>🎙️ Audio recording isn't supported in this browser.</div>
    );
  }

  function runTest() {
    setTesting(true); setTestUrl(null);
    rec.testRecording(3000).then(function(url) {
      setTesting(false); setTestUrl(url);
      setTimeout(function() { if (audioRef.current) audioRef.current.play().catch(function(){}); }, 50);
    }).catch(function() { setTesting(false); });
  }

  var granted = rec.permission === "granted";
  var toggle = (
    <button type="button" role="switch" aria-checked={!!enabled} aria-label="Record audio" onClick={function(){ setEnabled(!enabled); }}
      style={{width:lg?42:38,height:lg?24:22,borderRadius:99,border:"none",cursor:"pointer",background:enabled?"#A8FF3E":"rgba(255,255,255,.18)",transition:"background .15s",position:"relative",flexShrink:0}}>
      <div style={{position:"absolute",top:3,left:enabled?(lg?21:18):3,width:lg?18:16,height:lg?18:16,borderRadius:"50%",background:enabled?"#000":"rgba(255,255,255,.8)",transition:"left .15s"}}/>
    </button>
  );

  return (
    <div style={{background:"rgba(168,255,62,.05)",border:"1px solid rgba(168,255,62,.18)",borderRadius:12,padding:lg?"12px 14px":"11px 14px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}>
        <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
          <span style={{fontSize:lg?18:14}}>🎙️</span>
          <div style={{minWidth:0}}>
            <div style={{fontSize:fs.title,fontWeight:700,color:"rgba(255,255,255,.9)"}}>Record audio</div>
            <div style={{fontSize:fs.body,color:"rgba(255,255,255,.45)"}}>Full call plus a clip for every card</div>
          </div>
        </div>
        {toggle}
      </div>

      {enabled && (
        <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:10}}>
          {!granted ? (
            <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
              <div style={{fontSize:fs.body,color:"rgba(255,255,255,.55)",flex:1,minWidth:160}}>
                {rec.permission === "denied"
                  ? "Microphone access is blocked for this site. Allow it in your browser's site settings, then reload."
                  : "Allow microphone access to choose an input device."}
              </div>
              {rec.permission !== "denied" && (
                <button type="button" onClick={rec.requestPermission}
                  style={ghostSm({fontSize:fs.body,color:"#A8FF3E",borderColor:"rgba(168,255,62,.4)"})}>
                  Allow microphone
                </button>
              )}
            </div>
          ) : (
            <>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <select value={rec.deviceId} onChange={function(e){ rec.setDeviceId(e.target.value); }} aria-label="Microphone"
                  style={inputSt({marginBottom:0,flex:1,minWidth:0,fontSize:fs.body,padding:lg?"8px 10px":"7px 10px"})}>
                  <option value="">System default input</option>
                  {rec.devices.map(function(d, i){
                    return <option key={d.deviceId} value={d.deviceId}>{d.label || ("Microphone " + (i + 1))}</option>;
                  })}
                </select>
                <button type="button" onClick={runTest} disabled={testing} title="Record 3 seconds and play it back"
                  style={ghostSm({fontSize:fs.body,padding:lg?"8px 12px":"6px 10px"})}>
                  {testing ? "● 3s…" : "Test"}
                </button>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:fs.small,color:"rgba(255,255,255,.4)",width:lg?44:38,flexShrink:0}}>Level</span>
                <LevelBar level={rec.level} height={lg?7:6}/>
              </div>
              {testUrl && (
                <audio ref={audioRef} src={testUrl} controls style={{width:"100%",height:32}}/>
              )}
            </>
          )}

          {rec.callAudioSupported && (
            <label style={{display:"flex",alignItems:"flex-start",gap:9,cursor:"pointer",fontSize:fs.body,color:"rgba(255,255,255,.75)"}}>
              <input type="checkbox" checked={rec.includeCallAudio} onChange={function(e){ rec.setIncludeCallAudio(e.target.checked); }}
                style={{marginTop:2,width:16,height:16,accentColor:"#A8FF3E",flexShrink:0}}/>
              <span>
                <strong style={{color:"#fff"}}>Also record call audio</strong>
                <span style={{display:"block",color:"rgba(255,255,255,.45)",fontSize:fs.small,marginTop:2,lineHeight:1.5}}>
                  When you start, pick the tab or screen your call is in (Zoom, Meet, softphone) and tick "Share audio" — the prospect's voice is mixed into the recording.
                </span>
              </span>
            </label>
          )}

          {rec.error && <div role="alert" style={{fontSize:fs.body,color:"#EF5350"}}>{rec.error}</div>}
        </div>
      )}
    </div>
  );
}

// Compact "● REC 12:04 ▮▮▮" badge for the in-session header
export function RecIndicator({ rec, size }) {
  var lg = size === "lg";
  if (rec.status === "idle" && !rec.error) return null;
  if (rec.error && rec.status !== "recording") {
    return (
      <span title={rec.error} style={{fontSize:lg?12:9,fontWeight:700,color:"#EF5350",background:"rgba(239,83,80,.12)",border:"1px solid rgba(239,83,80,.35)",borderRadius:99,padding:lg?"4px 10px":"2px 7px",whiteSpace:"nowrap"}}>
        ⚠ Not recording
      </span>
    );
  }
  var bars = [0.15, 0.35, 0.6, 0.85];
  return (
    <span title={rec.error || rec.notice || "Recording"} style={{display:"inline-flex",alignItems:"center",gap:lg?7:5,fontSize:lg?12:9,fontWeight:700,color:"#EF5350",background:"rgba(239,83,80,.1)",border:"1px solid rgba(239,83,80,.3)",borderRadius:99,padding:lg?"4px 10px":"2px 7px",whiteSpace:"nowrap"}}>
      <span style={{width:lg?8:6,height:lg?8:6,borderRadius:"50%",background:"#EF5350",animation:"recPulse 1.2s ease-in-out infinite"}}/>
      {rec.status === "starting" ? "Starting mic…" : rec.status === "stopping" ? "Saving…" : "REC"}
      <span style={{display:"inline-flex",alignItems:"flex-end",gap:2,height:lg?12:9}} aria-hidden="true">
        {bars.map(function(b, i) {
          var on = (rec.level || 0) >= b;
          return <span key={i} style={{width:lg?3:2,height:((i + 1) / bars.length * 100) + "%",borderRadius:1,background:on?"#EF5350":"rgba(239,83,80,.25)"}}/>;
        })}
      </span>
      {rec.notice && <span style={{color:"#FFB300"}}>· mic only</span>}
      <style>{"@keyframes recPulse{0%,100%{opacity:1}50%{opacity:.25}}"}</style>
    </span>
  );
}
