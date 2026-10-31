import { useState, useRef, useEffect, useContext, useMemo } from "react";
import { cachedGet, peek, useCacheVersion } from "../../lib/dataCache";
import { TM, uid, aid, themed } from "../../lib/constants";
import { lsGet, lsSet } from "../../lib/api";
import { solidBtn, inputSt, resizeHandle } from "../../lib/styles";
import { CardEditorSheet } from "../Editor";
import { TreeView } from "../Viewer";
import { RichPromptDisplay } from "../Tooltip";
import { stripMarkup } from "../../lib/richtext";
import { getParents } from "../../lib/cardGraph";
import DesktopCtx from "../../lib/DesktopCtx";
import { CardStage, PaneRail } from "../CardStage";
import { ImportPicker } from "../ImportPicker";
import { CopyIcon } from "../ui";

// ─── DESKTOP TYPE SCALE ───────────────────────────────────────────────────────
// body 14–15 · meta 13 · section heading 16–18 · page title 20–24 · badges ≥11
var TXT  = "#fff";
var TXT2 = "rgba(255,255,255,.72)";
var TXT3 = "rgba(255,255,255,.5)";
var LINE = "rgba(255,255,255,.07)";
var GREEN = "#66BB6A";

function validBullets(card) { return (card.overview || []).filter(function(b){ return b && b.trim(); }); }

// ─── SMALL BADGES (desktop-sized) ─────────────────────────────────────────────
export function DeskTypeBadge({ type }) {
  var m = TM[type] || TM.pitch;
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:5,background:m.color+"1f",border:"1px solid "+m.color+"55",color:m.color,borderRadius:99,fontSize:12,fontWeight:700,letterSpacing:.5,padding:"3px 10px",textTransform:"uppercase",flexShrink:0}}>
      <span>{m.icon}</span>{m.label}
    </span>
  );
}
function MiniBadge({ color, children, title }) {
  return <span title={title} style={{fontSize:11,fontWeight:700,color:color,background:color+"1a",border:"1px solid "+color+"44",borderRadius:99,padding:"2px 8px",whiteSpace:"nowrap",flexShrink:0,letterSpacing:.3}}>{children}</span>;
}

