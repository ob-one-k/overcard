# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies (Node 24.x LTS — see .nvmrc / engines)
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

**Stack:** React 19 (Vite 8) frontend + Express 5 backend + PostgreSQL (`pg` Pool, async). Node 24 LTS.

**Modular frontend:** `src/App.jsx` is the app shell (auth, tabs, autosave). Components are split into `src/components/` (9 files) and shared code into `src/lib/` (4 files):

- `src/components/` — `Cards.jsx`, `Editor.jsx`, `Home.jsx`, `Panels.jsx`, `Play.jsx`, `Sessions.jsx`, `Tooltip.jsx`, `Viewer.jsx`, `ui.jsx`
- `src/lib/` — `api.js`, `constants.js`, `richtext.js`, `styles.js`

**Inline styling:** All styles are plain JS objects passed to `style={}`. There is no CSS file, no Tailwind, no CSS-in-JS library. Reusable style helpers are defined in `src/lib/styles.js` (`solidBtn`, `ghostBtn`, `ghostSm`, `iconBtn`, `labelSt`, `inputSt`, `cardBg`, `badgeSt`, `dividerV`).

**Backend:** Express REST API with PostgreSQL database via async `pg` Pool (connection string from `DATABASE_URL`).
- `server/index.js` — Express entry, middleware, route mounting, static file serving; calls `initSchema()` (retried with backoff) before `app.listen()`, then runs `runSeed()` in the background on every boot (including production — demo data). SPA catch-all uses Express 5 syntax `app.get("/{*splat}")`. `trust proxy` is set in production (Render).
- `server/db.js` — PostgreSQL schema init (`initSchema`), async pool (10s connection timeout, 30s query timeout, `pool.on("error")` handler), `withTransaction` helper, all database query functions (50+ exports). BIGINT timestamp columns use a type parser to return JS numbers. JSONB columns (cards, objStacks, events, notes, metrics) are auto-serialized/deserialized by pg. All camelCase column names are double-quoted in SQL strings.
- `server/auth.js` — JWT signing/verification, bcrypt hashing, cookie management, async auth middleware (`requireAuth`, `requireAdmin`, `requireOwner`, `isAdminRole`)
- `server/validate.js` — Shared validators for signup/admin/org input (names, email, phone, password policy, org fields)
- `server/routes/` — Route handlers (authRoutes, deckRoutes, sessionRoutes, adminRoutes, orgRoutes)
- `server/seed.js` — Database seeder (2 orgs, 6 teams, 20+ users, 3 decks, 300+ sessions)

In dev mode, Vite proxies `/api/*` to `http://localhost:3001` (see `vite.config.mjs`). In production, Express serves the built `dist/` and handles all routes.

## Authentication

JWT-based authentication with HttpOnly cookies.

- **Cookie:** `rc_token` — HttpOnly, SameSite=Strict, Secure in production
- **JWT payload:** `{ sub: userId, role, orgId, sid }` — 24h expiry by default. `req.user.role` always comes from the DB, not the token.
- **Middleware:** `requireAuth` (async — validates JWT, attaches `req.user`), `requireAdmin` (admin **or owner**), `requireOwner` (owner only)
- **Roles:** `owner` > `admin` > `user`. Always check admin access with `isAdminRole(role)` (server: `auth.js`, client: `src/lib/constants.js`) — never `role === "admin"`, or owners lose admin powers.
  - `owner` — exactly one per org (partial unique index `uniq_users_org_owner`); the org's creator. Only the owner edits org details (`PUT /api/org`), demotes/edits/deletes/resets admins, and transfers ownership. The owner can't be deleted or have their role changed except via transfer.
  - `admin` — deck CRUD, user management (users only), promote user→admin, teams, share codes
  - `user` — play sessions, view cards/objections read-only, share sessions
  - Nobody changes their own role. Demoting an admin removes them from `team_admins`.
- **Signup:** `POST /api/auth/signup` (share code → joins that org as `user`) and `POST /api/auth/create-org` (requires `MASTER_CODE` env; creator becomes `owner`). Both create the account and log in. Share-code use is claimed in the same transaction as the user insert, so a failed signup never burns a use. Both share a 10/15min rate limiter. Invite links: `/?join=CODE` opens the signup screen pre-filled.
- **Dev login:** Uses `DEV_ORGS` and `DEV_PASSWORD` defined unconditionally at module level in `Panels.jsx`. Only the LoginScreen UI that renders them is conditionally shown. Default credentials are configured in `server/seed.js` (development only).

