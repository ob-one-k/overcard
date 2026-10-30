import { SESS_COLOR } from "../lib/constants";
import { useState, useEffect } from "react";
import { apiGet, apiPost, setStoredToken } from "../lib/api";
import { solidBtn, labelSt, inputSt } from "../lib/styles";
import { useDesktop } from "../lib/useDesktop";
import { BrandingFields } from "./BrandingFields";

// ─── SIGNUP SCREEN ────────────────────────────────────────────────────────────
// Two paths:
//   join   — employee enters an admin-issued share code → account joins that org as a user
//   create — founder enters the server's MASTER_CODE → new org, founder becomes its owner

// Client-side mirrors of server/validate.js so errors show before a round-trip
function passwordError(pw) {
  if (!pw || pw.length < 8) return "Password must be at least 8 characters";
  if (!/[A-Z]/.test(pw)) return "Password must contain an uppercase letter";
  if (!/[0-9]/.test(pw)) return "Password must contain a digit";
  return null;
}
function phoneError(phone) {
  if (!phone.trim()) return "Phone number is required";
  if (!/^\+?[0-9\s().-]+$/.test(phone.trim())) return "Invalid phone number";
  var digits = phone.replace(/\D/g, "").length;
  if (digits < 7 || digits > 15) return "Phone number must have 7–15 digits";
  return null;
}
function personError(f) {
  if (!f.firstName.trim()) return "First name is required";
  if (!f.lastName.trim()) return "Last name is required";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return "Enter a valid email";
  return phoneError(f.phone) || passwordError(f.password) || (f.password !== f.confirm ? "Passwords don't match" : null);
}

// Display share codes as XXXX-XXXX while typing
function formatCode(v) {
  var c = v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return c.length > 4 ? c.slice(0, 4) + "-" + c.slice(4) : c;
}

var EMPTY_PERSON = { firstName:"", lastName:"", email:"", phone:"", password:"", confirm:"" };
var EMPTY_ORG    = { name:"", industry:"", website:"", phone:"", address:"", logo:null, accentColor:null };

