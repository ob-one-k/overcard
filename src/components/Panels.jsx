import { useState, useEffect, useRef, useContext } from "react";
import { TM, DECK_COLORS, DECK_ICONS, SESS_COLOR } from "../lib/constants";
import { apiGet, apiPost, apiPut, apiDel, setStoredToken, API_BASE } from "../lib/api";
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
      { label:"Alex Mercer",    email:"alex@apexsales.com"    },
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
      { label:"Casey Wright", email:"casey@meridiangroup.com" },
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

export function LoginScreen({ onLogin, kickReason }) {
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
        setErr(e.message || "Login failed");
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
                      <span style={{fontSize:9,fontWeight:700,padding:"2px 8px",borderRadius:99,background:"rgba(168,255,62,.15)",color:SESS_COLOR,border:"1px solid rgba(168,255,62,.25)",flexShrink:0}}>admin</span>
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
    var storedToken = localStorage.getItem("overcard_token");
    var headers = storedToken ? { "Authorization": "Bearer " + storedToken } : {};
    fetch(API_BASE + "/auth/logout", { method:"POST", credentials:"include", headers: headers })
      .then(function(){ onLogout(); })
      .catch(function(){ onLogout(); });
  }

  var profileContent = (
    <div style={{padding:"20px 20px 24px",display:"flex",flexDirection:"column",gap:14,fontFamily:"inherit"}}>
      {/* Avatar + name */}
      <div style={{display:"flex",alignItems:"center",gap:14}}>
        <div style={{width:52,height:52,borderRadius:"50%",background:"#1565C0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,fontWeight:700,color:"#fff",flexShrink:0}}>
          {authUser.displayName[0].toUpperCase()}
        </div>
        <div>
          <div style={{fontSize:16,fontWeight:700,color:"#fff"}}>{authUser.displayName}</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,.4)",marginTop:2}}>{authUser.email}</div>
        </div>
      </div>
      {/* Role + team */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <span style={{fontSize:10,fontWeight:700,padding:"3px 10px",borderRadius:99,background:authUser.role==="admin"?"rgba(168,255,62,.18)":"rgba(0,180,255,.1)",color:authUser.role==="admin"?SESS_COLOR:"#00B4FF",border:"1px solid "+(authUser.role==="admin"?"rgba(168,255,62,.3)":"rgba(0,180,255,.2)"),textTransform:"uppercase",letterSpacing:.6}}>
          {authUser.role}
        </span>
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
export function AdminPanel({ authUser, orgUsers, orgTeams, onRefreshUsers, onRefreshTeams }) {
  var [sub, setSub]           = useState("users");
  var [editUser, setEditUser] = useState(null);    // null | "new" | user obj
  var [editTeam, setEditTeam] = useState(null);    // null | "new" | team obj
  var [busy, setBusy]         = useState(false);
  var [msg,  setMsg]          = useState("");

  // ── user form state ──
  var [uf, setUf] = useState({ email:"", displayName:"", role:"user", teamId:"", password:"" });
  // ── team form state ──
  var [tf, setTf] = useState({ name:"", adminIds:[], memberIds:[] });

  var admins = (orgUsers||[]).filter(function(u){ return u.role==="admin"; });

  function resetUf() { setUf({ email:"", displayName:"", role:"user", teamId:"", password:"" }); }
  function resetTf() { setTf({ name:"", adminIds:[], memberIds:[] }); }

  function flash(m) { setMsg(m); setTimeout(function(){ setMsg(""); }, 3000); }

  // ── users ──
  function saveUser() {
    if (!uf.displayName.trim()) { flash("Display name is required"); return; }
    if (editUser === "new" && (!uf.email.trim() || !uf.password)) { flash("Email and password required"); return; }
    setBusy(true);
    var p = editUser === "new"
      ? apiPost("/admin/users", { email:uf.email.trim(), displayName:uf.displayName.trim(), role:uf.role, teamId:uf.teamId||null, password:uf.password })
      : apiPut("/admin/users/" + editUser.id, { displayName:uf.displayName.trim(), role:uf.role, teamId:uf.teamId||null });
    p.then(function(){ setBusy(false); setEditUser(null); resetUf(); onRefreshUsers(); flash(editUser==="new"?"User created":"User updated"); })
     .catch(function(e){ setBusy(false); flash(e.message||"Error saving user"); });
  }

  function resetPassword(user) {
    var pw = prompt("New password for " + user.displayName + " (min 6 chars):");
    if (!pw || pw.length < 6) return;
    apiPost("/admin/users/" + user.id + "/reset-password", { password: pw })
      .then(function(){ flash("Password reset for " + user.displayName); })
      .catch(function(){ flash("Error resetting password"); });
  }

  function deleteUserConfirm(user) {
    if (!confirm("Delete " + user.displayName + "? This cannot be undone.")) return;
    apiDel("/admin/users/" + user.id)
      .then(function(){ onRefreshUsers(); flash("User deleted"); })
      .catch(function(){ flash("Error deleting user"); });
  }

  // ── teams ──
  var [addMemberSel, setAddMemberSel] = useState("");

  function saveTeam() {
    if (!tf.name.trim()) { flash("Team name is required"); return; }
    if (!tf.adminIds.length) { flash("At least one admin must be assigned"); return; }
    setBusy(true);
    var isNew = editTeam === "new";
    var p = isNew
      ? apiPost("/admin/teams", { name:tf.name.trim(), adminIds:tf.adminIds, memberIds:tf.memberIds })
      : apiPut("/admin/teams/" + editTeam.id, { name:tf.name.trim(), adminIds:tf.adminIds, memberIds:tf.memberIds });
    p.then(function(){ setBusy(false); setEditTeam(null); resetTf(); setAddMemberSel(""); onRefreshUsers(); onRefreshTeams(); flash(isNew?"Team created":"Team updated"); })
     .catch(function(e){ setBusy(false); flash(e.message||"Error saving team"); });
  }

  function deleteTeamConfirm(team) {
    if (!confirm("Delete team \"" + team.name + "\"? Users won't be deleted.")) return;
    apiDel("/admin/teams/" + team.id)
      .then(function(){ onRefreshTeams(); flash("Team deleted"); })
      .catch(function(){ flash("Error deleting team"); });
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


  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {/* Sub-tab bar */}
      <div style={{flexShrink:0,padding:"10px 14px 0",borderBottom:"1px solid rgba(255,255,255,.07)"}}>
        <div style={{fontSize:10,fontWeight:700,color:SESS_COLOR,letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>Admin Panel</div>
        <div style={{display:"flex",background:"rgba(255,255,255,.05)",borderRadius:10,padding:2,gap:1}}>
          {[["users","👥 Users"],["teams","🏷️ Teams"]].map(function(s){
            var on = sub===s[0];
            return <button key={s[0]} onClick={function(){setSub(s[0]);}}
              style={{flex:1,background:on?"rgba(255,255,255,.12)":"transparent",border:"none",borderRadius:8,padding:"7px 4px",cursor:"pointer",fontFamily:"inherit",color:on?"#fff":"rgba(255,255,255,.35)",fontSize:11,fontWeight:on?700:400}}>{s[1]}</button>;
          })}
        </div>
      </div>

      {msg && <div style={{margin:"8px 14px 0",background:"rgba(102,187,106,.1)",border:"1px solid rgba(102,187,106,.25)",borderRadius:9,padding:"7px 12px",fontSize:11,color:"#66BB6A",flexShrink:0}}>{msg}</div>}

      <div style={{flex:1,overflowY:"auto",padding:"12px 14px 0"}}>

        {/* ── USERS ── */}
        {sub==="users" && (
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <SectionHdr style={{margin:0}}>Users ({(orgUsers||[]).length})</SectionHdr>
              <button onClick={function(){resetUf();setEditUser("new");}} style={Object.assign({},ghostSm(),{fontSize:11})}>+ New User</button>
            </div>

            {editUser && (
              <div style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.1)",borderRadius:12,padding:"14px",marginBottom:14}}>
                <div style={{fontSize:13,fontWeight:700,color:"#fff",marginBottom:12}}>{editUser==="new"?"New User":"Edit: "+editUser.displayName}</div>
                {editUser==="new" && <>
                  <label style={labelSt()}>Email</label>
                  <input value={uf.email} onChange={function(e){setUf(function(p){return Object.assign({},p,{email:e.target.value});});}} placeholder="email@company.com" style={inputSt({marginBottom:9})}/>
                  <label style={labelSt()}>Password</label>
                  <input type="password" value={uf.password} onChange={function(e){setUf(function(p){return Object.assign({},p,{password:e.target.value});});}} placeholder="••••••••" style={inputSt({marginBottom:9})}/>
                </>}
                <label style={labelSt()}>Display Name</label>
                <input value={uf.displayName} onChange={function(e){setUf(function(p){return Object.assign({},p,{displayName:e.target.value});});}} placeholder="Full name" style={inputSt({marginBottom:9})}/>
                <label style={labelSt()}>Role</label>
                <div style={{display:"flex",gap:6,marginBottom:9}}>
                  {["user","admin"].map(function(r){
                    var on=uf.role===r;
                    return <button key={r} onClick={function(){setUf(function(p){return Object.assign({},p,{role:r});});}}
                      style={{background:on?"rgba(168,255,62,.15)":"rgba(255,255,255,.05)",border:"1px solid "+(on?"rgba(168,255,62,.4)":"rgba(255,255,255,.1)"),borderRadius:8,padding:"5px 14px",cursor:"pointer",fontFamily:"inherit",fontSize:11,color:on?SESS_COLOR:"rgba(255,255,255,.4)",fontWeight:on?700:400}}>{r}</button>;
                  })}
                </div>
                <label style={labelSt()}>Team Assignment</label>
                <select value={uf.teamId||""} onChange={function(e){setUf(function(p){return Object.assign({},p,{teamId:e.target.value});});}} style={inputSt({marginBottom:12})}>
                  <option value="">— None —</option>
                  {(orgTeams||[]).map(function(t){ return <option key={t.id} value={t.id}>{t.name}</option>; })}
                </select>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={function(){setEditUser(null);resetUf();}} style={Object.assign({},ghostBtn(),{flex:1,padding:"8px",fontSize:12})}>Cancel</button>
                  <button onClick={saveUser} disabled={busy} style={Object.assign({},solidBtn(SESS_COLOR),{flex:2,padding:"8px",fontSize:12})}>{busy?"Saving…":"Save"}</button>
                </div>
              </div>
            )}

            <div style={{display:"flex",flexDirection:"column",gap:7}}>
              {(orgUsers||[]).map(function(u){
                var userTeamList = (u.teamIds||[]).map(function(tid){ return (orgTeams||[]).find(function(t){return t.id===tid;}); }).filter(Boolean);
                return (
                  <div key={u.id} style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.07)",borderRadius:10,padding:"11px 12px",display:"flex",alignItems:"center",gap:10}}>
                    <div style={{width:34,height:34,borderRadius:"50%",background:"#1565C0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:"#fff",flexShrink:0}}>
                      {u.displayName[0].toUpperCase()}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                        <span style={{fontSize:12,fontWeight:700,color:"#fff"}}>{u.displayName}</span>
                        <span style={{fontSize:9,padding:"1px 6px",borderRadius:99,background:u.role==="admin"?"rgba(168,255,62,.18)":"rgba(0,180,255,.1)",color:u.role==="admin"?SESS_COLOR:"#00B4FF",border:"1px solid "+(u.role==="admin"?"rgba(168,255,62,.3)":"rgba(0,180,255,.2)"),textTransform:"uppercase",letterSpacing:.5}}>{u.role}</span>
                        {userTeamList.map(function(t){
                          return <span key={t.id} style={{fontSize:9,padding:"1px 6px",borderRadius:99,background:"rgba(255,255,255,.07)",color:"rgba(255,255,255,.45)",border:"1px solid rgba(255,255,255,.12)"}}>{t.name}</span>;
                        })}
                      </div>
                      <div style={{fontSize:10,color:"rgba(255,255,255,.35)",marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.email}</div>
                    </div>
                    <div style={{display:"flex",gap:5,flexShrink:0}}>
                      <button onClick={function(){setUf({email:u.email,displayName:u.displayName,role:u.role,teamId:u.teamId||"",password:""});setEditUser(u);}}
                        style={{background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",borderRadius:7,padding:"4px 8px",cursor:"pointer",fontSize:10,color:"rgba(255,255,255,.5)",fontFamily:"inherit"}}>✏</button>
                      <button onClick={function(){resetPassword(u);}}
                        style={{background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",borderRadius:7,padding:"4px 8px",cursor:"pointer",fontSize:10,color:"rgba(255,255,255,.5)",fontFamily:"inherit"}}>🔑</button>
                      {u.id !== authUser.id && <button onClick={function(){deleteUserConfirm(u);}}
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
                <label style={labelSt()}>Team Name</label>
                <input value={tf.name} onChange={function(e){setTf(function(p){return Object.assign({},p,{name:e.target.value});});}} placeholder="e.g. West Coast" style={inputSt({marginBottom:10})}/>
                <label style={labelSt()}>Assigned Admins <span style={{color:"#EF5350",fontSize:9}}>required</span></label>
                <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
                  {admins.map(function(a){
                    var on = tf.adminIds.includes(a.id);
                    return <button key={a.id} onClick={function(){toggleAdminId(a.id);}}
                      style={{background:on?"rgba(168,255,62,.15)":"rgba(255,255,255,.05)",border:"1px solid "+(on?"rgba(168,255,62,.4)":"rgba(255,255,255,.1)"),borderRadius:8,padding:"5px 11px",cursor:"pointer",fontFamily:"inherit",fontSize:11,color:on?SESS_COLOR:"rgba(255,255,255,.4)",fontWeight:on?700:400}}>{a.displayName}</button>;
                  })}
                </div>
                {/* Members section */}
                <label style={labelSt()}>Members</label>
                {tf.memberIds.length > 0 && (
                  <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:8}}>
                    {tf.memberIds.map(function(uid){
                      var u = (orgUsers||[]).find(function(x){return x.id===uid;});
                      if (!u) return null;
                      return (
                        <span key={uid} style={{display:"inline-flex",alignItems:"center",gap:4,background:"rgba(0,180,255,.1)",border:"1px solid rgba(0,180,255,.25)",borderRadius:99,padding:"3px 8px",fontSize:10,color:"#00B4FF"}}>
                          {u.displayName}
                          <button onClick={function(){toggleMemberId(uid);}} style={{background:"none",border:"none",cursor:"pointer",color:"rgba(0,180,255,.6)",fontSize:11,padding:"0 0 0 2px",fontFamily:"inherit",lineHeight:1}}>×</button>
                        </span>
                      );
                    })}
                  </div>
                )}
                {(orgUsers||[]).filter(function(u){ return !tf.memberIds.includes(u.id); }).length > 0 && (
                  <div style={{display:"flex",gap:6,marginBottom:12}}>
                    <select value={addMemberSel} onChange={function(e){setAddMemberSel(e.target.value);}}
                      style={inputSt({margin:0,flex:1,fontSize:12,padding:"7px 10px"})}>
                      <option value="">— Add member —</option>
                      {(orgUsers||[]).filter(function(u){ return !tf.memberIds.includes(u.id); }).map(function(u){
                        return <option key={u.id} value={u.id}>{u.displayName} ({u.role})</option>;
                      })}
                    </select>
                    <button onClick={function(){
                      if (!addMemberSel) return;
                      toggleMemberId(addMemberSel);
                      setAddMemberSel("");
                    }} style={ghostSm({color:SESS_COLOR,borderColor:"rgba(168,255,62,.3)",fontSize:12,padding:"7px 12px"})}>+ Add</button>
                  </div>
                )}
                {tf.memberIds.length === 0 && (orgUsers||[]).filter(function(u){ return !tf.memberIds.includes(u.id); }).length === 0 && (
                  <div style={{fontSize:10,color:"rgba(255,255,255,.25)",marginBottom:12}}>No users available.</div>
                )}
                {tf.memberIds.length === 0 && (orgUsers||[]).filter(function(u){ return !tf.memberIds.includes(u.id); }).length > 0 && (
                  <div style={{fontSize:10,color:"rgba(255,255,255,.25)",marginBottom:12}}>No members assigned yet.</div>
                )}
                <div style={{display:"flex",gap:8}}>
                  <button onClick={function(){setEditTeam(null);resetTf();}} style={Object.assign({},ghostBtn(),{flex:1,padding:"8px",fontSize:12})}>Cancel</button>
                  <button onClick={saveTeam} disabled={busy} style={Object.assign({},solidBtn(SESS_COLOR),{flex:2,padding:"8px",fontSize:12})}>{busy?"Saving…":"Save"}</button>
                </div>
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
    </div>
  );
}
