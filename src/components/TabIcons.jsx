// ─── TAB ICONS ────────────────────────────────────────────────────────────────
// Minimal flat line icons for the main navigation. They draw in currentColor, so the
// nav colours them: the org accent (SESS_COLOR) when active, a muted white otherwise.
var PATHS = {
  home: (
    <>
      <path d="M3.5 10.6 12 3.8l8.5 6.8V19a1.5 1.5 0 0 1-1.5 1.5h-4.2v-6h-5.6v6H5A1.5 1.5 0 0 1 3.5 19z"/>
    </>
  ),
  play: (
    <>
      <circle cx="12" cy="12" r="8.75"/>
      <path d="M10.2 8.6v6.8l5.6-3.4z" fill="currentColor" stroke="none"/>
    </>
  ),
  sessions: (
    <>
      <rect x="4.5" y="4" width="15" height="16.5" rx="2.5"/>
      <path d="M8.5 9h7M8.5 12.5h7M8.5 16h4"/>
    </>
  ),
  cards: (
    <>
      <rect x="3.5" y="7" width="12.5" height="14" rx="2.2"/>
      <path d="M8 4h10.3a2.2 2.2 0 0 1 2.2 2.2V17"/>
    </>
  ),
  objections: (
    <>
      <path d="M12 3.3 19 6v5.2c0 4.6-3 8.1-7 9.6-4-1.5-7-5-7-9.6V6z"/>
      <path d="M9.3 12.2 11.2 14l3.6-3.8"/>
    </>
  ),
  admin: (
    <>
      <path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/>
      <circle cx="15" cy="7" r="2"/>
      <circle cx="9" cy="12" r="2"/>
      <circle cx="17" cy="17" r="2"/>
    </>
  ),
};

export function TabIcon({ id, size }) {
  var s = size || 20;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{display:"block",flexShrink:0}}>
      {PATHS[id] || PATHS.home}
    </svg>
  );
}

// Search glyph, same line style as the tab icons
export function SearchIcon({ size }) {
  var s = size || 18;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{display:"block",flexShrink:0}}>
      <circle cx="11" cy="11" r="6.5"/>
      <path d="m16 16 4.5 4.5"/>
    </svg>
  );
}
