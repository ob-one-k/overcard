import { useState, useEffect, useRef, useContext } from "react";
import { TM, DECK_COLORS, DECK_ICONS, SESS_COLOR, isAdminRole, roleMeta } from "../lib/constants";
import { apiGet, apiPost, apiPut, apiDel, setStoredToken, lsGet, fetchWithTimeout, API_BASE } from "../lib/api";
import { solidBtn, ghostBtn, ghostSm, iconBtn, inputSt, cardBg, badgeSt, labelSt } from "../lib/styles";
import { TypeBadge, Handle, SectionHdr } from "./ui";
import DesktopCtx from "../lib/DesktopCtx";
import { DesktopModal } from "./DesktopModal";

// ─── DECK SWITCHER SHEET ──────────────────────────────────────────────────────
export function DeckSwitcherSheet({ decks, activeDeckId, onSelect, onAddDeck, onClose, isAdmin, onEditDeck, orgUsers, orgTeams }) {
  var desktop = useContext(DesktopCtx);
  var [showNew, setShowNew] = useState(false);
  var [nf, setNf] = useState({ name:"", icon:"💼", color:"#F5A623", visibility:"public", accessList:[] });
  var [editingDeck, setEditingDeck] = useState(null);
  var [ef, setEf] = useState({ name:"", icon:"💼", color:"#00B4FF", visibility:"public", accessList:[] });

  function toggleAccess(formSetter, entityType, entityId) {
    formSetter(function(p) {
      var al = p.accessList || [];
      var has = al.some(function(a){ return a.entityType===entityType && a.entityId===entityId; });
      return Object.assign({}, p, { accessList: has
        ? al.filter(function(a){ return !(a.entityType===entityType && a.entityId===entityId); })
        : al.concat([{ entityType:entityType, entityId:entityId }])
      });
    });
  }

  function create() {
    if (!nf.name.trim()) return;
    onAddDeck({ name:nf.name, icon:nf.icon, color:nf.color, visibility:nf.visibility||"public", accessList:nf.accessList||[], rootCard:null, cards:{}, objStacks:[] });
    setShowNew(false); setNf({name:"",icon:"💼",color:"#F5A623",visibility:"public",accessList:[]}); onClose();
  }

  // ── Inner content (shared between mobile sheet and desktop modal) ──
  var innerContent = (
    <div style={{overflowY:"auto",flex:1,padding:"14px 20px"}}>
      {isAdmin && (
        <div style={{marginBottom:12}}>
          <button onClick={function(){setShowNew(function(p){return !p;});}} style={ghostSm({width:"100%",textAlign:"center",padding:"9px"})}>+ New Deck</button>
        </div>
      )}
      {showNew && (
            <div style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.1)",borderRadius:14,padding:"16px",marginBottom:14}}>
              <div style={{fontSize:14,fontWeight:700,color:"#fff",marginBottom:14,fontFamily:"'Lora',serif"}}>New Pitch Deck</div>
              <label style={labelSt()}>Name</label>
              <input value={nf.name} onChange={function(e){setNf(function(p){return Object.assign({},p,{name:e.target.value});});}} placeholder="e.g. Enterprise Outbound" style={inputSt({marginBottom:11})}/>
              <label style={labelSt()}>Icon</label>
              <div style={{display:"flex",gap:7,flexWrap:"wrap",marginBottom:11}}>
                {DECK_ICONS.map(function(ic) {
                  return <button key={ic} onClick={function(){setNf(function(p){return Object.assign({},p,{icon:ic});});}}
                    style={{background:nf.icon===ic?"rgba(255,255,255,.15)":"rgba(255,255,255,.05)",border:"1.5px solid "+(nf.icon===ic?"rgba(255,255,255,.4)":"rgba(255,255,255,.07)"),borderRadius:9,width:36,height:36,cursor:"pointer",fontSize:17}}>{ic}</button>;
                })}
              </div>
              <label style={labelSt()}>Color</label>
              <div style={{display:"flex",gap:8,marginBottom:11}}>
                {DECK_COLORS.map(function(c) {
                  return <button key={c} onClick={function(){setNf(function(p){return Object.assign({},p,{color:c});});}}
                    style={{width:28,height:28,borderRadius:"50%",background:c,border:"3px solid "+(nf.color===c?"#fff":"transparent"),cursor:"pointer"}}/>;
                })}
              </div>
              <label style={labelSt()}>Visibility</label>
              <div style={{display:"flex",gap:8,marginBottom:14}}>
                {["public","private"].map(function(v){
                  var on = nf.visibility===v;
                  var icon = v==="public" ? "🌐" : "🔒";
                  return (
                    <button key={v} onClick={function(){setNf(function(p){return Object.assign({},p,{visibility:v});});}}
                      style={{flex:1,background:on?"rgba(168,255,62,.1)":"rgba(255,255,255,.07)",border:"1.5px solid "+(on?"rgba(168,255,62,.35)":"rgba(255,255,255,.1)"),borderRadius:10,padding:"8px 6px",cursor:"pointer",fontFamily:"inherit",textAlign:"center"}}>
                      <div style={{fontSize:14}}>{icon}</div>
                      <div style={{fontSize:9,color:on?SESS_COLOR:"rgba(255,255,255,.4)",fontWeight:on?700:400,marginTop:2}}>{v==="public"?"Public":"Private"}</div>
                    </button>
                  );
                })}
              </div>
              {nf.visibility === "private" && (
                <div style={{marginBottom:14}}>
                  {(orgTeams||[]).length > 0 && <>
                    <label style={labelSt()}>Team Access</label>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:9}}>
                      {(orgTeams||[]).map(function(t) {
                        var on = (nf.accessList||[]).some(function(a){ return a.entityType==="team"&&a.entityId===t.id; });
                        return <button key={t.id} onClick={function(){toggleAccess(setNf,"team",t.id);}}
                          style={{background:on?"rgba(0,180,255,.18)":"rgba(255,255,255,.05)",border:"1px solid "+(on?"rgba(0,180,255,.45)":"rgba(255,255,255,.1)"),borderRadius:8,padding:"4px 11px",cursor:"pointer",fontFamily:"inherit",fontSize:11,color:on?"#00B4FF":"rgba(255,255,255,.4)",fontWeight:on?700:400}}>{t.name}</button>;
                      })}
                    </div>
                  </>}
                  {(orgUsers||[]).length > 0 && <>
                    <label style={labelSt()}>User Access</label>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:0}}>
                      {(orgUsers||[]).map(function(u) {
                        var on = (nf.accessList||[]).some(function(a){ return a.entityType==="user"&&a.entityId===u.id; });
                        return <button key={u.id} onClick={function(){toggleAccess(setNf,"user",u.id);}}
                          style={{background:on?"rgba(0,180,255,.18)":"rgba(255,255,255,.05)",border:"1px solid "+(on?"rgba(0,180,255,.45)":"rgba(255,255,255,.1)"),borderRadius:8,padding:"4px 11px",cursor:"pointer",fontFamily:"inherit",fontSize:11,color:on?"#00B4FF":"rgba(255,255,255,.4)",fontWeight:on?700:400}}>{u.displayName}</button>;
                      })}
                    </div>
                  </>}
                </div>
              )}
              <div style={{display:"flex",gap:10}}>
                <button onClick={function(){setShowNew(false);}} style={Object.assign({},ghostBtn(),{flex:1,padding:"9px",fontSize:13})}>Cancel</button>
                <button onClick={create} style={Object.assign({},solidBtn(nf.color),{flex:2})}>Create</button>
              </div>
            </div>
          )}
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {decks.map(function(d) {
              var active = d.id===activeDeckId;
              var isEditing = editingDeck && editingDeck.id === d.id;
              if (isEditing) {
                return (
                  <div key={d.id} style={{background:"rgba(255,255,255,.06)",border:"1.5px solid rgba(255,255,255,.15)",borderRadius:16,padding:"14px 15px"}}>
                    <div style={{fontSize:12,fontWeight:700,color:"#fff",marginBottom:10}}>Edit Deck</div>
                    <label style={labelSt()}>Name</label>
                    <input value={ef.name} onChange={function(e){setEf(function(p){return Object.assign({},p,{name:e.target.value});});}} style={inputSt({marginBottom:10})}/>
                    <label style={labelSt()}>Icon</label>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
                      {DECK_ICONS.map(function(ic) {
                        return <button key={ic} onClick={function(){setEf(function(p){return Object.assign({},p,{icon:ic});});}}
                          style={{background:ef.icon===ic?"rgba(255,255,255,.15)":"rgba(255,255,255,.05)",border:"1.5px solid "+(ef.icon===ic?"rgba(255,255,255,.4)":"rgba(255,255,255,.07)"),borderRadius:9,width:34,height:34,cursor:"pointer",fontSize:16}}>{ic}</button>;
                      })}
                    </div>
                    <label style={labelSt()}>Color</label>
                    <div style={{display:"flex",gap:7,flexWrap:"wrap",marginBottom:10}}>
                      {DECK_COLORS.map(function(c) {
                        return <button key={c} onClick={function(){setEf(function(p){return Object.assign({},p,{color:c});});}}
                          style={{width:26,height:26,borderRadius:"50%",background:c,border:"3px solid "+(ef.color===c?"#fff":"transparent"),cursor:"pointer"}}/>;
                      })}
                    </div>
                    <label style={labelSt()}>Visibility</label>
                    <div style={{display:"flex",gap:8,marginBottom:12}}>
                      {["public","private"].map(function(v){
                        var on = ef.visibility===v;
                        var icon = v==="public" ? "🌐" : "🔒";
                        return (
                          <button key={v} onClick={function(){setEf(function(p){return Object.assign({},p,{visibility:v});});}}
                            style={{flex:1,background:on?"rgba(168,255,62,.1)":"rgba(255,255,255,.07)",border:"1.5px solid "+(on?"rgba(168,255,62,.35)":"rgba(255,255,255,.1)"),borderRadius:10,padding:"8px 6px",cursor:"pointer",fontFamily:"inherit",textAlign:"center"}}>
                            <div style={{fontSize:14}}>{icon}</div>
                            <div style={{fontSize:9,color:on?SESS_COLOR:"rgba(255,255,255,.4)",fontWeight:on?700:400,marginTop:2}}>{v==="public"?"Public":"Private"}</div>
                          </button>
                        );
                      })}
                    </div>
                    {ef.visibility === "private" && (
                      <div style={{marginBottom:12}}>
                        {(orgTeams||[]).length > 0 && <>
                          <label style={labelSt()}>Team Access</label>
                          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
                            {(orgTeams||[]).map(function(t) {
                              var on = (ef.accessList||[]).some(function(a){ return a.entityType==="team"&&a.entityId===t.id; });
                              return <button key={t.id} onClick={function(){toggleAccess(setEf,"team",t.id);}}
                                style={{background:on?"rgba(0,180,255,.18)":"rgba(255,255,255,.05)",border:"1px solid "+(on?"rgba(0,180,255,.45)":"rgba(255,255,255,.1)"),borderRadius:8,padding:"4px 10px",cursor:"pointer",fontFamily:"inherit",fontSize:10,color:on?"#00B4FF":"rgba(255,255,255,.4)",fontWeight:on?700:400}}>{t.name}</button>;
                            })}
                          </div>
                        </>}
                        {(orgUsers||[]).length > 0 && <>
                          <label style={labelSt()}>User Access</label>
                          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:0}}>
                            {(orgUsers||[]).map(function(u) {
                              var on = (ef.accessList||[]).some(function(a){ return a.entityType==="user"&&a.entityId===u.id; });
                              return <button key={u.id} onClick={function(){toggleAccess(setEf,"user",u.id);}}
                                style={{background:on?"rgba(0,180,255,.18)":"rgba(255,255,255,.05)",border:"1px solid "+(on?"rgba(0,180,255,.45)":"rgba(255,255,255,.1)"),borderRadius:8,padding:"4px 10px",cursor:"pointer",fontFamily:"inherit",fontSize:10,color:on?"#00B4FF":"rgba(255,255,255,.4)",fontWeight:on?700:400}}>{u.displayName}</button>;
                            })}
                          </div>
                        </>}
                      </div>
                    )}
                    <div style={{display:"flex",gap:8}}>
                      <button onClick={function(){setEditingDeck(null);}} style={Object.assign({},ghostBtn(),{flex:1,padding:"8px",fontSize:12})}>Cancel</button>
                      <button onClick={function(){if(onEditDeck&&ef.name.trim())onEditDeck(editingDeck.id,ef);setEditingDeck(null);}} style={Object.assign({},solidBtn(ef.color),{flex:2,padding:"8px",fontSize:12})}>Save</button>
                    </div>
                  </div>
                );
              }
              return (
                <div key={d.id} style={{position:"relative",display:"flex",alignItems:"center",gap:0}}>
                  <button onClick={function(){onSelect(d.id);onClose();}}
                    style={{flex:1,background:active?d.color+"14":"rgba(255,255,255,.07)",border:"1.5px solid "+(active?d.color:"rgba(255,255,255,.08)"),borderRadius:16,padding:"13px 15px",cursor:"pointer",textAlign:"left",fontFamily:"inherit"}}>
                    <div style={{display:"flex",alignItems:"center",gap:11}}>
                      <div style={{width:44,height:44,borderRadius:13,background:d.color+"22",border:"1.5px solid "+d.color+"44",display:"flex",alignItems:"center",justifyContent:"center",fontSize:21,flexShrink:0}}>{d.icon}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:3,flexWrap:"wrap"}}>
                          <span style={{fontSize:14,fontWeight:700,color:"#fff"}}>{d.name}</span>
                          {active && <span style={{fontSize:9,background:d.color+"22",color:d.color,padding:"1px 8px",borderRadius:99,letterSpacing:.5,textTransform:"uppercase"}}>active</span>}
                          <span style={{fontSize:10,opacity:.55}} title={d.visibility==="private"?"Private — restricted access":"Public — org-wide"}>{d.visibility==="private"?"🔒":"🌐"}</span>
                        </div>
                        <div style={{fontSize:11,color:"rgba(255,255,255,.3)"}}>{Object.values(d.cards).length} cards · {d.objStacks.length} obj stacks</div>
                      </div>
                    </div>
                  </button>
                  {isAdmin && <button onClick={function(e){ e.stopPropagation(); setEf({name:d.name,icon:d.icon||"💼",color:d.color||"#00B4FF",visibility:d.visibility||"public",accessList:d.accessList||[]}); setEditingDeck(d); }} style={{background:"none",border:"none",cursor:"pointer",fontSize:14,padding:"2px 5px",color:"rgba(255,255,255,.4)",position:"absolute",right:10,top:"50%",transform:"translateY(-50%)"}}>✏</button>}
                </div>
              );
            })}
          </div>
    </div>
  );

  if (desktop.isDesktop) {
    return (
      <DesktopModal title="Switch Deck" width={560} onClose={onClose}>
        {innerContent}
      </DesktopModal>
    );
  }

  return (
    <div style={{position:"fixed",inset:0,zIndex:250,display:"flex",flexDirection:"column"}}>
      <div onClick={onClose} style={{flex:1,background:"rgba(0,0,0,.6)",backdropFilter:"blur(8px)"}}/>
      <div style={{background:"#081428",borderRadius:"24px 24px 0 0",border:"1px solid rgba(255,255,255,.1)",borderBottom:"none",maxHeight:"80vh",display:"flex",flexDirection:"column",animation:"sheetUp .3s cubic-bezier(.22,1,.36,1) both"}}>
        <Handle/>
        <div style={{padding:"4px 20px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid rgba(255,255,255,.07)"}}>
          <div style={{fontSize:18,fontWeight:700,color:"#fff",fontFamily:"'Lora',serif"}}>Switch Deck</div>
          <div style={{display:"flex",gap:8}}>
            {isAdmin && <button onClick={function(){setShowNew(function(p){return !p;});}} style={ghostSm()}>+ New Deck</button>}
            <button onClick={onClose} style={iconBtn()}>✕</button>
          </div>
        </div>
        {innerContent}
      </div>
    </div>
  );
}

