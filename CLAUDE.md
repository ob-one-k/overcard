# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies (Node 24.x LTS — see .nvmrc / engines)
npm run dev          # Dev mode: runs Express (port 3001) + Vite (port 5173) concurrently
npm run build        # Build frontend into dist/
npm start            # Build + serve production on port 3000
```

Dev endpoints:
- Frontend: `http://localhost:5173`
- API: `http://localhost:3001/api/health`

```bash
npm test             # node:test suite in tests/ — needs a running local server with a MASTER_CODE:
                     #   RATE_LIMITS=off MASTER_CODE=local-test-code npm run server
                     #   TEST_API=http://localhost:3001 MASTER_CODE=local-test-code npm test
npm run loadtest     # 100-person mixed workload in a throwaway org (needs MASTER_CODE; never against production)
npm run owner-reset -- owner@company.com   # one-time password link for a locked-out owner
npm run db-reset -- --confirm=<db name>    # empty EVERY table (keeps schema)
```

There is no demo data or demo mode. On first run the tests build their own fixtures through the API (`fixtures()` in `tests/helpers.js`: orgs Apex Test Co / Meridian Test Group, fixed `*@apex-test.com` / `*@meridian-test.com` accounts, teams, decks — reused on later runs) and otherwise only create records with ids prefixed `t_`. Use `F.apexDeck`, `F.merNorth` etc. from `fixtures()`, never hard-coded ids. `tests/isolation.test.js` probes every endpoint across orgs — extend it whenever an endpoint is added. Operations (deploy, backups, clean database, recovery): `docs/PRODUCTION.md`.

## Architecture

**Stack:** React 19 (Vite 8) frontend + Express 5 backend + PostgreSQL (`pg` Pool, async). Node 24 LTS.

**Modular frontend:** `src/App.jsx` is the app shell (auth, tabs, autosave). Components are split into `src/components/` (9 files) and shared code into `src/lib/` (4 files):

- `src/components/` — `Cards.jsx`, `Editor.jsx`, `Home.jsx`, `Panels.jsx`, `Play.jsx`, `Sessions.jsx`, `Tooltip.jsx`, `Viewer.jsx`, `ui.jsx`
- `src/lib/` — `api.js`, `constants.js`, `richtext.js`, `styles.js`

**Inline styling:** All styles are plain JS objects passed to `style={}`. There is no CSS file, no Tailwind, no CSS-in-JS library. Reusable style helpers are defined in `src/lib/styles.js` (`solidBtn`, `ghostBtn`, `ghostSm`, `iconBtn`, `labelSt`, `inputSt`, `cardBg`, `badgeSt`, `dividerV`).

**Backend:** Express REST API with PostgreSQL database via async `pg` Pool (connection string from `DATABASE_URL`).
- `server/index.js` — Express entry, middleware, route mounting, static file serving; calls `initSchema()` (retried with backoff) before `app.listen()`. No seeding — every org is created by people through sign-up. SPA catch-all uses Express 5 syntax `app.get("/{*splat}")`. `trust proxy` is set in production (Render).
- `server/db.js` — PostgreSQL schema init (`initSchema`), async pool (10s connection timeout, 30s query timeout, `pool.on("error")` handler), `withTransaction` helper, all database query functions (50+ exports). BIGINT timestamp columns use a type parser to return JS numbers. JSONB columns (cards, objStacks, events, notes, metrics) are auto-serialized/deserialized by pg. All camelCase column names are double-quoted in SQL strings.
- `server/auth.js` — JWT signing/verification, bcrypt hashing, cookie management, async auth middleware (`requireAuth`, `requireAdmin`, `requireOwner`, `isAdminRole`)
- `server/validate.js` — Shared validators for signup/admin/org input (names, email, phone, password policy, org fields)
- `server/routes/` — Route handlers (authRoutes, deckRoutes, sessionRoutes, adminRoutes, orgRoutes)

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
- **Passwords:** `POST /auth/change-password` (current password required; this device gets a fresh session, others are signed out). Admins issue one-time reset links (`POST /admin/users/:id/reset-link`, 1h, single use, SHA-256-hashed in `password_resets`) opened at `/?reset=TOKEN` (`ResetPasswordScreen`). The owner recovers with `npm run owner-reset`. No email yet — the table/endpoints are ready for an email step.

