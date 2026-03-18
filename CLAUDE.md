# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies (Node >=18 required)
npm run dev          # Dev mode: runs Express (port 3001) + Vite (port 5173) concurrently
npm run build        # Build frontend into dist/
npm start            # Build + serve production on port 3000
node server/seed.js  # Seed database with demo orgs, users, decks, sessions
```

Dev endpoints:
- Frontend: `http://localhost:5173`
- API: `http://localhost:3001/api/health`

No test framework is configured.

## Architecture

**Stack:** React 19 (Vite) frontend + Express backend + SQLite (better-sqlite3).

**Modular frontend:** `src/App.jsx` is the app shell (auth, tabs, autosave). Components are split into `src/components/` (8 files) and shared code into `src/lib/` (4 files):

- `src/components/` — `Cards.jsx`, `Editor.jsx`, `Panels.jsx`, `Play.jsx`, `Sessions.jsx`, `Tooltip.jsx`, `Viewer.jsx`, `ui.jsx`
- `src/lib/` — `api.js`, `constants.js`, `richtext.js`, `styles.js`

**Inline styling:** All styles are plain JS objects passed to `style={}`. There is no CSS file, no Tailwind, no CSS-in-JS library. Reusable style helpers are defined in `src/lib/styles.js` (`solidBtn`, `ghostBtn`, `ghostSm`, `iconBtn`, `labelSt`, `inputSt`, `cardBg`, `badgeSt`, `dividerV`).

**Backend:** Express REST API with SQLite database at `data/overcard.db`.
- `server/index.js` — Express entry, middleware, route mounting, static file serving
- `server/db.js` — Schema, migrations, all database query functions (50+ exports)
- `server/auth.js` — JWT signing/verification, bcrypt hashing, cookie management, auth middleware
- `server/routes/` — Route handlers (authRoutes, deckRoutes, sessionRoutes, adminRoutes)
- `server/seed.js` — Database seeder (2 orgs, 6 teams, 20+ users, 3 decks, 300+ sessions)

In dev mode, Vite proxies `/api/*` to `http://localhost:3001` (see `vite.config.js`). In production, Express serves the built `dist/` and handles all routes.

## Authentication

JWT-based authentication with HttpOnly cookies.

- **Cookie:** `rc_token` — HttpOnly, SameSite=Strict, Secure in production
- **JWT payload:** `{ sub: userId, role, orgId }` — 24h expiry by default
- **Middleware:** `requireAuth` (validates JWT, attaches `req.user`) and `requireAdmin` (checks `role === "admin"`)
- **Roles:** `admin` (full org access, deck CRUD, user management) and `user` (play sessions, view cards/objections read-only, share sessions)
- **Dev login:** Uses `DEV_ORGS` in LoginScreen (gated by `import.meta.env.DEV`) with org picker and user quick-select. Default credentials are configured in `server/seed.js` (development only).

## Database Schema

SQLite with WAL mode and foreign keys enabled. 10 tables:

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `orgs` | Organizations | id, name |
| `teams` | Teams per org | id, orgId, name |
| `team_admins` | Team admin assignments | teamId, userId |
| `user_teams` | User-to-team membership (many-to-many) | userId, teamId |
| `users` | User accounts with auth | id, orgId, teamId, email, passwordHash, displayName, role |
| `decks` | Sales pitch decks | id, orgId, name, color, icon, rootCard, cards (JSON), objStacks (JSON), visibility |
| `deck_access` | Deck visibility controls for private decks | deckId, entityType (team/user), entityId |
| `sessions` | Practice/live session runs | id, orgId, userId, deckId, mode, outcome, events (JSON), notes (JSON), metrics (JSON) |
| `session_feedback` | Feedback comments on sessions | id, sessionId, authorId, text, cardId |
| `session_shares` | Session sharing between users | id, sessionId, fromUserId, toUserId, context |

**Migrations:** Applied inline after schema creation (e.g., `ALTER TABLE decks ADD COLUMN visibility`).

**Helper functions:** `parseDeck(row)` and `parseSession(row)` in db.js handle JSON field parsing on every read.

## Data Model

**Deck** — A structured sales pitch deck:
- `cards: {}` — Map of card ID to card object. Each card has: `id`, `title`, `type` (pitch/discovery/close/objection), `prompt` (rich-text string), `overview[]` (bullet points), `answers[]` (each with `id`, `label`, `next` card ID), `intendedPath` (boolean)
- `rootCard` — ID of the entry card
- `objStacks[]` — Objection stacks, each with: `id`, `label`, `icon`, `rootCard`, `cards{}` (own card sub-tree), `targetCard` (optional — card ID to navigate to after resolution instead of returning)
- `visibility` — "public" (all org users) or "private" (specific teams/users via deck_access)