// ─── LOGIN SCREEN ─────────────────────────────────────────────────────────────
var DEV_PASSWORD = "Overcard2025!";
var DEV_ORGS = [
  {
    id: "apex", name: "Apex Sales", domain: "apexsales.com",
    admins: [
      { label:"Alex Mercer",    email:"alex@apexsales.com",     role:"owner" },
      { label:"Jordan Rivera",  email:"jordan@apexsales.com"  },
      { label:"Sam Patel",      email:"sam@apexsales.com"     },
    ],
    teams: [
      { name:"Team Alpha", users:[
        { label:"Marcus Chen",    email:"marcus@apexsales.com"  },
        { label:"Priya Nair",     email:"priya@apexsales.com"   },
        { label:"Tyler Brooks",   email:"tyler@apexsales.com"   },
        { label:"Sofia Martinez", email:"sofia@apexsales.com"   },
      ]},
      { name:"Team Beta", users:[
        { label:"Dani Walsh",     email:"dani@apexsales.com"    },
        { label:"Kenji Tanaka",   email:"kenji@apexsales.com"   },
        { label:"Amara Osei",     email:"amara@apexsales.com"   },
        { label:"Ryan Costello",  email:"ryan@apexsales.com"    },
      ]},
      { name:"Team Gamma", users:[
        { label:"Leila Hassan",   email:"leila@apexsales.com"   },
        { label:"Colt Barnard",   email:"colt@apexsales.com"    },
        { label:"Zara Kim",       email:"zara@apexsales.com"    },
        { label:"Derek Pham",     email:"derek@apexsales.com"   },
      ]},
    ],
  },
  {
    id: "meridian", name: "Meridian Group", domain: "meridiangroup.com",
    admins: [
      { label:"Casey Wright", email:"casey@meridiangroup.com", role:"owner" },
      { label:"Riley Stone",  email:"riley@meridiangroup.com" },
    ],
    teams: [
      { name:"Team North", users:[
        { label:"Jordan Fox",   email:"fox@meridiangroup.com"   },
        { label:"Avery Blake",  email:"blake@meridiangroup.com" },
      ]},
      { name:"Team South", users:[
        { label:"Morgan Shaw",  email:"shaw@meridiangroup.com"  },
        { label:"Taylor Reed",  email:"reed@meridiangroup.com"  },
      ]},
    ],
  },
];

