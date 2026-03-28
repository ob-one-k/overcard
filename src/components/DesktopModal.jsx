import { useEffect } from "react";
import { modalOverlay, modalDialog, iconBtn, labelSt } from "../lib/styles";

// ─── DESKTOP MODAL ─────────────────────────────────────────────────────────────
// Generic centered dialog that replaces bottom sheets on desktop.
// Usage: wrap inner sheet content JSX — nothing else changes.
export function DesktopModal({ title, width, onClose, children }) {
  // ESC key closes the modal
  useEffect(function() {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return function() { document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div style={modalOverlay()} onClick={handleOverlayClick}>
      <div style={Object.assign({}, modalDialog(width || 480), {
        position:"absolute",
        top:"50%",
        left:"50%",
        transform:"translate(-50%,-50%)",
        animation:"modalIn .22s cubic-bezier(.22,1,.36,1) both"
      })}>
        {/* Title bar */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"18px 20px 14px",borderBottom:"1px solid rgba(255,255,255,.07)",flexShrink:0}}>
          <div style={{fontSize:16,fontWeight:700,color:"#fff",fontFamily:"'Lora',serif"}}>{title}</div>
          <button onClick={onClose} style={iconBtn()}>✕</button>
        </div>
        {/* Content */}
        <div style={{padding:"0"}}>
          {children}
        </div>
      </div>
    </div>
  );
}
