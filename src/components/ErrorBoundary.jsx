import { Component } from "react";
import { getBrand } from "../lib/brand";
import { OrgMark } from "./OrgMark";

// ─── ERROR BOUNDARY ───────────────────────────────────────────────────────────
// Catches render-time exceptions so a single component failure shows a recovery
// screen instead of unmounting the whole app to a blank page.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error: error };
  }
  componentDidCatch(error, info) {
    console.error("OverCard crashed:", error, info && info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{width:"100%",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#060d1a",flexDirection:"column",gap:16,fontFamily:"inherit",padding:16,boxSizing:"border-box"}}>
        {getBrand() ? <OrgMark size={typeof window !== "undefined" && window.innerWidth < 768 ? 40 : 48}/> : <div style={{fontSize:40}}>⚠️</div>}
        <div style={{color:"#fff",fontSize:15,fontWeight:700}}>Something went wrong</div>
        <div style={{color:"rgba(255,255,255,.5)",fontSize:13,maxWidth:300,textAlign:"center",lineHeight:1.5}}>OverCard hit an unexpected error. Reloading usually fixes it.</div>
        <button
          onClick={function() { window.location.reload(); }}
          style={{background:"#1565C0",border:"none",borderRadius:14,color:"#fff",fontSize:14,fontWeight:700,padding:"12px 20px",cursor:"pointer",fontFamily:"inherit"}}>
          Reload
        </button>
      </div>
    );
  }
}
