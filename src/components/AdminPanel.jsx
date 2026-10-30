import { useState, useEffect, useRef, useContext } from "react";
import { cachedGet, peek } from "../lib/dataCache";
import { TM, DECK_COLORS, DECK_ICONS, SESS_COLOR, isAdminRole, roleMeta, accentA, normalizeAccent, DEFAULT_ACCENT } from "../lib/constants";
import { apiGet, apiPost, apiPut, apiDel, setStoredToken, lsGet, fetchWithTimeout, API_BASE } from "../lib/api";
import { solidBtn, ghostBtn, ghostSm, iconBtn, inputSt, cardBg, badgeSt, labelSt } from "../lib/styles";
import { TypeBadge, Handle, SectionHdr } from "./ui";
import DesktopCtx from "../lib/DesktopCtx";
import { DesktopModal } from "./DesktopModal";
import { BrandingFields } from "./BrandingFields";
import { useDesktop } from "../lib/useDesktop";
import { OrgMark } from "./OrgMark";

// ─── ADMIN PANEL ──────────────────────────────────────────────────────────────
// Users / Teams / Share Codes / Organization. Split out of Panels.jsx so the admin
// code loads only when an admin opens the tab.
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
function ShareCodesPanel({ isDesktop, orgUsers, compact, stacked }) {
  var [invites, setInvites] = useState(null);
  var [expiry,  setExpiry]  = useState("7");
  var [maxUses, setMaxUses] = useState("");
  var [busy,    setBusy]    = useState(false);
  var [msg,     setMsg]     = useState(null);   // { text, error }
  var [fresh,   setFresh]   = useState(null);   // id of the code just generated
  var [showAll, setShowAll] = useState(false);

  function flash(text, error) { setMsg({ text:text, error:!!error }); setTimeout(function(){ setMsg(null); }, 3000); }
  function load() {
    cachedGet("/admin/invites").then(setInvites).catch(function(){ setInvites([]); flash("Couldn't load share codes", true); });
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
            <div key={inv.id} style={{background:isFresh?accentA(.07):"rgba(255,255,255,.04)",border:"1px solid "+(isFresh?accentA(.35):"rgba(255,255,255,.08)"),borderRadius:12,padding:isDesktop?"14px 16px":"12px",opacity:st.active?1:.6}}>
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

  var threeCol = !compact && window.innerWidth >= 1400;
  var recentCard = isDesktop ? (
<div style={SIDE_CARD}>
              <SideTitle>Recently joined</SideTitle>
              {(orgUsers || []).slice().sort(function(a, b){ return (b.createdAt || 0) - (a.createdAt || 0); }).slice(0, 8).map(function(u, i) {
                var m = roleMeta(u.role);
                return (
                  <div key={u.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderTop:i ? "1px solid rgba(255,255,255,.06)" : "none"}}>
                    <span style={{width:28,height:28,borderRadius:"50%",background:m.bg,border:"1px solid "+m.border,color:m.color,fontSize:12,fontWeight:700,display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{(u.displayName || "?")[0].toUpperCase()}</span>
                    <span style={{flex:1,minWidth:0}}>
                      <span style={{display:"block",fontSize:14,fontWeight:600,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.displayName}</span>
                      <span style={{display:"block",fontSize:12,color:"rgba(255,255,255,.4)"}}>{u.createdAt ? fmtShortDate(u.createdAt) : ""}</span>
                    </span>
                    <RoleBadge role={u.role}/>
                  </div>
                );
              })}
            </div>
  ) : null;
  var guideAndStats = isDesktop ? (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>


            <div style={SIDE_CARD}>
              <SideTitle>How it works</SideTitle>
              {[["1","Generate a code","Pick how long it lasts and how many people can use it."],
                ["2","Send it to your team","Share the code, or the invite link — it opens sign-up with the code filled in."],
                ["3","They sign up","New accounts join this organization as users. Promote them in Users."]].map(function(st) {
                return (
                  <div key={st[0]} style={{display:"flex",gap:12,padding:"7px 0"}}>
                    <span style={{width:26,height:26,borderRadius:"50%",background:accentA(.15),border:"1px solid "+accentA(.4),color:SESS_COLOR,fontSize:13,fontWeight:800,display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{st[0]}</span>
                    <span>
                      <span style={{display:"block",fontSize:14,fontWeight:600,color:"#fff"}}>{st[1]}</span>
                      <span style={{display:"block",fontSize:13,color:"rgba(255,255,255,.5)",marginTop:2,lineHeight:1.45}}>{st[2]}</span>
                    </span>
                  </div>
                );
              })}
            </div>
            {invites && invites.length > 0 && (
              <div style={SIDE_CARD}>
                <StatTiles items={[
                  ["Active", invites.filter(function(i){ return inviteStatus(i).active; }).length, SESS_COLOR],
                  ["Sign-ups", invites.reduce(function(t, i){ return t + (i.uses || 0); }, 0), "#00B4FF"],
                  ["All codes", invites.length],
                ]}/>
              </div>
            )}
          
    </div>
  ) : null;
  var generatorAndGuide = isDesktop ? <>{generator}{guideAndStats}</> : null;

  return (
    <div style={{flex:1,overflowY:"auto",padding:isDesktop?(compact?"16px":"20px 24px"):"12px 14px"}}>
      {msg && <div style={{marginBottom:12,background:msg.error?"rgba(239,83,80,.1)":"rgba(102,187,106,.1)",border:"1px solid "+(msg.error?"rgba(239,83,80,.3)":"rgba(102,187,106,.25)"),borderRadius:9,padding:"8px 12px",fontSize:fs.small,color:msg.error?"#EF5350":"#66BB6A"}}>{msg.text}</div>}
      {isDesktop ? (
        // Desktop ≥1400: generator + guide | codes | recently joined.
        // Tablet landscape / narrower desktop: two columns (recent joins under the guide on tablet).
        // Tablet portrait: one column, codes first after the generator.
        <div style={{display:"grid",gridTemplateColumns:threeCol ? "minmax(320px,380px) minmax(0,1fr) minmax(280px,340px)" : stacked ? "minmax(0,1fr)" : "minmax(280px,360px) minmax(0,1fr)",gap:compact ? 16 : 24,alignItems:"start"}}>
          {stacked ? generator : (
            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              {generatorAndGuide}
              {compact && recentCard}
            </div>
          )}
          {listView}
          {threeCol && recentCard}
          {stacked && <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,alignItems:"start"}}>{guideAndStats}{recentCard}</div>}
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

function OrgPanel({ authUser, orgUsers, orgTeams, isDesktop, onOrgUpdated, compact, stacked }) {
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
    f.logo = o.logo || null;
    f.accentColor = o.accentColor || null;
    return f;
  }
  useEffect(function() {
    cachedGet("/org").then(function(o){ setOrg(o); setForm(toForm(o)); })
      .catch(function(){ flash("Couldn't load organization", true); });
  }, []);

  function save() {
    if (!form.name.trim()) { flash("Company name is required", true); return; }
    setBusy(true);
    apiPut("/org", form)
      .then(function(o){ setBusy(false); setOrg(o); setForm(toForm(o)); flash("Organization updated"); if (onOrgUpdated) onOrgUpdated(o); })
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
  var dirty = org && form && (ORG_FORM_FIELDS.some(function(d){ return (org[d.key] || "") !== form[d.key]; })
    || (org.logo || null) !== form.logo || (org.accentColor || null) !== form.accentColor);
  var badAccent = form && form.accentColor && !/^#[0-9A-F]{6}$/i.test(form.accentColor);
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
      {/* Branding — logo + accent theme the whole app for everyone in the org */}
      <div style={{marginTop:18,paddingTop:16,borderTop:"1px solid rgba(255,255,255,.08)"}}>
        <div style={{fontSize:fs.title - 1,fontWeight:700,color:"#fff",marginBottom:4}}>Branding</div>
        <div style={{fontSize:fs.small,color:"rgba(255,255,255,.45)",marginBottom:12}}>Shown in place of the OverCard logo, and used as the accent colour across the app for everyone in your organization.</div>
        <BrandingFields logo={form.logo} accent={form.accentColor} disabled={!isOwner} size={isDesktop ? "lg" : undefined} orgName={form.name}
          onChange={function(patch){ setForm(function(p){ return Object.assign({}, p, patch); }); }}/>
        {/* Live preview of how the mark appears in the app header */}
        <div style={{marginTop:14,display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:12}}>
          <OrgMark authUser={{ orgName:form.name, orgLogo:form.logo }} size={34} withName nameSize={15}/>
          <span style={{marginLeft:"auto",fontSize:fs.small,color:"rgba(255,255,255,.35)"}}>Preview</span>
        </div>
      </div>
      {isOwner && (
        <div style={{display:"flex",gap:8,marginTop:16}}>
          <button onClick={function(){ setForm(toForm(org)); }} disabled={!dirty || busy} style={Object.assign({}, ghostBtn(), {flex:1,padding:"10px",fontSize:fs.base})}>Discard</button>
          <button onClick={save} disabled={!dirty || busy || badAccent} style={Object.assign({}, solidBtn(SESS_COLOR), {flex:2,padding:"10px",fontSize:fs.base})}>{busy ? "Saving…" : "Save changes"}</button>
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

  var msgBox = msg && <div style={{marginBottom:12,background:msg.error?"rgba(239,83,80,.1)":"rgba(102,187,106,.1)",border:"1px solid "+(msg.error?"rgba(239,83,80,.3)":"rgba(102,187,106,.25)"),borderRadius:9,padding:"8px 12px",fontSize:fs.small,color:msg.error?"#EF5350":"#66BB6A"}}>{msg.text}</div>;

  if (!isDesktop) {
    return (
      <div style={{flex:1,overflowY:"auto",padding:"12px 14px"}}>
        {msgBox}
        <div style={{display:"grid",gridTemplateColumns:"1fr",gap:16,alignItems:"start",paddingBottom:16}}>
          {details}
          {ownerCard}
        </div>
      </div>
    );
  }

  // ── Desktop: header with save bar · details | branding + live preview | owner + at a glance ──
  var wide3 = !compact && window.innerWidth >= 1400;
  var previewAccent = form.accentColor && /^#[0-9A-F]{6}$/i.test(form.accentColor) ? normalizeAccent(form.accentColor) : DEFAULT_ACCENT;
  var detailsCard = (
    <div style={cardSt}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:14}}>
        <div style={{fontSize:fs.title,fontWeight:700,color:"#fff"}}>Company details</div>
        {!isOwner && <span style={{fontSize:fs.small,color:"rgba(255,255,255,.4)"}}>🔒 Owner only</span>}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        {ORG_FORM_FIELDS.map(function(d) {
          return (
            <div key={d.key} style={{gridColumn:d.full || d.key === "name" ? "1 / -1" : undefined}}>
              <label style={labelSt()}>{d.label}</label>
              <input value={form[d.key]} disabled={!isOwner} placeholder={isOwner ? d.placeholder : "—"}
                onChange={function(e){ var v = e.target.value; setForm(function(p){ var n = Object.assign({}, p); n[d.key] = v; return n; }); }}
                style={inputSt({marginBottom:0,fontSize:fs.base,opacity:isOwner?1:.75,cursor:isOwner?"text":"default"})}/>
            </div>
          );
        })}
      </div>
    </div>
  );
  var brandingCard = (
    <div style={cardSt}>
      <div style={{fontSize:fs.title,fontWeight:700,color:"#fff",marginBottom:4}}>Branding</div>
      <div style={{fontSize:fs.small,color:"rgba(255,255,255,.45)",marginBottom:14,lineHeight:1.5}}>Your logo replaces the OverCard mark and the accent colour themes the app for everyone in the organization.</div>
      <BrandingFields logo={form.logo} accent={form.accentColor} disabled={!isOwner} orgName={form.name}
        onChange={function(patch){ setForm(function(p){ return Object.assign({}, p, patch); }); }}/>
      {/* Live preview of the sidebar header + accent */}
      <div style={{marginTop:16}}>
        <label style={labelSt()}>Preview</label>
        <div style={{background:"#060d1a",border:"1px solid rgba(255,255,255,.08)",borderRadius:12,padding:"14px",display:"flex",flexDirection:"column",gap:12}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <OrgMark authUser={{ orgName: form.name, orgLogo: form.logo }} size={34}/>
            <span style={{fontSize:16,fontWeight:800,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{form.name || "Your company"}</span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",borderRadius:10,background:previewAccent + "1f",border:"1px solid " + previewAccent + "44"}}>
            <span style={{fontSize:14,fontWeight:700,color:previewAccent}}>▶ Play</span>
            <span style={{marginLeft:"auto",fontSize:11,fontWeight:700,color:previewAccent,border:"1px solid " + previewAccent + "55",borderRadius:99,padding:"1px 8px"}}>2</span>
          </div>
          <span style={Object.assign({}, solidBtn(previewAccent), {fontSize:13,padding:"9px 14px",borderRadius:10,cursor:"default"})}>Start Practice Session</span>
        </div>
      </div>
    </div>
  );
  var teamsN = (orgTeams || []).length;
  var roleN = { owner:0, admin:0, user:0 };
  (orgUsers || []).forEach(function(u){ roleN[u.role] = (roleN[u.role] || 0) + 1; });
  var glanceCard = (
    <div style={cardSt}>
      <div style={{fontSize:fs.title,fontWeight:700,color:"#fff",marginBottom:12}}>At a glance</div>
      <StatTiles items={[["Members", (orgUsers || []).length], ["Admin access", roleN.admin + roleN.owner, SESS_COLOR], ["Teams", teamsN, "#FFD54F"]]}/>
      <div style={{marginTop:12}}>
        {[["Created", org.createdAt ? fmtShortDate(org.createdAt) : "—"], ["Last updated", org.updatedAt ? fmtShortDate(org.updatedAt) : "—"], ["Org ID", org.id]].map(function(r) {
          return (
            <div key={r[0]} style={{display:"flex",justifyContent:"space-between",gap:12,fontSize:13,padding:"5px 0"}}>
              <span style={{color:"rgba(255,255,255,.45)"}}>{r[0]}</span>
              <span style={{color:"rgba(255,255,255,.8)",fontFamily:r[0] === "Org ID" ? "ui-monospace,Menlo,monospace" : "inherit",fontSize:r[0] === "Org ID" ? 12 : 13}}>{r[1]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{flexShrink:0,display:"flex",alignItems:"center",gap:compact ? 10 : 16,padding:compact ? "12px 16px" : "16px 24px",borderBottom:"1px solid rgba(255,255,255,.06)",flexWrap:"wrap"}}>
        <div style={{flex:1,minWidth:compact ? 200 : 0}}>
          <div style={{fontSize:compact ? 18 : 20,fontWeight:700,color:"#fff"}}>Organization settings</div>
          <div style={{fontSize:13,color:"rgba(255,255,255,.45)",marginTop:2}}>{isOwner ? (dirty ? "You have unsaved changes." : "Changes apply to everyone in " + (org.name || "the organization") + ".") : "Only the owner can change these settings."}</div>
        </div>
        {isOwner && (
          <>
            <button onClick={function(){ setForm(toForm(org)); }} disabled={!dirty || busy} style={Object.assign({}, ghostBtn(), {padding:"10px 20px",fontSize:14,minHeight:compact ? 44 : undefined})}>Discard</button>
            <button onClick={save} disabled={!dirty || busy || badAccent} style={Object.assign({}, solidBtn(SESS_COLOR), {padding:"10px 26px",fontSize:14,minHeight:compact ? 44 : undefined})}>{busy ? "Saving…" : "Save changes"}</button>
          </>
        )}
      </div>
      <div style={{flex:1,overflowY:"auto",padding:compact ? "16px" : "20px 24px"}}>
        {msgBox}
        <div style={{display:"grid",gridTemplateColumns:wide3 ? "minmax(0,1fr) minmax(0,1.1fr) minmax(300px,360px)" : stacked ? "minmax(0,1fr)" : "minmax(0,1.4fr) minmax(280px,1fr)",gap:compact ? 16 : 24,alignItems:"start",paddingBottom:16}}>
          {wide3 ? detailsCard : <div style={{display:"flex",flexDirection:"column",gap:24}}>{detailsCard}{brandingCard}</div>}
          {wide3 && brandingCard}
          <div style={{display:"flex",flexDirection:"column",gap:24}}>{ownerCard}{glanceCard}</div>
        </div>
      </div>
    </div>
  );
}

// ─── ADMIN SIDE PANELS (desktop) ──────────────────────────────────────────────
// Fill the space beside the Users / Teams editors with live data about the selection.
function sessStats(list) {
  var live = list.filter(function(x){ return (x.mode || "live") === "live"; });
  var sold = live.filter(function(x){ return x.sold || x.outcome === "sold"; }).length;
  var durs = list.filter(function(x){ return x.endTs && x.startTs; }).map(function(x){ return x.endTs - x.startTs; });
  var avg = durs.length ? durs.reduce(function(a, b){ return a + b; }, 0) / durs.length : 0;
  var last = list.reduce(function(m, x){ return Math.max(m, x.startTs || 0); }, 0);
  return { total:list.length, live:live.length, practice:list.length - live.length, sold:sold,
    rate: live.length ? Math.round(sold / live.length * 100) : null, avgMs:avg, last:last };
}
function fmtDurShort(ms) {
  if (!ms) return "—";
  var sec = Math.round(ms / 1000);
  return sec < 60 ? sec + "s" : Math.floor(sec / 60) + "m " + (sec % 60 ? (sec % 60) + "s" : "");
}
var SIDE_CARD = { background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.08)", borderRadius:14, padding:"16px 18px" };
function SideTitle({ children, right }) {
  return (
    <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:8,marginBottom:12}}>
      <div style={{fontSize:15,fontWeight:700,color:"#fff"}}>{children}</div>
      {right && <div style={{fontSize:12,color:"rgba(255,255,255,.4)"}}>{right}</div>}
    </div>
  );
}
function StatTiles({ items }) {
  return (
    <div style={{display:"grid",gridTemplateColumns:"repeat(3, minmax(0,1fr))",gap:10}}>
      {items.map(function(it) {
        return (
          <div key={it[0]} style={{background:"rgba(0,0,0,.2)",borderRadius:10,padding:"10px 12px",minWidth:0}}>
            <div style={{fontSize:22,fontWeight:800,color:it[2] || "#fff",lineHeight:1.1,fontVariantNumeric:"tabular-nums"}}>{it[1]}</div>
            <div style={{fontSize:12,color:"rgba(255,255,255,.45)",marginTop:3,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{it[0]}</div>
          </div>
        );
      })}
    </div>
  );
}
function outcomeChip(x) {
  var o = (x.mode || "live") === "practice" ? ["Practice","#00B4FF"] : (x.sold || x.outcome === "sold") ? ["Sold","#66BB6A"]
    : x.outcome === "booked" ? ["Booked","#FFD54F"] : x.outcome === "not_contacted" ? ["No contact","rgba(255,255,255,.55)"]
    : x.outcome === "abandoned" ? ["Abandoned","#EF5350"] : ["Live","rgba(255,255,255,.7)"];
  return <span style={{fontSize:11,fontWeight:700,color:o[1],border:"1px solid "+(o[1][0]==="#"?o[1]+"55":"rgba(255,255,255,.2)"),borderRadius:99,padding:"2px 8px",flexShrink:0}}>{o[0]}</span>;
}

// Selected user's call activity + account facts
function UserActivity({ user, teams }) {
  var [list, setList] = useState(null);
  useEffect(function() {
    var cancelled = false;
    var url = "/sessions?scope=user:" + encodeURIComponent(user.id);
    setList(peek(url) || null);
    cachedGet(url)
      .then(function(d){ if (!cancelled) setList(Array.isArray(d) ? d : []); })
      .catch(function(){ if (!cancelled) setList([]); });
    return function(){ cancelled = true; };
  }, [user.id]);
  var st = list ? sessStats(list) : null;
  var recent = list ? list.slice().sort(function(a, b){ return b.startTs - a.startTs; }).slice(0, 6) : [];
  return (
    <div style={{display:"flex",flexDirection:"column",gap:16,minWidth:0}}>
      <div style={SIDE_CARD}>
        <SideTitle right={st && st.last ? "Last call " + fmtShortDate(st.last) : null}>Call activity</SideTitle>
        {!st ? <div style={{fontSize:13,color:"rgba(255,255,255,.4)"}}>Loading…</div> : (
          <StatTiles items={[
            ["Sessions", st.total], ["Live calls", st.live], ["Practice", st.practice, "#00B4FF"],
            ["Sold", st.sold, "#66BB6A"], ["Close rate", st.rate === null ? "—" : st.rate + "%", SESS_COLOR], ["Avg call", fmtDurShort(st.avgMs), "#FFD54F"],
          ]}/>
        )}
      </div>
      <div style={SIDE_CARD}>
        <SideTitle right={list ? list.length + " total" : null}>Recent calls</SideTitle>
        {list && recent.length === 0 && <div style={{fontSize:13,color:"rgba(255,255,255,.4)"}}>No sessions yet.</div>}
        {recent.map(function(x, i) {
          return (
            <div key={x.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderTop:i ? "1px solid rgba(255,255,255,.06)" : "none"}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:14,fontWeight:600,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{x.name}</div>
                <div style={{fontSize:12,color:"rgba(255,255,255,.4)",marginTop:1}}>{x.deckName} · {fmtShortDate(x.startTs)}{x.endTs ? " · " + fmtDurShort(x.endTs - x.startTs) : ""}</div>
              </div>
              {outcomeChip(x)}
            </div>
          );
        })}
      </div>
      <div style={SIDE_CARD}>
        <SideTitle>Account</SideTitle>
        {[["Email", user.email], ["Phone", user.phone || "—"], ["Teams", teams.length ? teams.map(function(t){ return t.name; }).join(", ") : "—"],
          ["Joined", user.createdAt ? fmtShortDate(user.createdAt) : "—"], ["Last login", user.lastLoginAt ? fmtShortDate(user.lastLoginAt) : "Never"]].map(function(r) {
          return (
            <div key={r[0]} style={{display:"flex",justifyContent:"space-between",gap:12,fontSize:13,padding:"5px 0"}}>
              <span style={{color:"rgba(255,255,255,.45)"}}>{r[0]}</span>
              <span style={{color:"rgba(255,255,255,.85)",textAlign:"right",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",minWidth:0}}>{r[1]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Selected team's results + per-member roster
function TeamOverview({ team, orgUsers }) {
  var [list, setList] = useState(null);
  useEffect(function() {
    var cancelled = false;
    var url = "/sessions?scope=team:" + encodeURIComponent(team.id);
    setList(peek(url) || null);
    cachedGet(url)
      .then(function(d){ if (!cancelled) setList(Array.isArray(d) ? d : []); })
      .catch(function(){ if (!cancelled) setList([]); });
    return function(){ cancelled = true; };
  }, [team.id]);
  var st = list ? sessStats(list) : null;
  var members = (team.memberIds || []).map(function(id){ return (orgUsers || []).find(function(u){ return u.id === id; }); }).filter(Boolean);
  var rows = members.map(function(u) {
    var ms = sessStats((list || []).filter(function(x){ return x.userId === u.id; }));
    return { u:u, st:ms };
  }).sort(function(a, b){ return (b.st.rate === null ? -1 : b.st.rate) - (a.st.rate === null ? -1 : a.st.rate) || b.st.total - a.st.total; });
  return (
    <div style={{display:"flex",flexDirection:"column",gap:16,minWidth:0}}>
      <div style={SIDE_CARD}>
        <SideTitle right={members.length + " member" + (members.length !== 1 ? "s" : "")}>Team results</SideTitle>
        {!st ? <div style={{fontSize:13,color:"rgba(255,255,255,.4)"}}>Loading…</div> : (
          <StatTiles items={[
            ["Sessions", st.total], ["Live calls", st.live], ["Sold", st.sold, "#66BB6A"],
            ["Close rate", st.rate === null ? "—" : st.rate + "%", SESS_COLOR], ["Avg call", fmtDurShort(st.avgMs), "#FFD54F"], ["Last call", st.last ? fmtShortDate(st.last) : "—"],
          ]}/>
        )}
      </div>
      <div style={SIDE_CARD}>
        <SideTitle right="by close rate">Roster</SideTitle>
        {members.length === 0 && <div style={{fontSize:13,color:"rgba(255,255,255,.4)"}}>No members yet.</div>}
        {members.length > 0 && (
          <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 70px 60px 70px",gap:8,fontSize:12,color:"rgba(255,255,255,.4)",paddingBottom:6,borderBottom:"1px solid rgba(255,255,255,.07)"}}>
            <span>Member</span><span style={{textAlign:"right"}}>Sessions</span><span style={{textAlign:"right"}}>Sold</span><span style={{textAlign:"right"}}>Close</span>
          </div>
        )}
        {rows.map(function(r) {
          var m = roleMeta(r.u.role);
          var isAdm = (team.adminIds || []).indexOf(r.u.id) !== -1;
          return (
            <div key={r.u.id} style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 70px 60px 70px",gap:8,alignItems:"center",padding:"8px 0",borderBottom:"1px solid rgba(255,255,255,.05)",fontSize:14}}>
              <span style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
                <span style={{width:28,height:28,borderRadius:"50%",background:m.bg,border:"1px solid "+m.border,color:m.color,fontSize:12,fontWeight:700,display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{(r.u.displayName || "?")[0].toUpperCase()}</span>
                <span style={{color:"#fff",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.u.displayName}</span>
                {isAdm && <span style={{fontSize:10,fontWeight:700,color:SESS_COLOR,border:"1px solid "+accentA(.35),borderRadius:99,padding:"1px 6px",flexShrink:0}}>LEAD</span>}
              </span>
              <span style={{textAlign:"right",color:"rgba(255,255,255,.8)",fontVariantNumeric:"tabular-nums"}}>{list ? r.st.total : "…"}</span>
              <span style={{textAlign:"right",color:"#66BB6A",fontVariantNumeric:"tabular-nums"}}>{list ? r.st.sold : "…"}</span>
              <span style={{textAlign:"right",color:"rgba(255,255,255,.8)",fontWeight:700,fontVariantNumeric:"tabular-nums"}}>{list ? (r.st.rate === null ? "—" : r.st.rate + "%") : "…"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Nothing selected on Users: an org roster snapshot instead of an empty pane
function RosterOverview({ users, teams, onOpen }) {
  var counts = { owner:0, admin:0, user:0 };
  users.forEach(function(u){ counts[u.role] = (counts[u.role] || 0) + 1; });
  var recent = users.slice().sort(function(a, b){ return (b.createdAt || 0) - (a.createdAt || 0); }).slice(0, 6);
  var weekAgo = Date.now() - 14 * 24 * 3600 * 1000;
  var idle = users.filter(function(u){ return !u.lastLoginAt || u.lastLoginAt < weekAgo; }).slice(0, 6);
  function row(u, meta) {
    var m = roleMeta(u.role);
    return (
      <button key={u.id} onClick={function(){ onOpen(u); }}
        style={{display:"flex",alignItems:"center",gap:10,width:"100%",textAlign:"left",background:"transparent",border:"none",borderTop:"1px solid rgba(255,255,255,.06)",padding:"8px 0",cursor:"pointer",fontFamily:"inherit"}}>
        <span style={{width:28,height:28,borderRadius:"50%",background:m.bg,border:"1px solid "+m.border,color:m.color,fontSize:12,fontWeight:700,display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{(u.displayName || "?")[0].toUpperCase()}</span>
        <span style={{flex:1,minWidth:0,fontSize:14,color:"#fff",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.displayName}</span>
        <span style={{fontSize:12,color:"rgba(255,255,255,.45)",flexShrink:0}}>{meta}</span>
      </button>
    );
  }
  return (
    <div style={{flex:1,overflowY:"auto",padding:"24px 28px"}}>
      <div style={{fontSize:20,fontWeight:700,color:"#fff",marginBottom:4}}>People</div>
      <div style={{fontSize:14,color:"rgba(255,255,255,.45)",marginBottom:18}}>Select someone on the left to edit them, or add a new user.</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(150px, 1fr))",gap:12,marginBottom:16}}>
        {[["Members", users.length, "#fff"], ["Owner", counts.owner, roleMeta("owner").color], ["Admins", counts.admin, SESS_COLOR], ["Users", counts.user, "#00B4FF"], ["Teams", teams.length, "#FFD54F"]].map(function(k) {
          return (
            <div key={k[0]} style={SIDE_CARD}>
              <div style={{fontSize:28,fontWeight:800,color:k[2],lineHeight:1.1}}>{k[1]}</div>
              <div style={{fontSize:13,color:"rgba(255,255,255,.5)",marginTop:4}}>{k[0]}</div>
            </div>
          );
        })}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(300px, 1fr))",gap:16,alignItems:"start"}}>
        <div style={SIDE_CARD}>
          <SideTitle>Recently joined</SideTitle>
          {recent.map(function(u){ return row(u, u.createdAt ? fmtShortDate(u.createdAt) : ""); })}
        </div>
        <div style={SIDE_CARD}>
          <SideTitle right="no login in 14 days">Inactive</SideTitle>
          {idle.length === 0 && <div style={{fontSize:13,color:"#66BB6A"}}>✓ Everyone has signed in recently.</div>}
          {idle.map(function(u){ return row(u, u.lastLoginAt ? "Last " + fmtShortDate(u.lastLoginAt) : "Never signed in"); })}
        </div>
      </div>
    </div>
  );
}

var EMPTY_UF = { email:"", firstName:"", lastName:"", phone:"", role:"user", teamId:"", password:"" };

export function AdminPanel({ authUser, orgUsers, orgTeams, onRefreshUsers, onRefreshTeams, onOrgUpdated }) {
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
            <div style={{fontSize:fs.small,color:SESS_COLOR,marginTop:6}}>Promoting to admin — they'll be able to edit decks and manage users.</div>
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
                style={{background:on?accentA(.15):"rgba(255,255,255,.05)",border:"1px solid "+(on?accentA(.4):"rgba(255,255,255,.1)"),borderRadius:8,padding:D?"7px 14px":"5px 11px",cursor:"pointer",fontFamily:"inherit",fontSize:D?13:11,color:on?SESS_COLOR:"rgba(255,255,255,.45)",fontWeight:on?700:400}}>{a.displayName}</button>;
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
                style={ghostSm({color:SESS_COLOR,borderColor:accentA(.3),fontSize:D?13:12,padding:"7px 12px"})}>+ Add</button>
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
    // Side-by-side editor + data columns need roughly 1100px of detail pane
    var wideDetail = !compact && window.innerWidth >= 1400;
    if (sub === "users") {
      listPane = (
        <div>
          <button onClick={function(){resetUf();setEditUser("new");}}
            style={{display:"block",width:"100%",background:accentA(.06),border:("1px dashed "+accentA(.25)),borderRadius:10,padding:"10px",minHeight:compact?44:undefined,cursor:"pointer",fontSize:14,color:accentA(.8),fontFamily:"inherit",marginBottom:10,textAlign:"center",fontWeight:600}}>
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
          {/* Editor left, the person's activity right (single column on narrow panes) */}
          <div style={{display:"grid",gridTemplateColumns:wideDetail ? "minmax(380px,1.05fr) minmax(320px,1fr)" : "minmax(0,1fr)",gap:24,alignItems:"start"}}>
          <div style={{minWidth:0}}>
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
          {editUser !== "new" ? <UserActivity user={editUser} teams={teamsOf(editUser)}/> : (
            <div style={SIDE_CARD}>
              <SideTitle>Inviting lots of people?</SideTitle>
              <div style={{fontSize:14,color:"rgba(255,255,255,.6)",lineHeight:1.6,marginBottom:12}}>Generate a share code instead — employees sign up themselves with their own password and join as users.</div>
              <button onClick={function(){ setSub("codes"); setEditUser(null); }} style={ghostSm({fontSize:13,color:"#fff",padding:"8px 14px"})}>🔑 Go to Share Codes</button>
            </div>
          )}
          </div>
        </div>
      ) : (
        <RosterOverview users={sortedUsers} teams={orgTeams || []} onOpen={openUser}/>
      );
    } else if (sub === "teams") {
      listPane = (
        <div>
          <button onClick={function(){resetTf();setEditTeam("new");}}
            style={{display:"block",width:"100%",background:accentA(.06),border:("1px dashed "+accentA(.25)),borderRadius:10,padding:"10px",minHeight:compact?44:undefined,cursor:"pointer",fontSize:14,color:accentA(.8),fontFamily:"inherit",marginBottom:10,textAlign:"center",fontWeight:600}}>
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
          <div style={{display:"grid",gridTemplateColumns:wideDetail && editTeam !== "new" ? "minmax(380px,1.05fr) minmax(320px,1fr)" : "minmax(0,1fr)",gap:24,alignItems:"start"}}>
            <div style={{minWidth:0,maxWidth:editTeam === "new" ? 720 : undefined}}>
              <div style={{fontSize:compact?18:20,fontWeight:700,color:"#fff",marginBottom:18}}>{editTeam==="new"?"New Team":editTeam.name}</div>
              {renderTeamForm()}
            </div>
            {editTeam !== "new" && <TeamOverview team={editTeam} orgUsers={orgUsers}/>}
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
        {sub === "codes" && <ShareCodesPanel isDesktop={true} orgUsers={orgUsers} compact={compact} stacked={stackedA}/>}
        {sub === "org"   && <OrgPanel authUser={authUser} orgUsers={orgUsers} orgTeams={orgTeams} isDesktop={true} onOrgUpdated={onOrgUpdated} compact={compact} stacked={stackedA}/>}
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
      {sub === "org"   && <OrgPanel authUser={authUser} orgUsers={orgUsers} isDesktop={false} onOrgUpdated={onOrgUpdated}/>}

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
                        return <span key={a.id} style={{fontSize:9,padding:"2px 8px",borderRadius:99,background:accentA(.1),color:SESS_COLOR,border:("1px solid "+accentA(.25))}}>{a.displayName}</span>;
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