export function SignupScreen({ initialCode, onLogin, onBack }) {
  var desktop = useDesktop();
  var [mode,   setMode]   = useState("join");      // "join" | "create"
  var [code,   setCode]   = useState(formatCode(initialCode || ""));
  var [codeOrg, setCodeOrg] = useState(null);      // org name the code resolves to
  var [codeErr, setCodeErr] = useState("");
  var [master, setMaster] = useState("");
  var [person, setPerson] = useState(EMPTY_PERSON);
  var [org,    setOrg]    = useState(EMPTY_ORG);
  var [err,    setErr]    = useState("");
  var [busy,   setBusy]   = useState(false);

  // Resolve the share code to its org name once all 8 characters are in
  useEffect(function() {
    var raw = code.replace(/-/g, "");
    setCodeOrg(null); setCodeErr("");
    if (mode !== "join" || raw.length !== 8) return;
    var cancelled = false;
    apiGet("/auth/invite/" + raw)
      .then(function(r) { if (!cancelled) setCodeOrg(r.orgName); })
      .catch(function(e) {
        if (cancelled) return;
        setCodeErr(e.status === 404 ? "This share code is invalid or has expired." : e.status === 429 ? "Too many attempts. Wait a few minutes." : "Couldn't check the code.");
      });
    return function() { cancelled = true; };
  }, [code, mode]);

  function setP(k, v) { setPerson(function(p) { var n = Object.assign({}, p); n[k] = v; return n; }); }
  function setO(k, v) { setOrg(function(p) { var n = Object.assign({}, p); n[k] = v; return n; }); }

  function submit(e) {
    e.preventDefault();
    setErr("");
    var pErr = personError(person);
    var body = {
      firstName: person.firstName.trim(), lastName: person.lastName.trim(),
      email: person.email.trim(), phone: person.phone.trim(), password: person.password,
    };
    var path;
    if (mode === "join") {
      if (code.replace(/-/g, "").length !== 8) { setErr("Enter the 8-character share code from your admin."); return; }
      if (pErr) { setErr(pErr); return; }
      path = "/auth/signup";
      body.code = code;
    } else {
      if (!master) { setErr("Master code is required."); return; }
      if (!org.name.trim()) { setErr("Company name is required."); return; }
      if (org.phone.trim()) { var cp = phoneError(org.phone); if (cp) { setErr("Company " + cp.toLowerCase()); return; } }
      if (pErr) { setErr(pErr); return; }
      path = "/auth/create-org";
      body.masterCode = master;
      body.org = { name: org.name.trim(), industry: org.industry.trim(), website: org.website.trim(), phone: org.phone.trim(), address: org.address.trim(),
        logo: org.logo || null, accentColor: org.accentColor || null };
    }
    setBusy(true);
    apiPost(path, body)
      .then(function(user) {
        if (user._token) setStoredToken(user._token);
        onLogin(user);
      })
      .catch(function(e) {
        setBusy(false);
        if (!e.status) { setErr("Can't reach the server. Check your connection and try again."); return; }
        if (e.status === 429) { setErr("Too many attempts. Please wait a few minutes and try again."); return; }
        setErr(e.message && e.message.indexOf("API ") !== 0 ? e.message : "Sign up failed (" + e.status + ").");
      });
  }

  function field(label, value, onChange, opts) {
    opts = opts || {};
    return (
      <div style={{gridColumn: opts.full ? "1 / -1" : undefined}}>
        <label style={labelSt()}>{label}{opts.optional && <span style={{textTransform:"none",letterSpacing:0,fontWeight:400,color:"rgba(255,255,255,.25)"}}> (optional)</span>}</label>
        <input type={opts.type || "text"} value={value} placeholder={opts.placeholder || ""}
          autoComplete={opts.autoComplete || "off"}
          onChange={function(e) { onChange(e.target.value); }}
          style={inputSt(Object.assign({marginBottom:0}, opts.style || {}))}/>
      </div>
    );
  }

  var wide = desktop.isDesktop || desktop.isTablet;
  var grid = { display:"grid", gridTemplateColumns: wide ? "1fr 1fr" : "1fr", gap:12 };
  var sectionHdr = { fontSize:12, fontWeight:700, color:"rgba(255,255,255,.55)", letterSpacing:.4, marginBottom:10, marginTop:4 };

  var personFields = (
    <div style={grid}>
      {field("First name", person.firstName, function(v){ setP("firstName", v); }, { autoComplete:"given-name" })}
      {field("Last name",  person.lastName,  function(v){ setP("lastName", v); },  { autoComplete:"family-name" })}
      {field("Email", person.email, function(v){ setP("email", v); }, { type:"email", placeholder:"you@company.com", autoComplete:"email" })}
      {field("Phone", person.phone, function(v){ setP("phone", v); }, { type:"tel", placeholder:"+1 555 123 4567", autoComplete:"tel" })}
      {field("Password", person.password, function(v){ setP("password", v); }, { type:"password", placeholder:"8+ chars, 1 uppercase, 1 digit", autoComplete:"new-password" })}
      {field("Confirm password", person.confirm, function(v){ setP("confirm", v); }, { type:"password", autoComplete:"new-password" })}
    </div>
  );

  return (
    <div style={{width:"100%",minHeight:"100vh",display:"flex",alignItems:wide?"center":"flex-start",justifyContent:"center",background:"linear-gradient(135deg,#060d1a 0%,#071025 100%)",fontFamily:"'Inter',sans-serif",padding:wide?32:"24px 16px",overflowY:"auto",boxSizing:"border-box"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Lora:ital,wght@0,400;0,700;1,400&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        body{background:#060d1a;color:#fff;}
        input::placeholder{color:rgba(255,255,255,.22);}
        input:focus{border-color:rgba(255,255,255,.3)!important;outline:none;}
        @keyframes fadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
        button{transition:transform 0.11s cubic-bezier(.22,1,.36,1),filter 0.11s ease,opacity 0.11s ease;}
        button:not(:disabled):active{transform:scale(0.95)!important;filter:brightness(0.85);}
        button:not(:disabled):hover{filter:brightness(1.12);}
        button:disabled{opacity:0.5!important;cursor:not-allowed;}
      `}</style>
      <div style={{width:"100%",maxWidth:wide?720:420,animation:"fadeIn .35s cubic-bezier(.22,1,.36,1) both"}}>

        {/* Header */}
        <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:20}}>
          <button onClick={onBack} aria-label="Back to sign in"
            style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.12)",borderRadius:12,color:"rgba(255,255,255,.7)",fontSize:16,width:40,height:40,cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>←</button>
          <div>
            <div style={{fontSize:wide?24:20,fontWeight:700,color:"#fff",fontFamily:"'Lora',serif"}}>Create your account</div>
            <div style={{fontSize:13,color:"rgba(255,255,255,.4)",marginTop:2}}>Join your team, or set up a new organization.</div>
          </div>
        </div>

        {/* Mode switch */}
        <div role="tablist" style={{display:"flex",background:"rgba(255,255,255,.05)",borderRadius:12,padding:3,gap:2,marginBottom:16}}>
          {[["join","Join with share code"],["create","Create organization"]].map(function(m) {
            var on = mode === m[0];
            return (
              <button key={m[0]} role="tab" aria-selected={on} onClick={function(){ setMode(m[0]); setErr(""); }}
                style={{flex:1,background:on?"rgba(255,255,255,.12)":"transparent",border:"none",borderRadius:10,padding:"10px 6px",cursor:"pointer",fontFamily:"inherit",color:on?"#fff":"rgba(255,255,255,.45)",fontSize:13,fontWeight:on?700:500}}>
                {m[1]}
              </button>
            );
          })}
        </div>

        <form onSubmit={submit} style={{background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.09)",borderRadius:18,padding:wide?"24px 26px":"20px 18px",display:"flex",flexDirection:"column",gap:16}}>
          {err && <div role="alert" style={{background:"rgba(239,83,80,.12)",border:"1px solid rgba(239,83,80,.3)",borderRadius:10,padding:"10px 12px",fontSize:13,color:"#EF5350"}}>{err}</div>}

          {mode === "join" && (
            <div>
              <label style={labelSt()}>Share code</label>
              <input value={code} onChange={function(e){ setCode(formatCode(e.target.value)); }} placeholder="XXXX-XXXX"
                autoComplete="off" spellCheck={false}
                style={inputSt({marginBottom:0,fontSize:20,fontWeight:700,letterSpacing:4,textAlign:"center",fontFamily:"ui-monospace,Menlo,monospace"})}/>
              <div style={{fontSize:12,marginTop:8,minHeight:16,color:codeOrg?"#66BB6A":codeErr?"#EF5350":"rgba(255,255,255,.35)"}}>
                {codeOrg ? "✓ You're joining " + codeOrg : codeErr || "Ask an admin in your organization for a share code."}
              </div>
            </div>
          )}

          {mode === "create" && (
            <>
              <div>
                <label style={labelSt()}>Master code</label>
                <input type="password" value={master} onChange={function(e){ setMaster(e.target.value); }} placeholder="Provided by OverCard"
                  autoComplete="off" style={inputSt({marginBottom:0})}/>
              </div>
              <div>
                <div style={sectionHdr}>Organization</div>
                <div style={grid}>
                  {field("Company name", org.name, function(v){ setO("name", v); }, { full:true, placeholder:"Acme Inc.", autoComplete:"organization" })}
                  {field("Industry", org.industry, function(v){ setO("industry", v); }, { optional:true, placeholder:"e.g. SaaS" })}
                  {field("Website", org.website, function(v){ setO("website", v); }, { optional:true, placeholder:"acme.com" })}
                  {field("Company phone", org.phone, function(v){ setO("phone", v); }, { optional:true, type:"tel" })}
                  {field("Address", org.address, function(v){ setO("address", v); }, { optional:true })}
                </div>
                <div style={{marginTop:14}}>
                  <BrandingFields logo={org.logo} accent={org.accentColor} size={wide ? "lg" : undefined} orgName={org.name}
                    onChange={function(patch){ setOrg(function(p){ return Object.assign({}, p, patch); }); }}/>
                </div>
              </div>
            </>
          )}

          <div>
            {mode === "create" && <div style={sectionHdr}>Your account (organization owner)</div>}
            {personFields}
          </div>

          <button type="submit" disabled={busy}
            style={Object.assign({}, solidBtn(SESS_COLOR), {marginTop:4,width:"100%"})}>
            {busy ? "Creating account…" : mode === "join" ? "Join organization" : "Create organization"}
          </button>
          <div style={{fontSize:13,color:"rgba(255,255,255,.4)",textAlign:"center"}}>
            Already have an account?{" "}
            <button type="button" onClick={onBack} style={{background:"none",border:"none",color:"#00B4FF",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:600,padding:0}}>Sign in</button>
          </div>
        </form>
      </div>
    </div>
  );
}