## Database Schema

PostgreSQL. Schema auto-initialized on startup via `initSchema()` using `CREATE TABLE IF NOT EXISTS`. 11 tables:

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `orgs` | Organizations | id, name, industry, website, phone, address, "updatedAt" |
| `org_invites` | Share codes for signup | id, "orgId", code (8 chars, unique, stored without dash), "createdBy", "expiresAt", "maxUses", uses, "revokedAt" |
| `teams` | Teams per org | id, "orgId", name |
| `team_admins` | Team admin assignments | "teamId", "userId" |
| `user_teams` | User-to-team membership (many-to-many) | "userId", "teamId" |
| `users` | User accounts with auth | id, "orgId", "teamId", email, "passwordHash", "displayName", "firstName", "lastName", phone, role (owner/admin/user) |
| `decks` | Sales pitch decks | id, "orgId", name, color, icon, "rootCard", cards (JSONB), "objStacks" (JSONB), visibility |
| `deck_access` | Deck visibility controls for private decks | "deckId", "entityType" (team/user), "entityId" |
| `sessions` | Practice/live session runs | id, "orgId", "userId", "deckId", "deckColor", "deckIcon", mode, status, outcome, sold, "soldCardId", "soldCardTitle", events (JSONB), notes (JSONB), metrics (JSONB) |
| `session_feedback` | Feedback comments on sessions | id, "sessionId", "authorId", text, "cardId" |
| `session_shares` | Session sharing between users | id, "sessionId", "fromUserId", "toUserId", context |
| `notifications` | In-app notifications (cascade with user/session) | id, "userId", type, "sessionId", "actorName", text, "createdAt", "readAt" |
| `session_audio` | Session recordings (BYTEA, one per session; cascades on session delete) | "sessionId" PK, "orgId", "mimeType", "durationMs", "sizeBytes", data |

**Column naming:** All camelCase column names are double-quoted in every SQL string throughout db.js to preserve case in PostgreSQL (e.g., `"orgId"`, `"userId"`, `"startTs"`).

**JSONB fields:** `cards`, `objStacks`, `events`, `notes`, `metrics` are stored as JSONB. The pg driver auto-serializes on write (pass JS objects directly — never `JSON.stringify`) and auto-deserializes on read (never `JSON.parse`).

**BIGINT timestamps:** `"startTs"`, `"updatedAt"`, `"lastLoginAt"` are `BIGINT` storing Unix milliseconds. A type parser (`types.setTypeParser(20, ...)`) ensures these are returned as JS numbers, not strings.

**Migrations:** Applied at end of `initSchema()` with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.

**Audio size budget:** recordings are ~0.24 MB/min (32 kbps). The free Render database is 1 GB, which is roughly 60 hours of audio in total.

**Helper functions:** `parseDeck(row)` and `parseSession(row)` in db.js set defaults for JSONB fields that may be null (no JSON parsing needed).

## Data Model

**Deck** — A structured sales pitch deck:
- `cards: {}` — Map of card ID to card object. Each card has: `id`, `title`, `type` (pitch/discovery/close/objection), `prompt` (rich-text string), `overview[]` (bullet points), `answers[]` (each with `id`, `label`, `next` card ID), `intendedPath` (boolean)
- `rootCard` — ID of the entry card
- `objStacks[]` — Objection stacks, each with: `id`, `label`, `icon`, `rootCard`, `cards{}` (own card sub-tree), `targetCard` (optional — card ID to navigate to after resolution instead of returning)
- `visibility` — "public" (all org users) or "private" (specific teams/users via deck_access)

