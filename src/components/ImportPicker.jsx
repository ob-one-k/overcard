import { useState, useContext, useMemo } from "react";
import { TM, OBJ_COLOR, themed } from "../lib/constants";
import { solidBtn, ghostBtn, iconBtn, inputSt, SHEET_MAX_H, overlayFill } from "../lib/styles";
import { stripMarkup } from "../lib/richtext";
import { collectBranch, cloneCards, cloneStack, liveStacks } from "../lib/deckOps";
import { Handle } from "./ui";
import { DesktopModal } from "./DesktopModal";
import DesktopCtx from "../lib/DesktopCtx";

var TXT2 = "rgba(255,255,255,.72)";
var TXT3 = "rgba(255,255,255,.5)";
var LINE = "rgba(255,255,255,.08)";
var CARD_TYPES = ["pitch", "discovery", "close"];

// ─── IMPORT PICKER ────────────────────────────────────────────────────────────
// Copy cards (optionally with everything they lead to) or whole objection stacks
// from another deck in the org into the current one. Copies get fresh ids, so the
// source deck is never touched. Desktop/tablet: modal · phone: bottom sheet.
//   mode="cards"  → onImport({ cards, firstId })      (copies join off the intended path)
//   mode="stacks" → onImport({ stacks })              (targetCard cleared — it pointed into the source deck)
export function ImportPicker({ mode, decks, currentDeckId, onImport, onClose }) {
  var desktop = useContext(DesktopCtx);
  var sources = (decks || []).filter(function(d) {
    if (d.id === currentDeckId || d.archivedAt) return false;
    return mode === "stacks" ? liveStacks(d).length > 0 : Object.keys(d.cards || {}).length > 0;
  });
  var [sourceId, setSourceId] = useState(sources.length ? sources[0].id : null);
  var [picked, setPicked]     = useState({});
  var [withBranch, setWithBranch] = useState(false);
  var [search, setSearch]     = useState("");
  var source = sources.find(function(d) { return d.id === sourceId; }) || null;
  var accent = mode === "stacks" ? OBJ_COLOR : (source ? source.color : "#00B4FF");

  function pickSource(id) { setSourceId(id); setPicked({}); setSearch(""); }
  function toggle(id) { setPicked(function(p) { var n = Object.assign({}, p); if (n[id]) delete n[id]; else n[id] = true; return n; }); }
  var pickedIds = Object.keys(picked);

  // Cards that will actually be copied (selected + their downstream branch when ticked)
  var copyIds = useMemo(function() {
    if (mode !== "cards" || !source) return [];
    if (!withBranch) return pickedIds;
    var all = {};
    pickedIds.forEach(function(id) { collectBranch(source.cards, id).forEach(function(x) { all[x] = true; }); });
    return Object.keys(all);
  }, [mode, source, withBranch, pickedIds.join(",")]);

  function confirm() {
    if (!source || !pickedIds.length) return;
    if (mode === "stacks") {
      var stacks = liveStacks(source).filter(function(st) { return picked[st.id]; }).map(function(st) { return cloneStack(st, null); });
      onImport({ stacks:stacks });
    } else {
      var res = cloneCards(source.cards, copyIds, { clearIntended:true });
      onImport({ cards:res.cards, firstId:res.idMap[pickedIds[0]] });
    }
    onClose();
  }

  var q = search.trim().toLowerCase();
  function matches(text) { return !q || (text || "").toLowerCase().indexOf(q) !== -1; }

  function renderRow(id, title, sub, badge, extra) {
    var on = !!picked[id];
    return (
      <button key={id} onClick={function(){ toggle(id); }} aria-pressed={on}
        style={{display:"flex",alignItems:"flex-start",gap:12,width:"100%",textAlign:"left",background:on?accent+"1a":"rgba(255,255,255,.03)",border:"1px solid "+(on?accent+"77":LINE),borderRadius:12,padding:"10px 12px",marginBottom:6,cursor:"pointer",fontFamily:"inherit",minHeight:48}}>
        <span style={{width:20,height:20,borderRadius:6,border:"2px solid "+(on?accent:"rgba(255,255,255,.3)"),background:on?accent:"transparent",color:"#000",fontSize:13,fontWeight:900,display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>{on ? "✓" : ""}</span>
        <span style={{flex:1,minWidth:0}}>
          <span style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            {badge}
            <span style={{fontSize:14,fontWeight:700,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"100%"}}>{title || "Untitled"}</span>
            {extra}
          </span>
          {sub && <span style={{display:"block",fontSize:12.5,color:TXT3,marginTop:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{sub}</span>}
        </span>
      </button>
    );
  }

  var list = null;
  if (source && mode === "stacks") {
    list = liveStacks(source).filter(function(st) { return matches(st.label); }).map(function(st) {
      var n = Object.keys(st.cards || {}).length;
      return renderRow(st.id, st.label, n + " card" + (n !== 1 ? "s" : ""), <span style={{fontSize:18}}>{st.icon}</span>);
    });
  } else if (source) {
    list = CARD_TYPES.map(function(t) {
      var group = Object.values(source.cards || {}).filter(function(c) {
        return c.type === t && (matches(c.title) || matches(stripMarkup(c.prompt || "")));
      }).sort(function(a, b) { return (a.sortIndex || 0) - (b.sortIndex || 0); });
      if (!group.length) return null;
      return (
        <div key={t} style={{marginBottom:10}}>
          <div style={{fontSize:11,fontWeight:800,letterSpacing:1.1,textTransform:"uppercase",color:TM[t].color,padding:"4px 2px 6px"}}>{TM[t].icon} {TM[t].label}</div>
          {group.map(function(c) {
            var n = collectBranch(source.cards, c.id).length - 1;
            return renderRow(c.id, c.title, stripMarkup(c.prompt || "") || "No script", null,
              n > 0 ? <span style={{fontSize:11,color:TXT3}}>leads to {n} more</span> : null);
          })}
        </div>
      );
    });
  }

  var count = mode === "stacks" ? pickedIds.length : copyIds.length;
  var noun  = mode === "stacks" ? "stack" : "card";
  var body = (
    <div style={{display:"flex",flexDirection:"column",minHeight:0,maxHeight:desktop.isDesktop ? "calc(85vh - 64px)" : "none",flex:1}}>
      <div style={{padding:"12px 20px",borderBottom:"1px solid "+LINE,flexShrink:0}}>
        {sources.length === 0 ? (
          <div style={{fontSize:14,color:TXT2,lineHeight:1.6,padding:"8px 0"}}>
            No other deck in your organization has {mode === "stacks" ? "objection stacks" : "cards"} to copy yet.
          </div>
        ) : (
          <>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:1,textTransform:"uppercase",color:TXT3,marginBottom:8}}>Copy from</div>
            <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:4}}>
              {sources.map(function(d) {
                var on = d.id === sourceId;
                return (
                  <button key={d.id} onClick={function(){ pickSource(d.id); }}
                    style={{display:"inline-flex",alignItems:"center",gap:6,flexShrink:0,background:on?d.color+"22":"rgba(255,255,255,.05)",border:"1.5px solid "+(on?d.color:"rgba(255,255,255,.1)"),borderRadius:99,padding:"6px 12px",minHeight:36,cursor:"pointer",fontFamily:"inherit",fontSize:13,color:on?"#fff":TXT2,fontWeight:on?700:500}}>
                    <span>{d.icon}</span>{d.name}
                  </button>
                );
              })}
            </div>
            <input value={search} onChange={function(e){ setSearch(e.target.value); }}
              placeholder={mode === "stacks" ? "Search stacks…" : "Search cards…"} aria-label="Search"
              style={inputSt({marginTop:10,marginBottom:0,height:38,fontSize:14})}/>
          </>
        )}
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"12px 20px",minHeight:120}}>{list}</div>
      {source && (
        <div style={{borderTop:"1px solid "+LINE,padding:"12px 20px",flexShrink:0,display:"flex",flexDirection:"column",gap:10}}>
          {mode === "cards" && (
            <button role="checkbox" aria-checked={withBranch} onClick={function(){ setWithBranch(!withBranch); }}
              style={{display:"flex",alignItems:"center",gap:10,fontSize:13.5,color:TXT2,cursor:"pointer",background:"none",border:"none",padding:"4px 0",fontFamily:"inherit",textAlign:"left",minHeight:36}}>
              <span style={{width:20,height:20,borderRadius:6,border:"2px solid "+(withBranch?accent:"rgba(255,255,255,.3)"),background:withBranch?accent:"transparent",color:"#000",fontSize:13,fontWeight:900,display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{withBranch ? "✓" : ""}</span>
              Include everything each card leads to
            </button>
          )}
          <div style={{fontSize:12,color:TXT3,lineHeight:1.5}}>
            {mode === "cards"
              ? "Copies are added off the intended path. Responses that point to cards you didn't copy are left unlinked."
              : "Copies keep their cards. Choose where each one returns after resolving once it's added."}
          </div>
          <div style={{display:"flex",gap:10}}>
            <button onClick={onClose} style={Object.assign({}, ghostBtn(), {flex:1})}>Cancel</button>
            <button onClick={confirm} disabled={!count}
              style={Object.assign({}, solidBtn(accent), {flex:2,opacity:count?1:.45,cursor:count?"pointer":"default"})}>
              {count ? "Copy " + count + " " + noun + (count !== 1 ? "s" : "") : "Select " + noun + "s"}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  var title = mode === "stacks" ? "Copy objection stacks from another deck" : "Copy cards from another deck";
  if (desktop.isDesktop) return <DesktopModal title={title} width={640} onClose={onClose}>{body}</DesktopModal>;
  return (
    <div style={overlayFill(320)}>
      <div onClick={onClose} style={{flex:1,background:"rgba(0,0,0,.6)",backdropFilter:"blur(8px)"}}/>
      <div style={{background:themed("#081428"),borderRadius:"24px 24px 0 0",border:"1px solid rgba(255,255,255,.1)",borderBottom:"none",maxHeight:SHEET_MAX_H,height:SHEET_MAX_H,display:"flex",flexDirection:"column",animation:"sheetUp .3s cubic-bezier(.22,1,.36,1) both"}}>
        <Handle/>
        <div style={{padding:"0 20px 10px",display:"flex",alignItems:"center",gap:10}}>
          <div style={{flex:1,fontSize:16,fontWeight:700,color:"#fff",fontFamily:"'Lora',serif"}}>{title}</div>
          <button onClick={onClose} style={iconBtn()}>✕</button>
        </div>
        {body}
      </div>
    </div>
  );
}