**Session** — A live or practice run through a deck:
- `mode` — "live" or "practice"
- `outcome` — "completed", "sold", "booked", or "abandoned"
- `events[]` — Array of `{ type:"visit", cardId, cardTitle, cardType, isObjCard, stackLabel, intendedPath, ts, durationMs }`
- `notes[]` — Array of `{ cardId, cardTitle, text, ts }`
- `metrics` — Computed stats: totalVisits, intendedVisits, intendedPct, noteCount, objectionVisits, uniqueCards, totalMs, etc.
- `feedbackCount` / `latestFeedbackAt` — Attached by getSessions() query (not stored)

**Feedback** — Comments on sessions by admins or share recipients (not the session owner).

**Share** — Session sharing from owner to another user. Unique constraint on (sessionId, toUserId). Share recipients can view session and write feedback.

## Frontend Organization (File Map)

| File | Exports |
|------|---------|
| `src/App.jsx` | `App` (root with auth), `MainApp` (authenticated shell with tabs, autosave) |
| `src/lib/constants.js` | `uid`, `aid`, `osid`, `sid`, `TM`, `OBJ_COLOR`, `SESS_COLOR`, `STYPE`, `DECK_COLORS`, `DECK_ICONS`, `OBJ_ICONS`, `INFLECTIONS`, `INFL_MAP`, `INFL_CATS` |
| `src/lib/richtext.js` | `parseRichText`, `stripMarkup` |
| `src/lib/api.js` | `apiGet`, `apiPut`, `apiPost`, `apiDel`, `setUnauthHandler` |
| `src/lib/styles.js` | `solidBtn`, `ghostBtn`, `ghostSm`, `iconBtn`, `labelSt`, `inputSt`, `cardBg`, `badgeSt`, `dividerV` |
| `src/components/ui.jsx` | `TypeBadge`, `Handle`, `IntendedBadge`, `SectionHdr`, `StatBox`, `BarRow` |
| `src/components/Tooltip.jsx` | `TipCtx`, `GlobalInflTooltip`, `InflWord`, `RichPromptDisplay`, `OverviewDisplay`, `OverviewEditor` |
| `src/components/Editor.jsx` | `RichPromptEditor`, `CardEditorSheet` |
| `src/components/Play.jsx` | `ObjPicker`, `Navigator`, `PlayTab` |
| `src/components/Viewer.jsx` | `TreeView`, `SwimlaneView` |
| `src/components/Sessions.jsx` | `ShareModal`, `SessionReview`, `SessionsTab`, `SessionAnalytics` |
| `src/components/Cards.jsx` | `CardsTab`, `ObjStackEditor`, `ObjectionsTab` |
| `src/components/Panels.jsx` | `DeckSwitcherSheet`, `LoginScreen`, `ProfileSheet`, `AdminPanel` |

## API Endpoints

### Authentication
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/login` | No | Email/password login, sets JWT cookie |
| POST | `/api/auth/logout` | No | Clears auth cookie |
| POST | `/api/auth/refresh` | Yes | Issues fresh JWT |
| GET | `/api/auth/me` | Yes | Returns current user profile with team info |

### Decks
| Method | Path | Auth | Admin | Description |
|--------|------|------|-------|-------------|
| GET | `/api/decks` | Yes | No | List decks (filtered by visibility for non-admins) |
| POST | `/api/decks` | Yes | Yes | Create new deck |
| PUT | `/api/decks/:id` | Yes | Yes | Update deck fields + access list |
| GET | `/api/decks/:id/access` | Yes | Yes | Get deck access list |
| PUT | `/api/decks/:id/access` | Yes | Yes | Set deck access list |
| DELETE | `/api/decks/:id` | Yes | Yes | Delete deck |

### Sessions
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/sessions` | Yes | List sessions (supports `?scope=`, `?deckId=`, `?mode=`, `?outcome=`, `?from=`, `?to=`) |
| POST | `/api/sessions` | Yes | Upsert session (requires `id` in body) |
| DELETE | `/api/sessions/:id` | Yes | Delete session (owner or org admin) |

### Session Feedback
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/sessions/:id/feedback` | Yes | Get feedback (owner, admin, or share recipient) |
| POST | `/api/sessions/:id/feedback` | Yes | Create feedback (admin or share recipient only) |
| PUT | `/api/sessions/:id/feedback/:fid` | Yes | Update feedback (author only) |
| DELETE | `/api/sessions/:id/feedback/:fid` | Yes | Delete feedback (author or admin) |

### Session Sharing
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/sessions/:id/share` | Yes | Share session with teammate (owner only) |
| GET | `/api/sessions/:id/shares` | Yes | List shares for session (owner or admin) |
| DELETE | `/api/sessions/:id/shares/:shareId` | Yes | Revoke share (owner or admin) |

