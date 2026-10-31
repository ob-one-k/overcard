import { useState, useEffect, useRef } from "react";
import { useNotifications, markAllNotificationsRead } from "../lib/notifications";
import { themed } from "../lib/constants";
import { openLibrary } from "../lib/library";

// ─── NOTIFICATION BELL ────────────────────────────────────────────────────────
// Header bell with an unread badge; the dropdown lists recent notifications
// (feedback left on your sessions). Clicking one opens that session's review.

function timeAgo(ts) {
  var s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  var m = Math.round(s / 60); if (m < 60) return m + "m ago";
  var h = Math.round(m / 60); if (h < 24) return h + "h ago";
  var d = Math.round(h / 24); if (d < 7) return d + "d ago";
  return new Date(ts).toLocaleDateString(undefined, { month:"short", day:"numeric" });
}

// side="right": the panel opens to the right of the bell, anchored to its bottom
// (the landscape-phone nav rail, where the bell sits bottom-left)
export function NotificationBell({ onOpenSession, size, side }) {
  var n = useNotifications();
  var [open, setOpen] = useState(false);
  var wrapRef = useRef(null);
  var lg = size === "lg";
  var btn = lg ? 40 : side === "right" ? 30 : 34;
  var panelPos = side === "right"
    ? { left:"calc(100% + 10px)", bottom:0, maxHeight:"calc(var(--vvh, 100vh) - 20px)" }
    : { top:"calc(100% + 8px)", right:0, maxHeight:lg?480:420 };

  // Close on outside click / Esc
  useEffect(function() {
    if (!open) return;
    function onDown(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    function onKey(e) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return function() { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  var unread = n.unreadCount;
  return (
    <div ref={wrapRef} style={{position:"relative",flexShrink:0}} onClick={function(e){ e.stopPropagation(); }}>
      <button onClick={function(){ setOpen(!open); }} aria-label={unread ? unread + " unread notifications" : "Notifications"} aria-expanded={open}
        style={{position:"relative",width:btn,height:btn,borderRadius:"50%",background:open?"rgba(255,255,255,.12)":"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.12)",color:"rgba(255,255,255,.85)",fontSize:lg?16:14,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"inherit"}}>
        🔔
        {unread > 0 && (
          <span style={{position:"absolute",top:-3,right:-3,minWidth:17,height:17,padding:"0 4px",borderRadius:99,background:"#EF5350",color:"#fff",fontSize:10,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:themed("0 0 0 2px #060d1a")}}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications"
          style={{position:"absolute",top:panelPos.top,right:panelPos.right,left:panelPos.left,bottom:panelPos.bottom,width:lg?380:side === "right" ? "min(340px, calc(100vw - 96px))" : "min(340px, calc(100vw - 24px))",maxHeight:panelPos.maxHeight,display:"flex",flexDirection:"column",background:themed("#0a1830"),border:"1px solid rgba(255,255,255,.12)",borderRadius:14,boxShadow:"0 18px 50px rgba(0,0,0,.7)",zIndex:400,overflow:"hidden",animation:"fadeIn .15s ease both"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 14px",borderBottom:"1px solid rgba(255,255,255,.08)"}}>
            <span style={{fontSize:lg?15:13,fontWeight:700,color:"#fff"}}>Notifications</span>
            {unread > 0 && (
              <button onClick={markAllNotificationsRead}
                style={{background:"none",border:"none",color:"#00B4FF",fontSize:lg?13:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",padding:0}}>Mark all read</button>
            )}
          </div>
          <div style={{overflowY:"auto"}}>
            {n.items.length === 0 && (
              <div style={{padding:"28px 16px",textAlign:"center",fontSize:lg?14:12,color:"rgba(255,255,255,.4)",lineHeight:1.6}}>
                No notifications yet.<br/>You'll be told here when someone leaves feedback on your sessions or shares a session or clip with you.
              </div>
            )}
            {n.items.map(function(item) {
              var isNew = !item.readAt;
              return (
                <button key={item.id}
                  onClick={function(){
                    setOpen(false);
                    if (item.type === "clip_share") { if (item.clipId) openLibrary({ tab: "clips", clipId: item.clipId }); return; }
                    if (item.sessionId && onOpenSession) onOpenSession(item.sessionId, item.deckId);
                  }}
                  style={{display:"flex",gap:10,width:"100%",textAlign:"left",padding:"11px 14px",background:isNew?"rgba(0,180,255,.06)":"transparent",border:"none",borderBottom:"1px solid rgba(255,255,255,.05)",cursor:"pointer",fontFamily:"inherit"}}>
                  <span style={{width:8,height:8,borderRadius:"50%",marginTop:6,flexShrink:0,background:isNew?"#00B4FF":"transparent"}}/>
                  <span style={{flex:1,minWidth:0}}>
                    <span style={{display:"block",fontSize:lg?14:12,color:"#fff",lineHeight:1.45}}>
                      {item.type === "clip_share" ? (
                        <><strong>{item.actorName || "Someone"}</strong> shared the clip <strong>{item.clipTitle || "a clip"}</strong> with you</>
                      ) : (
                        <><strong>{item.actorName || "Someone"}</strong>{item.type === "share" ? " shared " : " left feedback on "}<strong>{item.sessionName || (item.type === "share" ? "a session" : "your session")}</strong>{item.type === "share" ? " with you" : ""}</>
                      )}
                    </span>
                    {item.text && <span style={{display:"block",fontSize:lg?13:11,color:"rgba(255,255,255,.55)",marginTop:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>“{item.text}”</span>}
                    <span style={{display:"block",fontSize:lg?12:10,color:"rgba(255,255,255,.35)",marginTop:3}}>{timeAgo(item.createdAt)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
