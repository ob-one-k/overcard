import { useState, useEffect } from "react";
import { apiGet, apiPost } from "../lib/api";
import { solidBtn, ghostBtn, labelSt, inputSt } from "../lib/styles";
import { useDesktop } from "../lib/useDesktop";

// ─── RESET PASSWORD ───────────────────────────────────────────────────────────
// Opened from a one-time link (/?reset=TOKEN) an admin created, or the owner recovery
// command printed. Choosing a new password signs the account out everywhere; the user
// then signs in with it.

// Mirror of server/validate.js validatePassword so problems show before a round-trip
export function passwordProblem(pw) {
  if (!pw || pw.length < 8) return "Use at least 8 characters";
  if (!/[A-Z]/.test(pw)) return "Add an uppercase letter";
  if (!/[0-9]/.test(pw)) return "Add a digit";
  if (pw.length > 128) return "Use 128 characters or fewer";
  return null;
}

export function ResetPasswordScreen({ token, onDone }) {
  var desktop = useDesktop();
  var wide = desktop.isDesktop || desktop.isTablet;
  var [info, setInfo]       = useState(null);    // { firstName, email, orgName } | { error }
  var [pw, setPw]           = useState("");
  var [confirm, setConfirm] = useState("");
  var [busy, setBusy]       = useState(false);
  var [err, setErr]         = useState("");
  var [done, setDone]       = useState(false);

  useEffect(function() {
    apiGet("/auth/reset/" + encodeURIComponent(token))
      .then(function(d) { setInfo(d); })
      .catch(function(e) { setInfo({ error: e.message || "This reset link can't be used." }); });
  }, [token]);

  function submit(e) {
    if (e) e.preventDefault();
    var p = passwordProblem(pw);
    if (p) { setErr(p); return; }
    if (pw !== confirm) { setErr("The passwords don't match"); return; }
    setBusy(true); setErr("");
    apiPost("/auth/reset", { token: token, password: pw })
      .then(function() { setDone(true); })
      .catch(function(e2) { setErr(e2.message || "Couldn't reset the password"); })
      .finally(function() { setBusy(false); });
  }

  var hint = pw ? passwordProblem(pw) : null;
  var body;
  if (!info) {
    body = <div style={{color:"rgba(255,255,255,.5)",fontSize:14}}>Checking your link…</div>;
  } else if (info.error) {
    body = (
      <>
        <div style={{fontSize:20,fontWeight:700,color:"#fff"}}>Link can't be used</div>
        <div style={{fontSize:14,color:"rgba(255,255,255,.65)",lineHeight:1.6}}>{info.error}</div>
        <button onClick={onDone} style={solidBtn("#1565C0")}>Go to sign in</button>
      </>
    );
  } else if (done) {
    body = (
      <>
        <div style={{fontSize:20,fontWeight:700,color:"#fff"}}>Password updated</div>
        <div style={{fontSize:14,color:"rgba(255,255,255,.65)",lineHeight:1.6}}>Sign in with <strong style={{color:"#fff"}}>{info.email}</strong> and your new password. Any device that was signed in to this account has been signed out.</div>
        <button onClick={onDone} style={solidBtn("#1565C0")}>Sign in</button>
      </>
    );
  } else {
    body = (
      <form onSubmit={submit} style={{display:"flex",flexDirection:"column",gap:14}}>
        <div>
          <div style={{fontSize:wide?24:20,fontWeight:700,color:"#fff",fontFamily:wide?"'Lora',serif":"inherit"}}>Choose a new password</div>
          <div style={{fontSize:14,color:"rgba(255,255,255,.55)",marginTop:6,lineHeight:1.5}}>
            For <strong style={{color:"#fff"}}>{info.firstName || info.email}</strong> · {info.orgName}
          </div>
        </div>
        {/* Lets password managers file the new password under the right account */}
        <input type="email" autoComplete="username" value={info.email} readOnly hidden/>
        <div>
          <label style={labelSt()}>New password</label>
          <input type="password" autoComplete="new-password" value={pw} autoFocus={wide}
            onChange={function(e) { setPw(e.target.value); setErr(""); }}
            style={inputSt({marginBottom:0})}/>
          <div style={{fontSize:12,marginTop:6,color:hint ? "rgba(255,255,255,.45)" : pw ? "#66BB6A" : "rgba(255,255,255,.35)"}}>
            {pw ? (hint || "✓ Strong enough") : "At least 8 characters with an uppercase letter and a digit"}
          </div>
        </div>
        <div>
          <label style={labelSt()}>Confirm new password</label>
          <input type="password" autoComplete="new-password" value={confirm}
            onChange={function(e) { setConfirm(e.target.value); setErr(""); }} style={inputSt({marginBottom:0})}/>
        </div>
        {err && <div role="alert" style={{background:"rgba(239,83,80,.12)",border:"1px solid rgba(239,83,80,.3)",borderRadius:10,padding:"10px 12px",fontSize:13,color:"#EF5350"}}>{err}</div>}
        <button type="submit" disabled={busy} style={Object.assign({}, solidBtn("#1565C0"), {opacity:busy?.6:1})}>{busy ? "Saving…" : "Set new password"}</button>
        <button type="button" onClick={onDone} style={ghostBtn()}>Cancel</button>
      </form>
    );
  }

  return (
    <div style={{width:"100%",minHeight:"100vh",display:"flex",alignItems:wide?"center":"flex-start",justifyContent:"center",background:"linear-gradient(135deg,#060d1a 0%,#071025 100%)",padding:wide?32:"40px 16px",boxSizing:"border-box"}}>
      <div style={{width:"100%",maxWidth:440,background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:20,padding:wide?"32px 32px":"24px 20px",display:"flex",flexDirection:"column",gap:16}}>
        <div style={{width:44,height:44,borderRadius:12,background:"#1565C0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,fontWeight:900,color:"#fff"}}>O</div>
        {body}
      </div>
    </div>
  );
}