**Session** — A live or practice run through a deck:
- `mode` — "live" or "practice"
- `status` — "completed" (default); tracks session lifecycle state
- `outcome` — "completed", "sold", "booked", or "abandoned"
- `sold` — boolean; true when outcome is a successful close
- `soldCardId` / `soldCardTitle` — card where the close was recorded (nullable)
- `deckColor` / `deckIcon` — snapshot of deck appearance at time of session (denormalized)
- `events[]` — Array of `{ type:"visit", cardId, cardTitle, cardType, isObjCard, stackLabel, intendedPath, ts, durationMs }`
- `notes[]` — Array of `{ cardId, cardTitle, text, ts }`
- `metrics` — Computed stats: totalVisits, intendedVisits, intendedPct, noteCount, objectionVisits, uniqueCards, totalMs, etc.
- `feedbackCount` / `latestFeedbackAt` — Attached by getSessions() query (not stored)
- `userName` — Display name of the user who ran the session, attached by getSessions() (not stored)
- `hasAudio` / `audioDurationMs` — set when a recording is uploaded / measured by the recorder
- `audioSegments[]` — `{ segId (= visit ts), cardId, cardTitle, cardType, isObjCard, stackLabel, startMs, endMs, segmentIndex }`, built by `buildAudioSegments()` from visit events; contiguous across the recording

**User** — `displayName` is always `firstName + " " + lastName`; `updateUser` re-derives it when either name part changes. Older accounts were backfilled by splitting `displayName` on the first space.

**Feedback** — Comments on sessions by admins or share recipients (not the session owner).

**Share** — Session sharing from owner to another user. Unique constraint on (sessionId, toUserId). Share recipients can view session and write feedback.

## Frontend Organization (File Map)

| File | Exports |
|------|---------|
| `src/App.jsx` | `App` (root with auth), `MainApp` (authenticated shell with tabs, autosave) |
| `src/lib/constants.js` | `uid`, `aid`, `osid`, `sid`, `TM`, `OBJ_COLOR`, `SESS_COLOR`, `STYPE`, `DECK_COLORS`, `DECK_ICONS`, `OBJ_ICONS`, `INFLECTIONS`, `INFL_MAP`, `INFL_CATS` |
| `src/lib/richtext.js` | `parseRichText`, `stripMarkup` |
| `src/lib/api.js` | `apiGet`, `apiPut`, `apiPost`, `apiDel`, `setUnauthHandler`, `setSessionReplacedHandler`, `setStoredToken`, `getStoredToken`, `fetchWithTimeout` (75s default — covers free-tier cold start), `apiPostWithRetry` (retries network/5xx; used for finished-session saves), `lsGet`/`lsSet` (try/catch-safe localStorage) |
| `src/lib/styles.js` | `solidBtn`, `ghostBtn`, `ghostSm`, `iconBtn`, `labelSt`, `inputSt`, `cardBg`, `badgeSt`, `dividerV` |
| `src/components/ErrorBoundary.jsx` | `ErrorBoundary` (wraps `<App/>` in `main.jsx`; shows reload screen on render crash) |
| `src/components/ui.jsx` | `TypeBadge`, `Handle`, `IntendedBadge`, `SectionHdr`, `StatBox`, `BarRow` |
| `src/components/Tooltip.jsx` | `TipCtx`, `GlobalInflTooltip`, `InflWord`, `RichPromptDisplay`, `OverviewDisplay`, `OverviewEditor` |
| `src/components/Editor.jsx` | `RichPromptEditor`, `CardEditorSheet` |
| `src/components/Home.jsx` | `HomeTab` |
| `src/components/Play.jsx` | `ObjPicker`, `Navigator`, `PlayTab` |
| `src/components/Viewer.jsx` | `TreeView` (collapsible tree navigator), `SwimlaneView` (horizontal type-lane layout) |
| `src/components/Sessions.jsx` | `ShareModal`, `SessionReview`, `SessionsTab`, `SessionAnalytics` |
| `src/components/Cards.jsx` | `CardsTab`, `ObjStackEditor`, `ObjectionsTab` |
| `src/components/Panels.jsx` | `DeckSwitcherSheet`, `LoginScreen`, `ProfileSheet`, `AdminPanel` (Users / Teams / Share Codes / Organization sub-tabs) |
| `src/components/CardStage.jsx` | `CardStage`, `PaneRail` |
| `src/components/StudyCard.jsx` | `StudyPopout` (Play tab study popout for intended-path steps and objection stacks; horizontal on desktop, vertical on tablet/phone), `intendedOutline`, `stackOrder` |
| `src/components/ReferenceSession.jsx` | `ReferencePicker` (live-session start form), `ReferencePanel` (in-call reference: rail on desktop/tablet, strip on phone) |
| `src/components/NotificationBell.jsx` | `NotificationBell` |
| `src/lib/cardGraph.js` | `getParents`, `orderParents`, `getChildren` |
| `src/components/Signup.jsx` | `SignupScreen` (join with share code, or create organization with master code) |
| `src/components/AudioPlayer.jsx` | `useSessionAudio`, `AudioMiniBar`, `AudioPlayback`, `UploadNotice`, `wallClockToAudioMs`, `segColor`, `msToMmss` |
| `src/components/RecordingSetup.jsx` | `RecordingSetup` (mic picker, level, test, call audio), `RecIndicator` |
| `src/lib/useRecorder.js` | `useRecorder`, `buildAudioSegments`, `pickMimeType`, `recorderSupported`, `callAudioSupported` |
| `src/lib/audioUpload.js` | `uploadSessionAudio`, `retrySessionAudio`, `useUploadStatus` |