// ─── READ-ONLY CARD VIEW ──────────────────────────────────────────────────────
// Used for non-admin users (readOnly) in Cards and Objections. Large type,
// answers link through to their destination cards, "Linked from" shows parents
// (hidden when `staged` — CardStage draws the parents as back tabs instead).
export function CardReadView({ card, cards, rootCard, onOpen, onClose, accent, staged }) {
  var m = TM[card.type] || TM.pitch;
  var color = accent || m.color;
  var bullets = validBullets(card);
  var answers = (card.answers || []).filter(function(a){ return a && a.label; });
  var parents = staged ? [] : getParents(cards, card.id).map(function(p){ return p.card; });
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0}}>
      <div style={{padding:"18px 26px 16px",borderBottom:"1px solid "+LINE,flexShrink:0,display:"flex",alignItems:"flex-start",gap:14}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,flexWrap:"wrap"}}>
            <DeskTypeBadge type={card.type}/>
            {card.id === rootCard && <MiniBadge color={GREEN}>Entry card</MiniBadge>}
            {card.intendedPath && <MiniBadge color={GREEN}>★ Intended path</MiniBadge>}
          </div>
          <div style={{fontSize:24,fontWeight:700,color:TXT,fontFamily:"'Lora',serif",lineHeight:1.25}}>{card.title || "Untitled"}</div>
        </div>
        {onClose && (
          <button onClick={onClose} aria-label="Close card"
            style={{background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.12)",borderRadius:10,color:TXT2,cursor:"pointer",fontSize:15,padding:"6px 12px",fontFamily:"inherit",flexShrink:0}}>✕</button>
        )}
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"20px 26px 28px"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(320px, 1fr))",gap:20,alignItems:"start"}}>
          {/* Script column */}
          <div style={{minWidth:0}}>
            {bullets.length > 0 && (
              <div style={{background:"rgba(255,255,255,.045)",borderLeft:"3px solid "+color,borderRadius:12,padding:"14px 18px",marginBottom:16}}>
                <div style={{fontSize:13,fontWeight:700,color:TXT3,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Key points</div>
                {bullets.map(function(b, i) {
                  return (
                    <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start",marginBottom:i<bullets.length-1?6:0}}>
                      <span style={{color:color,fontSize:11,marginTop:5,flexShrink:0}}>◆</span>
                      <span style={{fontSize:15,color:TXT2,lineHeight:1.5}}>{b}</span>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{fontSize:13,fontWeight:700,color:TXT3,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Script</div>
            <div style={{background:"rgba(255,255,255,.04)",border:"1px solid "+LINE,borderRadius:14,padding:"18px 20px",fontSize:17,lineHeight:1.75,color:"rgba(255,255,255,.9)"}}>
              {card.prompt ? <RichPromptDisplay text={card.prompt} accentColor={color}/> : <span style={{color:TXT3,fontSize:15}}>No script written for this card.</span>}
            </div>
          </div>

          {/* Flow column */}
          <div style={{minWidth:0}}>
            <div style={{fontSize:13,fontWeight:700,color:TXT3,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Prospect responds</div>
            {answers.length === 0 && <div style={{fontSize:14,color:TXT3,marginBottom:16}}>No responses — this card ends the path.</div>}
            {answers.map(function(ans, i) {
              var linked = ans.next && cards ? cards[ans.next] : null;
              var lm = linked ? (TM[linked.type] || TM.pitch) : null;
              return (
                <button key={ans.id || i} disabled={!linked || !onOpen}
                  onClick={function(){ if (linked && onOpen) onOpen(linked); }}
                  style={{display:"block",width:"100%",textAlign:"left",background:"rgba(255,255,255,.04)",border:"1px solid "+LINE,borderRadius:12,padding:"12px 14px",marginBottom:8,cursor:linked&&onOpen?"pointer":"default",fontFamily:"inherit"}}>
                  <div style={{fontSize:15,color:TXT,lineHeight:1.4}}>{ans.label}</div>
                  {linked ? (
                    <div style={{display:"flex",alignItems:"center",gap:8,marginTop:8}}>
                      <span style={{fontSize:13,color:TXT3}}>→</span>
                      <span style={{fontSize:14,color:lm.color,fontWeight:600,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{linked.title || "Untitled"}</span>
                      <MiniBadge color={lm.color}>{lm.label}</MiniBadge>
                    </div>
                  ) : (
                    <div style={{fontSize:13,color:TXT3,marginTop:6}}>→ No destination linked</div>
                  )}
                </button>
              );
            })}
            {parents.length > 0 && (
              <>
                <div style={{fontSize:13,fontWeight:700,color:TXT3,textTransform:"uppercase",letterSpacing:1,margin:"18px 0 8px"}}>Linked from</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                  {parents.map(function(p) {
                    var pm = TM[p.type] || TM.pitch;
                    return (
                      <button key={p.id} onClick={function(){ if (onOpen) onOpen(p); }}
                        style={{background:pm.color+"14",border:"1px solid "+pm.color+"44",color:pm.color,borderRadius:99,fontSize:13,fontWeight:600,padding:"5px 12px",cursor:"pointer",fontFamily:"inherit"}}>
                        ← {p.title || "Untitled"}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── CARDS DESKTOP ────────────────────────────────────────────────────────────
// LIST mode — resizable list pane (default 380px) + detail pane (flex:1).
//             Detail pane: editor (admin) / read-only view (user) for the
//             selected card, or a deck overview (intended path, type mix,
//             cards needing attention) when nothing is selected.
// TREE mode — summary rail (260px) + TreeView; opening a card works like LIST mode
//             (tree folds into a rail / resizable pane, the card goes on the stage).
// focus (from search): { cardId, stackId?, nonce } — open that card once, then onFocusDone()
export function CardsDesktop({ deck, decks, onUpsert, onDelete, onUpdateDeck, readOnly, focus, onFocusDone }) {
  var desktop = useContext(DesktopCtx);
  var isTablet = !!desktop.isTablet;
  var [viewMode,  setViewMode]  = useState("list");
  // While a card is on the stage the list pane folds into a rail (desktop
  // preference, persisted). Tablets hide the list entirely and show a back pill.
  var [listRail,  setListRailSt] = useState(function(){ return lsGet("overcard_cards_listRail") !== "0"; });
  function setListRail(v) { setListRailSt(v); lsSet("overcard_cards_listRail", v ? "1" : "0"); }
  var [editing,   setEditing]   = useState(null);
  var [navDir,    setNavDir]    = useState(null);
  var [search,    setSearch]    = useState("");
  var [collapsed, setCollapsed] = useState({});
  var [showImport, setShowImport] = useState(false);

  // ── Resizable left pane (list mode only) ─────────────────────────────────────
  var [leftW, setLeftW] = useState(function() {
    var stored = parseInt(lsGet("overcard_cards_leftW2"), 10);
    return (stored >= 300 && stored <= 600) ? stored : 380;
  });
  var dragging   = useRef(false);
  var dragStartX = useRef(0);
  var dragStartW = useRef(380);
  var leftWRef   = useRef(leftW);
  var [isDragging, setIsDragging] = useState(false);
  // Tree mode, card open: like List mode — the tree folds into a "Tree" rail (or a resizable
  // pane with ‹ Collapse) and the card opens on the stage. Desktop preference, persisted.
  var [treeRail, setTreeRailSt] = useState(function(){ return lsGet("overcard_cards_treeRail") !== "0"; });
  function setTreeRail(v) { setTreeRailSt(v); lsSet("overcard_cards_treeRail", v ? "1" : "0"); }
  // Overview performance data — sessions run on this deck (whole org for admins, own for users)
  var [perfScope, setPerfScope] = useState(readOnly ? "self" : "org");
  var [perfMode,  setPerfMode]  = useState("all");       // all | live | practice
  var [perfSessions, setPerfSessions] = useState(null);
  var [perfSort, setPerfSort] = useState({ key:"visits", dir:"desc" });
  var [perfType, setPerfType] = useState("all");     // card performance: all | pitch | discovery | close
  var [perfPath, setPerfPath] = useState(false);     // card performance: intended-path cards only
  var sv = useCacheVersion("/sessions");
  useEffect(function() {
    var cancelled = false;
    var url = "/sessions?deckId=" + encodeURIComponent(deck.id) + (perfScope === "org" ? "&scope=org" : "");
    function own(list) { return Array.isArray(list) ? list.filter(function(x){ return !x._shared; }) : []; }
    var cached = peek(url);
    setPerfSessions(cached !== undefined ? own(cached) : null);
    cachedGet(url)
      .then(function(list) { if (!cancelled) setPerfSessions(own(list)); })
      .catch(function() { if (!cancelled) setPerfSessions([]); });
    return function() { cancelled = true; };
  }, [deck.id, perfScope, sv]);

  function updateLeftW(w) { leftWRef.current = w; setLeftW(w); }

  useEffect(function() {
    function onMove(e) {
      if (!dragging.current) return;
      var delta = e.clientX - dragStartX.current;
      var newW = Math.max(300, Math.min(600, dragStartW.current + delta));
      updateLeftW(newW);
    }
    function onUp() {
      if (!dragging.current) return;
      dragging.current = false;
      setIsDragging(false);
      lsSet("overcard_cards_leftW2", String(leftWRef.current));
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return function() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, []);

  function startDrag(e) {
    dragging.current = true;
    dragStartX.current = e.clientX;
    dragStartW.current = leftWRef.current;
    setIsDragging(true);
    e.preventDefault();
  }

  // ── Card operations ───────────────────────────────────────────────────────────
  var pitchTypes = ["pitch", "discovery", "close"];
  var allCards   = Object.values(deck.cards);

  function safeUpsert(deckId, card) {
    if (card.intendedPath && card.id !== deck.rootCard) {
      Object.values(deck.cards).forEach(function(parent) {
        if (!parent.intendedPath) return;
        var leadsToCard = (parent.answers || []).some(function(a){ return a.next === card.id; });
        if (!leadsToCard) return;
        (parent.answers || []).forEach(function(a) {
          if (a.next && a.next !== card.id) {
            var sibling = deck.cards[a.next];
            if (sibling && sibling.intendedPath) {
              onUpsert(deckId, Object.assign({}, sibling, { intendedPath: false }));
            }
          }
        });
      });
    }
    onUpsert(deckId, card);
  }

  function startNew() {
    setEditing({ id:uid(), title:"", type:"pitch", overview:[], intendedPath:false, prompt:"", answers:[{id:aid(),label:"",next:null}] });
  }
  function openCard(card) { setNavDir(null); setEditing(card); }
  useEffect(function() {
    if (!focus) return;
    var c = deck.cards[focus.cardId];
    if (c) openCard(c);
    if (onFocusDone) onFocusDone();
  }, [focus && focus.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  // Cards copied from another deck in the org (fresh ids, off the intended path)
  function importCards(res) {
    onUpdateDeck(deck.id, function(d) {
      return Object.assign({}, d, { cards: Object.assign({}, d.cards, res.cards), rootCard: d.rootCard || res.firstId });
    });
    if (res.firstId && res.cards[res.firstId]) openCard(res.cards[res.firstId]);
  }

  // ── Deck analysis (overview pane + tree rail) ────────────────────────────────
  var typeStats = pitchTypes.map(function(t) {
    var m = TM[t];
    var count = allCards.filter(function(c){ return c.type === t; }).length;
    var intendedCount = allCards.filter(function(c){ return c.type === t && c.intendedPath; }).length;
    return { type:t, m:m, count:count, intendedCount:intendedCount };
  });

  // Intended path: walk from root through answers that lead to intended cards
  var intendedPath = [];
  (function() {
    var seen = {};
    var cur = deck.cards[deck.rootCard];
    while (cur && !seen[cur.id]) {
      seen[cur.id] = true;
      intendedPath.push(cur);
      var nextCard = null;
      (cur.answers || []).some(function(a) {
        var c = a && a.next ? deck.cards[a.next] : null;
        if (c && c.intendedPath && !seen[c.id]) { nextCard = c; return true; }
        return false;
      });
      cur = nextCard;
    }
  })();

  // Reachability from root → orphans; plus dead ends and unlinked answers
  var reachable = {};
  (function() {
    var stack = deck.rootCard ? [deck.rootCard] : [];
    while (stack.length) {
      var id = stack.pop();
      if (reachable[id] || !deck.cards[id]) continue;
      reachable[id] = true;
      (deck.cards[id].answers || []).forEach(function(a){ if (a && a.next) stack.push(a.next); });
    }
  })();
  var issues = [];
  allCards.forEach(function(c) {
    var labelled = (c.answers || []).filter(function(a){ return a && a.label; });
    var unlinked = labelled.filter(function(a){ return !a.next || !deck.cards[a.next]; }).length;
    if (deck.rootCard && !reachable[c.id]) issues.push({ card:c, text:"Not reachable from the entry card", color:"#FFD54F" });
    else if (unlinked > 0 && c.type !== "close") issues.push({ card:c, text:unlinked + " response" + (unlinked!==1?"s":"") + " without a destination", color:"#FF8A65" });
    if (!stripMarkup(c.prompt || "").trim()) issues.push({ card:c, text:"No script written", color:"#EF5350" });
  });

  var intendedTotal = allCards.filter(function(c){ return c.intendedPath; }).length;

  // ── Card performance from real sessions ─────────────────────────────────────
  // reach = share of sessions that visited the card · endedHere = sessions whose last
  // main-deck card was this one · closeAfter = sold rate of live sessions that visited it ·
  // objAfter = how often an objection stack was opened while on this card
  // Memoised: dragging the pane divider or hovering re-renders constantly
  var perf = useMemo(function() {
    var list = (perfSessions || []).filter(function(x) {
      return perfMode === "all" || (x.mode || "live") === perfMode;
    });
    var by = {};
    allCards.forEach(function(c) { by[c.id] = { visits:0, sessions:0, ms:0, endedHere:0, liveVisited:0, soldAfter:0, objAfter:0 }; });
    var live = 0, sold = 0, durSum = 0, durN = 0, onPath = 0, pathVisits = 0;
    list.forEach(function(x) {
      var isLive = (x.mode || "live") === "live";
      if (isLive) { live++; if (x.sold || x.outcome === "sold") sold++; }
      if (x.endTs && x.startTs) { durSum += x.endTs - x.startTs; durN++; }
      var visits = (x.events || []).filter(function(e){ return e.type === "visit"; });
      var seen = {}, lastMain = null, prevMain = null;
      visits.forEach(function(v) {
        // First objection card after a main card = an objection raised on that card (count once)
        if (v.isObjCard) { if (prevMain && by[prevMain]) { by[prevMain].objAfter++; prevMain = null; } return; }
        prevMain = v.cardId;
        var b = by[v.cardId]; if (!b) return;
        b.visits++; b.ms += v.durationMs || 0;
        if (v.intendedPath) onPath++;
        pathVisits++;
        if (!seen[v.cardId]) { seen[v.cardId] = true; b.sessions++; if (isLive) { b.liveVisited++; if (x.sold || x.outcome === "sold") b.soldAfter++; } }
        lastMain = v.cardId;
      });
      if (lastMain && by[lastMain]) by[lastMain].endedHere++;
    });
    return { list:list, n:list.length, live:live, sold:sold, by:by,
      avgMs: durN ? durSum / durN : 0,
      closeRate: live ? Math.round(sold / live * 100) : null,
      adherence: pathVisits ? Math.round(onPath / pathVisits * 100) : null };
  }, [perfSessions, perfMode, deck.cards]); // eslint-disable-line react-hooks/exhaustive-deps

  // Deck health: share of cards that are reachable, scripted and fully linked
  var health = (function() {
    if (!allCards.length) return null;
    var bad = {};
    issues.forEach(function(it){ bad[it.card.id] = true; });
    return Math.round((allCards.length - Object.keys(bad).length) / allCards.length * 100);
  })();
  var q = search.toLowerCase();

  // ── Detail panel (editor for admins, read view for users) ───────────────────
  // staged=true (list mode) → wrapped in CardStage; tree mode keeps the plain panel.
  function closeCard() { setEditing(null); setNavDir(null); }
  // The open card on the stage (List and Tree modes)
  function renderDetail() {
    if (!editing) return null;
    var stageCard = readOnly ? (deck.cards[editing.id] || editing) : editing;
    return (
      <CardStage
        card={stageCard}
        cards={deck.cards}
        rootCard={deck.rootCard}
        navDir={navDir}
        onNavigate={function(target, dir){ setNavDir(dir||null); setEditing(target); }}
        onBack={isTablet ? closeCard : null}
        backLabel={viewMode === "tree" ? "Tree" : "All cards"}
        renderCenter={function(c, api) {
          if (readOnly) {
            return <CardReadView key={c.id} card={c} cards={deck.cards} rootCard={deck.rootCard} staged={true}
              onOpen={function(t){ setNavDir("forward"); setEditing(t); }} onClose={closeCard}/>;
          }
          return (
            <CardEditorSheet
              key={c.id}
              card={c}
              allCards={deck.cards}
              rootCard={deck.rootCard}
              accentColor={TM[c.type] ? TM[c.type].color : "#00B4FF"}
              navDir={null}
              staged={true}
              navRef={api.navRef}
              onFormChange={api.onFormChange}
              onSave={function(card){ safeUpsert(deck.id, card); closeCard(); }}
              onDelete={function(id){ onDelete(deck.id, id); closeCard(); }}
              onClose={closeCard}
              onNavigateTo={function(targetCard, dir){ setNavDir(dir||null); setEditing(targetCard); }}
              onSaveAndNavigateTo={function(form, targetCard, dir){ safeUpsert(deck.id, form); setNavDir(dir||null); setEditing(targetCard); }}
              inline={true}
            />
          );
        }}
      />
    );
  }

  // ── Overview pane (nothing selected) ─────────────────────────────────────────
  // Deck dashboard: structure (health, path, issues) joined with how each card performs in
  // real sessions (reach, time, drop-off, objections, close rate after visiting).
  function fmtDur(ms) {
    if (!ms) return "—";
    var sec = Math.round(ms / 1000);
    return sec < 60 ? sec + "s" : Math.floor(sec / 60) + "m " + (sec % 60 ? (sec % 60) + "s" : "");
  }
  function pct(a, b) { return b ? Math.round(a / b * 100) : null; }

  function renderOverview() {
    var compact = !!(desktop && desktop.compact);
    var panel = { background:"rgba(255,255,255,.035)", border:"1px solid "+LINE, borderRadius:14, padding:compact?"14px":"16px 18px", minWidth:0 };
    var hdr = { fontSize:compact?15:16, fontWeight:700, color:TXT };
    var loading = perfSessions === null;
    var n = perf.n;

    function pill(on, label, onClick) {
      return (
        <button key={label} onClick={onClick}
          style={{background:on?"rgba(255,255,255,.12)":"transparent",border:"none",borderRadius:99,padding:compact?"8px 14px":"5px 12px",fontSize:13,color:on?TXT:TXT3,fontWeight:on?700:500,cursor:"pointer",fontFamily:"inherit"}}>{label}</button>
      );
    }
    var healthColor = health === null ? TXT3 : health >= 90 ? GREEN : health >= 70 ? "#FFD54F" : "#EF5350";
    var kpis = [
      { v: health === null ? "—" : health + "%", l:"Deck health", s: issues.length ? issues.length + " issue" + (issues.length !== 1 ? "s" : "") : "No issues", c:healthColor },
      { v: perf.closeRate === null ? "—" : perf.closeRate + "%", l:"Close rate", s: perf.live ? perf.sold + " sold of " + perf.live + " live" : "No live calls yet", c:GREEN },
      { v: fmtDur(perf.avgMs), l:"Avg call", s: n + " session" + (n !== 1 ? "s" : ""), c:"#FFD54F" },
      { v: perf.adherence === null ? "—" : perf.adherence + "%", l:"On intended path", s:"of card visits", c:"#4DB6AC" },
      { v: allCards.length, l:"Cards", s: typeStats.map(function(t){ return t.count + " " + t.m.label.toLowerCase(); }).join(" · "), c:"#00B4FF" },
    ];

    // Funnel along the intended path
    var reachRows = intendedPath.map(function(c) { var b = perf.by[c.id] || {}; return { c:c, reach:pct(b.sessions || 0, n), ms: b.visits ? b.ms / b.visits : 0 }; });

    // Where objections hit (cards that most often lead to an objection stack)
    var objRows = allCards.map(function(c){ return { c:c, n:(perf.by[c.id] || {}).objAfter || 0 }; })
      .filter(function(r){ return r.n > 0; }).sort(function(a,b){ return b.n - a.n; }).slice(0, 5);
    var objMax = objRows.length ? objRows[0].n : 1;

    // Card performance table
    var cols = [
      ["title","Card","left"],["visits","Visits"],["reach","Reach"],["avg","Avg time"],
      ["ended","Ended here"],["close","Close after"],["links","Links"],["path","Path"],
    ];
    var TYPE_ORDER = { pitch:0, discovery:1, close:2 };
    var rows = allCards.filter(function(c) {
      return (perfType === "all" || c.type === perfType) && (!perfPath || c.intendedPath);
    }).map(function(c) {
      var b = perf.by[c.id] || {};
      var nAns = (c.answers || []).filter(function(a){ return a && a.label; }).length;
      var nIn = getParents(deck.cards, c.id).length;
      return { c:c, visits:b.visits || 0, reach:pct(b.sessions || 0, n), avg: b.visits ? b.ms / b.visits : 0,
        ended:pct(b.endedHere || 0, b.sessions || 0), close:pct(b.soldAfter || 0, b.liveVisited || 0),
        nAns:nAns, nIn:nIn, links:nAns + nIn, path:c.intendedPath ? 1 : 0, title:(c.title || "").toLowerCase(), type:TYPE_ORDER[c.type] || 0 };
    });
    rows.sort(function(a, b) {
      var k = perfSort.key, va = a[k], vb = b[k];
      if (va === null) va = -1; if (vb === null) vb = -1;
      var d = va < vb ? -1 : va > vb ? 1 : 0;
      if (!d) d = a.title < b.title ? -1 : 1;
      return perfSort.dir === "asc" ? d : -d;
    });
    var gridCols = "minmax(170px,2.2fr) repeat(7, minmax(62px,1fr))";

    return (
      <div style={{flex:1,overflowY:"auto",padding:compact?"16px":"22px 26px 28px"}}>
        {/* Header + data scope */}
        <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",gap:12,flexWrap:"wrap",marginBottom:16}}>
          <div style={{minWidth:0}}>
            <div style={{display:"flex",alignItems:"baseline",gap:12,flexWrap:"wrap"}}>
              <div style={{fontSize:compact?20:22,fontWeight:700,color:TXT,fontFamily:"'Lora',serif"}}>{deck.name}</div>
              <div style={{fontSize:14,color:TXT3}}>{allCards.length} card{allCards.length!==1?"s":""} · {intendedTotal} on intended path</div>
            </div>
            <div style={{fontSize:13,color:TXT3,marginTop:4}}>
              {readOnly ? "Select a card to read it." : "Select a card to edit it, or create a new one."} Performance below is from {loading ? "…" : n + " session" + (n !== 1 ? "s" : "")}{perfScope === "org" ? " across the org" : " you ran"}.
            </div>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <span style={{display:"inline-flex",background:"rgba(255,255,255,.05)",borderRadius:99,padding:2}}>
              {pill(perfMode === "all", "All", function(){ setPerfMode("all"); })}
              {pill(perfMode === "live", "Live", function(){ setPerfMode("live"); })}
              {pill(perfMode === "practice", "Practice", function(){ setPerfMode("practice"); })}
            </span>
            {!readOnly && (
              <span style={{display:"inline-flex",background:"rgba(255,255,255,.05)",borderRadius:99,padding:2}}>
                {pill(perfScope === "org", "Org", function(){ setPerfScope("org"); })}
                {pill(perfScope === "self", "Mine", function(){ setPerfScope("self"); })}
              </span>
            )}
          </div>
        </div>

        {/* KPI strip */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(" + (compact ? 150 : 132) + "px, 1fr))",gap:12,marginBottom:16}}>
          {kpis.map(function(k) {
            return (
              <div key={k.l} style={Object.assign({}, panel, {padding:compact?"12px 14px":"14px 16px"})}>
                <div style={{fontSize:compact?24:28,fontWeight:800,color:k.c,lineHeight:1.1,fontVariantNumeric:"tabular-nums"}}>{loading && k.l !== "Deck health" && k.l !== "Cards" ? "…" : k.v}</div>
                <div style={{fontSize:14,fontWeight:600,color:TXT2,marginTop:4}}>{k.l}</div>
                <div style={{fontSize:12,color:TXT3,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{k.s}</div>
              </div>
            );
          })}
        </div>

        <div style={{display:"grid",gridTemplateColumns:compact?"minmax(0,1fr)":"minmax(0,2fr) minmax(300px,1fr)",gap:16,alignItems:"start"}}>
          {/* Intended path funnel — one row per step: reach bar, avg time, drop-off to the next step */}
          <div style={panel}>
            <div style={hdr}>★ Intended path</div>
            <div style={{fontSize:12,color:TXT3,marginTop:2,marginBottom:12}}>How far calls get along the path · click a step to open it</div>
            {intendedPath.length === 0 && <div style={{fontSize:14,color:TXT3}}>No entry card set yet.</div>}
            {reachRows.map(function(r, i) {
              var m = TM[r.c.type] || TM.pitch;
              var next = reachRows[i + 1];
              var drop = next && r.reach !== null && next.reach !== null ? r.reach - next.reach : null;
              return (
                <div key={r.c.id}>
                  <button onClick={function(){ openCard(r.c); }}
                    style={{display:"grid",gridTemplateColumns:"28px minmax(110px,1.6fr) minmax(70px,1.4fr) 44px 50px",gap:12,alignItems:"center",width:"100%",textAlign:"left",background:"transparent",border:"none",borderRadius:10,padding:"8px 6px",cursor:"pointer",fontFamily:"inherit"}}>
                    <span style={{width:26,height:26,borderRadius:"50%",background:m.color+"22",border:"1.5px solid "+m.color+"88",color:m.color,fontSize:13,fontWeight:800,display:"inline-flex",alignItems:"center",justifyContent:"center"}}>{i + 1}</span>
                    <span style={{minWidth:0}}>
                      <span style={{display:"block",fontSize:15,fontWeight:600,color:TXT,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.c.title || "Untitled"}</span>
                      <span style={{display:"block",fontSize:12,color:m.color}}>{m.label}</span>
                    </span>
                    <span style={{height:10,borderRadius:99,background:"rgba(255,255,255,.07)",overflow:"hidden"}} title={(r.reach === null ? 0 : r.reach) + "% of sessions reached this step"}>
                      <span style={{display:"block",height:"100%",width:(r.reach || 0) + "%",background:"linear-gradient(90deg," + m.color + "aa," + m.color + ")",borderRadius:99,transition:"width .4s"}}/>
                    </span>
                    <span style={{fontSize:14,fontWeight:700,color:TXT,textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{loading ? "…" : r.reach === null ? "—" : r.reach + "%"}</span>
                    <span style={{fontSize:13,color:TXT3,textAlign:"right",fontVariantNumeric:"tabular-nums"}} title="Average time on this card">{fmtDur(r.ms)}</span>
                  </button>
                  {next && (
                    <div style={{display:"flex",alignItems:"center",gap:8,padding:"0 0 0 18px",height:14}}>
                      <span style={{width:2,height:14,background:LINE}}/>
                      {drop !== null && drop > 0 && <span style={{fontSize:11,fontWeight:700,color:drop >= 15 ? "#EF8070" : TXT3}}>−{drop}% drop-off</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Right column: issues + objections */}
          <div style={{display:"flex",flexDirection:"column",gap:16,minWidth:0}}>
            <div style={panel}>
              <div style={Object.assign({}, hdr, {marginBottom:10})}>Needs attention</div>
              {issues.length === 0 && <div style={{fontSize:14,color:GREEN}}>✓ Every card is reachable, scripted and linked.</div>}
              {issues.slice(0, 5).map(function(it, i) {
                return (
                  <button key={it.card.id + i} onClick={function(){ openCard(it.card); }}
                    style={{display:"flex",alignItems:"center",gap:10,width:"100%",textAlign:"left",background:"transparent",border:"none",borderTop:i?"1px solid "+LINE:"none",padding:"8px 2px",cursor:"pointer",fontFamily:"inherit"}}>
                    <span style={{width:8,height:8,borderRadius:"50%",background:it.color,flexShrink:0}}/>
                    <span style={{flex:1,minWidth:0}}>
                      <span style={{display:"block",fontSize:14,fontWeight:600,color:TXT,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.card.title || "Untitled"}</span>
                      <span style={{display:"block",fontSize:12,color:TXT3,marginTop:1}}>{it.text}</span>
                    </span>
                    <span style={{fontSize:12,color:"#00B4FF",flexShrink:0}}>{readOnly ? "View" : "Fix"} ›</span>
                  </button>
                );
              })}
              {issues.length > 5 && <div style={{fontSize:12,color:TXT3,marginTop:6}}>+ {issues.length - 5} more</div>}
            </div>
            <div style={panel}>
              <div style={Object.assign({}, hdr, {marginBottom:4})}>Where objections hit</div>
              <div style={{fontSize:12,color:TXT3,marginBottom:10}}>Cards where prospects most often raised an objection</div>
              {loading && <div style={{fontSize:13,color:TXT3}}>Loading…</div>}
              {!loading && objRows.length === 0 && <div style={{fontSize:13,color:TXT3}}>No objections recorded on this deck yet.</div>}
              {objRows.map(function(r) {
                var m = TM[r.c.type] || TM.pitch;
                return (
                  <button key={r.c.id} onClick={function(){ openCard(r.c); }}
                    style={{display:"block",width:"100%",textAlign:"left",background:"transparent",border:"none",padding:"6px 2px",cursor:"pointer",fontFamily:"inherit"}}>
                    <span style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:4}}>
                      <span style={{color:TXT,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.c.title}</span>
                      <span style={{color:"#EF5350",fontWeight:700,flexShrink:0,marginLeft:8}}>{r.n}</span>
                    </span>
                    <span style={{display:"block",height:5,borderRadius:99,background:"rgba(255,255,255,.07)",overflow:"hidden"}}>
                      <span style={{display:"block",height:"100%",width:(r.n / objMax * 100) + "%",background:"linear-gradient(90deg," + m.color + ",#EF5350)",borderRadius:99}}/>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Card performance */}
        {allCards.length > 0 && (
          <div style={Object.assign({}, panel, {marginTop:16,padding:"16px 0 6px",overflowX:"auto"})}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",margin:"0 18px 10px",gap:12,flexWrap:"wrap"}}>
              <div style={hdr}>Card performance</div>
              <div style={{fontSize:12,color:TXT3}}>Reach = % of sessions that visited · Ended here = sessions that stopped on it · Close after = live close rate when visited</div>
            </div>
            {/* Sorting + filtering toolbar (column headers also sort) */}
            <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",margin:"0 18px 12px"}}>
              <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:TXT3}}>
                Sort by
                <select value={perfSort.key} onChange={function(e){ var k = e.target.value; setPerfSort({ key:k, dir:k === "title" || k === "type" ? "asc" : "desc" }); }}
                  aria-label="Sort cards by"
                  style={{background:themed("rgba(8,25,60,.5)"),border:"1px solid rgba(255,255,255,.12)",borderRadius:8,color:TXT,fontSize:13,padding:"6px 10px",minHeight:compact ? 40 : undefined,fontFamily:"inherit",cursor:"pointer",outline:"none"}}>
                  <option value="visits">Most visited</option>
                  <option value="reach">Reach</option>
                  <option value="avg">Avg time on card</option>
                  <option value="ended">Ended here (drop-off)</option>
                  <option value="close">Close rate after</option>
                  <option value="links">Most linked</option>
                  <option value="type">Card type</option>
                  <option value="title">Name (A–Z)</option>
                </select>
              </label>
              <button onClick={function(){ setPerfSort({ key:perfSort.key, dir:perfSort.dir === "asc" ? "desc" : "asc" }); }}
                aria-label={"Sort " + (perfSort.dir === "asc" ? "ascending" : "descending") + " — click to reverse"}
                style={{background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.12)",borderRadius:8,color:TXT2,fontSize:13,padding:"6px 12px",minHeight:compact ? 40 : undefined,cursor:"pointer",fontFamily:"inherit"}}>
                {perfSort.dir === "asc" ? "↑ Ascending" : "↓ Descending"}
              </button>
              <span style={{width:1,height:22,background:LINE}}/>
              <span style={{display:"inline-flex",background:"rgba(255,255,255,.05)",borderRadius:99,padding:2}}>
                {pill(perfType === "all", "All types", function(){ setPerfType("all"); })}
                {pitchTypes.map(function(t){ return pill(perfType === t, TM[t].label, function(){ setPerfType(t); }); })}
              </span>
              <button onClick={function(){ setPerfPath(!perfPath); }} aria-pressed={perfPath}
                style={{background:perfPath ? "rgba(102,187,106,.15)" : "transparent",border:"1px solid "+(perfPath ? "rgba(102,187,106,.45)" : "rgba(255,255,255,.12)"),borderRadius:99,color:perfPath ? GREEN : TXT3,fontSize:13,padding:compact ? "8px 14px" : "5px 12px",cursor:"pointer",fontFamily:"inherit",fontWeight:perfPath ? 700 : 500}}>
                ★ Intended path only
              </button>
              <span style={{marginLeft:"auto",fontSize:12,color:TXT3}}>{rows.length} of {allCards.length} cards</span>
            </div>
            <div style={{display:"grid",gridTemplateColumns:gridCols,gap:10,fontSize:13,color:TXT3,padding:"0 18px 8px",borderBottom:"1px solid "+LINE,minWidth:720}}>
              {cols.map(function(col) {
                var on = perfSort.key === col[0];
                return (
                  <button key={col[0]} aria-sort={on ? (perfSort.dir === "asc" ? "ascending" : "descending") : "none"}
                    onClick={function(){ setPerfSort(on ? { key:col[0], dir:perfSort.dir === "asc" ? "desc" : "asc" } : { key:col[0], dir:col[0] === "title" ? "asc" : "desc" }); }}
                    style={{background:"none",border:"none",padding:0,cursor:"pointer",fontFamily:"inherit",fontSize:13,color:on?TXT:TXT3,fontWeight:on?700:500,display:"flex",gap:4,alignItems:"center",justifyContent:col[2]==="left"?"flex-start":"flex-end"}}>
                    {col[1]}<span style={{fontSize:10,opacity:on?1:.35}}>{on ? (perfSort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
                  </button>
                );
              })}
            </div>
            {rows.map(function(r) {
              var c = r.c, m = TM[c.type] || TM.pitch;
              var cell = { textAlign:"right", fontVariantNumeric:"tabular-nums" };
              return (
                <button key={c.id} onClick={function(){ openCard(c); }}
                  style={{display:"grid",gridTemplateColumns:gridCols,gap:10,alignItems:"center",width:"100%",minWidth:720,textAlign:"left",background:"transparent",border:"none",borderBottom:"1px solid "+LINE,padding:"10px 18px",cursor:"pointer",fontFamily:"inherit",fontSize:14,color:TXT2}}>
                  <span style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
                    <span style={{width:4,height:22,borderRadius:99,background:m.color,flexShrink:0}}/>
                    <span style={{minWidth:0}}>
                      <span style={{display:"block",fontWeight:600,color:TXT,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.title || "Untitled"}</span>
                      <span style={{display:"block",fontSize:12,color:m.color}}>{m.label}{c.id === deck.rootCard ? " · Entry" : ""}</span>
                    </span>
                  </span>
                  <span style={Object.assign({}, cell, {color:TXT,fontWeight:700})}>{loading ? "…" : r.visits}</span>
                  <span style={cell}>{r.reach === null ? "—" : r.reach + "%"}</span>
                  <span style={cell}>{fmtDur(r.avg)}</span>
                  <span style={Object.assign({}, cell, {color:r.ended >= 40 && c.type !== "close" ? "#EF8070" : TXT2})}>{r.ended === null ? "—" : r.ended + "%"}</span>
                  <span style={Object.assign({}, cell, {color:r.close === null ? TXT3 : r.close >= 30 ? GREEN : TXT2})}>{r.close === null ? "—" : r.close + "%"}</span>
                  <span style={Object.assign({}, cell, {fontSize:13})} title={r.nIn + " in · " + r.nAns + " out"}>{r.nIn} in · {r.nAns} out</span>
                  <span style={Object.assign({}, cell, {color:c.intendedPath?GREEN:TXT3})}>{c.intendedPath ? "★" : "—"}</span>
                </button>
              );
            })}
          </div>
        )}

        {!readOnly && allCards.length === 0 && (
          <button onClick={startNew} style={Object.assign({},solidBtn(deck.color),{marginTop:18,fontSize:15})}>+ Create the first card</button>
        )}
      </div>
    );
  }

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",overflow:"hidden",userSelect:isDragging?"none":"auto"}}>

      {/* ── Top action bar ── */}
      <div style={{height:54,flexShrink:0,display:"flex",alignItems:"center",borderBottom:"1px solid "+LINE,background:themed("rgba(6,16,42,.6)"),padding:"0 16px 0 8px",gap:12}}>
        {/* View mode tabs */}
        <div role="tablist" style={{display:"flex",alignSelf:"stretch"}}>
          {[["list","≡  List"],["tree","◈  Tree"]].map(function(pair) {
            var v = pair[0]; var lbl = pair[1]; var on = viewMode === v;
            return (
              <button key={v} role="tab" aria-selected={on} onClick={function(){ setViewMode(v); }}
                style={{background:"none",border:"none",borderBottom:"3px solid "+(on ? deck.color : "transparent"),padding:"0 18px",cursor:"pointer",fontFamily:"inherit",fontSize:15,fontWeight:on?700:500,color:on?TXT:TXT3,transition:"color .15s, border-color .15s",flexShrink:0,whiteSpace:"pre"}}>
                {lbl}
              </button>
            );
          })}
        </div>

        <div style={{width:1,height:26,background:LINE,flexShrink:0}}/>

        {viewMode === "list" ? (
          <input
            value={search}
            onChange={function(e){ setSearch(e.target.value); }}
            placeholder="Search card titles and scripts…"
            aria-label="Search cards"
            style={Object.assign({}, inputSt({height:36,fontSize:14,padding:"0 14px",borderRadius:10}), {flex:1,maxWidth:460,width:"auto"})}
          />
        ) : (
          <span style={{fontSize:14,color:TXT3,flex:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
            {readOnly ? "Click a card to read it" : "Click a card to edit"} · ctrl+scroll to zoom
          </span>
        )}

        <div style={{flex:1}}/>

        <span style={{fontSize:13,color:TXT3,flexShrink:0,whiteSpace:"nowrap"}}>
          {allCards.length} card{allCards.length!==1?"s":""} · <span style={{color:GREEN}}>★ {intendedTotal}</span>
        </span>

        {readOnly ? (
          <span style={{fontSize:13,color:TXT2,background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.12)",borderRadius:99,padding:"5px 12px",flexShrink:0}}>View only</span>
        ) : (
          <>
            <button onClick={function(){ setShowImport(true); }} title="Copy cards from another deck in your organization"
              style={{height:36,padding:"0 14px",fontSize:14,borderRadius:10,flexShrink:0,background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.14)",color:TXT2,cursor:"pointer",fontFamily:"inherit",fontWeight:600,display:"inline-flex",alignItems:"center",gap:7}}>
              <CopyIcon size={15}/>{isTablet ? "Copy" : "From another deck"}
            </button>
            <button onClick={startNew}
              style={Object.assign({},solidBtn(deck.color),{height:36,padding:"0 18px",fontSize:14,borderRadius:10,flexShrink:0})}>
              + New Card
            </button>
          </>
        )}
      </div>

      {/* ── Body ── */}
      <div style={{flex:1,display:"flex",overflow:"hidden",minHeight:0}}>

        {/* ── LIST MODE ── */}
        {viewMode === "list" && (
          <>
            {/* Collapsed list rail (desktop, card on stage) */}
            {editing && !isTablet && listRail && <PaneRail label="Cards" color={deck.color} onExpand={function(){ setListRail(false); }}/>}

            {/* Left pane: grouped card list */}
            {(!editing || (!isTablet && !listRail)) && <>
            <div style={{width:isTablet?Math.min(leftW,340):leftW,minWidth:isTablet?Math.min(leftW,340):leftW,display:"flex",flexDirection:"column",overflow:"hidden",flexShrink:0,background:themed("rgba(4,12,32,.35)")}}>
              {editing && (
                <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",borderBottom:"1px solid "+LINE,flexShrink:0}}>
                  <span style={{fontSize:13,fontWeight:700,color:TXT3,letterSpacing:1,textTransform:"uppercase",flex:1}}>Cards</span>
                  <button onClick={function(){ setListRail(true); }} title="Collapse the list to give the card stage more room"
                    style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.12)",borderRadius:8,color:TXT2,fontSize:13,padding:"4px 10px",cursor:"pointer",fontFamily:"inherit"}}>‹ Collapse</button>
                </div>
              )}
              <div style={{overflowY:"auto",flex:1,padding:"14px 14px 0"}}>
                {pitchTypes.map(function(t) {
                  var m = TM[t];
                  var group = allCards.filter(function(c){
                    return c.type === t && (!q || (c.title||"").toLowerCase().includes(q) || stripMarkup(c.prompt||"").toLowerCase().includes(q));
                  }).sort(function(a,b){ return (a.sortIndex||0)-(b.sortIndex||0); });
                  if (!group.length) return null;
                  var isColl = !!collapsed[t];
                  return (
                    <div key={t} style={{marginBottom:18}}>
                      {/* Group header */}
                      <button
                        onClick={function(){ setCollapsed(function(p){ return Object.assign({},p,{[t]:!isColl}); }); }}
                        aria-expanded={!isColl}
                        style={{display:"flex",alignItems:"center",gap:8,width:"100%",background:"none",border:"none",borderBottom:"1px solid "+LINE,padding:"4px 4px 8px",marginBottom:isColl?0:10,cursor:"pointer",fontFamily:"inherit"}}>
                        <span style={{fontSize:15}}>{m.icon}</span>
                        <span style={{fontSize:13,fontWeight:800,color:m.color,letterSpacing:1.2,textTransform:"uppercase"}}>{m.label}</span>
                        <span style={{fontSize:13,color:TXT3}}>{group.length}</span>
                        <span style={{fontSize:12,color:TXT3,marginLeft:"auto"}}>{isColl?"▶":"▼"}</span>
                      </button>
                      {!isColl && group.map(function(card) {
                        var sel = editing && editing.id === card.id;
                        var isRoot = card.id === deck.rootCard;
                        var b = validBullets(card);
                        var nAns = (card.answers || []).filter(function(a){ return a && a.label; }).length;
                        return (
                          <button key={card.id}
                            data-row="1"
                            onClick={function(){ openCard(card); }}
                            style={{
                              display:"flex", alignItems:"flex-start", gap:10,
                              width:"100%", textAlign:"left",
                              background:sel?m.color+"1a":"rgba(255,255,255,.035)",
                              borderTop:"1px solid "+(sel?m.color+"66":LINE),
                              borderRight:"1px solid "+(sel?m.color+"66":LINE),
                              borderBottom:"1px solid "+(sel?m.color+"66":LINE),
                              borderLeft:"4px solid "+m.color,
                              borderRadius:10, padding:"11px 12px", marginBottom:6,
                              cursor:"pointer", fontFamily:"inherit",
                              transition:"background .1s"
                            }}>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontSize:15,fontWeight:700,color:TXT,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                {card.title || <em style={{opacity:.45}}>Untitled</em>}
                              </div>
                              <div style={{fontSize:13,color:TXT3,marginTop:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                {b.length ? b[0] : (stripMarkup(card.prompt || "") || "No script yet")}
                              </div>
                              <div style={{fontSize:12,color:TXT3,marginTop:5}}>{nAns} response{nAns!==1?"s":""}</div>
                            </div>
                            <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:5,flexShrink:0}}>
                              {isRoot && <MiniBadge color={GREEN}>Entry</MiniBadge>}
                              {card.intendedPath && <MiniBadge color={GREEN}>★ Intended</MiniBadge>}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
                {allCards.length === 0 && (
                  <div style={{textAlign:"center",color:TXT3,padding:"48px 0",fontSize:15}}>
                    No cards yet.{!readOnly && " Use + New Card to start."}
                  </div>
                )}
                {allCards.length > 0 && q && !allCards.some(function(c){ return pitchTypes.indexOf(c.type) >= 0 && ((c.title||"").toLowerCase().includes(q) || stripMarkup(c.prompt||"").toLowerCase().includes(q)); }) && (
                  <div style={{textAlign:"center",color:TXT3,padding:"40px 0",fontSize:15}}>No cards match “{search}”</div>
                )}
                <div style={{height:16}}/>
              </div>
            </div>

            {/* Drag handle */}
            <div
              onMouseDown={startDrag}
              title="Drag to resize"
              style={Object.assign({},resizeHandle(),{background:isDragging?"rgba(255,255,255,.1)":"transparent"})}
            />
            </>}

            {/* Right pane: card stage (editor / read view) or overview */}
            <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0,background:themed("rgba(8,20,50,.2)")}}>
              {editing ? renderDetail() : renderOverview()}
            </div>
          </>
        )}

        {/* ── TREE MODE ── */}
        {viewMode === "tree" && (
          <>
            {/* Left: summary rail (hidden while the side panel is open so the tree keeps its width) */}
            {!editing && <div style={{width:260,minWidth:260,flexShrink:0,display:"flex",flexDirection:"column",borderRight:"1px solid "+LINE,background:themed("rgba(4,12,32,.4)"),overflowY:"auto"}}>
              <div style={{padding:"16px 18px 12px",borderBottom:"1px solid "+LINE}}>
                <div style={{fontSize:13,fontWeight:700,color:TXT3,letterSpacing:1,textTransform:"uppercase",marginBottom:12}}>Card types</div>
                {typeStats.map(function(ts) {
                  return (
                    <div key={ts.type} style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
                      <div style={{width:4,height:36,borderRadius:99,background:ts.m.color,flexShrink:0}}/>
                      <div style={{flex:1}}>
                        <div style={{fontSize:20,fontWeight:800,color:ts.m.color,lineHeight:1.1}}>{ts.count}</div>
                        <div style={{fontSize:13,color:TXT2}}>{ts.m.label}</div>
                      </div>
                      {ts.intendedCount > 0 && <MiniBadge color={GREEN}>★ {ts.intendedCount}</MiniBadge>}
                    </div>
                  );
                })}
              </div>
              <div style={{padding:"14px 18px"}}>
                <div style={{fontSize:13,fontWeight:700,color:TXT3,letterSpacing:1,textTransform:"uppercase",marginBottom:10}}>Intended path</div>
                {intendedPath.length === 0 && <div style={{fontSize:14,color:TXT3}}>No entry card set</div>}
                {intendedPath.map(function(c, i) {
                  var m = TM[c.type] || TM.pitch;
                  var sel = editing && editing.id === c.id;
                  return (
                    <button key={c.id} onClick={function(){ openCard(c); }}
                      style={{display:"flex",alignItems:"center",gap:10,width:"100%",textAlign:"left",background:sel?m.color+"1a":"transparent",border:"none",borderRadius:8,padding:"7px 6px",cursor:"pointer",fontFamily:"inherit"}}>
                      <span style={{width:22,height:22,borderRadius:"50%",background:m.color+"22",border:"1.5px solid "+m.color+"88",color:m.color,fontSize:12,fontWeight:800,display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{i+1}</span>
                      <span style={{fontSize:14,color:i===0?GREEN:TXT2,fontWeight:i===0?700:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.title || "Untitled"}</span>
                    </button>
                  );
                })}
              </div>
            </div>}

            {/* Card open: the tree folds into a rail on desktop (same as the Cards list) */}
            {editing && !isTablet && treeRail && <PaneRail label="Tree" color={deck.color} onExpand={function(){ setTreeRail(false); }}/>}

            {/* The tree: full width with nothing open; a resizable pane beside the stage when
                expanded; hidden on tablets while a card is on the stage (its back pill returns) */}
            {(!editing || (!isTablet && !treeRail)) && <>
            <div style={editing
              ? {width:leftW,minWidth:leftW,flexShrink:0,display:"flex",flexDirection:"column",overflow:"hidden",background:themed("rgba(4,12,32,.35)")}
              : {flex:1,overflow:"hidden",position:"relative",minWidth:0,display:"flex",flexDirection:"column"}}>
              {editing && (
                <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",borderBottom:"1px solid "+LINE,flexShrink:0}}>
                  <span style={{fontSize:13,fontWeight:700,color:TXT3,letterSpacing:1,textTransform:"uppercase",flex:1}}>Tree</span>
                  <button onClick={function(){ setTreeRail(true); }} title="Collapse the tree to give the card stage more room"
                    style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.12)",borderRadius:8,color:TXT2,fontSize:13,padding:"4px 10px",cursor:"pointer",fontFamily:"inherit"}}>‹ Collapse</button>
                </div>
              )}
              <TreeView
                cards={deck.cards}
                rootCard={deck.rootCard}
                onEdit={function(c){ openCard(c); }}
                onSetRoot={readOnly ? null : function(id){ onUpdateDeck(deck.id, function(d){ return Object.assign({},d,{rootCard:id}); }); }}
              />
            </div>
            {editing && (
              <div onMouseDown={startDrag} title="Drag to resize"
                style={Object.assign({},resizeHandle(),{background:isDragging?"rgba(255,255,255,.1)":"transparent"})}/>
            )}
            </>}

            {/* The open card on the stage (editor / read view) */}
            {editing && (
              <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0,background:themed("rgba(8,20,50,.2)")}}>
                {renderDetail()}
              </div>
            )}
          </>
        )}

      </div>
      {showImport && <ImportPicker mode="cards" decks={decks} currentDeckId={deck.id} onImport={importCards} onClose={function(){ setShowImport(false); }}/>}
    </div>
  );
}