## Database Schema

PostgreSQL. Schema auto-initialized on startup via `initSchema()` (baseline, `CREATE TABLE IF NOT EXISTS`) followed by numbered migrations. Main tables (also `migrations`):

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `orgs` | Organizations | id, name, industry, website, phone, address, "updatedAt" |
| `org_invites` | Share codes for signup | id, "orgId", code (8 chars, unique, stored without dash), "createdBy", "expiresAt", "maxUses", uses, "revokedAt" |
| `teams` | Teams per org | id, "orgId", name |
| `team_admins` | Team admin assignments | "teamId", "userId" |
| `user_teams` | User-to-team membership (many-to-many) | "userId", "teamId" |
| `users` | User accounts with auth | id, "orgId", "teamId", email, "passwordHash", "displayName", "firstName", "lastName", phone, role (owner/admin/user) |
| `decks` | Sales pitch decks | id, "orgId", name, color, icon, "rootCard", cards (JSONB), "objStacks" (JSONB), visibility, "archivedAt" (null = active) |
| `deck_access` | Deck visibility controls for private decks | "deckId", "entityType" (team/user), "entityId" |
| `sessions` | Practice/live session runs | id, "orgId", "userId", "deckId", "deckColor", "deckIcon", mode, status, outcome, sold, "soldCardId", "soldCardTitle", events (JSONB), notes (JSONB), metrics (JSONB) |
| `session_feedback` | Feedback comments on sessions | id, "sessionId", "authorId", text, "cardId" |
| `session_shares` | Session sharing between users | id, "sessionId", "fromUserId", "toUserId", context |
| `notifications` | In-app notifications (cascade with user/session) | id, "userId", type, "sessionId", "actorName", text, "createdAt", "readAt" |
| `session_audio` | Session recordings (BYTEA, one per session; cascades on session delete) | "sessionId" PK, "orgId", "mimeType", "durationMs", "sizeBytes", data |
| `password_resets` | One-time reset links | id, "userId", "tokenHash" (SHA-256), "createdBy", "expiresAt", "usedAt" |

Also: `sessions."lastBeatTs"`/`live` (in-progress runs, `status='active'`), `org_invites.label`/`"teamId"`, `users."inviteId"`. `users."activeToken"` holds SHA-256 of the session id, never the raw id. Emails are unique case-insensitively (`uniq_users_email_lower`). Deleting a user keeps their sessions (`userId` → NULL, listed as "Former member"), keeps feedback they wrote, removes shares to/from them; deleting a team clears members' `teamId`.

**Column naming:** All camelCase column names are double-quoted in every SQL string throughout db.js to preserve case in PostgreSQL (e.g., `"orgId"`, `"userId"`, `"startTs"`).

**JSONB fields:** `cards`, `objStacks`, `events`, `notes`, `metrics` are stored as JSONB. The pg driver auto-serializes on write (pass JS objects directly — never `JSON.stringify`) and auto-deserializes on read (never `JSON.parse`).

**BIGINT timestamps:** `"startTs"`, `"updatedAt"`, `"lastLoginAt"` are `BIGINT` storing Unix milliseconds. A type parser (`types.setTypeParser(20, ...)`) ensures these are returned as JS numbers, not strings.

**Migrations:** every schema change goes in a numbered file in `server/migrations/` (`{ name, up(client) }`, listed in `index.js`), applied once each in its own transaction under an advisory lock and recorded in `migrations`. Never edit or reorder a shipped migration. Don't add new `ALTER`s to the `initSchema` baseline.

**Audio size budget:** recordings are ~0.24 MB/min (32 kbps). The free Render database is 1 GB, which is roughly 60 hours of audio in total.

**Helper functions:** `parseDeck(row)` and `parseSession(row)` in db.js set defaults for JSONB fields that may be null (no JSON parsing needed).

## Data Model

