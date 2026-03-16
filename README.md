# RedCard

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
- **Swimlane View** — Column-based card flow visualization organized by type (pitch, discovery, close, objection) with SVG connection edges
- **Tree View** — Hierarchical card tree with collapse/expand, zoom controls, loop detection, and orphan identification
- **Admin Panel** — Manage users (create, edit, delete, password reset) and teams (create, edit, assign admins/members)
- **Deck Management** — Multiple decks per org with color, icon, and visibility settings (public/private with team/user access controls)
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

Creates 2 organizations with teams, users, decks, and 300+ realistic sessions. Default password for all seeded users: `Redcard2025!`

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
React 19 (Vite)  ──▶  Express REST API  ──▶  SQLite (better-sqlite3)
   SPA frontend          server/              data/redcard.db
   src/App.jsx           index.js
                         routes/
                         db.js
                         auth.js
```

- **Frontend:** Single-file React app (`src/App.jsx`, ~4400 lines). All components, contexts, and utilities inline. All styling via JS objects — no CSS files.
- **Backend:** Express with JWT cookie authentication, role-based authorization (admin/user), and SQLite database with WAL mode.
- **Dev proxy:** Vite proxies `/api/*` to Express on port 3001 during development.
- **Production:** Express serves the built `dist/` directory and handles API routes on a single port.

## Project Structure

```
redcard/
├── index.html              # Vite entry HTML
├── package.json            # Dependencies and scripts
├── vite.config.js          # Vite config with API proxy
├── CLAUDE.md               # Detailed codebase documentation
├── src/
│   ├── main.jsx            # React entry point
│   └── App.jsx             # Entire frontend (~4400 lines)
├── server/
│   ├── index.js            # Express app, middleware, route mounting
│   ├── db.js               # SQLite schema, migrations, query functions
│   ├── auth.js             # JWT, bcrypt, cookie, auth middleware
│   ├── seed.js             # Database seeder with demo data
│   └── routes/
│       ├── authRoutes.js   # Login, logout, refresh, me
│       ├── deckRoutes.js   # Deck CRUD + access control
│       ├── sessionRoutes.js # Sessions, feedback, sharing
│       └── adminRoutes.js  # User and team management
└── data/
    └── redcard.db          # SQLite database (created on first run)
```

## Database

SQLite database with 10 tables supporting multi-tenant organization structure:

- **orgs** — Organizations
- **teams** — Teams per org
- **users** — User accounts with roles (admin/user)
- **team_admins** / **user_teams** — Team membership and admin assignments
- **decks** — Sales pitch decks with JSON card and objection data
- **deck_access** — Visibility controls for private decks
- **sessions** — Practice/live session recordings
- **session_feedback** — Feedback comments on sessions
- **session_shares** — Session sharing between users

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
- **ES5-style code:** Uses `var`, `function`, `Object.assign` — no arrow functions, no spread operator, no destructuring in the frontend
- **Rich text:** Card prompts support `**bold**`, `*italic*`, and `*text*[Inflection]` markup
- **Polling:** Feedback and share modals poll every 5 seconds with proper cleanup on unmount