## API Endpoints

### Authentication
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/login` | No | Email/password login, sets JWT cookie |
| POST | `/api/auth/logout` | No | Clears auth cookie |
| POST | `/api/auth/refresh` | Yes | Issues fresh JWT |
| GET | `/api/auth/me` | Yes | Returns current user profile with team info, name parts, phone, orgName |
| GET | `/api/auth/invite/:code` | No | Preview the org a share code joins (rate limited) |
| POST | `/api/auth/signup` | No | `{code, firstName, lastName, email, phone, password}` → new `user` in the code's org, logged in |
| POST | `/api/auth/create-org` | No | `{masterCode, org:{name, industry, website, phone, address}, firstName, lastName, email, phone, password}` → new org + `owner`, logged in. 503 if `MASTER_CODE` unset |

### Organization
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/org` | Yes | Caller's org profile + `owner` |
| PUT | `/api/org` | Owner | Update name/industry/website/phone/address (empty string clears) |

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
| GET | `/api/sessions/org-users` | Yes | List all users in the caller's org (used by sharing UI) |

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

### Session Audio
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| PUT | `/api/sessions/:id/audio?durationMs=` | Owner | Raw audio body (`audio/*`), max 60 MB → 413. Replaces any existing recording |
| GET | `/api/sessions/:id/audio` | Owner, org admin, share recipient | Streams the recording; honours `Range` (206/416). `X-Audio-Duration-Ms` header |
| GET | `/api/sessions/:id/audio/meta` | Same | `{ mimeType, durationMs, sizeBytes, chapters }` — chapters = the per-card segment markers stamped onto the recording at upload |

### Reference Sessions
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/sessions/reference-options?deckId=&q=` | Any org member | Up to 50 completed org sessions (name, rep, outcome, date) to pick as a live-call reference |
| GET | `/api/sessions/:id/reference` | Any org member | Outline of a completed session: visits (card, time), notes, outcome — no feedback/shares/audio |

Sessions store the chosen reference in `"referenceSessionId"`.

### Notifications
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/notifications` | Yes | `{ items (latest 30, with sessionName/deckId), unreadCount }` |
| POST | `/api/notifications/read` | Yes | `{ ids }` or `{ sessionId }` marks those read; empty body marks all |

Created when someone else leaves feedback on your session (`type: "feedback"`). Client store: `src/lib/notifications.js` (polls every 30s); UI: `NotificationBell` in the desktop shell and mobile header; opening your own session's review marks its notifications read.

### Admin (requires admin role)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/users` | List org users |
| POST | `/api/admin/users` | Create user (`firstName, lastName, email, phone, password, role: admin|user`) |
| PUT | `/api/admin/users/:id` | Update name/phone/role/team (role rules above) |
| POST | `/api/admin/users/:id/reset-password` | Reset password (owner required for admin targets) |
| DELETE | `/api/admin/users/:id` | Delete user (never the owner; owner required for admin targets) |
| POST | `/api/admin/transfer-ownership` | Owner only — `{userId}`; target becomes owner, caller becomes admin |
| GET | `/api/admin/invites` | List share codes |
| POST | `/api/admin/invites` | Generate share code (`expiresInDays` 1–365 or null, `maxUses` 1–1000 or null) |
| DELETE | `/api/admin/invites/:id` | Revoke share code |
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