### Admin (requires admin role)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/users` | List org users |
| POST | `/api/admin/users` | Create user |
| PUT | `/api/admin/users/:id` | Update user |
| POST | `/api/admin/users/:id/reset-password` | Reset password |
| DELETE | `/api/admin/users/:id` | Delete user |
| GET | `/api/admin/teams` | List org teams |
| POST | `/api/admin/teams` | Create team |
| PUT | `/api/admin/teams/:id` | Update team |
| DELETE | `/api/admin/teams/:id` | Delete team |

### Health
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | No | Server status with user/deck/session counts |

## Rich Text Format

Prompts use custom markup parsed by `parseRichText()`:
- `**text**` — bold
- `*text*` — italic
- `*text*[InflectionLabel]` — italic with a named inflection cue (e.g., `*quick question*[Pause]`)

Stripped back to plain text by `stripMarkup()`.

## Inflection System

`INFLECTIONS` array maps labels to delivery cues across 5 categories:
- **Pace:** Pause, Slow Down, Speed Up
- **Tone:** Raise Tone, Lower Tone, Question, Hushed
- **Attitude:** Confident, Empathetic, Sincere, Warm, Urgent, Casual, Cautious
- **Rhetorical:** Emphasize, Contrast, Rhetorical
- **Personality:** Joking, Dry Humor, Indifferent, Disarming

Tooltips are hoisted to the app root via `TipCtx` context to avoid CSS stacking issues with `position:fixed`.

## Key Patterns

- **Autosave:** 800ms debounce per deck. `dirtyIds` ref tracks which decks have unsaved changes. Saves via `PUT /api/decks/:id`.
- **Polling:** SessionReview polls feedback every 5s. ShareModal polls shares every 5s. Both clean up intervals on unmount.
- **Immutable updates:** All state updates use `Object.assign({}, prev, changes)` pattern. No spread operator (ES5-style codebase).
- **Inline styling:** All styles are JS objects. Helper functions for common patterns. No CSS classes.
- **Auth flow:** JWT in HttpOnly cookie. `setUnauthHandler` sets a global 401 redirect. `apiGet/Put/Post/Del` check for 401 on every response.
- **Dev login:** `DEV_ORGS` gated by `import.meta.env.DEV` with preset orgs/teams/users. Default credentials are configured in `server/seed.js` (development only).
- **Read-only mode:** CardsTab and ObjectionsTab accept a `readOnly` prop. Non-admin users see cards/objections but cannot edit.
- **Feedback notifications:** `feedbackCount` and `latestFeedbackAt` returned per session by API. Frontend stores `fbSeenTs` in localStorage to track read state.

## Constants Reference

| Constant | Location | Purpose |
|----------|----------|---------|
| `TM` | `src/lib/constants.js` | Card type metadata (color, glow, icon, label) for pitch/discovery/close/objection |
| `OBJ_COLOR` | `src/lib/constants.js` | "#EF5350" — red accent for objections |
| `SESS_COLOR` | `src/lib/constants.js` | "#A8FF3E" — lime accent for sessions |
| `STYPE` | `src/lib/constants.js` | Session type metadata for live/practice |
| `DECK_COLORS` | `src/lib/constants.js` | 10 color options for deck picker |
| `DECK_ICONS` | `src/lib/constants.js` | 30 emoji options for deck picker |
| `OBJ_ICONS` | `src/lib/constants.js` | 30 emoji options for objection stack picker |
| `INFLECTIONS` | `src/lib/constants.js` | 20 delivery cue definitions |
| `SL_CARD_W/H` | `src/components/Viewer.jsx` | Swimlane card dimensions (162x82) |
| `SL_LANE_W` | `src/components/Viewer.jsx` | Swimlane column width (186) |
| `SL_COL_GAP` | `src/components/Viewer.jsx` | Gap between swimlane columns (36) |
| `TAB_ACCENTS` | `src/App.jsx` | Color accent per tab |
| `USER_TABS` | `src/App.jsx` | Tabs for regular users: play, sessions, cards, objections |
| `ADMIN_TABS` | `src/App.jsx` | Tabs for admins: play, sessions, cards, objections, admin |

## Security

- **JWT secret:** Production requires `JWT_SECRET` env var — app refuses to start without it. Dev mode uses a hardcoded fallback.
- **Rate limiting:** Login endpoint limited to 10 attempts per 15-minute window via `express-rate-limit`.
- **Security headers:** `helmet` middleware sets standard security headers (CSP disabled in dev for Vite HMR).
- **Password policy:** 8+ characters, at least one uppercase letter, at least one digit. Enforced on user creation and password reset.
- **Org scoping:** All endpoints validate `orgId` to prevent cross-org data access (IDOR protection).
- **XSS prevention:** `escH()` in `Editor.jsx` escapes all user content before innerHTML rendering in the contentEditable editor.
- **Dev-only features:** `DEV_ORGS` and `DEV_PASSWORD` gated by `import.meta.env.DEV` — stripped from production bundles by Vite.
- **Seed guard:** `server/seed.js` exits immediately if `NODE_ENV=production`.
- **Feedback limits:** Feedback text capped at 5000 characters.
