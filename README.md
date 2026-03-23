# OverCard

A sales pitch deck training platform. Build structured call flows with branching response paths, practice sessions with real-time card navigation, and review performance with analytics and peer feedback.

## Features

- **Play Mode** — Navigate through pitch decks in live or practice sessions with real-time card flow, objection handling, breadcrumb navigation, and quick notes
- **Session Recording** — Every session captures visit events, timing, card paths, notes, and outcome (sold/booked/abandoned/completed)
- **Cards** — Create pitch, discovery, and close cards with rich-text prompts, inflection delivery cues, branching response paths, and intended path marking
- **Objection Stacks** — Build reusable objection handling flows with custom icons, entry cards, and configurable post-resolution routing (return to current card or jump to a specific target)
- **Session Review** — Four-tab analysis: overview stats, visit path timeline, notes transcript, and feedback thread
- **Analytics** — Aggregated metrics: close rate, average duration, intended path adherence, call funnel, top objections, top cards by visit count
- **Sharing** — Session owners can share completed sessions with teammates for feedback
- **Feedback** — Admins and share recipients can leave card-specific or general feedback on sessions
- **Canvas Viewer** — Top-to-bottom card flow visualization as a DAG. Cards are arranged by depth (BFS rows) and spread horizontally within each row. Edges use orthogonal staircase routing through gutter zones — never overlapping card rows. Loopback edges appear as dashed amber lines routed to the right. Supports fit-to-screen, zoom, and pan.
- **Tree View** — Hierarchical card tree with collapse/expand, zoom controls, loop detection, and orphan identification
- **Admin Panel** — Manage users (create, edit, delete, password reset) and teams (create, edit, assign admins/members)
- **Deck Management** — Multiple decks per org with color, icon, and visibility settings (public/private with team/user access controls)
- **Home Tab** — Performance dashboard showing win rates, average call duration, intended path adherence, top cards, top objections, and per-deck breakdowns with team sub-tabs
- **Inflection System** — 20 delivery cues across 5 categories (pace, tone, attitude, rhetorical, personality) embedded in card prompts via rich-text markup

## Quick Start

### Prerequisites

- Node.js >= 18

### Install

```bash
npm install
```

### Seed Demo Data (optional)

```bash
node server/seed.js
```

Creates 2 organizations with teams, users, decks, and 300+ realistic sessions. Default credentials are configured in `server/seed.js` (development only).

### Development

```bash
npm run dev
```

- Frontend: http://localhost:5173
- API: http://localhost:3001/api/health

### Production

```bash
npm start
```

Builds the frontend and serves everything on http://localhost:3000

## Architecture

```
React 19 (Vite)  ──▶  Express REST API  ──▶  PostgreSQL (pg Pool)
   SPA frontend          server/              DATABASE_URL
   src/App.jsx           index.js
                         routes/
                         db.js
                         auth.js
```

- **Frontend:** Modular React app. `src/App.jsx` is the shell; components in `src/components/` (9 files), shared code in `src/lib/` (4 files). All styling via JS objects — no CSS files.
- **Backend:** Express with JWT cookie authentication, role-based authorization (admin/user), and PostgreSQL database via async `pg` Pool.
- **Dev proxy:** Vite proxies `/api/*` to Express on port 3001 during development.
- **Production:** Express serves the built `dist/` directory and handles API routes on a single port.

## Project Structure

```
overcard/
├── index.html              # Vite entry HTML
├── package.json            # Dependencies and scripts
├── vite.config.js          # Vite config with API proxy
├── CLAUDE.md               # Detailed codebase documentation
├── src/
│   ├── main.jsx            # React entry point
│   ├── App.jsx             # App shell (auth, tabs, autosave)
│   ├── components/
│   │   ├── Cards.jsx       # CardsTab, ObjStackEditor, ObjectionsTab
│   │   ├── Editor.jsx      # RichPromptEditor, CardEditorSheet
│   │   ├── Home.jsx        # HomeTab (performance dashboard, team sub-tabs)
│   │   ├── Panels.jsx      # DeckSwitcherSheet, LoginScreen, ProfileSheet, AdminPanel
│   │   ├── Play.jsx        # ObjPicker, Navigator, PlayTab
│   │   ├── Sessions.jsx    # ShareModal, SessionReview, SessionsTab, SessionAnalytics
│   │   ├── Tooltip.jsx     # TipCtx, GlobalInflTooltip, InflWord, RichPromptDisplay
│   │   ├── Viewer.jsx      # TreeView, SwimlaneView
│   │   └── ui.jsx          # TypeBadge, Handle, IntendedBadge, SectionHdr, StatBox, BarRow
│   └── lib/
│       ├── api.js          # apiGet, apiPut, apiPost, apiDel, setUnauthHandler
│       ├── constants.js    # TM, INFLECTIONS, DECK_COLORS, DECK_ICONS, etc.
│       ├── richtext.js     # parseRichText, stripMarkup
│       └── styles.js       # solidBtn, ghostBtn, ghostSm, iconBtn, etc.
├── server/
│   ├── index.js            # Express app, middleware, route mounting
│   ├── db.js               # PostgreSQL schema init, pool, query functions
│   ├── auth.js             # JWT, bcrypt, cookie, auth middleware
│   ├── seed.js             # Database seeder with demo data
│   └── routes/
│       ├── authRoutes.js   # Login, logout, refresh, me
│       ├── deckRoutes.js   # Deck CRUD + access control
│       ├── sessionRoutes.js # Sessions, feedback, sharing
│       └── adminRoutes.js  # User and team management
└── render.yaml             # Render Blueprint (web service + PostgreSQL)
```