- **Startup resilience:** `App` checks `/auth/me` with a 75s timeout (shows "Waking up the server" after 5s). Only 401/403 route to login; network errors/timeouts/5xx show a "Can't reach the server" retry screen. Deck load failures show a retry screen too.
- **Org branding & theme:** orgs have `logo` (raster `data:` URL ≤ ~300 KB, client-resized to 256px by `BrandingFields`; SVG rejected server-side) and `"accentColor"` (#RRGGBB), edited by the owner (Admin → Organization) or at org creation. `/auth/me` returns `orgName`, `orgLogo`, `orgAccent`. `App` calls `setAccentColor(authUser.orgAccent)` before rendering; `SESS_COLOR` in `constants.js` is a live binding that becomes the org accent, and `accentA(alpha)` replaces hard-coded `rgba(168,255,62,…)`. Never hard-code the lime accent again — use `SESS_COLOR` / `accentA()`; `solidBtn` picks black/white text by luminance (`inkOn`). Semantic colours (card types, Live/Practice `STYPE`, outcomes) are intentionally not themed. `OrgMark` shows the org logo (or initial) wherever the OverCard "O" used to be inside the app.
- **Sign-in:** `LoginScreen` reads `useDesktop()` directly (it renders outside `DesktopCtx`): desktop and wide tablets get a split brand panel + large form, portrait tablets a larger single column, phones the original layout.
- **Recording:** `src/lib/useRecorder.js` is the only recorder (used by `PlayMobile` and `PlayDesktop`): device list with permission + `devicechange`, optional call audio (`getDisplayMedia` mixed with the mic via Web Audio, desktop only), level meter, 3s test, mono 32 kbps, mime fallback webm→mp4. Navigators close the current card's visit on EVERY card change (forward, back, jump, exit objection, restart) and once more on finish, so segments tile the recording. `finishSession` → save session JSON → `uploadSessionAudio()` (`src/lib/audioUpload.js`: IndexedDB backup first, upload with retries, local copy deleted on success, "Retry upload" on failure). UI: `src/components/RecordingSetup.jsx` (`RecordingSetup`, `RecIndicator`).
- **Playback:** `useSessionAudio(session)` in `AudioPlayer.jsx` owns one `<audio>` per `SessionReview`, loading server → device fallback. Modes: full recording, or `playClip(seg)` which stops at the segment end (rAF-precise). Views: `AudioMiniBar` (every tab), `AudioPlayback` (Playback tab: segment timeline, transport, list in order / by card), Path-tab ▶ per visit, Notes "▶ hear this" (via `wallClockToAudioMs`). WebM without a duration header is fixed by seeking far ahead once on load.
- **Empty org:** A new org has no decks. `MainApp` shows admins/owners a "Create your first deck" form (and everyone a Sign out button) instead of the main shell, since most tabs require a deck.
- **API errors:** `apiGet/Put/Post/Del` throw `Error(message)` using the server's `{ error }` text when present (falls back to `"API <status>"`), with `.status` set.
- **Three layouts:** `useDesktop()` returns `layout` = desktop (≥1024px, mouse) | tablet (768–1023px, or touch tablets) | mobile. App passes `DesktopCtx` with `isDesktop:true` on tablet too, so every `XDesktop/XMobile` switch shows the desktop component; tablet-aware code checks `desktop.compact` (smaller type, 44px touch targets, icon rail + ☰ drawer, in-session Play side rails as drawers) and `desktop.splitPanes` (list + detail side by side only when ≥960px wide, otherwise list ↔ detail with back buttons). Phones are unchanged.
- **Card stage (desktop/tablet editors only):** `src/components/CardStage.jsx` shows the open card large in the centre, its parent card(s) as tabs tucked behind on the left (fanned when there are several; front = the card you came from, else intended path), and its destinations as floating cards on the right with hover/tap previews. Used by `CardsDesktop` (list mode), `ObjectionsDesktop` and `ObjStackEditor` (inline). Graph helpers live in `src/lib/cardGraph.js` (`getParents`, `orderParents`, `getChildren`). Never used in Play or on phones. Stage navigation saves through `CardEditorSheet`'s `onSaveAndNavigateTo`.
- **Desktop/mobile split:** `PlayTab`, `CardsTab`, `ObjectionsTab`, `SessionsTab` are thin wrappers that render `XDesktop` or `XMobile`. Never put hooks after a conditional `return` — crossing the 1024px breakpoint would change hook order and crash.
- **Auth sessions:** `requireAuth` requires the JWT `sid` to equal `users.activeToken`. Logout clears `activeToken` only if the token's `sid` matches (a stale device can't end the active session); admin password reset nulls it unconditionally, revoking all tokens. JWTs pinned to HS256. bcrypt is async (`hashPassword`/`checkPassword` return promises).
- **Autosave:** 800ms debounce per deck. `dirtyIds` ref tracks which decks have unsaved changes. Saves via `PUT /api/decks/:id`.
- **Polling:** SessionReview polls feedback every 5s. ShareModal polls shares every 5s. Both clean up intervals on unmount.
- **Immutable updates:** All state updates use `Object.assign({}, prev, changes)` pattern. No spread operator (ES5-style codebase).
- **Inline styling:** All styles are JS objects. Helper functions for common patterns. No CSS classes.
- **Auth flow:** JWT in HttpOnly cookie. `setUnauthHandler` sets a global 401 redirect. `apiGet/Put/Post/Del` check for 401 on every response.
- **Dev login:** `DEV_ORGS` and `DEV_PASSWORD` defined unconditionally in `Panels.jsx`. The quick-select UI is shown based on context, not `import.meta.env.DEV`. Default credentials are configured in `server/seed.js` (development only).
- **Read-only mode:** CardsTab and ObjectionsTab accept a `readOnly` prop. Non-admin users see cards/objections but cannot edit.
- **Feedback notifications:** `feedbackCount` and `latestFeedbackAt` returned per session by API. Frontend stores `fbSeenTs` in localStorage to track read state.
- **Card reordering:** Cards within each type group support drag-and-drop reordering via a `⠿` grip handle (non-readOnly only). Uses Pointer Events API (`setPointerCapture`, `onPointerMove`, `onPointerUp`). On drop, `sortIndex` (integer) is written to every card in the group via `safeUpsert`. Display order is `(a.sortIndex||0) - (b.sortIndex||0)`. Autosave handles persistence.
- **Linked From pills:** `CardEditorSheet` shows pills for all cards that link to the current card. Clicking a pill calls `onSaveAndNavigateTo(form, targetCard)` — saves current edits before navigating. `key={editing.id}` on `CardEditorSheet` forces a full remount when navigating between cards.
- **Response card preview:** Inside the response link dropdown, each card row has a `◎/◉` eye toggle button that reveals a preview panel showing the card's type, title, overview bullets, and prompt snippet. On touch devices, a tap-twice pattern is used: first tap previews, second tap selects.
- **Tree viewer (TreeView):** Collapsible indented tree. `renderNode` recurses depth-first from `rootCard`. Cards already rendered (loop-backs) are displayed as amber `↻ loop back` pills — non-expandable. Cards with multiple inbound edges show `⊕`. Intended-path cards have a green left border and `★` badge. Pinch/ctrl+scroll zoom via CSS `zoom` on scroll container. Orphan cards (unreachable from root) listed in a separate "Unconnected" section at bottom.
- **Swimlane viewer (SwimlaneView):** Horizontal type-based lane layout — 4 columns (pitch / discovery / close / objection). `buildTypeLayout` computes positions and answer port Y coordinates. `slEdgePath` generates bezier curves. Compact mode activates at zoom < 0.70. Click-to-select, second click triggers `onEdit`. Selection expansion pushes cards below the selected card down.

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
| `SL_CARD_W` | `src/components/Viewer.jsx` | Swimlane card width (210px) |
| `SL_LANE_W` | `src/components/Viewer.jsx` | Swimlane lane width = SL_CARD_W + 28 (238px) |
| `SL_COL_GAP` | `src/components/Viewer.jsx` | Gap between swimlane columns (48px) |
| `LANE_ORDER` | `src/components/Viewer.jsx` | Swimlane column order: pitch / discovery / close / objection |
| `TAB_ACCENTS` | `src/App.jsx` | Color accent per tab |
| `USER_TABS` | `src/App.jsx` | Tabs for regular users: home, play, sessions, cards, objections |
| `ADMIN_TABS` | `src/App.jsx` | Tabs for admins/owners: home, play, sessions, cards, objections, admin |
| `ROLE_META` / `roleMeta()` / `isAdminRole()` | `src/lib/constants.js` | Role badge colours/labels and the admin-access check |

