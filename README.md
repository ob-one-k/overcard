# OverCard

A sales pitch deck training platform. Build structured call flows with branching response paths, practice sessions with real-time card navigation, and review performance with analytics and peer feedback.

## Features

- **Play Mode** — Navigate through pitch decks in live or practice sessions with real-time card flow, objection handling, breadcrumb navigation, and quick notes
- **Session Recording** — Every session captures visit events, timing, card paths, notes, and outcome (sold/booked/abandoned/completed)
- **Call Audio** — Optional audio recording from any input device (built-in, headset, USB, Bluetooth), plus the call's tab/system audio on desktop Chrome/Edge. Recordings are stored with the session, so managers can listen from any device: the full call start to finish, or one card's clip at a time
- **Cards** — Create pitch, discovery, and close cards with rich-text prompts, inflection delivery cues, branching response paths, and intended path marking
- **Objection Stacks** — Build reusable objection handling flows with custom icons, entry cards, and configurable post-resolution routing (return to current card or jump to a specific target)
- **Session Review** — Four-tab analysis: overview stats, visit path timeline, notes transcript, and feedback thread
- **Analytics** — Aggregated metrics: close rate, average duration, intended path adherence, call funnel, top objections, top cards by visit count
- **Sharing** — Session owners can share completed sessions with teammates for feedback
- **Feedback** — Admins and share recipients can leave card-specific or general feedback on sessions
- **Tree Viewer** — Collapsible hierarchical card tree with per-node expand/collapse (▶/▼), intended path highlighting, loop-back detection, merge-point markers, orphan identification, and pinch/ctrl+scroll zoom
- **Swimlane Viewer** — Horizontal type-based lane layout (pitch / discovery / close / objection) with bezier edge routing, compact mode at low zoom, and click-to-select/edit card interaction
- **Sign Up** — Employees join their organization with an admin-issued share code (or invite link `/?join=CODE`); new organizations are created with the server's master code, and the creator becomes the owner
- **Admin Panel** — Manage users (create, edit, promote/demote, delete, password reset), teams, share codes, and organization details
- **Roles** — Owner (one per org; edits org details, demotes admins, transfers ownership), Admin (decks, users, teams, share codes), User
- **Deck Management** — Multiple decks per org with color, icon, and visibility settings (public/private with team/user access controls)
- **Home Tab** — Performance dashboard showing win rates, average call duration, intended path adherence, top cards, top objections, and per-deck breakdowns with team sub-tabs
- **Inflection System** — 20 delivery cues across 5 categories (pace, tone, attitude, rhetorical, personality) embedded in card prompts via rich-text markup

## Quick Start

### Prerequisites

- Node.js 24.x (LTS — see `.nvmrc`)

### Install

```bash
npm install
```

### First Organization

There is no demo data. Start the server with a `MASTER_CODE`, open the app, choose **Sign up → Create organization**, and enter that code. You become the org's owner.

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
- **Backend:** Express with JWT cookie authentication, role-based authorization (owner/admin/user), and PostgreSQL database via async `pg` Pool.
- **Dev proxy:** Vite proxies `/api/*` to Express on port 3001 during development.
- **Production:** Express serves the built `dist/` directory and handles API routes on a single port.

## Project Structure

```
overcard/
├── index.html              # Vite entry HTML
├── package.json            # Dependencies and scripts
├── vite.config.mjs         # Vite config with API proxy
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
│   ├── validate.js         # Input validation (names, email, phone, password, org fields)
│   └── routes/
│       ├── authRoutes.js   # Login, logout, refresh, me, signup, create-org
│       ├── orgRoutes.js    # Organization profile (read: members, edit: owner)
│       ├── deckRoutes.js   # Deck CRUD + access control
│       ├── sessionRoutes.js # Sessions, feedback, sharing
│       └── adminRoutes.js  # Users, roles, ownership transfer, share codes, teams
└── render.yaml             # Render Blueprint (web service + PostgreSQL)
```

## Database

PostgreSQL database with 11 tables supporting multi-tenant organization structure:

