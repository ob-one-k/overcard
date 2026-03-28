import { createContext } from "react";

// ─── DESKTOP CONTEXT ──────────────────────────────────────────────────────────
// Consumed by sheet/modal components to decide which container to render.
// Default value = mobile (no changes to existing behavior when context not provided).
var DesktopCtx = createContext({
  isDesktop: false,
  isTablet: false,
  isMobile: true,
  isTouchPrimary: false
});

export default DesktopCtx;