## Environment Variables

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | Yes (production) | PostgreSQL connection string (e.g., `postgres://localhost/overcard_dev` locally; auto-wired on Render) |
| `JWT_SECRET` | Yes (production) | App exits without it. Dev uses a hardcoded fallback. |
| `NODE_ENV` | Yes (production) | Set to `production`. Enables secure cookies, helmet CSP, JWT secret enforcement. |
| `CORS_ORIGIN` | Yes (production) | Frontend URL allowed for CORS (e.g., your Vercel URL) |
| `MASTER_CODE` | For org sign-up | Secret entered on the "Create organization" signup form. Unset = org creation disabled (503). Compared in constant time. |
| `PORT` | No | Default: 3000 |

**Local dev:** Set `DATABASE_URL` in a `.env` file or shell: `export DATABASE_URL=postgres://localhost/overcard_dev`

## Deployment

**Platform:** Render (web service + managed PostgreSQL).

`render.yaml` in the project root is a Render Blueprint that auto-provisions:
- `overcard-api` — Node.js web service (`node server/index.js`)
- `overcard-db` — Free-tier PostgreSQL instance

Deploy steps:
1. Push to GitHub
2. Render dashboard → New → Blueprint → connect repo
3. Render detects `render.yaml`, creates both services, auto-wires `DATABASE_URL`
4. Set `CORS_ORIGIN` manually in the Render dashboard to your Vercel frontend URL
5. Seed via Render Shell: `node server/seed.js`

