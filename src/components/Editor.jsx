import { useState, useEffect, useRef, useContext } from "react";
import { TM, INFLECTIONS, INFL_CATS, aid } from "../lib/constants";
import { solidBtn, ghostBtn, ghostSm, iconBtn, labelSt, inputSt, cardBg, SHEET_MAX_H } from "../lib/styles";
import { TypeBadge, SectionHdr, IntendedBadge, Handle } from "./ui";
import { TipCtx, OverviewEditor, RichPromptDisplay } from "./Tooltip";
import { parseRichText, stripMarkup } from "../lib/richtext";
import { INFL_MAP, uid } from "../lib/constants";

// ─── RICH PROMPT EDITOR ───────────────────────────────────────────────────────
// contentEditable-based editor — renders formatted text inline, no raw markup.
// Stores/loads our markdown format (*text*[Label], **text**) behind the scenes.
export function RichPromptEditor({ value, onChange, accentColor }) {
  var editorRef      = useRef(null);
  var isInternal     = useRef(false);
  var editNodeRef    = useRef(null); // <em> node being re-inflected
  var [showPicker,   setShowPicker]   = useState(false);
  var [selRange,     setSelRange]     = useState(null);
  var [hasSel,       setHasSel]       = useState(false);
  var [cursorInFmt,  setCursorInFmt]  = useState(null); // { node, inf:string|null, isBold:bool }
  var [pickerMode,   setPickerMode]   = useState("new"); // "new" | "edit"

  // SECURITY NOTE: escH() is the XSS-prevention mechanism for the contentEditable
  // rich-text editor. All user content is passed through this function before being
  // inserted as innerHTML via mdToHtml(). It escapes &, <, and > to their HTML entities.
  // Any change to innerHTML rendering MUST continue to use escH() for all user content.
  function escH(s) { return (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

  function mdToHtml(md) {
    if (!md) return "";
    return parseRichText(md).map(function(seg) {
      if (seg.type === "bold")
        return "<strong style=\"font-weight:800;font-style:normal;color:#fff\">"+escH(seg.content)+"</strong>";
      if (seg.type === "italic" && seg.inflection)
        return "<em data-inf=\""+escH(seg.inflection)+"\" style=\"color:"+accentColor+";border-bottom:1.5px dashed "+accentColor+"80;cursor:pointer;font-style:italic\">"+escH(seg.content)+"</em>";
      if (seg.type === "italic")
        return "<em style=\"font-style:italic;color:rgba(255,255,255,.75)\">"+escH(seg.content)+"</em>";
      return escH(seg.content).replace(/\n/g,"<br>");
    }).join("");
  }

  function nodeToMd(node) {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1) return "";
    var tag = node.tagName.toLowerCase();
    var inner = Array.from(node.childNodes).map(nodeToMd).join("");
    if (tag === "strong" || tag === "b") return "**"+inner+"**";
    if (tag === "em" || tag === "i") {
      var inf = node.getAttribute ? node.getAttribute("data-inf") : null;
      return inf ? "*"+inner+"*["+inf+"]" : "*"+inner+"*";
    }
    if (tag === "br") return "\n";
    if (tag === "div" || tag === "p") {
      if (!inner || inner === "\n") return "\n";
      return inner.replace(/\n+$/,"") + "\n";
    }
    return inner;
  }
  function elToMd(el) { return nodeToMd(el).replace(/\n+$/,""); }

  useEffect(function() {
    var el = editorRef.current; if (!el) return;
    if (!isInternal.current) el.innerHTML = mdToHtml(value) || "";
  }, [value, accentColor]);

  useEffect(function() {
    var el = editorRef.current; if (el) el.innerHTML = mdToHtml(value) || "";
  }, []); // eslint-disable-line

  function handleInput() {
    var el = editorRef.current; if (!el) return;
    isInternal.current = true;
    onChange(elToMd(el));
    requestAnimationFrame(function() { isInternal.current = false; });
  }
  function handlePaste(e) {
    e.preventDefault();
    var text = (e.clipboardData||window.clipboardData).getData("text/plain");
    document.execCommand("insertText", false, text);
  }

  // Walk up from a DOM node to find the nearest formatting ancestor inside editor
  function findFmtAncestor(startNode) {
    var el = editorRef.current;
    var node = startNode;
    while (node && node !== el) {
      if (node.nodeType === 1) {
        if (node.tagName === "EM" || node.tagName === "I")
          return { node: node, inf: node.getAttribute("data-inf"), isBold: false };
        if (node.tagName === "STRONG" || node.tagName === "B")
          return { node: node, inf: null, isBold: true };
      }
      node = node.parentNode;
    }
    return null;
  }

  function checkSel() {
    var sel = window.getSelection(), el = editorRef.current;
    var hasSel_ = !!(sel && !sel.isCollapsed && el && el.contains(sel.anchorNode));
    setHasSel(hasSel_);
    if (!hasSel_ && sel && sel.isCollapsed && el && el.contains(sel.anchorNode)) {
      setCursorInFmt(findFmtAncestor(sel.anchorNode));
    } else {
      setCursorInFmt(null);
    }
  }

  function handleMouseUp(e) {
    // If user clicked directly on an <em data-inf> node, treat it as cursor-in-fmt
    var target = e.target;
    if (target && target.tagName === "EM" && target.getAttribute && target.getAttribute("data-inf")) {
      setCursorInFmt({ node: target, inf: target.getAttribute("data-inf"), isBold: false });
      setHasSel(false);
      return;
    }
    checkSel();
  }

  function captureRange() {
    var sel = window.getSelection(), el = editorRef.current;
    if (sel && !sel.isCollapsed && el && el.contains(sel.anchorNode))
      return sel.getRangeAt(0).cloneRange();
    return null;
  }

  // Replace a formatted DOM node with its plain text content
  function removeNodeFormatting(fmtNode) {
    var el = editorRef.current;
    if (!fmtNode || !fmtNode.parentNode || !el || !el.contains(fmtNode)) return;
    var text = document.createTextNode(fmtNode.textContent);
    fmtNode.parentNode.replaceChild(text, fmtNode);
    var sel = window.getSelection();
    if (sel) {
      try {
        var nr = document.createRange(); nr.setStartAfter(text); nr.collapse(true);
        sel.removeAllRanges(); sel.addRange(nr);
      } catch(e) {} // eslint-disable-line
    }
    setCursorInFmt(null); setHasSel(false);
    el.normalize();
    handleInput();
  }

  function applyBold() {
    var el = editorRef.current; if (!el) return;
    el.focus();
    var sel = window.getSelection(); if (!sel||sel.isCollapsed) return;
    var r = sel.getRangeAt(0), text = r.toString(); if (!text) return;
    var node = document.createElement("strong");
    node.style.fontWeight="800"; node.style.fontStyle="normal"; node.style.color="#fff";
    node.textContent = text;
    r.deleteContents(); r.insertNode(node);
    var nr = document.createRange(); nr.setStartAfter(node); nr.collapse(true);
    sel.removeAllRanges(); sel.addRange(nr);
    setHasSel(false); handleInput();
  }

  function openInflPicker() {
    var r = captureRange(); if (!r) return;
    editNodeRef.current = null;
    setSelRange(r); setPickerMode("new"); setShowPicker(true);
  }
  function openInflPickerForNode(fmtNode) {
    editNodeRef.current = fmtNode;
    setSelRange(null); setPickerMode("edit"); setShowPicker(true);
  }
  function closePicker() {
    setShowPicker(false); setSelRange(null); editNodeRef.current = null;
  }

  function applyInflection(inf) {
    setShowPicker(false);
    var el = editorRef.current; if (!el) return;

    // Mode: editing an existing em node
    if (editNodeRef.current && el.contains(editNodeRef.current)) {
      var node = editNodeRef.current;
      if (inf) {
        node.setAttribute("data-inf", inf.label);
        node.style.color = accentColor;
        node.style.borderBottom = "1.5px dashed "+accentColor+"80";
        node.style.cursor = "pointer";
        node.style.fontStyle = "italic";
        setCursorInFmt({ node: node, inf: inf.label, isBold: false });
      } else {
        node.removeAttribute("data-inf");
        node.style.color = "rgba(255,255,255,.75)";
        node.style.borderBottom = "none";
        node.style.cursor = "";
        setCursorInFmt({ node: node, inf: null, isBold: false });
      }
      editNodeRef.current = null; setSelRange(null);
      handleInput(); return;
    }

    // Mode: new inflection wrapping a selection
    if (!selRange) return;
    el.focus();
    var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(selRange);
    var text = selRange.toString(); if (!text) { setSelRange(null); return; }
    var em = document.createElement("em");
    if (inf) {
      em.setAttribute("data-inf", inf.label);
      em.style.color = accentColor;
      em.style.borderBottom = "1.5px dashed "+accentColor+"80";
      em.style.cursor = "pointer";
    } else {
      em.style.color = "rgba(255,255,255,.75)";
    }
    em.style.fontStyle = "italic";
    em.textContent = text;
    selRange.deleteContents(); selRange.insertNode(em);
    var nr = document.createRange(); nr.setStartAfter(em); nr.collapse(true);
    sel.removeAllRanges(); sel.addRange(nr);
    setSelRange(null); setHasSel(false); handleInput();
  }

  function applyQuickInfl(lbl) {
    var r = captureRange(); if (!r) return;
    var el = editorRef.current; if (!el) return;
    el.focus();
    var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    var text = r.toString(); if (!text) return;
    var em = document.createElement("em");
    em.setAttribute("data-inf", lbl);
    em.style.color = accentColor;
    em.style.borderBottom = "1.5px dashed "+accentColor+"80";
    em.style.cursor = "pointer";
    em.style.fontStyle = "italic";
    em.textContent = text;
    r.deleteContents(); r.insertNode(em);
    var nr = document.createRange(); nr.setStartAfter(em); nr.collapse(true);
    sel.removeAllRanges(); sel.addRange(nr);
    setHasSel(false); handleInput();
  }

  function stripFormatting() {
    var el = editorRef.current; if (!el) return;

    // Case 1: cursor is inside a formatted node — unwrap it directly
    if (cursorInFmt && cursorInFmt.node && el.contains(cursorInFmt.node)) {
      removeNodeFormatting(cursorInFmt.node);
      return;
    }

    // Case 2: active text selection — extract as plain text and re-insert
    el.focus();
    var sel = window.getSelection(); if (!sel || sel.isCollapsed) return;
    var r = sel.getRangeAt(0);
    var plainText = r.toString(); if (!plainText) return;
    // Delete the range contents (removes all nodes within selection)
    r.deleteContents();
    var textNode = document.createTextNode(plainText);
    r.insertNode(textNode);
    // If the new text node ended up inside a formatting element, unwrap that element
    var parent = textNode.parentNode;
    while (parent && parent !== el) {
      if (parent.tagName === "EM" || parent.tagName === "I" ||
          parent.tagName === "STRONG" || parent.tagName === "B") {
        var gp = parent.parentNode;
        while (parent.firstChild) gp.insertBefore(parent.firstChild, parent);
        gp.removeChild(parent);
        break;
      }
      parent = parent.parentNode;
    }
    el.normalize();
    // Restore cursor after the inserted text node
    var newSel = window.getSelection();
    var nr2 = document.createRange();
    try { nr2.setStartAfter(textNode); nr2.collapse(true); } catch(e2) { nr2.selectNodeContents(el); nr2.collapse(false); }
    newSel.removeAllRanges(); newSel.addRange(nr2);
    setHasSel(false); setCursorInFmt(null); handleInput();
  }


  var curFmt = cursorInFmt;
  var curInfl = curFmt && curFmt.inf ? INFL_MAP[curFmt.inf] : null;
  var isEmpty = !value || value.trim() === "";

  return (
    <div>
      {/* ── Editable area ── */}
      <div style={{position:"relative"}}>
        {isEmpty && (
          <div style={{position:"absolute",top:0,left:0,right:0,padding:"13px 14px 13px 18px",fontSize:14,lineHeight:1.8,fontFamily:"'Lora',Georgia,serif",fontStyle:"italic",color:"rgba(255,255,255,.2)",pointerEvents:"none",userSelect:"none",WebkitUserSelect:"none"}}>
            Type what the rep says…
          </div>
        )}
        <div
          ref={editorRef}
          contentEditable={true}
          suppressContentEditableWarning={true}
          onInput={handleInput}
          onPaste={handlePaste}
          onMouseUp={handleMouseUp}
          onKeyUp={checkSel}
          onBlur={function() { setHasSel(false); setCursorInFmt(null); }}
          style={{minHeight:130,padding:"13px 14px 13px 18px",background:"rgba(255,255,255,.06)",border:"1.5px solid rgba(255,255,255,.1)",borderLeft:"3px solid "+accentColor,borderRadius:12,color:"rgba(255,255,255,.92)",fontSize:15,lineHeight:1.8,fontFamily:"'Lora',Georgia,serif",outline:"none",cursor:"text",wordBreak:"break-word",whiteSpace:"pre-wrap"}}
        />
      </div>

      {/* ── Formatting toolbar ── */}
      <div style={{position:"sticky",bottom:0,zIndex:10,marginTop:8}}>
        <div style={{background:"rgba(5,14,38,.97)",border:"1px solid rgba(255,255,255,.1)",borderRadius:12,padding:"8px 12px",backdropFilter:"blur(12px)"}}>

          {/* Context mode: cursor is inside a formatted span */}
          {curFmt && !hasSel ? (
            <div>
              <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:6}}>
                <div style={{flex:1,display:"flex",alignItems:"center",gap:8,background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.12)",borderRadius:9,padding:"6px 10px",minWidth:0,overflow:"hidden"}}>
                  {curFmt.isBold
                    ? <span style={{fontWeight:800,color:"#fff",fontSize:13,fontFamily:"'Lora',serif",flexShrink:0}}>B</span>
                    : curInfl
                      ? <span style={{fontSize:15,flexShrink:0}}>{curInfl.icon}</span>
                      : <span style={{fontStyle:"italic",color:"rgba(255,255,255,.45)",fontSize:13,flexShrink:0}}>i</span>
                  }
                  <div style={{minWidth:0,overflow:"hidden"}}>
                    <div style={{fontSize:11,fontWeight:700,color:curFmt.isBold?"#fff":accentColor,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                      {curFmt.isBold ? "Bold" : curInfl ? curInfl.label : "Plain italic"}
                    </div>
                    {!curFmt.isBold && curInfl && (
                      <div style={{fontSize:10,color:"rgba(255,255,255,.3)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{curInfl.cue}</div>
                    )}
                  </div>
                </div>
                {!curFmt.isBold && (
                  <button onMouseDown={function(e){e.preventDefault();openInflPickerForNode(curFmt.node);}}
                    style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.14)",borderRadius:8,padding:"6px 11px",fontSize:11,color:"rgba(255,255,255,.7)",cursor:"pointer",fontFamily:"inherit",flexShrink:0,fontWeight:600,whiteSpace:"nowrap"}}>
                    ↺ Change
                  </button>
                )}
                <button onMouseDown={function(e){e.preventDefault();stripFormatting();}}
                  style={{background:"rgba(239,83,80,.1)",border:"1px solid rgba(239,83,80,.3)",borderRadius:8,padding:"6px 11px",fontSize:11,color:"#EF5350",cursor:"pointer",fontFamily:"inherit",flexShrink:0,fontWeight:600,whiteSpace:"nowrap"}}>
                  ✕ Remove
                </button>
              </div>
              <div style={{fontSize:9,color:"rgba(255,255,255,.2)",letterSpacing:.3}}>
                Cursor inside formatted span · click elsewhere or select text to format new words
              </div>
            </div>
          ) : (
            /* Default toolbar */
            <div>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:hasSel?8:0}}>
                <button onMouseDown={function(e){e.preventDefault();applyBold();}} onTouchEnd={function(e){e.preventDefault();applyBold();}}
                  title="Bold (select text first)"
                  style={{background:hasSel?"rgba(255,255,255,.2)":"rgba(255,255,255,.08)",border:"1px solid "+(hasSel?"rgba(255,255,255,.4)":"rgba(255,255,255,.12)"),borderRadius:8,width:36,height:36,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Lora',serif",fontSize:15,fontWeight:800,fontStyle:"normal",color:"#fff",flexShrink:0,transition:"all .15s"}}>B</button>
                <button onMouseDown={function(e){e.preventDefault();openInflPicker();}} onTouchEnd={function(e){e.preventDefault();openInflPicker();}}
                  title="Add inflection (select text first)"
                  style={{background:hasSel?"rgba(255,255,255,.2)":"rgba(255,255,255,.08)",border:"1px solid "+(hasSel?"rgba(255,255,255,.4)":"rgba(255,255,255,.12)"),borderRadius:8,width:36,height:36,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Lora',serif",fontSize:15,fontStyle:"italic",fontWeight:700,color:accentColor,flexShrink:0,transition:"all .15s"}}>I</button>
                <button onMouseDown={function(e){e.preventDefault();stripFormatting();}} onTouchEnd={function(e){e.preventDefault();stripFormatting();}}
                  title="Remove formatting from selection"
                  style={{background:hasSel?"rgba(239,83,80,.18)":"rgba(255,255,255,.07)",border:"1px solid "+(hasSel?"rgba(239,83,80,.4)":"rgba(255,255,255,.08)"),borderRadius:8,width:36,height:36,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,color:hasSel?"#EF5350":"rgba(255,255,255,.2)",flexShrink:0,transition:"all .15s"}}>✕</button>
                <div style={{width:1,height:20,background:"rgba(255,255,255,.1)",flexShrink:0}}/>
                <div style={{flex:1,fontSize:11,color:hasSel?"rgba(255,255,255,.55)":"rgba(255,255,255,.25)",lineHeight:1.4,transition:"color .15s"}}>
                  {hasSel
                    ? <span style={{color:accentColor,fontWeight:700}}>Apply to selection ↑</span>
                    : <span>Select text to format · click an inflected word to edit it</span>}
                </div>
              </div>
              {hasSel && (
                <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                  {["Pause","Emphasize","Confident","Warm","Slow Down","Question"].map(function(lbl) {
                    var inf = INFL_MAP[lbl]; if (!inf) return null;
                    return (
                      <button key={lbl} onMouseDown={function(e){e.preventDefault();applyQuickInfl(lbl);}}
                        style={{background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.11)",borderRadius:99,padding:"4px 9px",fontSize:10,cursor:"pointer",fontFamily:"inherit",color:"rgba(255,255,255,.6)",display:"flex",alignItems:"center",gap:3}}>
                        <span>{inf.icon}</span><span>{lbl}</span>
                      </button>
                    );
                  })}
                  <button onMouseDown={function(e){e.preventDefault();openInflPicker();}}
                    style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.11)",borderRadius:99,padding:"4px 9px",fontSize:10,cursor:"pointer",fontFamily:"inherit",color:accentColor,display:"flex",alignItems:"center",gap:3}}>
                    <span>＋</span><span>More…</span>
                  </button>
                  <button onMouseDown={function(e){e.preventDefault();stripFormatting();}}
                    style={{background:"rgba(239,83,80,.08)",border:"1px solid rgba(239,83,80,.2)",borderRadius:99,padding:"4px 9px",fontSize:10,cursor:"pointer",fontFamily:"inherit",color:"rgba(239,83,80,.7)",display:"flex",alignItems:"center",gap:3}}>
                    <span>✕</span><span>Remove</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Inflection picker bottom sheet ── */}
      {showPicker && (
        <div style={{position:"fixed",inset:0,zIndex:600,display:"flex",flexDirection:"column"}}>
          <div onClick={closePicker} style={{flex:1,background:"rgba(0,0,0,.7)",backdropFilter:"blur(6px)"}}/>
          <div style={{background:"#081428",borderRadius:"24px 24px 0 0",border:"1px solid rgba(255,255,255,.1)",borderBottom:"none",maxHeight:"82vh",display:"flex",flexDirection:"column"}}>
            <Handle/>
            <div style={{padding:"0 20px 12px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid rgba(255,255,255,.07)"}}>
              <div>
                <div style={{fontSize:15,fontWeight:700,color:"#fff",fontFamily:"'Lora',serif"}}>
                  {pickerMode==="edit" && editNodeRef.current
                    ? <em style={{color:accentColor}}>"{editNodeRef.current.textContent.length>26?editNodeRef.current.textContent.slice(0,25)+"…":editNodeRef.current.textContent}"</em>
                    : selRange
                      ? <em style={{color:accentColor}}>"{selRange.toString().length>26?selRange.toString().slice(0,25)+"…":selRange.toString()}"</em>
                      : "Choose Inflection"}
                </div>
                <div style={{fontSize:11,color:"rgba(255,255,255,.3)",marginTop:3}}>
                  {pickerMode==="edit" ? "Change delivery cue for this phrase" : "How should the rep deliver this?"}
                </div>
              </div>
              <button onClick={closePicker} style={iconBtn()}>✕</button>
            </div>
            <div style={{overflowY:"auto",flex:1,padding:"12px 16px 32px"}}>
              {/* Remove option shown only in edit mode */}
              {pickerMode==="edit" && (
                <button onMouseDown={function(e){
                  e.preventDefault();
                  setShowPicker(false);
                  var node = editNodeRef.current; editNodeRef.current = null;
                  if (node && editorRef.current && editorRef.current.contains(node)) removeNodeFormatting(node);
                }}
                  style={{display:"flex",alignItems:"center",gap:12,background:"rgba(239,83,80,.07)",border:"1px solid rgba(239,83,80,.2)",borderRadius:14,padding:"11px 13px",cursor:"pointer",fontFamily:"inherit",textAlign:"left",width:"100%",marginBottom:14}}>
                  <span style={{fontSize:19,width:30,textAlign:"center",flexShrink:0}}>✕</span>
                  <div>
                    <div style={{fontSize:13,fontWeight:700,color:"#EF5350",marginBottom:2}}>Remove formatting</div>
                    <div style={{fontSize:11,color:"rgba(255,255,255,.3)"}}>Strip this phrase back to plain text</div>
                  </div>
                </button>
              )}
              {INFL_CATS.map(function(cat) {
                return (
                  <div key={cat} style={{marginBottom:20}}>
                    <SectionHdr>{cat}</SectionHdr>
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      {INFLECTIONS.filter(function(inf) { return inf.cat===cat; }).map(function(inf) {
                        var isCurrent = pickerMode==="edit" && editNodeRef.current
                          && editNodeRef.current.getAttribute && editNodeRef.current.getAttribute("data-inf")===inf.label;
                        return (
                          <button key={inf.id} onClick={function(){applyInflection(inf);}}
                            style={{display:"flex",alignItems:"center",gap:12,background:isCurrent?"rgba(255,255,255,.09)":"rgba(255,255,255,.07)",border:"1px solid "+(isCurrent?accentColor+"55":"rgba(255,255,255,.08)"),borderRadius:14,padding:"11px 13px",cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}>
                            <span style={{fontSize:19,width:30,textAlign:"center",flexShrink:0}}>{inf.icon}</span>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontSize:13,fontWeight:700,color:isCurrent?accentColor:"rgba(255,255,255,.8)",marginBottom:2}}>
                                {inf.label}{isCurrent ? " ✓" : ""}
                              </div>
                              <div style={{fontSize:11,color:"rgba(255,255,255,.4)",lineHeight:1.4}}>{inf.cue}</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <button onClick={function(){applyInflection(null);}}
                style={{display:"flex",alignItems:"center",gap:12,background:"rgba(255,255,255,.05)",border:"1px dashed rgba(255,255,255,.1)",borderRadius:14,padding:"11px 13px",cursor:"pointer",fontFamily:"inherit",textAlign:"left",width:"100%"}}>
                <span style={{fontSize:19,width:30,textAlign:"center",flexShrink:0}}>✏️</span>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:"rgba(255,255,255,.45)",marginBottom:2}}>Plain italic</div>
                  <div style={{fontSize:11,color:"rgba(255,255,255,.3)"}}>Style only, no coaching cue</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CARD EDITOR SHEET ────────────────────────────────────────────────────────
export function CardEditorSheet({ card, allCards, rootCard, accentColor, lockedType, onSave, onDelete, onClose, onNavigateTo, onSaveAndNavigateTo }) {
  var isBlank = !card.prompt && !card.title;
  var [form, setForm] = useState({
    id: card.id || uid(),
    title: card.title || "",
    type: lockedType || card.type || "pitch",
    overview: card.overview || [],
    intendedPath: card.intendedPath === undefined ? false : card.intendedPath,
    prompt: card.prompt || "",
    answers: card.answers && card.answers.length ? card.answers.map(function(a){ return Object.assign({}, a); }) : [{id:aid(),label:"",next:null}]
  });
  var [linkIdx, setLinkIdx] = useState(null);
  var [previewCardId, setPreviewCardId] = useState(null);
  var touchPreviewRef = useRef(null); // {cardId, ansIdx} — tap-once-for-preview, tap-again-to-select
  var [errs, setErrs] = useState({});
  var [section, setSection] = useState("prompt");
  var [showOv, setShowOv] = useState(function() { return !!(card.overview && card.overview.some(function(b){return b&&b.trim();})); });

  function setField(k, v) { setForm(function(p) { return Object.assign({}, p, {[k]:v}); }); }
  function setAns(i, k, v) { setForm(function(p) { var arr=p.answers.map(function(a){return Object.assign({},a);}); arr[i]=Object.assign({},arr[i],{[k]:v}); return Object.assign({},p,{answers:arr}); }); }
  function addAns() { setForm(function(p) { return Object.assign({}, p, {answers:p.answers.concat([{id:aid(),label:"",next:null}])}); }); }
  function delAns(i) { setForm(function(p) { return Object.assign({}, p, {answers:p.answers.filter(function(_,j){return j!==i;})}); }); }
  function validate() {
    var e = {};
    if (!form.title.trim()) e.title = "Required";
    if (!form.prompt.trim()) e.prompt = "Required";
    if (form.answers.some(function(a) { return !a.label.trim(); })) e.answers = "All response labels required";
    setErrs(e);
    return Object.keys(e).length === 0;
  }
  var meta = TM[form.type] || TM.pitch;
  var ac = accentColor || meta.color;
  var availTypes = lockedType ? [lockedType] : ["pitch","discovery","close"];
  var isRootCard = !!rootCard && form.id === rootCard;
  var hasIntendedParent = Object.values(allCards || {}).some(function(c) {
    return c.intendedPath && (c.answers || []).some(function(a){ return a.next === form.id; });
  });
  var canEnableIntended = isRootCard || hasIntendedParent;
  var linkedFromCards = Object.values(allCards || {}).filter(function(c) {
    return c.id !== form.id && (c.answers||[]).some(function(a){ return a.next === form.id; });
  });

  return (
    <div style={{position:"fixed",inset:0,zIndex:300,display:"flex",flexDirection:"column"}}>
      <div onClick={onClose} style={{flex:1,background:"rgba(0,0,0,.65)",backdropFilter:"blur(8px)"}}/>
      <div style={{background:"#081428",borderRadius:"24px 24px 0 0",border:"1px solid rgba(255,255,255,.1)",borderBottom:"none",maxHeight:SHEET_MAX_H,display:"flex",flexDirection:"column",animation:"sheetUp .3s cubic-bezier(.22,1,.36,1) both"}}>
        <Handle/>
        <div style={{padding:"8px 20px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid rgba(255,255,255,.07)"}}>
          <div>
            <div style={{fontSize:18,fontWeight:700,color:"#fff",fontFamily:"'Lora',serif"}}>{isBlank?"New Card":"Edit Card"}</div>
            {!isBlank && <div style={{fontSize:10,color:"rgba(255,255,255,.25)",marginTop:2}}>ID: {form.id}</div>}
          </div>
          <div style={{display:"flex",gap:8}}>
            {!isBlank && onDelete && <button onClick={function(){onDelete(form.id);}} style={ghostSm({color:"#EF5350",borderColor:"rgba(239,83,80,.3)"})}>Delete</button>}
            <button onClick={onClose} style={iconBtn()}>✕</button>
          </div>
        </div>
        <div style={{overflowY:"auto",flex:1,padding:"18px 20px"}}>
          {/* Linked From — cards that have an answer pointing to this card */}
          {linkedFromCards.length > 0 && (
            <div style={{marginBottom:14}}>
              <label style={labelSt()}>Linked From</label>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {linkedFromCards.map(function(c) {
                  var m2 = TM[c.type]||TM.pitch;
                  return (
                    <button key={c.id}
                      onClick={function(){ if(onNavigateTo) onNavigateTo(c); }}
                      style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.1)",borderRadius:99,padding:"5px 10px",fontSize:11,cursor:onNavigateTo?"pointer":"default",fontFamily:"inherit",display:"flex",alignItems:"center",gap:4,color:"rgba(255,255,255,.6)"}}>
                      <span style={{color:m2.color}}>{m2.icon}</span>
                      <span>{c.title}</span>
                      {onNavigateTo && <span style={{fontSize:9,color:"rgba(255,255,255,.3)"}}>↵</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {/* Card type */}
          {availTypes.length > 1 && (
            <div style={{marginBottom:18}}>
              <label style={labelSt()}>Card Type</label>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {availTypes.map(function(k) {
                  var v = TM[k];
                  return (
                    <button key={k} onClick={function(){setField("type",k);}}
                      style={{background:form.type===k?v.color+"25":"rgba(255,255,255,.05)",border:"1.5px solid "+(form.type===k?v.color:"rgba(255,255,255,.1)"),borderRadius:99,color:form.type===k?v.color:"rgba(255,255,255,.4)",fontSize:13,fontWeight:form.type===k?700:400,padding:"7px 15px",cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:4}}>
                      <span>{v.icon}</span>{v.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {/* Title */}
          <div style={{marginBottom:14}}>
            <label style={labelSt()}>Card Title</label>
            <input value={form.title} onChange={function(e){setField("title",e.target.value);}} placeholder="e.g. Opening Hook" style={inputSt({borderColor:errs.title?"#EF5350":"rgba(255,255,255,.1)"})}/>
            {errs.title && <div style={{fontSize:11,color:"#EF5350",marginTop:4}}>{errs.title}</div>}
          </div>
          {/* Intended path toggle — hidden for new cards and cards with no intended-path parent */}
          {!isBlank && (isRootCard || hasIntendedParent) && (
            <div style={{marginBottom:16,display:"flex",alignItems:"center",justifyContent:"space-between",background:isRootCard?"rgba(102,187,106,.1)":"rgba(102,187,106,.07)",border:"1px solid "+(isRootCard?"rgba(102,187,106,.3)":"rgba(102,187,106,.18)"),borderRadius:12,padding:"11px 14px"}}>
              <div>
                <div style={{fontSize:12,fontWeight:700,color:"#66BB6A"}}>★ Intended Path</div>
                <div style={{fontSize:10,color:"rgba(255,255,255,.3)",marginTop:2}}>
                  {isRootCard ? "Root card — always on intended path" : "Mark as part of the ideal call flow for analytics"}
                </div>
              </div>
              <button
                disabled={isRootCard}
                onClick={function(){if(!isRootCard)setField("intendedPath",!form.intendedPath);}}
                style={{width:44,height:26,borderRadius:99,background:(isRootCard||form.intendedPath)?"#66BB6A":"rgba(255,255,255,.1)",border:"none",cursor:isRootCard?"default":"pointer",position:"relative",transition:"background .2s",flexShrink:0}}>
                <div style={{position:"absolute",top:3,left:(isRootCard||form.intendedPath)?20:3,width:20,height:20,borderRadius:"50%",background:"#fff",transition:"left .2s"}}/>
              </button>
            </div>
          )}
          {/* Section tabs */}
          <div style={{display:"flex",background:"rgba(255,255,255,.05)",borderRadius:10,padding:2,gap:1,marginBottom:14}}>
            {["prompt","overview"].map(function(sec) {
              var on = section === sec;
              var ovCount = form.overview ? form.overview.filter(function(b){return b&&b.trim();}).length : 0;
              return (
                <button key={sec} onClick={function(){setSection(sec);}}
                  style={{flex:1,background:on?"rgba(255,255,255,.12)":"transparent",border:"none",borderRadius:8,padding:"7px",cursor:"pointer",color:on?"#fff":"rgba(255,255,255,.4)",fontSize:12,fontFamily:"inherit",fontWeight:on?700:400}}>
                  {sec === "overview" ? ("◆ Overview" + (ovCount > 0 ? " ("+ovCount+")" : "")) : "✍ Script"}
                </button>
              );
            })}
          </div>
          {section === "overview" && (
            <div style={{marginBottom:18}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                <label style={Object.assign({},labelSt(),{marginBottom:0})}>Overview</label>
                <button onClick={function(){if(showOv)setField("overview",[]); setShowOv(function(p){return !p;});}}
                  style={{width:44,height:26,borderRadius:99,background:showOv?ac:"rgba(255,255,255,.1)",border:"none",cursor:"pointer",position:"relative",transition:"background .2s",flexShrink:0}}>
                  <div style={{position:"absolute",top:3,left:showOv?20:3,width:20,height:20,borderRadius:"50%",background:"#fff",transition:"left .2s"}}/>
                </button>
              </div>
              {showOv ? (
                <OverviewEditor bullets={form.overview} onChange={function(v){setField("overview",v);}} accent={ac}/>
              ) : (
                <div style={{fontSize:11,color:"rgba(255,255,255,.3)",padding:"10px 0",lineHeight:1.6}}>Toggle on to add 1–3 bullet points shown above the script in play mode.</div>
              )}
            </div>
          )}
          {section === "prompt" && (
            <div style={{marginBottom:18}}>
              <label style={labelSt()}>Script Prompt</label>
              <RichPromptEditor value={form.prompt} onChange={function(v){setField("prompt",v);}} accentColor={ac}/>
              {errs.prompt && <div style={{fontSize:11,color:"#EF5350",marginTop:4}}>{errs.prompt}</div>}
            </div>
          )}
          {/* Response options */}
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <label style={Object.assign({},labelSt(),{marginBottom:0})}>Response Options</label>
              <button onClick={addAns} style={ghostSm({color:ac,borderColor:ac+"44"})}>+ Add</button>
            </div>
            {errs.answers && <div style={{fontSize:11,color:"#EF5350",marginBottom:8}}>{errs.answers}</div>}
            {form.answers.map(function(ans, i) {
              var prevCard = (linkIdx === i && previewCardId) ? allCards[previewCardId] : null;
              var prevMeta = prevCard ? (TM[prevCard.type] || TM.pitch) : null;
              var prevBullets = prevCard ? (prevCard.overview||[]).filter(function(b){return b&&b.trim();}) : [];
              return (
                <div key={ans.id} style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.07)",borderRadius:14,padding:"13px",marginBottom:8}}>
                  <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}>
                    <span style={{width:24,height:24,borderRadius:"50%",background:ac+"22",border:"1.5px solid "+ac+"55",color:ac,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,flexShrink:0}}>{i+1}</span>
                    <input value={ans.label} onChange={function(e){setAns(i,"label",e.target.value);}} placeholder="Prospect says..." style={inputSt({margin:0,flex:1})}/>
                    <button onClick={function(){delAns(i);}} style={Object.assign({},iconBtn(),{flexShrink:0})}>🗑</button>
                  </div>
                  <button onClick={function(){setLinkIdx(linkIdx===i?null:i);}}
                    style={{background:"none",border:"none",cursor:"pointer",padding:"2px 0",display:"flex",alignItems:"center",gap:6,fontFamily:"inherit"}}>
                    <span style={{fontSize:13}}>🔗</span>
                    <span style={{fontSize:12,color:ans.next?ac:"rgba(255,255,255,.28)"}}>
                      {ans.next ? ("→ " + (allCards[ans.next] ? allCards[ans.next].title : ans.next)) : (lockedType==="objection" ? "End — returns to pitch" : "End of path")}
                    </span>
                    <span style={{fontSize:10,color:"rgba(255,255,255,.25)"}}>▾</span>
                  </button>
                  {linkIdx === i && (
                    <div style={{marginTop:8,background:"#0c0d13",border:"1px solid rgba(255,255,255,.12)",borderRadius:12,overflow:"hidden"}}>
                      {/* Scrollable list — preview panel below has pre-allocated height to prevent reflow on mobile */}
                      <div style={{maxHeight:240,overflowY:"auto"}}>
                        {/* + New Card option */}
                        {onSaveAndNavigateTo && (
                          <button onClick={function() {
                            var newCard = {id:uid(),title:"",type:"pitch",overview:[],intendedPath:false,prompt:"",answers:[{id:aid(),label:"",next:null}]};
                            var updatedAnswers = form.answers.map(function(a,ai){ return ai===i ? Object.assign({},a,{next:newCard.id}) : a; });
                            var savedForm = Object.assign({},form,{answers:updatedAnswers});
                            setLinkIdx(null);
                            setPreviewCardId(null);
                            onSaveAndNavigateTo(savedForm, newCard);
                          }}
                          style={{display:"flex",alignItems:"center",gap:8,width:"100%",background:"transparent",border:"none",borderBottom:"1px solid rgba(255,255,255,.05)",color:ac,fontSize:13,padding:"11px 14px",cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}>
                            <span style={{fontSize:14}}>✦</span>
                            <span>New card</span>
                          </button>
                        )}
                        <button onClick={function(){setAns(i,"next",null);setLinkIdx(null);setPreviewCardId(null);touchPreviewRef.current=null;}}
                          onPointerEnter={function(e){ if(e.pointerType!=="touch") setPreviewCardId(null); }}
                          style={{display:"flex",alignItems:"center",gap:8,width:"100%",background:ans.next===null?"rgba(255,255,255,.08)":"transparent",border:"none",borderBottom:"1px solid rgba(255,255,255,.05)",color:"rgba(255,255,255,.4)",fontSize:13,padding:"11px 14px",cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}>
                          <span>— {lockedType==="objection" ? "End / return to pitch" : "End of path"}</span>
                          {ans.next === null && <span style={{marginLeft:"auto",color:ac}}>✓</span>}
                        </button>
                        {Object.values(allCards).filter(function(c) { return c.id !== form.id; }).map(function(c) {
                          var m2 = TM[c.type] || TM.pitch;
                          var isPreviewing = previewCardId === c.id;
                          return (
                            <button
                              key={c.id}
                              onPointerDown={function(e) {
                                if (e.pointerType !== "touch") return;
                                e.preventDefault();
                                var isSameTap = touchPreviewRef.current && touchPreviewRef.current.cardId===c.id && touchPreviewRef.current.ansIdx===i;
                                if (isSameTap) {
                                  touchPreviewRef.current = null;
                                  setPreviewCardId(null);
                                  setAns(i,"next",c.id);
                                  setLinkIdx(null);
                                } else {
                                  touchPreviewRef.current = {cardId:c.id, ansIdx:i};
                                  setPreviewCardId(c.id);
                                }
                              }}
                              onPointerEnter={function(e){ if(e.pointerType!=="touch") setPreviewCardId(c.id); }}
                              onPointerLeave={function(e){ if(e.pointerType!=="touch") setPreviewCardId(null); }}
                              onClick={function(){setAns(i,"next",c.id);setLinkIdx(null);setPreviewCardId(null);touchPreviewRef.current=null;}}
                              style={{display:"flex",alignItems:"center",gap:8,width:"100%",background:ans.next===c.id?"rgba(255,255,255,.09)":isPreviewing?"rgba(255,255,255,.06)":"transparent",border:"none",borderBottom:"1px solid rgba(255,255,255,.05)",color:"rgba(255,255,255,.75)",fontSize:13,padding:"11px 14px",cursor:"pointer",fontFamily:"inherit",textAlign:"left",transition:"background .1s"}}>
                              <span style={{color:m2.color,fontSize:12,flexShrink:0}}>{m2.icon}</span>
                              <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.title}</span>
                              {ans.next === c.id && <span style={{color:ac,flexShrink:0}}>✓</span>}
                            </button>
                          );
                        })}
                      </div>
                      {/* Card preview panel — pre-allocated height prevents list reflow on mobile */}
                      <div style={{height:prevCard?96:0,overflow:"hidden",transition:"height .15s",borderTop:prevCard?("2px solid "+prevMeta.color):"none",background:"rgba(255,255,255,.04)"}}>
                        {prevCard && (
                          <div style={{padding:"10px 14px 12px"}}>
                            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:prevBullets.length>0||prevCard.prompt?7:0}}>
                              <TypeBadge type={prevCard.type} small/>
                              {prevCard.intendedPath && <IntendedBadge/>}
                              <span style={{fontSize:12,fontWeight:700,color:"#fff",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{prevCard.title}</span>
                            </div>
                            {prevBullets.length > 0 && (
                              <div style={{marginBottom:prevCard.prompt?5:0}}>
                                {prevBullets.map(function(b,bi){return(
                                  <div key={bi} style={{display:"flex",alignItems:"flex-start",gap:5,marginBottom:2}}>
                                    <span style={{color:prevMeta.color,fontSize:8,marginTop:3,flexShrink:0}}>◆</span>
                                    <span style={{fontSize:10,color:"rgba(255,255,255,.55)",lineHeight:1.4}}>{b}</span>
                                  </div>
                                );})}
                              </div>
                            )}
                            {prevCard.prompt && (
                              <div style={{fontSize:11,color:"rgba(255,255,255,.38)",lineHeight:1.5,fontStyle:"italic",overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",fontFamily:"'Lora',Georgia,serif"}}>
                                {stripMarkup(prevCard.prompt).slice(0,130)}{stripMarkup(prevCard.prompt).length>130?"…":""}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div style={{padding:"14px 20px",borderTop:"1px solid rgba(255,255,255,.07)",display:"flex",gap:10}}>
          <button onClick={onClose} style={Object.assign({},ghostBtn(),{flex:1})}>Cancel</button>
          <button onClick={function(){if(validate())onSave(isRootCard?Object.assign({},form,{intendedPath:true}):form);}} style={Object.assign({},solidBtn(ac),{flex:2})}>{isBlank?"Create Card":"Save Changes"}</button>
        </div>
      </div>
    </div>
  );
}