export function LoginScreen({ onLogin, kickReason, onShowSignup }) {
  var [email,   setEmail]   = useState("");
  var [pass,    setPass]    = useState("");
  var [err,     setErr]     = useState("");
  var [busy,    setBusy]    = useState(false);
  var [selOrg,  setSelOrg]  = useState(null);   // null | DEV_ORGS entry
  var [showPicker, setShowPicker] = useState(false);
  var [alreadyLoggedIn, setAlreadyLoggedIn] = useState(false);

  function pickOrg(org) {
    setSelOrg(org);
    setEmail(""); setPass(""); setErr(""); setAlreadyLoggedIn(false);
  }

  function pickUser(u) {
    setEmail(u.email);
    setPass(DEV_PASSWORD);
    setShowPicker(false);
    setErr("");
  }

  function doLogin(url, creds) {
    setBusy(true); setErr(""); setAlreadyLoggedIn(false);
    apiPost(url, creds)
      .then(function(user) {
        setBusy(false);
        if (user._token) setStoredToken(user._token);
        onLogin(user);
      })
      .catch(function(e) {
        setBusy(false);
        if (e.status === 409) { setAlreadyLoggedIn(true); return; }
        if (e.status === 401) { setErr("Invalid email or password."); return; }
        if (e.status === 429) { setErr("Too many login attempts. Please wait a few minutes and try again."); return; }
        if (!e.status)        { setErr("Can't reach the server. Check your connection and try again."); return; }
        setErr("Login failed (" + e.status + "). Please try again.");
      });
  }

  function submit(e) {
    e.preventDefault();
    if (!email.trim() || !pass) { setErr("Email and password are required."); return; }
    doLogin("/auth/login", { email: email.trim(), password: pass });
  }

  function handleForceLogin() {
    if (!email.trim() || !pass) return;
    doLogin("/auth/login?force=true", { email: email.trim(), password: pass });
  }

  var accentColor = "#00B4FF"; // always on-theme; org colors only identify org tiles

  return (
    <div style={{width:"100%",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"linear-gradient(135deg,#060d1a 0%,#071025 100%)",fontFamily:"'Inter',sans-serif",padding:24,overflowY:"auto"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Lora:ital,wght@0,400;0,700;1,400&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        body{background:#060d1a;color:#fff;}
        input::placeholder{color:rgba(255,255,255,.22);}
        input:focus{border-color:rgba(255,255,255,.3)!important;outline:none;}
        @keyframes fadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
        @keyframes dropIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
        button{transition:transform 0.11s cubic-bezier(.22,1,.36,1),filter 0.11s ease,opacity 0.11s ease;}
        button:not(:disabled):active{transform:scale(0.92)!important;filter:brightness(0.80);}
        button:not(:disabled):hover{filter:brightness(1.12);}
        button:disabled{opacity:0.45!important;cursor:not-allowed;}
      `}</style>
      <div style={{width:"100%",maxWidth:380,animation:"fadeIn .4s cubic-bezier(.22,1,.36,1) both",paddingBottom:24}}>

        {/* Logo */}
        <div style={{textAlign:"center",marginBottom:16}}>
          <div style={{display:"inline-block",marginBottom:2}}>
            <img src="/icon.png" alt="OverCard"
              style={{width:330,height:220,objectFit:"contain",filter:"drop-shadow(0 6px 24px rgba(0,180,255,.4))"}}/>
          </div>
          <div style={{fontSize:22,fontWeight:700,color:"#fff",fontFamily:"'Lora',serif",marginBottom:4}}>OverCard</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,.3)",letterSpacing:.5}}>Sales Deck Platform</div>
        </div>

        {/* ── Step 1: Org selector ── */}
        <div style={{marginBottom:14}}>
          <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,.3)",letterSpacing:1.4,textTransform:"uppercase",marginBottom:8}}>Select organization</div>
          <div style={{display:"flex",gap:8}}>
            {DEV_ORGS.map(function(org) {
              var active = selOrg && selOrg.id === org.id;
              return (
                <button key={org.id} onClick={function(){ pickOrg(org); }}
                  style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:5,padding:"12px 10px",background:active?"rgba(0,180,255,.08)":"rgba(255,255,255,.07)",border:"1.5px solid "+(active?"rgba(0,180,255,.4)":"rgba(255,255,255,.09)"),borderRadius:14,cursor:"pointer",fontFamily:"inherit",transition:"all .15s"}}>
                  <div style={{width:34,height:34,borderRadius:10,background:active?"rgba(0,180,255,.15)":"rgba(255,255,255,.07)",border:"1.5px solid "+(active?"rgba(0,180,255,.35)":"rgba(255,255,255,.12)"),display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:700,color:active?"#00B4FF":"rgba(255,255,255,.5)"}}>
                    {org.name[0]}
                  </div>
                  <div style={{fontSize:11,fontWeight:700,color:active?"#fff":"rgba(255,255,255,.55)",textAlign:"center",lineHeight:1.3}}>{org.name}</div>
                  {active && <div style={{width:6,height:6,borderRadius:"50%",background:"#00B4FF"}}/>}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Step 2: User picker (only when org selected) ── */}
        {selOrg && (
          <div style={{marginBottom:14,position:"relative"}}>
            <button onClick={function(){ setShowPicker(function(p){ return !p; }); }}
              style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",background:accentColor+"0f",border:"1px solid "+accentColor+"33",borderRadius:12,padding:"10px 14px",cursor:"pointer",fontFamily:"inherit",color:"rgba(255,255,255,.7)",fontSize:12,transition:"all .15s"}}>
              <span style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:13}}>⚡</span>
                <span>{email ? email : "Quick select a user"}</span>
              </span>
              <span style={{fontSize:10,color:"rgba(255,255,255,.3)"}}>{showPicker ? "▲" : "▼"}</span>
            </button>
            {showPicker && (
              <div style={{position:"absolute",top:"calc(100% + 6px)",left:0,right:0,background:"#081428",border:"1px solid rgba(255,255,255,.12)",borderRadius:12,overflow:"hidden",zIndex:20,animation:"dropIn .15s ease both",maxHeight:300,overflowY:"auto",boxShadow:"0 16px 48px rgba(0,0,0,.8)"}}>
                {/* Admins */}
                <div style={{padding:"7px 12px 4px",fontSize:9,fontWeight:700,color:SESS_COLOR+"99",letterSpacing:1.2,textTransform:"uppercase",borderBottom:"1px solid rgba(255,255,255,.05)"}}>Admins</div>
                {selOrg.admins.map(function(u) {
                  return (
                    <button key={u.email} onClick={function(){ pickUser(u); }}
                      style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",background:"none",border:"none",borderBottom:"1px solid rgba(255,255,255,.04)",padding:"10px 14px",cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}>
                      <div>
                        <div style={{fontSize:12,fontWeight:700,color:"#fff"}}>{u.label}</div>
                        <div style={{fontSize:10,color:"rgba(255,255,255,.3)",marginTop:1}}>{u.email}</div>
                      </div>
                      <span style={{fontSize:9,fontWeight:700,padding:"2px 8px",borderRadius:99,background:roleMeta(u.role||"admin").bg,color:roleMeta(u.role||"admin").color,border:"1px solid "+roleMeta(u.role||"admin").border,flexShrink:0}}>{u.role||"admin"}</span>
                    </button>
                  );
                })}
                {/* Teams */}
                {selOrg.teams.map(function(team) {
                  return (
                    <div key={team.name}>
                      <div style={{padding:"7px 12px 4px",fontSize:9,fontWeight:700,color:"rgba(0,180,255,.55)",letterSpacing:1.2,textTransform:"uppercase",borderBottom:"1px solid rgba(255,255,255,.04)",borderTop:"1px solid rgba(255,255,255,.05)"}}>{team.name}</div>
                      {team.users.map(function(u) {
                        return (
                          <button key={u.email} onClick={function(){ pickUser(u); }}
                            style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",background:"none",border:"none",borderBottom:"1px solid rgba(255,255,255,.04)",padding:"10px 14px",cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}>
                            <div>
                              <div style={{fontSize:12,fontWeight:700,color:"#fff"}}>{u.label}</div>
                              <div style={{fontSize:10,color:"rgba(255,255,255,.3)",marginTop:1}}>{u.email}</div>
                            </div>
                            <span style={{fontSize:9,fontWeight:700,padding:"2px 8px",borderRadius:99,background:"rgba(0,180,255,.1)",color:"#00B4FF",border:"1px solid rgba(0,180,255,.2)",flexShrink:0}}>user</span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Kicked-out banner ── */}
        {kickReason === "replaced" && (
          <div style={{background:"rgba(239,83,80,.10)",border:"1px solid rgba(239,83,80,.28)",borderRadius:12,padding:"10px 14px",fontSize:12,color:"#EF8070",marginBottom:12,lineHeight:1.5}}>
            You were signed out because this account was accessed on another device.
          </div>
        )}

        {/* ── Form ── */}
        <form onSubmit={submit} style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.09)",borderRadius:18,padding:"24px 24px",display:"flex",flexDirection:"column",gap:14}}>
          <div style={{fontSize:14,fontWeight:700,color:"#fff",marginBottom:2}}>Sign in</div>
          {err && <div style={{background:"rgba(239,83,80,.12)",border:"1px solid rgba(239,83,80,.3)",borderRadius:9,padding:"9px 12px",fontSize:12,color:"#EF5350"}}>{err}</div>}
          {alreadyLoggedIn && (
            <div style={{background:"rgba(255,165,0,.10)",border:"1px solid rgba(255,165,0,.3)",borderRadius:9,padding:"12px 14px",fontSize:12,color:"#FFA040",display:"flex",flexDirection:"column",gap:10}}>
              <div>This account is already active on another device.</div>
              <div style={{display:"flex",gap:8}}>
                <button type="button" disabled={busy} onClick={handleForceLogin}
                  style={Object.assign({},solidBtn("#FFA040"),{flex:1,fontSize:12,padding:"7px 12px",opacity:busy?0.6:1})}>
                  {busy ? "Signing in…" : "Log in anyway"}
                </button>
                <button type="button" onClick={function(){ setAlreadyLoggedIn(false); setErr(""); }}
                  style={Object.assign({},ghostBtn(),{flex:1,fontSize:12,padding:"7px 12px"})}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          <div>
            <label style={labelSt()}>Email</label>
            <input type="email" value={email} onChange={function(e){setEmail(e.target.value);}} placeholder="you@company.com"
              style={inputSt({marginBottom:0})} autoFocus autoComplete="email"/>
          </div>
          <div>
            <label style={labelSt()}>Password</label>
            <input type="password" value={pass} onChange={function(e){setPass(e.target.value);}} placeholder="••••••••"
              style={inputSt({marginBottom:0})} autoComplete="current-password"/>
          </div>
          <button type="submit" disabled={busy || alreadyLoggedIn}
            style={Object.assign({},solidBtn("#A8FF3E"),{marginTop:2,opacity:(busy||alreadyLoggedIn)?0.6:1})}>
            {busy ? "Signing in…" : "Sign In"}
          </button>
          {onShowSignup && (
            <div style={{fontSize:13,color:"rgba(255,255,255,.4)",textAlign:"center"}}>
              New to OverCard?{" "}
              <button type="button" onClick={onShowSignup}
                style={{background:"none",border:"none",color:"#00B4FF",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:600,padding:0}}>
                Create an account
              </button>
            </div>
          )}
        </form>
        <div style={{textAlign:"center",marginTop:16,fontSize:10,color:"rgba(255,255,255,.18)"}}>
          OverCard v2 · dev build
        </div>
      </div>
    </div>
  );
}

// ─── PROFILE SHEET ────────────────────────────────────────────────────────────
export function ProfileSheet({ authUser, teamName, onLogout, onClose }) {
  var desktop = useContext(DesktopCtx);
  var [busy, setBusy] = useState(false);
  function logout() {
    setBusy(true);
    var storedToken = lsGet("overcard_token");
    var headers = storedToken ? { "Authorization": "Bearer " + storedToken } : {};
    fetchWithTimeout(API_BASE + "/auth/logout", { method:"POST", credentials:"include", headers: headers }, 10000)
      .then(function(){ onLogout(); })
      .catch(function(){ onLogout(); });
  }

  var profileContent = (
    <div style={{padding:"20px 20px 24px",display:"flex",flexDirection:"column",gap:14,fontFamily:"inherit"}}>
      {/* Avatar + name */}
      <div style={{display:"flex",alignItems:"center",gap:14}}>
        <div style={{width:52,height:52,borderRadius:"50%",background:"#1565C0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,fontWeight:700,color:"#fff",flexShrink:0}}>
          {(authUser.displayName || "?")[0].toUpperCase()}
        </div>
        <div>
          <div style={{fontSize:16,fontWeight:700,color:"#fff"}}>{authUser.displayName}</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,.4)",marginTop:2}}>{authUser.email}</div>
          {authUser.phone && <div style={{fontSize:11,color:"rgba(255,255,255,.4)",marginTop:1}}>{authUser.phone}</div>}
        </div>
      </div>
      {/* Role + team */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <span style={{fontSize:10,fontWeight:700,padding:"3px 10px",borderRadius:99,background:roleMeta(authUser.role).bg,color:roleMeta(authUser.role).color,border:"1px solid "+roleMeta(authUser.role).border,textTransform:"uppercase",letterSpacing:.6}}>
          {roleMeta(authUser.role).label}
        </span>
        {authUser.orgName && <span style={{fontSize:10,padding:"3px 10px",borderRadius:99,background:"rgba(255,255,255,.06)",color:"rgba(255,255,255,.55)",border:"1px solid rgba(255,255,255,.1)"}}>🏢 {authUser.orgName}</span>}
        {teamName && <span style={{fontSize:10,padding:"3px 10px",borderRadius:99,background:"rgba(255,255,255,.06)",color:"rgba(255,255,255,.45)",border:"1px solid rgba(255,255,255,.1)"}}>{teamName}</span>}
      </div>
      <button onClick={logout} disabled={busy}
        style={Object.assign({},ghostBtn(),{padding:"11px",marginTop:4,color:"#EF5350",borderColor:"rgba(239,83,80,.3)"})}>
        {busy ? "Signing out…" : "Sign Out"}
      </button>
    </div>
  );

  if (desktop.isDesktop) {
    return (
      <DesktopModal title="Profile" width={400} onClose={onClose}>
        {profileContent}
      </DesktopModal>
    );
  }

  return (
    <div style={{position:"fixed",inset:0,zIndex:250,display:"flex",flexDirection:"column"}}>
      <div onClick={onClose} style={{flex:1,background:"rgba(0,0,0,.6)",backdropFilter:"blur(8px)"}}/>
      <div style={{background:"#081428",borderRadius:"24px 24px 0 0",border:"1px solid rgba(255,255,255,.1)",borderBottom:"none",padding:"0 0 32px",animation:"sheetUp .3s cubic-bezier(.22,1,.36,1) both",fontFamily:"inherit"}}>
        <Handle/>
        <div style={{padding:"4px 20px 20px",borderBottom:"1px solid rgba(255,255,255,.07)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{fontSize:16,fontWeight:700,color:"#fff",fontFamily:"'Lora',serif"}}>Profile</div>
          <button onClick={onClose} style={iconBtn()}>✕</button>
        </div>
        {profileContent}
      </div>
    </div>
  );
}

// ─── ADMIN PANEL ──────────────────────────────────────────────────────────────
// Role hierarchy mirrors server/routes/adminRoutes.js: owner > admin > user.
// Admins manage users; only the owner manages admins and org settings.
function canManageUser(actor, target) {
  if (actor.id === target.id) return true;
  if (actor.role === "owner") return true;
  return target.role === "user";
}

function RoleBadge({ role, size }) {
  var m = roleMeta(role);
  var big = size === "lg";
  return (
    <span style={{fontSize:big?11:9,fontWeight:700,padding:big?"2px 9px":"1px 6px",borderRadius:99,background:m.bg,color:m.color,border:"1px solid "+m.border,textTransform:"uppercase",letterSpacing:.5,flexShrink:0,whiteSpace:"nowrap"}}>{m.label}</span>
  );
}

// Clipboard with a fallback for non-secure contexts (plain-http LAN testing)
function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  return new Promise(function(resolve, reject) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); document.body.removeChild(ta);
      resolve();
    } catch (e) { reject(e); }
  });
}

function prettyCode(code) { return code.slice(0, 4) + "-" + code.slice(4); }

function inviteStatus(inv) {
  if (inv.revokedAt) return { label:"Revoked", color:"rgba(255,255,255,.35)", active:false };
  if (inv.expiresAt && inv.expiresAt <= Date.now()) return { label:"Expired", color:"#FFA040", active:false };
  if (inv.maxUses && inv.uses >= inv.maxUses) return { label:"Used up", color:"#FFA040", active:false };
  return { label:"Active", color:"#66BB6A", active:true };
}

function fmtShortDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month:"short", day:"numeric", year:"numeric" });
}

// ── Share codes: admins generate org-specific codes that employees use to sign up ──
function ShareCodesPanel({ isDesktop }) {
  var [invites, setInvites] = useState(null);
  var [expiry,  setExpiry]  = useState("7");
  var [maxUses, setMaxUses] = useState("");
  var [busy,    setBusy]    = useState(false);
  var [msg,     setMsg]     = useState(null);   // { text, error }
  var [fresh,   setFresh]   = useState(null);   // id of the code just generated
  var [showAll, setShowAll] = useState(false);

  function flash(text, error) { setMsg({ text:text, error:!!error }); setTimeout(function(){ setMsg(null); }, 3000); }
  function load() {
    apiGet("/admin/invites").then(setInvites).catch(function(){ setInvites([]); flash("Couldn't load share codes", true); });
  }
  useEffect(load, []);

  function generate() {
    setBusy(true);
    apiPost("/admin/invites", { expiresInDays: expiry ? Number(expiry) : null, maxUses: maxUses ? Number(maxUses) : null })
      .then(function(inv) { setBusy(false); setFresh(inv.id); load(); })
      .catch(function(e) { setBusy(false); flash(e.message || "Couldn't generate code", true); });
  }
  function revoke(inv) {
    if (!confirm("Revoke code " + prettyCode(inv.code) + "? Nobody will be able to sign up with it.")) return;
    apiDel("/admin/invites/" + inv.id).then(function(){ load(); flash("Code revoked"); })
      .catch(function(e){ flash(e.message || "Couldn't revoke", true); });
  }
  function copy(text, what) {
    copyText(text).then(function(){ flash(what + " copied"); }).catch(function(){ flash("Copy failed — select and copy manually", true); });
  }

  var fs = isDesktop ? { base:14, small:13, title:17, code:22 } : { base:12, small:11, title:14, code:18 };
  var list = (invites || []).filter(function(i){ return showAll || inviteStatus(i).active; });
  var inactiveCount = (invites || []).filter(function(i){ return !inviteStatus(i).active; }).length;
  var selSt = inputSt({marginBottom:0,fontSize:fs.base,padding:isDesktop?"10px 12px":"9px 10px"});

  var generator = (
    <div style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.09)",borderRadius:14,padding:isDesktop?"18px 20px":"14px"}}>
      <div style={{fontSize:fs.title,fontWeight:700,color:"#fff",marginBottom:4}}>Generate a share code</div>
      <div style={{fontSize:fs.small,color:"rgba(255,255,255,.45)",lineHeight:1.5,marginBottom:14}}>
        Employees enter the code on the sign-up screen (or open the invite link) and join this organization as users.
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
        <div>
          <label style={labelSt()}>Expires</label>
          <select value={expiry} onChange={function(e){ setExpiry(e.target.value); }} style={selSt}>
            <option value="1">In 24 hours</option>
            <option value="7">In 7 days</option>
            <option value="30">In 30 days</option>
            <option value="90">In 90 days</option>
            <option value="">Never</option>
          </select>
        </div>
        <div>
          <label style={labelSt()}>Uses</label>
          <select value={maxUses} onChange={function(e){ setMaxUses(e.target.value); }} style={selSt}>
            <option value="">Unlimited</option>
            <option value="1">1 person</option>
            <option value="5">5 people</option>
            <option value="10">10 people</option>
            <option value="25">25 people</option>
            <option value="100">100 people</option>
          </select>
        </div>
      </div>
      <button onClick={generate} disabled={busy} style={Object.assign({}, solidBtn(SESS_COLOR), {width:"100%",fontSize:fs.base,padding:isDesktop?"11px":"10px"})}>
        {busy ? "Generating…" : "+ Generate code"}
      </button>
    </div>
  );

  var listView = (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10,gap:8}}>
        <div style={{fontSize:fs.title,fontWeight:700,color:"#fff"}}>{showAll ? "All codes" : "Active codes"}{invites ? " (" + list.length + ")" : ""}</div>
        {inactiveCount > 0 && (
          <button onClick={function(){ setShowAll(!showAll); }} style={ghostSm({fontSize:fs.small})}>
            {showAll ? "Hide inactive" : "Show inactive (" + inactiveCount + ")"}
          </button>
        )}
      </div>
      {invites === null && <div style={{fontSize:fs.base,color:"rgba(255,255,255,.35)",padding:"16px 0"}}>Loading…</div>}
      {invites !== null && list.length === 0 && (
        <div style={{fontSize:fs.base,color:"rgba(255,255,255,.35)",padding:"20px",textAlign:"center",border:"1px dashed rgba(255,255,255,.12)",borderRadius:12}}>
          No active share codes. Generate one to invite your team.
        </div>
      )}
      <div style={{display:"grid",gridTemplateColumns:isDesktop?"repeat(auto-fill,minmax(320px,1fr))":"1fr",gap:10}}>
        {list.map(function(inv) {
          var st = inviteStatus(inv);
          var link = window.location.origin + "/?join=" + inv.code;
          var isFresh = inv.id === fresh;
          return (
            <div key={inv.id} style={{background:isFresh?"rgba(168,255,62,.07)":"rgba(255,255,255,.04)",border:"1px solid "+(isFresh?"rgba(168,255,62,.35)":"rgba(255,255,255,.08)"),borderRadius:12,padding:isDesktop?"14px 16px":"12px",opacity:st.active?1:.6}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:6}}>
                <span style={{fontFamily:"ui-monospace,Menlo,monospace",fontSize:fs.code,fontWeight:700,letterSpacing:2,color:"#fff"}}>{prettyCode(inv.code)}</span>
                <span style={{fontSize:fs.small - 1,fontWeight:700,color:st.color}}>● {st.label}</span>
              </div>
              <div style={{fontSize:fs.small,color:"rgba(255,255,255,.45)",lineHeight:1.6,marginBottom:st.active?10:0}}>
                {inv.uses} use{inv.uses!==1?"s":""}{inv.maxUses ? " of " + inv.maxUses : ""}
                {" · "}{inv.expiresAt ? (st.label === "Expired" ? "expired " : "expires ") + fmtShortDate(inv.expiresAt) : "never expires"}
                <br/>Created {fmtShortDate(inv.createdAt)}{inv.createdByName ? " by " + inv.createdByName : ""}
              </div>
              {st.active && (
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  <button onClick={function(){ copy(prettyCode(inv.code), "Code"); }} style={ghostSm({fontSize:fs.small,color:"#fff"})}>Copy code</button>
                  <button onClick={function(){ copy(link, "Invite link"); }} style={ghostSm({fontSize:fs.small,color:"#00B4FF",borderColor:"rgba(0,180,255,.3)"})}>Copy invite link</button>
                  <button onClick={function(){ revoke(inv); }} style={ghostSm({fontSize:fs.small,color:"#EF5350",borderColor:"rgba(239,83,80,.3)",marginLeft:"auto"})}>Revoke</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div style={{flex:1,overflowY:"auto",padding:isDesktop?"20px 24px":"12px 14px"}}>
      {msg && <div style={{marginBottom:12,background:msg.error?"rgba(239,83,80,.1)":"rgba(102,187,106,.1)",border:"1px solid "+(msg.error?"rgba(239,83,80,.3)":"rgba(102,187,106,.25)"),borderRadius:9,padding:"8px 12px",fontSize:fs.small,color:msg.error?"#EF5350":"#66BB6A"}}>{msg.text}</div>}
      {isDesktop ? (
        <div style={{display:"grid",gridTemplateColumns:"minmax(300px,380px) 1fr",gap:24,alignItems:"start"}}>
          {generator}
          {listView}
        </div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:16,paddingBottom:16}}>
          {generator}
          {listView}
        </div>
      )}
    </div>
  );
}

// ── Organization profile: every admin can view; only the owner edits or transfers ownership ──
var ORG_FORM_FIELDS = [
  { key:"name",     label:"Company name", placeholder:"Acme Inc." },
  { key:"industry", label:"Industry",     placeholder:"e.g. SaaS" },
  { key:"website",  label:"Website",      placeholder:"acme.com" },
  { key:"phone",    label:"Company phone", placeholder:"+1 555 123 4567" },
  { key:"address",  label:"Address",      placeholder:"Street, city", full:true },
];

function OrgPanel({ authUser, orgUsers, isDesktop }) {
  var isOwner = authUser.role === "owner";
  var [org,  setOrg]  = useState(null);
  var [form, setForm] = useState(null);
  var [busy, setBusy] = useState(false);
  var [msg,  setMsg]  = useState(null);
  var [transferTo, setTransferTo] = useState("");

  function flash(text, error) { setMsg({ text:text, error:!!error }); setTimeout(function(){ setMsg(null); }, 3000); }
  function toForm(o) {
    var f = {};
    ORG_FORM_FIELDS.forEach(function(d){ f[d.key] = o[d.key] || ""; });
    return f;
  }
  useEffect(function() {
    apiGet("/org").then(function(o){ setOrg(o); setForm(toForm(o)); })
      .catch(function(){ flash("Couldn't load organization", true); });
  }, []);

  function save() {
    if (!form.name.trim()) { flash("Company name is required", true); return; }
    setBusy(true);
    apiPut("/org", form)
      .then(function(o){ setBusy(false); setOrg(o); setForm(toForm(o)); flash("Organization updated"); })
      .catch(function(e){ setBusy(false); flash(e.message || "Couldn't save", true); });
  }

  function transfer() {
    var target = (orgUsers || []).find(function(u){ return u.id === transferTo; });
    if (!target) return;
    if (!confirm("Transfer ownership to " + target.displayName + "?\n\nThey become the owner and you become an admin. Only the new owner can transfer it back.")) return;
    setBusy(true);
    apiPost("/admin/transfer-ownership", { userId: target.id })
      // Roles changed on both sides — reload so the whole app picks up the new permissions
      .then(function(){ window.location.reload(); })
      .catch(function(e){ setBusy(false); flash(e.message || "Transfer failed", true); });
  }

  var fs = isDesktop ? { base:14, small:13, title:17 } : { base:12, small:11, title:14 };
  var dirty = org && form && ORG_FORM_FIELDS.some(function(d){ return (org[d.key] || "") !== form[d.key]; });
  var candidates = (orgUsers || []).filter(function(u){ return u.id !== authUser.id; })
    .sort(function(a, b){ return (isAdminRole(b.role) ? 1 : 0) - (isAdminRole(a.role) ? 1 : 0) || a.displayName.localeCompare(b.displayName); });
  var cardSt = {background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.09)",borderRadius:14,padding:isDesktop?"18px 20px":"14px"};

  if (!form) {
    return <div style={{flex:1,padding:24,fontSize:fs.base,color:"rgba(255,255,255,.35)"}}>{msg ? msg.text : "Loading…"}</div>;
  }

  var details = (
    <div style={cardSt}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:14}}>
        <div style={{fontSize:fs.title,fontWeight:700,color:"#fff"}}>Organization details</div>
        {!isOwner && <span style={{fontSize:fs.small,color:"rgba(255,255,255,.4)"}}>🔒 Only the owner can edit</span>}
      </div>
      <div style={{display:"grid",gridTemplateColumns:isDesktop?"1fr 1fr":"1fr",gap:12}}>
        {ORG_FORM_FIELDS.map(function(d) {
          return (
            <div key={d.key} style={{gridColumn:d.full?"1 / -1":undefined}}>
              <label style={labelSt()}>{d.label}</label>
              <input value={form[d.key]} disabled={!isOwner} placeholder={isOwner ? d.placeholder : "—"}
                onChange={function(e){ var v = e.target.value; setForm(function(p){ var n = Object.assign({}, p); n[d.key] = v; return n; }); }}
                style={inputSt({marginBottom:0,fontSize:fs.base,opacity:isOwner?1:.75,cursor:isOwner?"text":"default"})}/>
            </div>
          );
        })}
      </div>
      {isOwner && (
        <div style={{display:"flex",gap:8,marginTop:16}}>
          <button onClick={function(){ setForm(toForm(org)); }} disabled={!dirty || busy} style={Object.assign({}, ghostBtn(), {flex:1,padding:"10px",fontSize:fs.base})}>Discard</button>
          <button onClick={save} disabled={!dirty || busy} style={Object.assign({}, solidBtn(SESS_COLOR), {flex:2,padding:"10px",fontSize:fs.base})}>{busy ? "Saving…" : "Save changes"}</button>
        </div>
      )}
    </div>
  );

  var ownerCard = (
    <div style={cardSt}>
      <div style={{fontSize:fs.title,fontWeight:700,color:"#fff",marginBottom:12}}>Owner</div>
      {org.owner ? (
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:40,height:40,borderRadius:"50%",background:roleMeta("owner").bg,border:"1px solid "+roleMeta("owner").border,color:roleMeta("owner").color,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:16,flexShrink:0}}>
            {(org.owner.displayName || "?")[0].toUpperCase()}
          </div>
          <div style={{minWidth:0}}>
            <div style={{fontSize:fs.base,fontWeight:700,color:"#fff"}}>{org.owner.displayName}{org.owner.id === authUser.id ? " (you)" : ""}</div>
            <div style={{fontSize:fs.small,color:"rgba(255,255,255,.4)",overflow:"hidden",textOverflow:"ellipsis"}}>{org.owner.email}</div>
          </div>
        </div>
      ) : <div style={{fontSize:fs.small,color:"rgba(255,255,255,.4)"}}>No owner assigned.</div>}
      <div style={{fontSize:fs.small,color:"rgba(255,255,255,.4)",lineHeight:1.6,marginTop:12}}>
        The owner is the only one who can edit organization details, demote admins and transfer ownership. There is exactly one owner.
      </div>
      {isOwner && (
        <div style={{marginTop:16,paddingTop:14,borderTop:"1px solid rgba(255,255,255,.08)"}}>
          <label style={labelSt()}>Transfer ownership</label>
          <div style={{display:"flex",gap:8}}>
            <select value={transferTo} onChange={function(e){ setTransferTo(e.target.value); }} style={inputSt({marginBottom:0,flex:1,fontSize:fs.base})}>
              <option value="">— Choose a member —</option>
              {candidates.map(function(u){ return <option key={u.id} value={u.id}>{u.displayName} ({u.role})</option>; })}
            </select>
            <button onClick={transfer} disabled={!transferTo || busy}
              style={{background:"rgba(255,179,0,.12)",border:"1px solid rgba(255,179,0,.35)",borderRadius:12,color:"#FFB300",fontSize:fs.base,fontWeight:700,padding:"0 16px",cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>
              Transfer
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div style={{flex:1,overflowY:"auto",padding:isDesktop?"20px 24px":"12px 14px"}}>
      {msg && <div style={{marginBottom:12,background:msg.error?"rgba(239,83,80,.1)":"rgba(102,187,106,.1)",border:"1px solid "+(msg.error?"rgba(239,83,80,.3)":"rgba(102,187,106,.25)"),borderRadius:9,padding:"8px 12px",fontSize:fs.small,color:msg.error?"#EF5350":"#66BB6A"}}>{msg.text}</div>}
      <div style={{display:"grid",gridTemplateColumns:isDesktop?"1fr minmax(300px,380px)":"1fr",gap:isDesktop?24:16,alignItems:"start",paddingBottom:16}}>
        {details}
        {ownerCard}
      </div>
    </div>
  );
}

var EMPTY_UF = { email:"", firstName:"", lastName:"", phone:"", role:"user", teamId:"", password:"" };

export function AdminPanel({ authUser, orgUsers, orgTeams, onRefreshUsers, onRefreshTeams }) {
  var desktop = useContext(DesktopCtx);
  var [sub, setSub]           = useState("users");
  var [editUser, setEditUser] = useState(null);    // null | "new" | user obj
  var [editTeam, setEditTeam] = useState(null);    // null | "new" | team obj
  var [busy, setBusy]         = useState(false);
  var [msg,  setMsg]          = useState(null);    // { text, error }

  // ── user form state ──
  var [uf, setUf] = useState(EMPTY_UF);
  // ── team form state ──
  var [tf, setTf] = useState({ name:"", adminIds:[], memberIds:[] });

  var admins = (orgUsers||[]).filter(function(u){ return isAdminRole(u.role); });
  var isOwner = authUser.role === "owner";

  function resetUf() { setUf(EMPTY_UF); }
  function resetTf() { setTf({ name:"", adminIds:[], memberIds:[] }); }
  function setUfField(k, v) { setUf(function(p){ var n = Object.assign({}, p); n[k] = v; return n; }); }

  function flash(text, error) { setMsg({ text:text, error:!!error }); setTimeout(function(){ setMsg(null); }, 3500); }

  function openUser(u) {
    setUf({ email:u.email, firstName:u.firstName||"", lastName:u.lastName||"", phone:u.phone||"", role:u.role, teamId:u.teamId||"", password:"" });
    setEditUser(u);
  }

  // ── users ──
  function saveUser() {
    if (!uf.firstName.trim() || !uf.lastName.trim()) { flash("First and last name are required", true); return; }
    var isNew = editUser === "new";
    if (isNew && (!uf.email.trim() || !uf.password || !uf.phone.trim())) { flash("Email, phone and password are required", true); return; }
    if (isNew && (uf.password.length < 8 || !/[A-Z]/.test(uf.password) || !/[0-9]/.test(uf.password))) {
      flash("Password must be 8+ characters with an uppercase letter and a digit", true); return;
    }
    setBusy(true);
    var body = { firstName:uf.firstName.trim(), lastName:uf.lastName.trim(), phone:uf.phone.trim(), teamId:uf.teamId||null };
    // Only send a role change the caller is allowed to make; the server re-checks every rule
    if (isNew || (uf.role !== editUser.role && editUser.role !== "owner" && editUser.id !== authUser.id)) body.role = uf.role;
    var p = isNew
      ? apiPost("/admin/users", Object.assign(body, { email:uf.email.trim(), password:uf.password }))
      : apiPut("/admin/users/" + editUser.id, body);
    p.then(function(){ setBusy(false); setEditUser(null); resetUf(); onRefreshUsers(); onRefreshTeams(); flash(isNew?"User created":"User updated"); })
     .catch(function(e){ setBusy(false); flash(e.message||"Error saving user", true); });
  }

  function resetPassword(user) {
    var pw = prompt("New password for " + user.displayName + " (8+ chars, 1 uppercase, 1 digit):");
    if (!pw) return;
    // Mirror the server's password policy so admins get a specific message
    if (pw.length < 8 || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw)) {
      flash("Password must be 8+ characters with an uppercase letter and a digit", true);
      return;
    }
    apiPost("/admin/users/" + user.id + "/reset-password", { password: pw })
      .then(function(){ flash("Password reset for " + user.displayName); })
      .catch(function(e){ flash(e.message || "Error resetting password", true); });
  }

  function deleteUserConfirm(user) {
    if (!confirm("Delete " + user.displayName + "? This cannot be undone.")) return;
    apiDel("/admin/users/" + user.id)
      .then(function(){ onRefreshUsers(); flash("User deleted"); })
      .catch(function(e){ flash(e.message || "Error deleting user", true); });
  }

  // ── teams ──
  var [addMemberSel, setAddMemberSel] = useState("");

  function saveTeam() {
    if (!tf.name.trim()) { flash("Team name is required", true); return; }
    if (!tf.adminIds.length) { flash("At least one admin must be assigned", true); return; }
    setBusy(true);
    var isNew = editTeam === "new";
    var p = isNew
      ? apiPost("/admin/teams", { name:tf.name.trim(), adminIds:tf.adminIds, memberIds:tf.memberIds })
      : apiPut("/admin/teams/" + editTeam.id, { name:tf.name.trim(), adminIds:tf.adminIds, memberIds:tf.memberIds });
    p.then(function(){ setBusy(false); setEditTeam(null); resetTf(); setAddMemberSel(""); onRefreshUsers(); onRefreshTeams(); flash(isNew?"Team created":"Team updated"); })
     .catch(function(e){ setBusy(false); flash(e.message||"Error saving team", true); });
  }

  function deleteTeamConfirm(team) {
    if (!confirm("Delete team \"" + team.name + "\"? Users won't be deleted.")) return;
    apiDel("/admin/teams/" + team.id)
      .then(function(){ onRefreshTeams(); flash("Team deleted"); })
      .catch(function(e){ flash(e.message || "Error deleting team", true); });
  }

  function toggleAdminId(uid) {
    setTf(function(p){
      var has = p.adminIds.includes(uid);
      return Object.assign({},p,{ adminIds: has ? p.adminIds.filter(function(x){return x!==uid;}) : p.adminIds.concat([uid]) });
    });
  }

  function toggleMemberId(uid) {
    setTf(function(f) {
      return Object.assign({},f,{ memberIds: f.memberIds.includes(uid) ? f.memberIds.filter(function(x){return x!==uid;}) : f.memberIds.concat([uid]) });
    });
  }

  var D  = desktop.isDesktop;
  // Tablet (compact desktop): one step smaller type, 44px targets; in portrait the
  // users/teams list and the editor stack (list → detail with a back button)
  var compact  = !!(D && desktop.compact);
  var stackedA = compact && !desktop.splitPanes;
  var fs = D ? (compact ? { base:13, small:12, title:17, tab:13 } : { base:14, small:13, title:18, tab:14 }) : { base:12, small:10, title:13, tab:11 };

  // Desktop shows full labels; the 390px mobile bar needs the short ones
  var SUBS = [["users","👥 Users","Users"],["teams","🏷️ Teams","Teams"],["codes","🔑 Share Codes","🔑 Codes"],["org","🏢 Organization","🏢 Org"]];
  function renderSubTabBar(style) {
    return (
      <div style={Object.assign({display:"flex",background:"rgba(255,255,255,.05)",borderRadius:10,padding:2,gap:1},style||{})}>
        {SUBS.map(function(s){
          var on = sub===s[0];
          return <button key={s[0]} onClick={function(){setSub(s[0]);setEditUser(null);setEditTeam(null);}}
            style={{flex:1,background:on?"rgba(255,255,255,.12)":"transparent",border:"none",borderRadius:8,padding:D?(compact?"9px 10px":"9px 14px"):"7px 2px",minHeight:compact?44:undefined,cursor:"pointer",fontFamily:"inherit",color:on?"#fff":"rgba(255,255,255,.4)",fontSize:fs.tab,fontWeight:on?700:500,whiteSpace:"nowrap"}}>{D ? s[1] : s[2]}</button>;
        })}
      </div>
    );
  }

  var msgBanner = msg && (
    <div style={{margin:D?"12px 24px 0":"8px 14px 0",background:msg.error?"rgba(239,83,80,.1)":"rgba(102,187,106,.1)",border:"1px solid "+(msg.error?"rgba(239,83,80,.3)":"rgba(102,187,106,.25)"),borderRadius:9,padding:"8px 12px",fontSize:fs.small,color:msg.error?"#EF5350":"#66BB6A",flexShrink:0}}>{msg.text}</div>
  );

  // ── Shared user form (desktop right pane / mobile inline card) ──
  function renderUserForm() {
    var isNew   = editUser === "new";
    var target  = isNew ? null : editUser;
    var canEdit = isNew || canManageUser(authUser, target);
    var roleLocked = !isNew && (target.role === "owner" || target.id === authUser.id);
    var gap = D ? 14 : 9;
    var inp = function(k, extra) {
      return inputSt(Object.assign({marginBottom:0,fontSize:D?14:13}, compact ? {minHeight:44} : {}, extra||{}));
    };
    if (!canEdit) {
      return (
        <div style={{fontSize:fs.base,color:"rgba(255,255,255,.55)",lineHeight:1.6}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
            <span style={{fontSize:fs.title,fontWeight:700,color:"#fff"}}>{target.displayName}</span>
            <RoleBadge role={target.role} size={D?"lg":undefined}/>
          </div>
          <div>{target.email}{target.phone ? " · " + target.phone : ""}</div>
          <div style={{marginTop:12,padding:"10px 12px",background:"rgba(255,179,0,.08)",border:"1px solid rgba(255,179,0,.25)",borderRadius:10,color:"#FFB300",fontSize:fs.small}}>
            🔒 Only the organization owner can modify {target.role === "owner" ? "the owner" : "admins"}.
          </div>
        </div>
      );
    }
    return (
      <div style={{display:"flex",flexDirection:"column",gap:gap}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:D?12:8}}>
          <div>
            <label style={labelSt()}>First name</label>
            <input value={uf.firstName} onChange={function(e){setUfField("firstName", e.target.value);}} style={inp()}/>
          </div>
          <div>
            <label style={labelSt()}>Last name</label>
            <input value={uf.lastName} onChange={function(e){setUfField("lastName", e.target.value);}} style={inp()}/>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:D?"1fr 1fr":"1fr",gap:D?12:gap}}>
          <div>
            <label style={labelSt()}>Email</label>
            {isNew
              ? <input type="email" value={uf.email} onChange={function(e){setUfField("email", e.target.value);}} placeholder="email@company.com" style={inp()}/>
              : <div style={{fontSize:D?14:13,color:"rgba(255,255,255,.6)",padding:"11px 0"}}>{uf.email}</div>}
          </div>
          <div>
            <label style={labelSt()}>Phone</label>
            <input type="tel" value={uf.phone} onChange={function(e){setUfField("phone", e.target.value);}} placeholder="+1 555 123 4567" style={inp()}/>
          </div>
        </div>
        {isNew && (
          <div>
            <label style={labelSt()}>Password</label>
            <input type="password" value={uf.password} onChange={function(e){setUfField("password", e.target.value);}} placeholder="8+ chars, 1 uppercase, 1 digit" style={inp()}/>
          </div>
        )}
        <div>
          <label style={labelSt()}>Role</label>
          {roleLocked ? (
            <div style={{display:"flex",alignItems:"center",gap:8,fontSize:fs.small,color:"rgba(255,255,255,.4)"}}>
              <RoleBadge role={target.role} size={D?"lg":undefined}/>
              {target.role === "owner" ? "Change via Organization → Transfer ownership" : "You can't change your own role"}
            </div>
          ) : (
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {["user","admin"].map(function(r){
                var on = uf.role===r;
                var m  = roleMeta(r);
                // Demoting an admin is owner-only; promoting is open to every admin
                var blocked = !isNew && target.role === "admin" && r === "user" && !isOwner;
                return <button key={r} disabled={blocked} onClick={function(){setUfField("role", r);}}
                  title={blocked ? "Only the owner can demote admins" : undefined}
                  style={{background:on?m.bg:"rgba(255,255,255,.05)",border:"1px solid "+(on?m.border:"rgba(255,255,255,.1)"),borderRadius:8,padding:D?"8px 20px":"6px 16px",cursor:"pointer",fontFamily:"inherit",fontSize:D?13:12,color:on?m.color:"rgba(255,255,255,.45)",fontWeight:on?700:500}}>{m.label}</button>;
              })}
            </div>
          )}
          {!roleLocked && !isNew && target.role === "user" && uf.role === "admin" && (
            <div style={{fontSize:fs.small,color:"#A8FF3E",marginTop:6}}>Promoting to admin — they'll be able to edit decks and manage users.</div>
          )}
          {!roleLocked && !isNew && target.role === "admin" && uf.role === "user" && (
            <div style={{fontSize:fs.small,color:"#FFA040",marginTop:6}}>Demoting to user — they'll lose admin access and team-admin assignments.</div>
          )}
        </div>
        <div>
          <label style={labelSt()}>Team Assignment</label>
          <select value={uf.teamId||""} onChange={function(e){setUfField("teamId", e.target.value);}} style={inp()}>
            <option value="">— None —</option>
            {(orgTeams||[]).map(function(t){ return <option key={t.id} value={t.id}>{t.name}</option>; })}
          </select>
        </div>
        <div style={{display:"flex",gap:8,marginTop:4}}>
          <button onClick={function(){setEditUser(null);resetUf();}} style={Object.assign({},ghostBtn(),{flex:1,padding:D?"10px":"8px",fontSize:D?14:12})}>Cancel</button>
          <button onClick={saveUser} disabled={busy} style={Object.assign({},solidBtn(SESS_COLOR),{flex:2,padding:D?"10px":"8px",fontSize:D?14:12})}>{busy?"Saving…":isNew?"Create user":"Save"}</button>
        </div>
        {!isNew && (
          <div style={{display:"flex",gap:8}}>
            {target.id !== authUser.id && <button onClick={function(){resetPassword(target);}}
              style={{flex:1,background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.12)",borderRadius:10,padding:D?"10px":"8px",cursor:"pointer",fontSize:D?13:12,color:"rgba(255,255,255,.65)",fontFamily:"inherit"}}>
              🔑 Reset Password
            </button>}
            {target.id !== authUser.id && target.role !== "owner" && (
              <button onClick={function(){deleteUserConfirm(target); setEditUser(null); resetUf();}}
                style={{flex:1,background:"rgba(239,83,80,.07)",border:"1px solid rgba(239,83,80,.2)",borderRadius:10,padding:D?"10px":"8px",cursor:"pointer",fontSize:D?13:12,color:"#EF5350",fontFamily:"inherit"}}>
                ✕ Delete User
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Shared team form ──
  function renderTeamForm() {
    var available = (orgUsers||[]).filter(function(u){ return !tf.memberIds.includes(u.id); });
    return (
      <div style={{display:"flex",flexDirection:"column",gap:D?14:10}}>
        <div>
          <label style={labelSt()}>Team Name</label>
          <input value={tf.name} onChange={function(e){setTf(function(p){return Object.assign({},p,{name:e.target.value});});}} placeholder="e.g. West Coast" style={inputSt({marginBottom:0,fontSize:D?14:13})}/>
        </div>
        <div>
          <label style={labelSt()}>Assigned Admins <span style={{color:"#EF5350",fontSize:9}}>required</span></label>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {admins.map(function(a){
              var on = tf.adminIds.includes(a.id);
              return <button key={a.id} onClick={function(){toggleAdminId(a.id);}}
                style={{background:on?"rgba(168,255,62,.15)":"rgba(255,255,255,.05)",border:"1px solid "+(on?"rgba(168,255,62,.4)":"rgba(255,255,255,.1)"),borderRadius:8,padding:D?"7px 14px":"5px 11px",cursor:"pointer",fontFamily:"inherit",fontSize:D?13:11,color:on?SESS_COLOR:"rgba(255,255,255,.45)",fontWeight:on?700:400}}>{a.displayName}</button>;
            })}
          </div>
        </div>
        <div>
          <label style={labelSt()}>Members</label>
          {tf.memberIds.length > 0 && (
            <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:8}}>
              {tf.memberIds.map(function(uid){
                var u = (orgUsers||[]).find(function(x){return x.id===uid;});
                if (!u) return null;
                return (
                  <span key={uid} style={{display:"inline-flex",alignItems:"center",gap:4,background:"rgba(0,180,255,.1)",border:"1px solid rgba(0,180,255,.25)",borderRadius:99,padding:D?"4px 10px":"3px 8px",fontSize:D?13:10,color:"#00B4FF"}}>
                    {u.displayName}
                    <button onClick={function(){toggleMemberId(uid);}} style={{background:"none",border:"none",cursor:"pointer",color:"rgba(0,180,255,.6)",fontSize:D?14:11,padding:"0 0 0 2px",fontFamily:"inherit",lineHeight:1}}>×</button>
                  </span>
                );
              })}
            </div>
          )}
          {available.length > 0 && (
            <div style={{display:"flex",gap:6}}>
              <select value={addMemberSel} onChange={function(e){setAddMemberSel(e.target.value);}}
                style={inputSt({margin:0,flex:1,fontSize:D?14:12,padding:"7px 10px"})}>
                <option value="">— Add member —</option>
                {available.map(function(u){ return <option key={u.id} value={u.id}>{u.displayName} ({u.role})</option>; })}
              </select>
              <button onClick={function(){ if (!addMemberSel) return; toggleMemberId(addMemberSel); setAddMemberSel(""); }}
                style={ghostSm({color:SESS_COLOR,borderColor:"rgba(168,255,62,.3)",fontSize:D?13:12,padding:"7px 12px"})}>+ Add</button>
            </div>
          )}
          {tf.memberIds.length === 0 && (
            <div style={{fontSize:fs.small,color:"rgba(255,255,255,.3)",marginTop:6}}>{available.length ? "No members assigned yet." : "No users available."}</div>
          )}
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={function(){setEditTeam(null);resetTf();}} style={Object.assign({},ghostBtn(),{flex:1,padding:D?"10px":"8px",fontSize:D?14:12})}>Cancel</button>
          <button onClick={saveTeam} disabled={busy} style={Object.assign({},solidBtn(SESS_COLOR),{flex:2,padding:D?"10px":"8px",fontSize:D?14:12})}>{busy?"Saving…":"Save"}</button>
        </div>
        {editTeam !== "new" && (
          <button onClick={function(){deleteTeamConfirm(editTeam); setEditTeam(null); resetTf();}}
            style={{width:"100%",background:"rgba(239,83,80,.07)",border:"1px solid rgba(239,83,80,.2)",borderRadius:10,padding:D?"10px":"8px",cursor:"pointer",fontSize:D?13:12,color:"#EF5350",fontFamily:"inherit"}}>
            ✕ Delete Team
          </button>
        )}
      </div>
    );
  }

  // Owner first, then admins, then users — alphabetical within each
  var ROLE_ORDER = { owner:0, admin:1, user:2 };
  var sortedUsers = (orgUsers||[]).slice().sort(function(a, b){
    return (ROLE_ORDER[a.role] - ROLE_ORDER[b.role]) || a.displayName.localeCompare(b.displayName);
  });
  function teamsOf(u) {
    return (u.teamIds||[]).map(function(tid){ return (orgTeams||[]).find(function(t){return t.id===tid;}); }).filter(Boolean);
  }

  if (D) {
    var listPane = null, detailPane = null;
    if (sub === "users") {
      listPane = (
        <div>
          <button onClick={function(){resetUf();setEditUser("new");}}
            style={{display:"block",width:"100%",background:"rgba(168,255,62,.06)",border:"1px dashed rgba(168,255,62,.25)",borderRadius:10,padding:"10px",minHeight:compact?44:undefined,cursor:"pointer",fontSize:14,color:"rgba(168,255,62,.8)",fontFamily:"inherit",marginBottom:10,textAlign:"center",fontWeight:600}}>
            + New User
          </button>
          {sortedUsers.map(function(u) {
            var sel = editUser && editUser !== "new" && editUser.id === u.id;
            var m = roleMeta(u.role);
            return (
              <button key={u.id} onClick={function(){ openUser(u); }}
                style={{display:"flex",alignItems:"center",gap:12,width:"100%",textAlign:"left",background:sel?"rgba(255,255,255,.1)":"rgba(255,255,255,.035)",border:"1.5px solid "+(sel?"rgba(255,255,255,.22)":"rgba(255,255,255,.06)"),borderRadius:12,padding:"10px 12px",marginBottom:6,cursor:"pointer",fontFamily:"inherit"}}>
                <div style={{width:38,height:38,borderRadius:"50%",background:m.bg,border:"1px solid "+m.border,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:700,color:m.color,flexShrink:0}}>
                  {(u.displayName || "?")[0].toUpperCase()}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontSize:14,fontWeight:700,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.displayName}{u.id === authUser.id ? " (you)" : ""}</span>
                  </div>
                  <div style={{fontSize:12,color:"rgba(255,255,255,.4)",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.email}</div>
                </div>
                <RoleBadge role={u.role}/>
              </button>
            );
          })}
        </div>
      );
      detailPane = editUser ? (
        <div style={{flex:1,overflowY:"auto",padding:compact?"16px 18px":"24px 28px"}}>
          <div style={{maxWidth:620}}>
            <div style={{fontSize:compact?18:20,fontWeight:700,color:"#fff",marginBottom:4}}>{editUser==="new" ? "New User" : editUser.displayName}</div>
            {editUser !== "new" && (
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:18}}>
                <RoleBadge role={editUser.role} size="lg"/>
                {teamsOf(editUser).map(function(t){ return <span key={t.id} style={{fontSize:12,padding:"2px 9px",borderRadius:99,background:"rgba(255,255,255,.07)",color:"rgba(255,255,255,.55)",border:"1px solid rgba(255,255,255,.12)"}}>{t.name}</span>; })}
                {editUser.lastLoginAt && <span style={{fontSize:12,color:"rgba(255,255,255,.35)"}}>Last login {fmtShortDate(editUser.lastLoginAt)}</span>}
              </div>
            )}
            {editUser === "new" && <div style={{fontSize:13,color:"rgba(255,255,255,.4)",marginBottom:18}}>Or generate a share code so they can sign up themselves.</div>}
            {renderUserForm()}
          </div>
        </div>
      ) : (
        <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:10,color:"rgba(255,255,255,.25)"}}>
          <span style={{fontSize:40}}>👥</span>
          <span style={{fontSize:15}}>Select a user to view or edit</span>
          <span style={{fontSize:13,color:"rgba(255,255,255,.2)"}}>{sortedUsers.length} member{sortedUsers.length!==1?"s":""} · {admins.length} with admin access</span>
        </div>
      );
    } else if (sub === "teams") {
      listPane = (
        <div>
          <button onClick={function(){resetTf();setEditTeam("new");}}
            style={{display:"block",width:"100%",background:"rgba(168,255,62,.06)",border:"1px dashed rgba(168,255,62,.25)",borderRadius:10,padding:"10px",minHeight:compact?44:undefined,cursor:"pointer",fontSize:14,color:"rgba(168,255,62,.8)",fontFamily:"inherit",marginBottom:10,textAlign:"center",fontWeight:600}}>
            + New Team
          </button>
          {(orgTeams||[]).map(function(team) {
            var sel = editTeam && editTeam !== "new" && editTeam.id === team.id;
            var mc = (team.memberIds||[]).length;
            return (
              <button key={team.id}
                onClick={function(){ setTf({name:team.name,adminIds:team.adminIds||[],memberIds:team.memberIds||[]}); setAddMemberSel(""); setEditTeam(team); }}
                style={{display:"flex",alignItems:"center",gap:12,width:"100%",textAlign:"left",background:sel?"rgba(255,255,255,.1)":"rgba(255,255,255,.035)",border:"1.5px solid "+(sel?"rgba(255,255,255,.22)":"rgba(255,255,255,.06)"),borderRadius:12,padding:"12px",marginBottom:6,cursor:"pointer",fontFamily:"inherit"}}>
                <span style={{fontSize:20,flexShrink:0}}>🏷️</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:14,fontWeight:700,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{team.name}</div>
                  <div style={{fontSize:12,color:"rgba(255,255,255,.4)",marginTop:2}}>{mc} member{mc!==1?"s":""} · {(team.adminIds||[]).length} admin{(team.adminIds||[]).length!==1?"s":""}</div>
                </div>
              </button>
            );
          })}
        </div>
      );
      detailPane = editTeam ? (
        <div style={{flex:1,overflowY:"auto",padding:compact?"16px 18px":"24px 28px"}}>
          <div style={{maxWidth:620}}>
            <div style={{fontSize:compact?18:20,fontWeight:700,color:"#fff",marginBottom:18}}>{editTeam==="new"?"New Team":editTeam.name}</div>
            {renderTeamForm()}
          </div>
        </div>
      ) : (
        <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:10,color:"rgba(255,255,255,.25)"}}>
          <span style={{fontSize:40}}>🏷️</span>
          <span style={{fontSize:15}}>Select a team to edit</span>
        </div>
      );
    }

    // Stacked (tablet portrait): list OR detail, never both
    var hasDetail = sub === "users" ? !!editUser : sub === "teams" ? !!editTeam : false;
    var showListA   = !stackedA || !hasDetail;
    var showDetailA = !stackedA || hasDetail;
    function backToList() {
      if (sub === "users") { setEditUser(null); resetUf(); }
      else { setEditTeam(null); resetTf(); setAddMemberSel(""); }
    }

    return (
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{padding:compact?"10px 16px":"14px 24px",flexShrink:0,borderBottom:"1px solid rgba(255,255,255,.06)",display:"flex",alignItems:"center",gap:compact?12:16}}>
          {renderSubTabBar({flex:"0 1 680px"})}
          {!stackedA && (
            <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8,fontSize:13,color:"rgba(255,255,255,.45)",whiteSpace:"nowrap"}}>
              Signed in as <RoleBadge role={authUser.role} size="lg"/>
            </div>
          )}
        </div>
        {msgBanner}
        {sub === "codes" && <ShareCodesPanel isDesktop={true}/>}
        {sub === "org"   && <OrgPanel authUser={authUser} orgUsers={orgUsers} isDesktop={true}/>}
        {(sub === "users" || sub === "teams") && (
          <div style={{flex:1,display:"flex",overflow:"hidden",minHeight:0}}>
            {showListA && (
              <div style={stackedA
                ? {flex:1,overflowY:"auto",padding:"12px 16px"}
                : {width:compact?320:360,minWidth:compact?320:360,overflowY:"auto",padding:"12px 14px",borderRight:"1px solid rgba(255,255,255,.06)"}}>
                {listPane}
              </div>
            )}
            {showDetailA && (
              <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:"rgba(8,20,50,.2)"}}>
                {stackedA && (
                  <div style={{flexShrink:0,display:"flex",alignItems:"center",padding:"6px 12px",borderBottom:"1px solid rgba(255,255,255,.06)"}}>
                    <button onClick={backToList} aria-label={"Back to " + (sub === "users" ? "users" : "teams")}
                      style={{minHeight:44,display:"flex",alignItems:"center",gap:8,background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",borderRadius:10,padding:"0 14px",color:"rgba(255,255,255,.75)",fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                      <span aria-hidden="true">←</span> {sub === "users" ? "Users" : "Teams"}
                    </button>
                  </div>
                )}
                {detailPane}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {/* Sub-tab bar */}
      <div style={{flexShrink:0,padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,.07)"}}>
        <div style={{fontSize:10,fontWeight:700,color:SESS_COLOR,letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>Admin Panel</div>
        {renderSubTabBar()}
      </div>

      {msgBanner}

      {sub === "codes" && <ShareCodesPanel isDesktop={false}/>}
      {sub === "org"   && <OrgPanel authUser={authUser} orgUsers={orgUsers} isDesktop={false}/>}

      {(sub === "users" || sub === "teams") && (
      <div style={{flex:1,overflowY:"auto",padding:"12px 14px 0"}}>

        {/* ── USERS ── */}
        {sub==="users" && (
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <SectionHdr style={{margin:0}}>Users ({sortedUsers.length})</SectionHdr>
              <button onClick={function(){resetUf();setEditUser("new");}} style={Object.assign({},ghostSm(),{fontSize:11})}>+ New User</button>
            </div>

            {editUser && (
              <div style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.1)",borderRadius:12,padding:"14px",marginBottom:14}}>
                <div style={{fontSize:13,fontWeight:700,color:"#fff",marginBottom:12}}>{editUser==="new"?"New User":"Edit: "+editUser.displayName}</div>
                {renderUserForm()}
              </div>
            )}

            <div style={{display:"flex",flexDirection:"column",gap:7}}>
              {sortedUsers.map(function(u){
                var manageable = canManageUser(authUser, u);
                var m = roleMeta(u.role);
                return (
                  <div key={u.id} style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.07)",borderRadius:10,padding:"11px 12px",display:"flex",alignItems:"center",gap:10}}>
                    <div style={{width:34,height:34,borderRadius:"50%",background:m.bg,border:"1px solid "+m.border,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:m.color,flexShrink:0}}>
                      {(u.displayName || "?")[0].toUpperCase()}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                        <span style={{fontSize:12,fontWeight:700,color:"#fff"}}>{u.displayName}</span>
                        <RoleBadge role={u.role}/>
                        {teamsOf(u).map(function(t){
                          return <span key={t.id} style={{fontSize:9,padding:"1px 6px",borderRadius:99,background:"rgba(255,255,255,.07)",color:"rgba(255,255,255,.45)",border:"1px solid rgba(255,255,255,.12)"}}>{t.name}</span>;
                        })}
                      </div>
                      <div style={{fontSize:10,color:"rgba(255,255,255,.35)",marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.email}{u.phone ? " · " + u.phone : ""}</div>
                    </div>
                    <div style={{display:"flex",gap:5,flexShrink:0}}>
                      <button onClick={function(){ openUser(u); }} title={manageable ? "Edit" : "View"}
                        style={{background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",borderRadius:7,padding:"4px 8px",cursor:"pointer",fontSize:10,color:"rgba(255,255,255,.5)",fontFamily:"inherit"}}>{manageable ? "✏" : "👁"}</button>
                      {manageable && u.id !== authUser.id && <button onClick={function(){resetPassword(u);}} title="Reset password"
                        style={{background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",borderRadius:7,padding:"4px 8px",cursor:"pointer",fontSize:10,color:"rgba(255,255,255,.5)",fontFamily:"inherit"}}>🔑</button>}
                      {manageable && u.id !== authUser.id && u.role !== "owner" && <button onClick={function(){deleteUserConfirm(u);}} title="Delete"
                        style={{background:"rgba(239,83,80,.07)",border:"1px solid rgba(239,83,80,.2)",borderRadius:7,padding:"4px 8px",cursor:"pointer",fontSize:10,color:"#EF5350",fontFamily:"inherit"}}>✕</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── TEAMS ── */}
        {sub==="teams" && (
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <SectionHdr style={{margin:0}}>Teams ({(orgTeams||[]).length})</SectionHdr>
              <button onClick={function(){resetTf();setEditTeam("new");}} style={Object.assign({},ghostSm(),{fontSize:11})}>+ New Team</button>
            </div>

            {editTeam && (
              <div style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.1)",borderRadius:12,padding:"14px",marginBottom:14}}>
                <div style={{fontSize:13,fontWeight:700,color:"#fff",marginBottom:12}}>{editTeam==="new"?"New Team":"Edit: "+editTeam.name}</div>
                {renderTeamForm()}
              </div>
            )}

            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {(orgTeams||[]).filter(function(t){ return editTeam === "new" || !editTeam || editTeam.id !== t.id; }).map(function(team){
                var memberCount = (team.memberIds||[]).length;
                var teamAdmins  = admins.filter(function(a){ return (team.adminIds||[]).includes(a.id); });
                return (
                  <div key={team.id} style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.07)",borderRadius:10,padding:"12px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                      <div style={{fontSize:13,fontWeight:700,color:"#fff"}}>{team.name}</div>
                      <div style={{display:"flex",gap:5}}>
                        <button onClick={function(){setTf({name:team.name,adminIds:team.adminIds||[],memberIds:team.memberIds||[]});setAddMemberSel("");setEditTeam(team);}}
                          style={{background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",borderRadius:7,padding:"4px 8px",cursor:"pointer",fontSize:10,color:"rgba(255,255,255,.5)",fontFamily:"inherit"}}>✏</button>
                        <button onClick={function(){deleteTeamConfirm(team);}}
                          style={{background:"rgba(239,83,80,.07)",border:"1px solid rgba(239,83,80,.2)",borderRadius:7,padding:"4px 8px",cursor:"pointer",fontSize:10,color:"#EF5350",fontFamily:"inherit"}}>✕</button>
                      </div>
                    </div>
                    <div style={{fontSize:10,color:"rgba(255,255,255,.35)"}}>{memberCount} member{memberCount!==1?"s":""}</div>
                    <div style={{display:"flex",gap:5,flexWrap:"wrap",marginTop:6}}>
                      {teamAdmins.map(function(a){
                        return <span key={a.id} style={{fontSize:9,padding:"2px 8px",borderRadius:99,background:"rgba(168,255,62,.1)",color:SESS_COLOR,border:"1px solid rgba(168,255,62,.25)"}}>{a.displayName}</span>;
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div style={{height:16}}/>
      </div>
      )}
    </div>
  );
}