**Deck** — A structured sales pitch deck:
- `cards: {}` — Map of card ID to card object. Each card has: `id`, `title`, `type` (pitch/discovery/close/objection), `prompt` (rich-text string), `overview[]` (bullet points), `answers[]` (each with `id`, `label`, `next` card ID), `intendedPath` (boolean)
- `rootCard` — ID of the entry card
- `objStacks[]` — Objection stacks, each with: `id`, `label`, `icon`, `rootCard`, `cards{}` (own card sub-tree), `targetCard` (optional — card ID to navigate to after resolution instead of returning)
- `visibility` — "public" (all org users) or "private" (specific teams/users via deck_access)
- `archivedAt` — set when an admin archives the deck. Archived decks are hidden from users (server-side) and from every admin view except the deck switcher's "Archived" section. Objection stacks archive the same way via an `archivedAt` field inside the stack JSON; Play/Study only ever see `liveStacks(deck)`.
- New decks start from `newDeckTemplate()` (Opening → Discovery → Close, all on the intended path).

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
| `src/lib/constants.js` | `uid`, `aid`, `osid`, `sid`, `themed`, `setAccentColor`, `accentA`, `TM`, `OBJ_COLOR`, `SESS_COLOR`, `STYPE`, `DECK_COLORS`, `DECK_ICONS`, `OBJ_ICONS`, `INFLECTIONS`, `INFL_MAP`, `INFL_CATS` |
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
| `src/components/Panels.jsx` | `DeckSwitcherSheet` (switch, create, duplicate, archive/restore, owner delete), `LoginScreen`, `ProfileSheet` |
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
| `src/lib/deckOps.js` | `newDeckTemplate`, `collectBranch`, `cloneCards`, `cloneStack`, `duplicateDeck`, `activeDecks`, `liveStacks`, `archivedStacks`, `upsertStackCard`, `deleteStackCard`, `confirmStackDelete` |
| `src/lib/dataCache.js` | `cachedGet`, `useCachedGet`, `peek`, `invalidate`, `clearCache` — stale-while-revalidate GET cache |
| `src/lib/useViewport.js` | `startViewportTracking`, `useKeyboardOpen`, `keyboardIsOpen`, `revealOnFocus`, `revealField`, `resetStrayScroll`, `isCoarsePointer` |
| `src/lib/brand.js` | `getBrand`, `syncBrand`, `setBrand`, `cachedLogoVer` — org name/logo/accent store + device cache |
| `src/components/ImportPicker.jsx` | `ImportPicker` (copy cards — optionally with their downstream branch — or objection stacks from another org deck) |
| `src/components/AdminPanel.jsx` | `AdminPanel` (Users / Teams / Share Codes / Organization; split from Panels.jsx, lazy-loaded), `ResetPasswordDialog`, `InviteCard` |
| `src/lib/noiseReduction.js` | `createNoiseReduction(ctx)` (high-pass 85 Hz → low-pass 7.5 kHz → adaptive noise gate, bypassable), `playbackNoiseReduction`/`setPlaybackNoiseReduction` (per-device pref, default on) |
| `public/noise-reduction-worklet.js` | `overcard-noise-gate` AudioWorklet: learns the background-noise floor and turns it down between words (max −18 dB) |
| `src/lib/live.js` | `startLive`, `stopLive`, `onLive`, `useLive`, `isLiveConnected` — the live event stream (fetch-based SSE, reconnect + resync) |
| `src/lib/liveBeat.js` | `useLiveBeat(session, events, live)` — start/heartbeat/pagehide for runs in progress; `onSignedOut` |
| `src/components/LiveMonitor.jsx` | `LiveNow` (admin "Live now" strip/card + watch view), `useLiveRuns` |
| `src/components/ResetPassword.jsx` | `ResetPasswordScreen` (`/?reset=TOKEN`), `passwordProblem` |
| `server/realtime.js` | `streamHandler`, `publish`, `closeUser`, `refreshUser`, `signOutDevices` — in-process SSE pub/sub |
| `server/migrations/` | Numbered schema migrations + runner |
| `server/limits.js` | `limiter` factory (`RATE_LIMITS=off` for tests, never in production), `apiLimiter` (600/min per account) |

## API Endpoints