## Database

PostgreSQL database with 10 tables supporting multi-tenant organization structure:

- **orgs** — Organizations
- **teams** — Teams per org
- **users** — User accounts with roles (admin/user)
- **team_admins** / **user_teams** — Team membership and admin assignments
- **decks** — Sales pitch decks with JSONB card and objection data
- **deck_access** — Visibility controls for private decks
- **sessions** — Practice/live session recordings with JSONB event/note/metrics data
- **session_feedback** — Feedback comments on sessions
- **session_shares** — Session sharing between users

Schema is auto-initialized on server startup via `initSchema()`. JSONB columns are serialized/deserialized automatically by the pg driver. Timestamp columns use BIGINT to store Unix millisecond values.

## Authentication

JWT tokens stored in HttpOnly cookies. Two roles:

- **Admin** — Full access: create/edit/delete decks, manage users and teams, view all org sessions
- **User** — Play sessions, view cards and objections (read-only), share sessions, leave feedback on shared sessions

Dev login screen provides an org picker and user quick-select for easy testing.

## API

30+ REST endpoints grouped by resource:

| Group | Endpoints |
|-------|-----------|
| Auth | login, logout, refresh, me |
| Decks | list, create, update, delete, get/set access |
| Sessions | list (filterable), upsert, delete |
| Feedback | list, create, update, delete per session |
| Shares | create, list, revoke per session |
| Admin | user CRUD + password reset, team CRUD |
| Health | server status check |

See `CLAUDE.md` for the complete endpoint reference.

## Development Notes

- **Autosave:** Deck changes autosave after 800ms of inactivity via `PUT /api/decks/:id`
- **No CSS:** All styling is inline JS objects. Style helper functions (`solidBtn`, `ghostBtn`, etc.) handle common patterns.
- **ES5-style code:** Uses `var`, `function`, `Object.assign` — no arrow functions, no spread operator, no destructuring. Applies to the frontend only; the backend uses modern JS freely.
- **Rich text:** Card prompts support `**bold**`, `*italic*`, and `*text*[Inflection]` markup
- **Polling:** Feedback and share modals poll every 5 seconds with proper cleanup on unmount
- **Single-session enforcement:** Each login records a session token (`activeToken`) in the database. A second login from a different device invalidates the first session, returning a `session_replaced` 401 that the frontend intercepts to show a kicked-out message.
- **Smart seeding:** `server/seed.js` uses upsert logic so it can be run repeatedly without creating duplicate data.

## Production Deployment

### Deploy to Render (recommended)

OverCard ships a `render.yaml` Blueprint that provisions a Node.js web service and a managed PostgreSQL database automatically.

1. Create an account at [render.com](https://render.com)
2. New → **Blueprint** → connect your repo
3. Render detects `render.yaml` and creates:
   - `overcard-api` — Node.js web service
   - `overcard-db` — Free-tier PostgreSQL instance
4. After the first deploy, set **`CORS_ORIGIN`** in the Render dashboard to your Vercel frontend URL (e.g. `https://your-app.vercel.app`)
5. Seed demo data via **Render Shell** (dashboard → web service → Shell tab):
   ```bash
   node server/seed.js
   ```

### Environment Variables

| Variable | Required | Source | Notes |
|----------|----------|--------|-------|
| `DATABASE_URL` | Yes | Auto-wired from `overcard-db` | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Auto-generated by Render | App exits without it in production |
| `NODE_ENV` | Yes | Set to `production` in render.yaml | Enables secure cookies, helmet CSP |
| `CORS_ORIGIN` | Yes | Set manually in dashboard | Your Vercel frontend URL |
| `PORT` | No | Render sets automatically | Default: 3000 |

### Local Production Run

```bash
DATABASE_URL=postgres://localhost/overcard npm run build && NODE_ENV=production JWT_SECRET=your-secret-here node server/index.js
```

**Warning:** Do NOT run `node server/seed.js` in production — the script exits immediately if `NODE_ENV=production`.

> **Note:** Render's free PostgreSQL plan has a 90-day data retention limit. Upgrade to a paid plan for persistent production data.
