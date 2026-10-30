import { useState, useEffect, useRef, useContext } from "react";
import { TM, DECK_COLORS, DECK_ICONS, SESS_COLOR, isAdminRole, roleMeta, accentA, normalizeAccent, DEFAULT_ACCENT } from "../lib/constants";
import { apiGet, apiPost, apiPut, apiDel, setStoredToken, getStoredToken, lsGet, fetchWithTimeout, API_BASE } from "../lib/api";
import { solidBtn, ghostBtn, ghostSm, iconBtn, inputSt, cardBg, badgeSt, labelSt, SHEET_MAX_H, overlayFill } from "../lib/styles";
import { TypeBadge, Handle, SectionHdr } from "./ui";
import DesktopCtx from "../lib/DesktopCtx";
import { DesktopModal } from "./DesktopModal";
import { useDesktop } from "../lib/useDesktop";
import { OrgMark } from "./OrgMark";

// ─── DECK SWITCHER SHEET ──────────────────────────────────────────────────────
export function DeckSwitcherSheet({ decks: allDecks, activeDeckId, onSelect, onAddDeck, onClose, isAdmin, isOwner, onEditDeck, onDuplicateDeck, onArchiveDeck, onRestoreDeck, onDeleteDeck, orgUsers, orgTeams }) {
  var decks    = (allDecks || []).filter(function(d) { return !d.archivedAt; });
  var archived = isAdmin ? (allDecks || []).filter(function(d) { return !!d.archivedAt; }) : [];
  var [showArchived, setShowArchived] = useState(false);
  var [busyId, setBusyId] = useState(null);
  function run(id, p) { setBusyId(id); Promise.resolve(p).then(function(){ setBusyId(null); }, function(){ setBusyId(null); }); }
  function confirmDelete(d) {
    if (!window.confirm("Permanently delete \"" + d.name + "\"?\n\nIts cards and objection stacks are removed for everyone. Past sessions are kept.")) return;
    setEditingDeck(null);
    run(d.id, onDeleteDeck(d.id));
  }
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
    // No cards → App fills in the starter template (Opening → Discovery → Close)
    onAddDeck({ name:nf.name, icon:nf.icon, color:nf.color, visibility:nf.visibility||"public", accessList:nf.accessList||[], objStacks:[] });
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
              <div style={{fontSize:14,fontWeight:700,color:"#fff",marginBottom:4,fontFamily:"'Lora',serif"}}>New Pitch Deck</div>
              <div style={{fontSize:11,color:"rgba(255,255,255,.4)",marginBottom:14,lineHeight:1.5}}>Starts with an Opening → Discovery → Close path you can edit.</div>
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
                      style={{flex:1,background:on?accentA(.1):"rgba(255,255,255,.07)",border:"1.5px solid "+(on?accentA(.35):"rgba(255,255,255,.1)"),borderRadius:10,padding:"8px 6px",cursor:"pointer",fontFamily:"inherit",textAlign:"center"}}>
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
                            style={{flex:1,background:on?accentA(.1):"rgba(255,255,255,.07)",border:"1.5px solid "+(on?accentA(.35):"rgba(255,255,255,.1)"),borderRadius:10,padding:"8px 6px",cursor:"pointer",fontFamily:"inherit",textAlign:"center"}}>
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
                    {/* Deck management — duplicate/archive for admins, delete for the owner */}
                    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:12,paddingTop:12,borderTop:"1px solid rgba(255,255,255,.08)"}}>
                      <button disabled={busyId===d.id} onClick={function(){ setEditingDeck(null); onClose(); onDuplicateDeck(d.id); }} style={ghostSm({flex:1,minWidth:90})}>⧉ Duplicate</button>
                      <button disabled={busyId===d.id} onClick={function(){ setEditingDeck(null); run(d.id, onArchiveDeck(d.id)); }} style={ghostSm({flex:1,minWidth:90,color:"#FFB74D",borderColor:"rgba(255,183,77,.3)"})}>🗄 Archive</button>
                      {isOwner && <button disabled={busyId===d.id} onClick={function(){ confirmDelete(d); }} style={ghostSm({flex:1,minWidth:90,color:"#EF5350",borderColor:"rgba(239,83,80,.3)"})}>🗑 Delete</button>}
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
                        <div style={{fontSize:11,color:"rgba(255,255,255,.3)"}}>{Object.keys(d.cards||{}).length} cards · {(d.objStacks||[]).filter(function(st){ return !st.archivedAt; }).length} obj stacks</div>
                      </div>
                    </div>
                  </button>
                  {isAdmin && <button title="Edit, duplicate or archive" aria-label={"Manage " + d.name} onClick={function(e){ e.stopPropagation(); setEf({name:d.name,icon:d.icon||"💼",color:d.color||"#00B4FF",visibility:d.visibility||"public",accessList:d.accessList||[]}); setEditingDeck(d); }} style={{background:"none",border:"none",cursor:"pointer",fontSize:14,padding:"10px 8px",color:"rgba(255,255,255,.4)",position:"absolute",right:6,top:"50%",transform:"translateY(-50%)"}}>✏</button>}
                </div>
              );
            })}
          </div>
          {archived.length > 0 && (
            <div style={{marginTop:16}}>
              <button onClick={function(){ setShowArchived(function(p){ return !p; }); }}
                style={{background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",padding:"6px 0",fontSize:11,fontWeight:700,letterSpacing:.6,textTransform:"uppercase",color:"rgba(255,255,255,.4)"}}>
                {showArchived ? "▾" : "▸"} Archived ({archived.length})
              </button>
              {showArchived && (
                <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:6}}>
                  {archived.map(function(d) {
                    return (
                      <div key={d.id} style={{display:"flex",alignItems:"center",gap:10,background:"rgba(255,255,255,.03)",border:"1px dashed rgba(255,255,255,.12)",borderRadius:12,padding:"10px 12px",opacity:busyId===d.id?.5:1}}>
                        <div style={{width:34,height:34,borderRadius:10,background:d.color+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,flexShrink:0,filter:"grayscale(.6)"}}>{d.icon}</div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:13,fontWeight:600,color:"rgba(255,255,255,.7)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.name}</div>
                          <div style={{fontSize:10,color:"rgba(255,255,255,.3)"}}>Archived {new Date(d.archivedAt).toLocaleDateString()}</div>
                        </div>
                        <button disabled={busyId===d.id} onClick={function(){ run(d.id, onRestoreDeck(d.id)); }} style={ghostSm()}>Restore</button>
                        {isOwner && <button disabled={busyId===d.id} onClick={function(){ confirmDelete(d); }} style={ghostSm({color:"#EF5350",borderColor:"rgba(239,83,80,.3)"})}>Delete</button>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
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
// Demo accounts (seeded by server/seed.js). The picker only appears when the server runs
// with DEMO_MODE on (GET /api/config), and signs in through /auth/demo-login — no
// password ships in the app.
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
  // Rendered before MainApp provides DesktopCtx, so read the layout directly
  var lay = useDesktop();
  var [email,   setEmail]   = useState("");
  var [pass,    setPass]    = useState("");
  var [err,     setErr]     = useState("");
  var [busy,    setBusy]    = useState(false);
  var [selOrg,  setSelOrg]  = useState(null);   // null | DEV_ORGS entry
  var [showPicker, setShowPicker] = useState(false);
  var [alreadyLoggedIn, setAlreadyLoggedIn] = useState(false);
  var [forgotOpen, setForgotOpen] = useState(false);
  var [demo, setDemo] = useState(false);          // server has demo accounts enabled
  var [demoEmail, setDemoEmail] = useState(null); // demo account being signed in (for "Log in anyway")
  useEffect(function() {
    apiGet("/config").then(function(c) { setDemo(!!(c && c.demo)); }).catch(function() {});
  }, []);

  function pickOrg(org) {
    setSelOrg(org);
    setEmail(""); setPass(""); setErr(""); setAlreadyLoggedIn(false);
  }

  function pickUser(u) {
    setEmail(u.email);
    setPass("");
    setShowPicker(false);
    setErr("");
    setDemoEmail(u.email);
    doLogin("/auth/demo-login", { email: u.email });
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
    setDemoEmail(null);
    if (!email.trim() || !pass) { setErr("Email and password are required."); return; }
    doLogin("/auth/login", { email: email.trim(), password: pass });
  }

  function handleForceLogin() {
    if (demoEmail) { doLogin("/auth/demo-login?force=true", { email: demoEmail }); return; }
    if (!email.trim() || !pass) return;
    doLogin("/auth/login?force=true", { email: email.trim(), password: pass });
  }

  var accentColor = "#00B4FF"; // always on-theme; org colors only identify org tiles

  // Desktop / tablet get a larger sign-in; wide screens split into brand panel + form
  var big   = lay.isDesktop || lay.isTablet;
  var split = lay.isDesktop || (lay.isTablet && window.innerWidth >= 960);
  var F = big
    ? { label:12, input:16, inPad:"14px 16px", title:26, small:14, tileName:15, tileIcon:44, btnPad:"15px 20px", btn:16, pick:14, pickName:14, pickMail:12 }
    : { label:9,  input:14, inPad:"11px 14px", title:14, small:13, tileName:11, tileIcon:34, btnPad:"12px 20px", btn:14, pick:12, pickName:12, pickMail:10 };
  var lbl = big ? Object.assign({}, labelSt(), { fontSize:12, marginBottom:8 }) : labelSt();
  var inp = inputSt({ marginBottom:0, fontSize:F.input, padding:F.inPad, borderRadius:big ? 14 : 12 });

  var brand = (
    <div style={{textAlign:split ? "left" : "center",marginBottom:split ? 0 : 16}}>
      <div style={{display:"inline-block",marginBottom:split ? 18 : 2}}>
        <img src="/icon.png" alt="OverCard"
          style={{width:split ? 340 : big ? 260 : 330,height:split ? 230 : big ? 170 : 220,objectFit:"contain",marginLeft:split ? -70 : 0,filter:"drop-shadow(0 6px 24px rgba(0,180,255,.4))"}}/>
      </div>
      <div style={{fontSize:split ? 52 : big ? 34 : 22,fontWeight:700,color:"#fff",fontFamily:"'Lora',serif",marginBottom:split ? 10 : 4,lineHeight:1.1}}>OverCard</div>
      <div style={{fontSize:split ? 20 : big ? 15 : 11,color:split ? "rgba(255,255,255,.7)" : "rgba(255,255,255,.35)",letterSpacing:split ? 0 : .5}}>
        {split ? "Run every sales call like your best rep." : "Sales Deck Platform"}
      </div>
      {split && (
        <div style={{display:"flex",flexDirection:"column",gap:18,marginTop:36}}>
          {[
            ["🃏", "Guided call decks", "Branching scripts, objection stacks and delivery cues — live, in the call."],
            ["🎙️", "Recorded calls", "Full call audio plus a clip for every card, reviewable from any device."],
            ["📊", "Coaching that sticks", "Team leaderboards, path analytics and feedback on every session."],
          ].map(function(f) {
            return (
              <div key={f[1]} style={{display:"flex",gap:16,alignItems:"flex-start"}}>
                <div style={{width:48,height:48,borderRadius:14,background:"rgba(0,180,255,.1)",border:"1px solid rgba(0,180,255,.25)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>{f[0]}</div>
                <div>
                  <div style={{fontSize:17,fontWeight:700,color:"#fff"}}>{f[1]}</div>
                  <div style={{fontSize:15,color:"rgba(255,255,255,.55)",marginTop:3,lineHeight:1.5,maxWidth:420}}>{f[2]}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  var orgPicker = (
    <div style={{marginBottom:big ? 18 : 14}}>
      <div style={{fontSize:F.label,fontWeight:700,color:"rgba(255,255,255,.35)",letterSpacing:1.4,textTransform:"uppercase",marginBottom:big ? 10 : 8}}>Demo organizations</div>
      <div style={{display:"flex",gap:big ? 12 : 8}}>
        {DEV_ORGS.map(function(org) {
          var active = selOrg && selOrg.id === org.id;
          return (
            <button key={org.id} onClick={function(){ pickOrg(org); }}
              style={{flex:1,display:"flex",flexDirection:big ? "row" : "column",alignItems:"center",justifyContent:big ? "flex-start" : "center",gap:big ? 12 : 5,padding:big ? "14px 16px" : "12px 10px",background:active?"rgba(0,180,255,.08)":"rgba(255,255,255,.07)",border:"1.5px solid "+(active?"rgba(0,180,255,.4)":"rgba(255,255,255,.09)"),borderRadius:big ? 16 : 14,cursor:"pointer",fontFamily:"inherit",transition:"all .15s"}}>
              <div style={{width:F.tileIcon,height:F.tileIcon,borderRadius:big ? 12 : 10,background:active?"rgba(0,180,255,.15)":"rgba(255,255,255,.07)",border:"1.5px solid "+(active?"rgba(0,180,255,.35)":"rgba(255,255,255,.12)"),display:"flex",alignItems:"center",justifyContent:"center",fontSize:big ? 20 : 16,fontWeight:700,color:active?"#00B4FF":"rgba(255,255,255,.5)",flexShrink:0}}>
                {org.name[0]}
              </div>
              <div style={{fontSize:F.tileName,fontWeight:700,color:active?"#fff":"rgba(255,255,255,.6)",textAlign:big ? "left" : "center",lineHeight:1.3}}>{org.name}</div>
              {active && <div style={{width:6,height:6,borderRadius:"50%",background:"#00B4FF",marginLeft:big ? "auto" : 0}}/>}
            </button>
          );
        })}
      </div>
    </div>
  );

  var userPicker = selOrg && (
    <div style={{marginBottom:big ? 18 : 14,position:"relative"}}>
      <button onClick={function(){ setShowPicker(function(p){ return !p; }); }}
        style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",background:accentColor+"0f",border:"1px solid "+accentColor+"33",borderRadius:12,padding:big ? "13px 16px" : "10px 14px",cursor:"pointer",fontFamily:"inherit",color:"rgba(255,255,255,.75)",fontSize:F.pick,transition:"all .15s"}}>
        <span style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:F.pick + 1}}>⚡</span>
          <span>{email ? email : "Quick select a user"}</span>
        </span>
        <span style={{fontSize:10,color:"rgba(255,255,255,.3)"}}>{showPicker ? "▲" : "▼"}</span>
      </button>
      {showPicker && (
        <div style={{position:"absolute",top:"calc(100% + 6px)",left:0,right:0,background:"#081428",border:"1px solid rgba(255,255,255,.12)",borderRadius:12,overflow:"hidden",zIndex:20,animation:"dropIn .15s ease both",maxHeight:big ? 380 : 300,overflowY:"auto",boxShadow:"0 16px 48px rgba(0,0,0,.8)"}}>
          <div style={{padding:"8px 14px 5px",fontSize:F.label,fontWeight:700,color:SESS_COLOR+"99",letterSpacing:1.2,textTransform:"uppercase",borderBottom:"1px solid rgba(255,255,255,.05)"}}>Admins</div>
          {selOrg.admins.map(function(u) {
            return (
              <button key={u.email} onClick={function(){ pickUser(u); }}
                style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",background:"none",border:"none",borderBottom:"1px solid rgba(255,255,255,.04)",padding:big ? "12px 16px" : "10px 14px",cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}>
                <div>
                  <div style={{fontSize:F.pickName,fontWeight:700,color:"#fff"}}>{u.label}</div>
                  <div style={{fontSize:F.pickMail,color:"rgba(255,255,255,.35)",marginTop:1}}>{u.email}</div>
                </div>
                <span style={{fontSize:big ? 11 : 9,fontWeight:700,padding:"2px 8px",borderRadius:99,background:roleMeta(u.role||"admin").bg,color:roleMeta(u.role||"admin").color,border:"1px solid "+roleMeta(u.role||"admin").border,flexShrink:0}}>{u.role||"admin"}</span>
              </button>
            );
          })}
          {selOrg.teams.map(function(team) {
            return (
              <div key={team.name}>
                <div style={{padding:"8px 14px 5px",fontSize:F.label,fontWeight:700,color:"rgba(0,180,255,.55)",letterSpacing:1.2,textTransform:"uppercase",borderBottom:"1px solid rgba(255,255,255,.04)",borderTop:"1px solid rgba(255,255,255,.05)"}}>{team.name}</div>
                {team.users.map(function(u) {
                  return (
                    <button key={u.email} onClick={function(){ pickUser(u); }}
                      style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",background:"none",border:"none",borderBottom:"1px solid rgba(255,255,255,.04)",padding:big ? "12px 16px" : "10px 14px",cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}>
                      <div>
                        <div style={{fontSize:F.pickName,fontWeight:700,color:"#fff"}}>{u.label}</div>
                        <div style={{fontSize:F.pickMail,color:"rgba(255,255,255,.35)",marginTop:1}}>{u.email}</div>
                      </div>
                      <span style={{fontSize:big ? 11 : 9,fontWeight:700,padding:"2px 8px",borderRadius:99,background:"rgba(0,180,255,.1)",color:"#00B4FF",border:"1px solid rgba(0,180,255,.2)",flexShrink:0}}>user</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  var form = (
    <form onSubmit={submit} style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.09)",borderRadius:big ? 22 : 18,padding:big ? "32px 32px" : "24px 24px",display:"flex",flexDirection:"column",gap:big ? 18 : 14,boxShadow:big ? "0 24px 60px rgba(0,0,0,.35)" : "none"}}>
      <div>
        <div style={{fontSize:F.title,fontWeight:700,color:"#fff",fontFamily:big ? "'Lora',serif" : "inherit"}}>{big ? "Welcome back" : "Sign in"}</div>
        {big && <div style={{fontSize:F.small,color:"rgba(255,255,255,.45)",marginTop:4}}>Sign in to your organization's workspace.</div>}
      </div>
      {(kickReason === "replaced" || kickReason === "password") && (
        <div style={{background:"rgba(239,83,80,.10)",border:"1px solid rgba(239,83,80,.28)",borderRadius:12,padding:"10px 14px",fontSize:F.small - 1,color:"#EF8070",lineHeight:1.5}}>
          {kickReason === "replaced"
            ? "You were signed out because this account was signed in on another device. Any call in progress was saved."
            : "You were signed out because this account's password was changed."}
        </div>
      )}
      {err && <div role="alert" style={{background:"rgba(239,83,80,.12)",border:"1px solid rgba(239,83,80,.3)",borderRadius:10,padding:"10px 12px",fontSize:F.small - 1,color:"#EF5350"}}>{err}</div>}
      {alreadyLoggedIn && (
        <div style={{background:"rgba(255,165,0,.10)",border:"1px solid rgba(255,165,0,.3)",borderRadius:10,padding:"12px 14px",fontSize:F.small - 1,color:"#FFA040",display:"flex",flexDirection:"column",gap:10}}>
          <div>This account is already active on another device.</div>
          <div style={{display:"flex",gap:8}}>
            <button type="button" disabled={busy} onClick={handleForceLogin}
              style={Object.assign({},solidBtn("#FFA040"),{flex:1,fontSize:F.small - 1,padding:big ? "10px 12px" : "7px 12px",opacity:busy?0.6:1})}>
              {busy ? "Signing in…" : "Log in anyway"}
            </button>
            <button type="button" onClick={function(){ setAlreadyLoggedIn(false); setErr(""); }}
              style={Object.assign({},ghostBtn(),{flex:1,fontSize:F.small - 1,padding:big ? "10px 12px" : "7px 12px"})}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <div>
        <label style={lbl}>Email</label>
        <input type="email" value={email} onChange={function(e){setEmail(e.target.value);}} placeholder="you@company.com"
          style={inp} autoFocus autoComplete="email"/>
      </div>
      <div>
        <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:8}}>
          <label style={lbl}>Password</label>
          <button type="button" onClick={function(){ setForgotOpen(!forgotOpen); }} aria-expanded={forgotOpen}
            style={{background:"none",border:"none",color:"#00B4FF",cursor:"pointer",fontFamily:"inherit",fontSize:F.small - 1,fontWeight:600,padding:"2px 0"}}>
            Forgot password?
          </button>
        </div>
        <input type="password" value={pass} onChange={function(e){setPass(e.target.value);}} placeholder="••••••••"
          style={inp} autoComplete="current-password"/>
      </div>
      {forgotOpen && (
        <div style={{background:"rgba(0,180,255,.07)",border:"1px solid rgba(0,180,255,.25)",borderRadius:12,padding:"12px 14px",fontSize:F.small - 1,color:"rgba(255,255,255,.75)",lineHeight:1.55}}>
          Ask an admin in your organization for a <strong style={{color:"#fff"}}>password reset link</strong> (Admin → People → your name → Reset password). The link works once, for one hour, and lets you choose a new password.
          <div style={{marginTop:6,color:"rgba(255,255,255,.5)"}}>Organization owners can get a reset link from whoever runs the OverCard server.</div>
        </div>
      )}
      <button type="submit" disabled={busy || alreadyLoggedIn}
        style={Object.assign({},solidBtn(SESS_COLOR),{marginTop:2,fontSize:F.btn,padding:F.btnPad,borderRadius:big ? 14 : 14,opacity:(busy||alreadyLoggedIn)?0.6:1})}>
        {busy ? "Signing in…" : "Sign In"}
      </button>
      {onShowSignup && (
        <div style={{fontSize:F.small,color:"rgba(255,255,255,.45)",textAlign:"center"}}>
          New to OverCard?{" "}
          <button type="button" onClick={onShowSignup}
            style={{background:"none",border:"none",color:"#00B4FF",cursor:"pointer",fontFamily:"inherit",fontSize:F.small,fontWeight:600,padding:0}}>
            Create an account
          </button>
        </div>
      )}
    </form>
  );

  var footer = (
    <div style={{textAlign:"center",marginTop:16,fontSize:big ? 12 : 10,color:"rgba(255,255,255,.2)"}}>{demo ? "OverCard · demo accounts enabled" : "OverCard"}</div>
  );

  return (
    <div style={{width:"100%",minHeight:"100vh",height:split ? "100vh" : undefined,display:"flex",alignItems:split ? "stretch" : "center",justifyContent:"center",background:"linear-gradient(135deg,#060d1a 0%,#071025 100%)",fontFamily:"'Inter',sans-serif",padding:split ? 0 : big ? 32 : 24,overflowY:"auto",boxSizing:"border-box"}}>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        body{background:#060d1a;color:#fff;}
        input::placeholder{color:rgba(255,255,255,.22);}
        input:focus{border-color:rgba(255,255,255,.3)!important;outline:none;}
        @keyframes fadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
        @keyframes dropIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
        button{transition:transform 0.11s cubic-bezier(.22,1,.36,1),filter 0.11s ease,opacity 0.11s ease;}
        button:not(:disabled):active{transform:scale(0.95)!important;filter:brightness(0.85);}
        @media (hover:hover){button:not(:disabled):hover{filter:brightness(1.12);}}
        button:disabled{opacity:0.45!important;cursor:not-allowed;}
      `}</style>
      {split ? (
        <div style={{display:"grid",gridTemplateColumns:"minmax(0,1.1fr) minmax(440px,1fr)",width:"100%",minHeight:"100%"}}>
          {/* Brand panel */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",padding:"48px 56px",background:"radial-gradient(ellipse at 30% 40%, rgba(0,180,255,.14), transparent 60%), radial-gradient(ellipse at 80% 90%, rgba(168,255,62,.06), transparent 50%)",borderRight:"1px solid rgba(255,255,255,.06)"}}>
            <div style={{maxWidth:520,animation:"fadeIn .5s cubic-bezier(.22,1,.36,1) both"}}>{brand}</div>
          </div>
          {/* Sign-in column */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",padding:"48px 40px",overflowY:"auto"}}>
            <div style={{width:"100%",maxWidth:480,animation:"fadeIn .4s cubic-bezier(.22,1,.36,1) .05s both"}}>
              {demo && orgPicker}
              {userPicker}
              {form}
              {footer}
            </div>
          </div>
        </div>
      ) : (
        <div style={{width:"100%",maxWidth:big ? 520 : 380,animation:"fadeIn .4s cubic-bezier(.22,1,.36,1) both",paddingBottom:24}}>
          {brand}
          {demo && orgPicker}
          {userPicker}
          {form}
          {footer}
        </div>
      )}
    </div>
  );
}

// ─── PROFILE SHEET ────────────────────────────────────────────────────────────
// Change your own password (needs the current one). This device stays signed in with a
// fresh session; anything else using the account is signed out.
function ChangePassword() {
  var [open, setOpen] = useState(false);
  var [cur, setCur] = useState("");
  var [pw, setPw] = useState("");
  var [confirm, setConfirm] = useState("");
  var [busy, setBusy] = useState(false);
  var [msg, setMsg] = useState(null);   // { ok, text }
  function problem(p) {
    if (!p || p.length < 8) return "Use at least 8 characters";
    if (!/[A-Z]/.test(p)) return "Add an uppercase letter";
    if (!/[0-9]/.test(p)) return "Add a digit";
    return null;
  }
  function submit(e) {
    e.preventDefault();
    var p = problem(pw);
    if (!cur) { setMsg({ text: "Enter your current password" }); return; }
    if (p) { setMsg({ text: p }); return; }
    if (pw !== confirm) { setMsg({ text: "The new passwords don't match" }); return; }
    setBusy(true); setMsg(null);
    apiPost("/auth/change-password", { currentPassword: cur, newPassword: pw })
      .then(function(r) {
        if (r && r._token) setStoredToken(r._token);
        setCur(""); setPw(""); setConfirm(""); setOpen(false);
        setMsg({ ok: true, text: "Password changed." });
      })
      .catch(function(err) { setMsg({ text: err.message || "Couldn't change the password" }); })
      .finally(function() { setBusy(false); });
  }
  if (!open) return (
    <div style={{display:"flex",flexDirection:"column",gap:6}}>
      <button onClick={function(){ setOpen(true); setMsg(null); }} style={Object.assign({}, ghostBtn(), {padding:"11px"})}>Change password</button>
      {msg && msg.ok && <div role="status" style={{fontSize:12,color:"#66BB6A",textAlign:"center"}}>✓ {msg.text}</div>}
    </div>
  );
  return (
    <form onSubmit={submit} style={{display:"flex",flexDirection:"column",gap:10,background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.08)",borderRadius:12,padding:12}}>
      <div style={{fontSize:13,fontWeight:700,color:"#fff"}}>Change password</div>
      <input type="password" autoComplete="current-password" placeholder="Current password" value={cur} onChange={function(e){ setCur(e.target.value); }} style={inputSt({marginBottom:0})}/>
      <input type="password" autoComplete="new-password" placeholder="New password (8+, 1 uppercase, 1 digit)" value={pw} onChange={function(e){ setPw(e.target.value); }} style={inputSt({marginBottom:0})}/>
      <input type="password" autoComplete="new-password" placeholder="Confirm new password" value={confirm} onChange={function(e){ setConfirm(e.target.value); }} style={inputSt({marginBottom:0})}/>
      {msg && !msg.ok && <div role="alert" style={{fontSize:12,color:"#EF5350"}}>{msg.text}</div>}
      <div style={{display:"flex",gap:8}}>
        <button type="button" onClick={function(){ setOpen(false); setMsg(null); }} style={Object.assign({}, ghostBtn(), {flex:1})}>Cancel</button>
        <button type="submit" disabled={busy} style={Object.assign({}, solidBtn("#1565C0"), {flex:2})}>{busy ? "Saving…" : "Update password"}</button>
      </div>
    </form>
  );
}

export function ProfileSheet({ authUser, teamName, onLogout, onClose }) {
  var desktop = useContext(DesktopCtx);
  var [busy, setBusy] = useState(false);
  function logout() {
    setBusy(true);
    var storedToken = getStoredToken();
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
        {authUser.orgName && <span style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:10,padding:"2px 10px 2px 3px",borderRadius:99,background:"rgba(255,255,255,.06)",color:"rgba(255,255,255,.55)",border:"1px solid rgba(255,255,255,.1)"}}><OrgMark authUser={authUser} size={18}/>{authUser.orgName}</span>}
        {teamName && <span style={{fontSize:10,padding:"3px 10px",borderRadius:99,background:"rgba(255,255,255,.06)",color:"rgba(255,255,255,.45)",border:"1px solid rgba(255,255,255,.1)"}}>{teamName}</span>}
      </div>
      <ChangePassword/>
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
    <div style={overlayFill(250)}>
      <div onClick={onClose} style={{flex:1,background:"rgba(0,0,0,.6)",backdropFilter:"blur(8px)"}}/>
      <div style={{background:"#081428",borderRadius:"24px 24px 0 0",border:"1px solid rgba(255,255,255,.1)",borderBottom:"none",padding:"0 0 32px",maxHeight:SHEET_MAX_H,overflowY:"auto",animation:"sheetUp .3s cubic-bezier(.22,1,.36,1) both",fontFamily:"inherit"}}>
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
