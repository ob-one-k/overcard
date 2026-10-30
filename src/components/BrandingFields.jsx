import { useState, useRef } from "react";
import { labelSt, inputSt, ghostSm, solidBtn } from "../lib/styles";
import { DEFAULT_ACCENT, normalizeAccent } from "../lib/constants";

// ─── ORG BRANDING FIELDS ──────────────────────────────────────────────────────
// Logo upload + accent colour, used by org creation (Signup) and org settings (Admin → Organization).
// Uploaded images are re-drawn onto a canvas (≤256px, PNG) in the browser: this keeps the stored
// data: URL small and turns any format — including SVG — into a plain raster image.

export var ACCENT_PRESETS = ["#A8FF3E","#00B4FF","#4DB6AC","#FFD54F","#FF8A65","#F5A623","#7C4DFF","#EF5350","#EC407A","#26C6DA"];
var MAX_SIDE = 256;

export function imageFileToDataUrl(file) {
  return new Promise(function(resolve, reject) {
    if (!file || !/^image\//.test(file.type)) { reject(new Error("Choose an image file (PNG, JPG, WebP or SVG).")); return; }
    if (file.size > 8 * 1024 * 1024) { reject(new Error("That image is over 8 MB — pick a smaller file.")); return; }
    var reader = new FileReader();
    reader.onerror = function() { reject(new Error("Couldn't read that file.")); };
    reader.onload = function() {
      var img = new Image();
      img.onerror = function() { reject(new Error("That file isn't an image this browser can open.")); };
      img.onload = function() {
        var w = img.naturalWidth || MAX_SIDE, h = img.naturalHeight || MAX_SIDE;
        var scale = Math.min(1, MAX_SIDE / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
        var c = document.createElement("canvas");
        c.width = cw; c.height = ch;
        c.getContext("2d").drawImage(img, 0, 0, cw, ch);
        var url = c.toDataURL("image/png");
        if (url.length > 380000) url = c.toDataURL("image/webp", 0.85);   // photos: fall back to WebP
        resolve(url);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export function BrandingFields({ logo, accent, onChange, disabled, size, orgName }) {
  var lg = size === "lg";
  var fs = lg ? { body:14, small:13 } : { body:13, small:12 };
  var [err, setErr] = useState("");
  var [busy, setBusy] = useState(false);
  var fileRef = useRef(null);
  var shown = accent ? normalizeAccent(accent) : DEFAULT_ACCENT;
  var adjusted = accent && normalizeAccent(accent) !== accent.toUpperCase();

  function pick(e) {
    var f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    setErr(""); setBusy(true);
    imageFileToDataUrl(f)
      .then(function(url) { setBusy(false); onChange({ logo: url }); })
      .catch(function(x) { setBusy(false); setErr(x.message); });
  }

  return (
    <div style={{display:"grid",gridTemplateColumns:lg ? "minmax(0,1fr) minmax(0,1.3fr)" : "1fr",gap:lg ? 20 : 14}}>
      {/* Logo */}
      <div>
        <label style={labelSt()}>Logo</label>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <div style={{width:72,height:72,borderRadius:18,background:"rgba(255,255,255,.05)",border:"1.5px dashed rgba(255,255,255,.18)",display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",flexShrink:0}}>
            {logo
              ? <img src={logo} alt="Organization logo preview" style={{width:"100%",height:"100%",objectFit:"contain"}}/>
              : <span style={{fontSize:28,fontWeight:900,color:shown}}>{(orgName || "?").trim()[0] ? (orgName || "?").trim()[0].toUpperCase() : "?"}</span>}
          </div>
          {!disabled && (
            <div style={{display:"flex",flexDirection:"column",gap:6,minWidth:0}}>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={pick} style={{display:"none"}}/>
              <button type="button" onClick={function(){ fileRef.current && fileRef.current.click(); }} disabled={busy}
                style={ghostSm({fontSize:fs.body,color:"#fff",padding:lg?"8px 14px":"6px 12px"})}>{busy ? "Processing…" : logo ? "Replace logo" : "Upload logo"}</button>
              {logo && <button type="button" onClick={function(){ onChange({ logo: null }); }}
                style={ghostSm({fontSize:fs.small,color:"#EF5350",borderColor:"rgba(239,83,80,.3)",padding:"4px 10px"})}>Remove</button>}
              <span style={{fontSize:fs.small - 1,color:"rgba(255,255,255,.4)"}}>Square images work best · resized to 256px</span>
            </div>
          )}
        </div>
        {err && <div role="alert" style={{fontSize:fs.small,color:"#EF5350",marginTop:8}}>{err}</div>}
      </div>

      {/* Accent colour */}
      <div>
        <label style={labelSt()}>Accent colour</label>
        <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:10}}>
          {ACCENT_PRESETS.map(function(c) {
            var on = shown.toUpperCase() === c;
            return (
              <button key={c} type="button" disabled={disabled} onClick={function(){ onChange({ accentColor: c }); }} aria-label={"Accent " + c} aria-pressed={on}
                style={{width:lg?32:28,height:lg?32:28,borderRadius:"50%",background:c,border:"none",cursor:disabled?"default":"pointer",
                  boxShadow:on ? "0 0 0 2px #060d1a, 0 0 0 4px " + c : "none",opacity:disabled && !on ? .45 : 1}}/>
            );
          })}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <input type="color" value={shown} disabled={disabled} onChange={function(e){ onChange({ accentColor: e.target.value.toUpperCase() }); }} aria-label="Custom accent colour"
            style={{width:44,height:36,padding:0,border:"1px solid rgba(255,255,255,.15)",borderRadius:8,background:"transparent",cursor:disabled?"default":"pointer"}}/>
          <input value={accent || ""} disabled={disabled} placeholder={DEFAULT_ACCENT} maxLength={7}
            onChange={function(e){ var v = e.target.value.trim(); if (/^#?[0-9a-f]{0,6}$/i.test(v)) onChange({ accentColor: v ? (v[0] === "#" ? v : "#" + v).toUpperCase() : null }); }}
            style={inputSt({width:110,marginBottom:0,fontSize:fs.body,padding:"8px 10px",fontFamily:"ui-monospace,Menlo,monospace"})}/>
          {/* Live preview of how the accent reads in the app */}
          <span style={Object.assign({}, solidBtn(shown), {fontSize:fs.small,padding:"8px 14px",borderRadius:10,cursor:"default"})}>Button</span>
          <span style={{fontSize:fs.small,fontWeight:700,color:shown,background:shown + "22",border:"1px solid " + shown + "55",borderRadius:99,padding:"3px 10px"}}>Badge</span>
        </div>
        {adjusted && <div style={{fontSize:fs.small - 1,color:"rgba(255,255,255,.45)",marginTop:6}}>Lightened to {shown} so it stays readable on the dark theme.</div>}
        {accent && !/^#[0-9A-F]{6}$/.test(accent) && <div style={{fontSize:fs.small - 1,color:"#FFB300",marginTop:6}}>Use a 6-digit hex colour like #A8FF3E.</div>}
      </div>
    </div>
  );
}