**Frontend** is deployed separately on Vercel. `buildCommand` in `render.yaml` is `npm install` only — Vite build runs on Vercel, not Render.

### Vercel (Frontend)

1. Connect repo to Vercel — it auto-detects the Vite project
2. Build command: `npm run build`, Output directory: `dist`
3. No extra environment variables required (Vite proxies `/api/*` at build time only; in production the frontend calls the same origin or the Render URL directly via `VITE_API_URL` if on a separate domain)
4. After Vercel deploys, copy the Vercel deployment URL and set it as `CORS_ORIGIN` in the Render dashboard (Environment → `CORS_ORIGIN`)

> Render free PostgreSQL has 90-day data retention. Upgrade for production persistence.

## Security

- **JWT secret:** Production requires `JWT_SECRET` env var — app refuses to start without it. Dev mode uses a hardcoded fallback.
- **Rate limiting:** Login endpoint limited to 10 attempts per 15-minute window via `express-rate-limit`.
- **Security headers:** `helmet` middleware sets standard security headers (CSP disabled in dev for Vite HMR).
- **Password policy:** 8+ characters, at least one uppercase letter, at least one digit. Enforced on user creation and password reset.
- **Org scoping:** All endpoints validate `orgId` to prevent cross-org data access (IDOR protection).
- **XSS prevention:** `escH()` in `Editor.jsx` escapes all user content before innerHTML rendering in the contentEditable editor.
- **Dev-only features:** `DEV_ORGS` and `DEV_PASSWORD` are defined unconditionally in `Panels.jsx` (not tree-shaken by Vite). Only the LoginScreen UI rendering them checks a condition. Do not rely on Vite bundle stripping for these values.
- **Seed on boot:** `server/index.js` runs `runSeed()` on every start, including production. There is no production guard — seeded accounts share a known password (demo deployment only).
- **Feedback limits:** Feedback text capped at 5000 characters.
- **Signup:** Share codes are 8 chars from an unambiguous 31-char alphabet (~40 bits), expirable, use-limited and revocable. `/auth/invite`, `/auth/signup` and `/auth/create-org` share a 10-per-15-min rate limiter.