- **orgs** — Organizations (name, industry, website, phone, address)
- **org_invites** — Share codes for joining an org (expiry, max uses, revocation)
- **teams** — Teams per org
- **users** — User accounts (first/last name, email, phone) with roles (owner/admin/user; one owner per org)
- **team_admins** / **user_teams** — Team membership and admin assignments
- **decks** — Sales pitch decks with JSONB card and objection data
- **deck_access** — Visibility controls for private decks
- **sessions** — Practice/live session recordings with JSONB event/note/metrics data
- **session_feedback** — Feedback comments on sessions
- **session_shares** — Session sharing between users

Schema is auto-initialized on server startup via `initSchema()`. JSONB columns are serialized/deserialized automatically by the pg driver. Timestamp columns use BIGINT to store Unix millisecond values.

## Authentication

JWT tokens stored in HttpOnly cookies. Three roles:

- **Owner** — Everything an admin can do, plus: edit organization details, demote admins, manage other admins, transfer ownership. Exactly one per org (the org's creator).
- **Admin** — Create/edit/delete decks, manage users and teams, promote users to admin, generate share codes, view all org sessions
- **User** — Play sessions, view cards and objections (read-only), share sessions, leave feedback on shared sessions

Dev login screen provides an org picker and user quick-select for easy testing.

## API

30+ REST endpoints grouped by resource:

| Group | Endpoints |
|-------|-----------|
| Auth | login, logout, refresh, me, signup (share code), create-org (master code), invite preview |
| Org | get profile, update (owner) |
| Decks | list, create, update, delete, get/set access |
| Sessions | list (filterable), upsert, delete |
| Feedback | list, create, update, delete per session |
| Shares | create, list, revoke per session |
| Admin | user CRUD + password reset, transfer ownership, share codes, team CRUD |
| Health | server status check |

See `CLAUDE.md` for the complete endpoint reference.

## Development Notes

- **Autosave:** Deck changes autosave after 800ms of inactivity via `PUT /api/decks/:id`
- **No CSS:** All styling is inline JS objects. Style helper functions (`solidBtn`, `ghostBtn`, etc.) handle common patterns.
- **ES5-style code:** Uses `var`, `function`, `Object.assign` — no arrow functions, no spread operator, no destructuring. Applies to the frontend only; the backend uses modern JS freely.
- **Rich text:** Card prompts support `**bold**`, `*italic*`, and `*text*[Inflection]` markup
- **Polling:** Feedback and share modals poll every 5 seconds with proper cleanup on unmount
- **Single-session enforcement:** Each login records a session token (`activeToken`) in the database. A second login from a different device invalidates the first session, returning a `session_replaced` 401 that the frontend intercepts to show a kicked-out message.

## Production Deployment

### Deploy to Render (recommended)

OverCard ships a `render.yaml` Blueprint that provisions a Node.js web service and a managed PostgreSQL database automatically.

1. Create an account at [render.com](https://render.com)
2. New → **Blueprint** → connect your repo
3. Render detects `render.yaml` and creates:
   - `overcard-api` — Node.js web service
   - `overcard-db` — Free-tier PostgreSQL instance
4. After the first deploy, set **`CORS_ORIGIN`** in the Render dashboard to your Vercel frontend URL (e.g. `https://your-app.vercel.app`)
5. Set **`MASTER_CODE`**, then create the first organization from the app's sign-up screen

### Environment Variables

| Variable | Required | Source | Notes |
|----------|----------|--------|-------|
| `DATABASE_URL` | Yes | Auto-wired from `overcard-db` | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Auto-generated by Render | App exits without it in production |
| `NODE_ENV` | Yes | Set to `production` in render.yaml | Enables secure cookies, helmet CSP |
| `CORS_ORIGIN` | Yes | Set manually in dashboard | Your Vercel frontend URL |
| `MASTER_CODE` | For org sign-up | Set manually in dashboard | Secret required to create a new organization. If unset, org creation is disabled (share-code signup still works). |
| `PORT` | No | Render sets automatically | Default: 3000 |

### Local Production Run

```bash
DATABASE_URL=postgres://localhost/overcard npm run build && NODE_ENV=production JWT_SECRET=your-secret-here node server/index.js
```

> **Note:** Render's free PostgreSQL plan has a 90-day data retention limit. Upgrade to a paid plan for persistent production data.