### Authentication
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/login` | No | Email/password login, sets JWT cookie |
| POST | `/api/auth/logout` | No | Clears auth cookie |
| POST | `/api/auth/refresh` | Yes | Issues fresh JWT |
| GET | `/api/auth/me` | Yes | Returns current user profile with team info, name parts, phone, orgName, `orgLogoVer`. `?logoVer=` matching the current logo omits `orgLogo` (`orgLogoCached:true`) |
| GET | `/api/auth/invite/:code` | No | Preview the org a share code joins (rate limited) |
| POST | `/api/auth/signup` | No | `{code, firstName, lastName, email, phone, password}` → new `user` in the code's org, logged in |
| POST | `/api/auth/change-password` | Yes | `{currentPassword, newPassword}` → new session token for this device; other sessions end |
| GET | `/api/auth/reset/:token` | No | Preview a reset link (first name, email, org) |
| POST | `/api/auth/reset` | No | `{token, password}` → one-time reset; signs the account out everywhere |
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
| POST | `/api/decks` | Yes | Yes | Create new deck — accepts starting `cards`, `rootCard`, `objStacks` (template / duplicate) |
| PUT | `/api/decks/:id` | Yes | Yes | Update deck fields + access list. Stacks a non-owner omits are kept (only the owner deletes stacks) |
| POST | `/api/decks/:id/archive` | Yes | Yes | Archive (sets `archivedAt`) |
| POST | `/api/decks/:id/restore` | Yes | Yes | Restore an archived deck |
| GET | `/api/decks/:id/access` | Yes | Yes | Get deck access list |
| PUT | `/api/decks/:id/access` | Yes | Yes | Set deck access list |
| DELETE | `/api/decks/:id` | Yes | Owner | Permanently delete deck (sessions keep their snapshot) |

### Sessions
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/sessions` | Yes | List sessions (supports `?scope=`, `?deckId=`, `?mode=`, `?outcome=`, `?from=`, `?to=`, `?limit=`). One query: feedback/share counts are LATERAL joins |
| POST | `/api/sessions` | Yes | Save a finished run (requires `id`; deck must be in the caller's org). Ends its live row |
| GET | `/api/sessions/live` | Admin | The org's runs in progress |
| POST | `/api/sessions/:id/start` | Yes | Store a run as `active` when it starts (deck must be usable by the caller) |
| POST | `/api/sessions/:id/beat` | Owner | `{events, live}` heartbeat while active; 409 once it isn't |
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

Created when someone else leaves feedback on your session (`type: "feedback"`) or shares one with you (`type: "share"`). Client store: `src/lib/notifications.js` (updated live; 5-minute safety poll); UI: `NotificationBell` in the desktop shell and mobile header; opening your own session's review marks its notifications read.

### Live events
`GET /api/events` (auth: cookie or Bearer) is a Server-Sent Events stream. Channels come from the signed-in user only: `user:<id>` and, for admins/owner, `orgAdmins:<orgId>`. Events: `session.started/progress/finished` (admins), `session.changed`, `feedback.changed`, `share.changed` (owner + share recipients + admins), `notification.new/read`, `users.changed` (admins), `auth.ended {reason: replaced|password|removed|logout}`, `auth.changed`. Payloads carry ids; clients refetch through the normal endpoints (progress carries the live run).

### Admin (requires admin role)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/users` | List org users |
| POST | `/api/admin/users` | Create user (`firstName, lastName, email, phone, password, role: admin|user`) |
| PUT | `/api/admin/users/:id` | Update name/phone/role/team (role rules above) |
| POST | `/api/admin/users/:id/reset-link` | One-time reset link `{token, expiresAt}` (never the owner, never yourself; owner required for admin targets) |
| POST | `/api/admin/users/:id/reset-password` | Set a temporary password (owner required for admin targets) |
| DELETE | `/api/admin/users/:id` | Delete user (never the owner; owner required for admin targets) |
| POST | `/api/admin/transfer-ownership` | Owner only — `{userId}`; target becomes owner, caller becomes admin |
| GET | `/api/admin/invites` | List share codes |
| POST | `/api/admin/invites` | Generate share code (`expiresInDays` 1–365 or null, `maxUses` 1–1000 or null) |
| PUT | `/api/admin/invites/:id` | Edit label, team, expiry (`expiresInDays` from now), max uses; `reactivate:true` clears a revoke |
| GET | `/api/admin/invites/:id/members` | Who joined with this code |
| DELETE | `/api/admin/invites/:id` | Revoke share code |
| GET | `/api/admin/teams` | List org teams |
| POST | `/api/admin/teams` | Create team |
| PUT | `/api/admin/teams/:id` | Update team |
| DELETE | `/api/admin/teams/:id` | Delete team |

### Health
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | No | `{ok, ts}` liveness (checks the DB) |

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

- **Archive vs delete:** admins archive decks/stacks (restorable); only the owner permanently deletes. The server enforces both: `DELETE /decks` is owner-only, and `PUT /decks` from a non-owner keeps any stored stack the payload omits, so stale copies never delete stacks.
- **Copying cards/stacks:** `ImportPicker` + `deckOps.cloneCards/cloneStack` give every copied card/answer/stack a fresh id and rewrite `next` links through an old→new map; links to cards that weren't copied become `null`, copied cards join off the intended path, and a copied stack's `targetCard` is cleared. `duplicateDeck` keeps intended flags and remaps stack targets.
- **Objections desktop/tablet:** `ObjectionsDesktop` mirrors CardsDesktop — stack switcher, List (path-ordered card list + CardStage) / Tree (docked editor + TreeView), and an "After resolving" strip. Stack edits save immediately via `onUpdateDeck` (no Save Stack step); phones still use the buffered `ObjStackEditor`. `CardStage` takes `endLabel` to say where a stack returns.
- **On-screen keyboard:** `startViewportTracking()` (main.jsx) publishes `--vvh/--vvt/--kb/--sheet-gap`. The desktop/tablet shell and every mobile sheet (`overlayFill()`, `SHEET_MAX_H`) size to the visible viewport. Containers with `overflow:hidden` that browsers might scroll to reveal a field carry `data-noscroll` and are snapped back on blur. Editor backdrops dismiss the keyboard first and confirm before discarding edits. Rich-text toolbar buttons use the `tap()` helper in Editor.jsx (no focus/selection loss on touch). Never use `100vh/dvh` for a sheet that contains inputs.
- **Data cache:** read session/admin/org data through `cachedGet`/`useCachedGet` (`src/lib/dataCache.js`), not `apiGet`, so tab revisits render instantly. Every successful `apiPut/Post/Del/PutBlob` invalidates cached URLs under the same first path segment; `clearCache()` runs on login/logout. Home derives admin team views from one `scope=org` list using `orgTeams[].memberIds`.
- **Code splitting:** App lazy-loads Home, Sessions, Cards/Objections, AdminPanel, Signup and the command palette (each in its own `Suspense`; Play stays eager and outside them) and prefetches the chunks on idle.
- **Org mark:** `OrgMark` reads `authUser` or the brand store (`src/lib/brand.js`); use `wide`/`withName` for headers. Sizes: full-screen states 64/56/48 (desktop/tablet/phone), headers 22–44.

- **Startup resilience:** `App` checks `/auth/me` with a 75s timeout (shows "Waking up the server" after 5s). Only 401/403 route to login; network errors/timeouts/5xx show a "Can't reach the server" retry screen. Deck load failures show a retry screen too.
- **Org branding & theme:** orgs have `logo` (raster `data:` URL ≤ ~300 KB, client-resized to 256px by `BrandingFields`; SVG rejected server-side) and `"accentColor"` (#RRGGBB), edited by the owner (Admin → Organization) or at org creation. `/auth/me` returns `orgName`, `orgLogo`, `orgAccent`. `App` calls `setAccentColor(authUser.orgAccent)` before rendering; `SESS_COLOR` in `constants.js` is a live binding that becomes the org accent, and `accentA(alpha)` replaces hard-coded `rgba(168,255,62,…)`. Never hard-code the lime accent again — use `SESS_COLOR` / `accentA()`; wrap any navy surface colour (backgrounds, panels, sheets, inputs) in `themed("…")` so it becomes a dark version of the org accent (unchanged navy when the org has none; sign-in/sign-up/reset screens stay navy); `solidBtn` picks black/white text by luminance (`inkOn`). Semantic colours (card types, Live/Practice `STYPE`, outcomes) are intentionally not themed. `OrgMark` shows the org logo (or initial) wherever the OverCard "O" used to be inside the app.
- **Sign-in:** `LoginScreen` reads `useDesktop()` directly (it renders outside `DesktopCtx`): desktop and wide tablets get a split brand panel + large form, portrait tablets a larger single column, phones the original layout.
- **Recording:** `src/lib/useRecorder.js` is the only recorder (used by `PlayMobile` and `PlayDesktop`): device list with permission + `devicechange`, optional call audio (`getDisplayMedia` mixed with the mic via Web Audio, desktop only), level meter, 3s test, mono 32 kbps, mime fallback webm→mp4. Navigators close the current card's visit on EVERY card change (forward, back, jump, exit objection, restart) and once more on finish, so segments tile the recording. `finishSession` → save session JSON → `uploadSessionAudio()` (`src/lib/audioUpload.js`: IndexedDB backup first, upload with retries, local copy deleted on success, "Retry upload" on failure). UI: `src/components/RecordingSetup.jsx` (`RecordingSetup`, `RecIndicator`).
- **Noise reduction:** automatic on both ends. Recording asks the browser for noise suppression on the mic *and* shared call audio, then runs each source through `createNoiseReduction` before mixing (the level meter and the "Test" recording use the same chain). Playback routes the `<audio>` element through the same chain via one shared AudioContext (`createMediaElementSource`, created inside the first play click); `ctl.noiseReduction`/`ctl.setNoiseReduction` crossfade it on/off (toggle in the Playback tab and the desktop mini-bar; remembered per device). Downloads are always the original file. Without AudioWorklet support only the filters run. The worklet must stay a same-origin file in `public/` (CSP `script-src 'self'`).
- **Playback:** `useSessionAudio(session)` in `AudioPlayer.jsx` owns one `<audio>` per `SessionReview`, loading server → device fallback. Modes: full recording, or `playClip(seg)` which stops at the segment end (rAF-precise). Views: `AudioMiniBar` (every tab), `AudioPlayback` (Playback tab: segment timeline, transport, list in order / by card), Path-tab ▶ per visit, Notes "▶ hear this" (via `wallClockToAudioMs`). WebM without a duration header is fixed by seeking far ahead once on load.
- **Empty org:** A new org has no decks. `MainApp` shows admins/owners a "Create your first deck" form (and everyone a Sign out button) instead of the main shell, since most tabs require a deck.
- **API errors:** `apiGet/Put/Post/Del` throw `Error(message)` using the server's `{ error }` text when present (falls back to `"API <status>"`), with `.status` set.
- **Three layouts:** `useDesktop()` returns `layout` = desktop (≥1024px, mouse) | tablet (768–1023px, or touch tablets) | mobile. App passes `DesktopCtx` with `isDesktop:true` on tablet too, so every `XDesktop/XMobile` switch shows the desktop component; tablet-aware code checks `desktop.compact` (smaller type, 44px touch targets, icon rail + ☰ drawer, in-session Play side rails as drawers) and `desktop.splitPanes` (list + detail side by side only when ≥960px wide, otherwise list ↔ detail with back buttons). Phones are unchanged.
- **Card stage (desktop/tablet editors only):** `src/components/CardStage.jsx` shows the open card large in the centre, its parent card(s) as tabs tucked behind on the left (fanned when there are several; front = the card you came from, else intended path), and its destinations as floating cards on the right with hover/tap previews. Used by `CardsDesktop` (list mode), `ObjectionsDesktop` and `ObjStackEditor` (inline). Graph helpers live in `src/lib/cardGraph.js` (`getParents`, `orderParents`, `getChildren`). Never used in Play or on phones. Stage navigation saves through `CardEditorSheet`'s `onSaveAndNavigateTo`.
- **Desktop/mobile split:** `PlayTab`, `CardsTab`, `ObjectionsTab`, `SessionsTab` are thin wrappers that render `XDesktop` or `XMobile`. Never put hooks after a conditional `return` — crossing the 1024px breakpoint would change hook order and crash.
- **Auth sessions:** `requireAuth` requires SHA-256 of the JWT `sid` to equal `users.activeToken` (constant-time). One device at a time: login asks "Log in anyway?" (409), then `startSession` → `realtime.signOutDevices()` saves the old device's runs as abandoned and sends it `auth.ended {reason:"replaced"}` instantly. Logout clears `activeToken` only if the token's `sid` matches. Password reset/change, user removal and role changes push `auth.ended`/`auth.changed` too. JWTs pinned to HS256. bcrypt is async. The client keeps the Bearer token in localStorage only when the API is cross-site (`CROSS_SITE` in `api.js`); same-origin uses the cookie alone.
- **Live updates:** `startLive()` runs while signed in. Components subscribe with `onLive(type, fn)` (unsubscribe on unmount). Session-list effects add `useCacheVersion("/sessions")` to their deps — `live.js` invalidates `/sessions` on finished/changed/feedback/share events and everything on reconnect (`live.resync`). Never invalidate on `session.progress`. New server writes should `publish()` to the right audience (`publishSession` in sessionRoutes).
- **Runs in progress:** Play calls `useLiveBeat` — the run exists server-side from the start (`status:'active'`, hidden from every list except `/sessions/live`), heartbeats on each card change/note and every 20s, and the normal finish save completes it. Runs whose heartbeat stops for 10 min are closed as `abandoned` (sweep in `index.js`). A device signed out mid-call keeps its recording in IndexedDB; `resumePendingUploads()` uploads it after the next sign-in.
- **Autosave:** 800ms debounce per deck. `dirtyIds` ref tracks which decks have unsaved changes. Saves via `PUT /api/decks/:id`.
- **No polling for live data:** feedback, shares, notifications and session lists update from live events (notifications keep a 5-minute safety poll).
- **Immutable updates:** All state updates use `Object.assign({}, prev, changes)` pattern. No spread operator (ES5-style codebase).
- **Inline styling:** All styles are JS objects. Helper functions for common patterns. No CSS classes.
- **Auth flow:** JWT in HttpOnly cookie. `setUnauthHandler` sets a global 401 redirect. `apiGet/Put/Post/Del` check for 401 on every response.
- **Share codes:** codes can carry a label and a team; joining adds the person to that team and records `users."inviteId"`. Signup/preview errors say why a code can't be used (`reason`: unknown/revoked/expired/used_up).
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
| `JWT_SECRET` | Yes (except dev/test) | 32+ chars. The server refuses to start without it unless `NODE_ENV` is `development` or `test` (`npm run server` sets development). |
| `NODE_ENV` | Yes (production) | Set to `production`. Enables secure cookies, helmet CSP. |
| `DATABASE_SSL` | No | `verify` / `require` (production default) / `off` |
| `DATABASE_POOL_MAX` | No | Default 20 |
| `APP_URL` | No | Public app URL for owner recovery links |
| `UV_THREADPOOL_SIZE` | No | 8 on Render (fast sign-in bursts) |
| `RATE_LIMITS` | No | `off` disables rate limits for tests/load test; ignored in production |
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
5. Set `MASTER_CODE` and create the first org from the sign-up screen

**Frontend** is deployed separately on Vercel. `buildCommand` in `render.yaml` is `npm install` only — Vite build runs on Vercel, not Render.

### Vercel (Frontend)

1. Connect repo to Vercel — it auto-detects the Vite project
2. Build command: `npm run build`, Output directory: `dist`
3. No extra environment variables required (Vite proxies `/api/*` at build time only; in production the frontend calls the same origin or the Render URL directly via `VITE_API_URL` if on a separate domain)
4. After Vercel deploys, copy the Vercel deployment URL and set it as `CORS_ORIGIN` in the Render dashboard (Environment → `CORS_ORIGIN`)

> Render free PostgreSQL has 90-day data retention. Upgrade for production persistence.

## Security

- **JWT secret:** required (32+ chars) everywhere except `NODE_ENV=development/test`.
- **Rate limiting (server/limits.js):** login and signup 10/15 min, invite preview 30/15 min, reset links 20/15 min, password change 10/15 min per account, whole API 600/min per account (falls back to IP).
- **Tokens:** session ids and reset tokens are stored only as SHA-256 hashes.
- **PII:** emails are returned to admins only (`/sessions/org-users`, share lists). Production error logs omit row details.
- **Security headers:** `helmet` middleware sets standard security headers (CSP disabled in dev for Vite HMR).
- **Password policy:** 8+ characters, at least one uppercase letter, at least one digit. Enforced on user creation and password reset.
- **Org scoping:** All endpoints validate `orgId` to prevent cross-org data access (IDOR protection).
- **XSS prevention:** `escH()` in `Editor.jsx` escapes all user content before innerHTML rendering in the contentEditable editor.
- **Feedback limits:** Feedback text capped at 5000 characters.
- **Signup:** Share codes are 8 chars from an unambiguous 31-char alphabet (~40 bits), expirable, use-limited and revocable. `/auth/invite`, `/auth/signup` and `/auth/create-org` share a 10-per-15-min rate limiter.
