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
| `decks` | Sales pitch decks | id, "orgId", name, color, icon, "rootCard", cards (JSONB), "objStacks" (JSONB), visibility, "archivedAt" (null = active), "sortIndex" (owner's order; new decks append) |
| `deck_access` | Deck visibility controls for private decks | "deckId", "entityType" (team/user), "entityId" |
| `deck_editors` | Admins granted edit rights on a deck (by the owner or the deck's creator) | "deckId", "userId" |
| `sessions` | Practice/live session runs | id, "orgId", "userId", "deckId", "deckColor", "deckIcon", mode, status, outcome, sold, "soldCardId", "soldCardTitle", events (JSONB), notes (JSONB), metrics (JSONB) |
| `session_feedback` | Feedback comments on sessions | id, "sessionId", "authorId", text, "cardId" |
| `session_shares` | Session sharing between users | id, "sessionId", "fromUserId", "toUserId", context |
| `notifications` | In-app notifications (cascade with user/session) | id, "userId", type, "sessionId", "actorName", text, "createdAt", "readAt" |
| `session_audio` | Session recordings (BYTEA, one per session; cascades on session delete) | "sessionId" PK, "orgId", "mimeType", "durationMs", "sizeBytes", data |
| `password_resets` | One-time reset links | id, "userId", "tokenHash" (SHA-256), "createdBy", "expiresAt", "usedAt" |
| `session_highlights` | Highlighted sessions (one per session; cascades with the session and the team) | "sessionId" PK, "orgId", scope (org/team), "teamId", note (≤280), "createdBy", "createdAt" |
| `audio_clips` | Saved clips — a cut of a recording in its own audio + a snapshot of the session (`meta`). Survive the session ("sessionId" → NULL), go with their owner | id, "orgId", "userId", "sessionId", title (≤50), kind (segment/range), "segId", "cardId", "startMs", "endMs", "durationMs", meta (JSONB), "mimeType", "sizeBytes", data (BYTEA) |
| `clip_shares` | Clips shared with teammates | id, "clipId", "orgId", "fromUserId", "toUserId", note (≤1000); UNIQUE("clipId","toUserId") |

Also: `notifications."clipId"` (clip shares), `sessions."lastBeatTs"`/`live` (in-progress runs, `status='active'`), `org_invites.label`/`"teamId"`, `users."inviteId"`. `users."activeToken"` holds SHA-256 of the session id, never the raw id. Emails are unique case-insensitively (`uniq_users_email_lower`). Deleting a user keeps their sessions (`userId` → NULL, listed as "Former member"), keeps feedback they wrote, removes shares to/from them; deleting a team clears members' `teamId`.

**Column naming:** All camelCase column names are double-quoted in every SQL string throughout db.js to preserve case in PostgreSQL (e.g., `"orgId"`, `"userId"`, `"startTs"`).

**JSONB fields:** `cards`, `objStacks`, `events`, `notes`, `metrics` are stored as JSONB. The pg driver auto-serializes on write (pass JS objects directly — never `JSON.stringify`) and auto-deserializes on read (never `JSON.parse`).

**BIGINT timestamps:** `"startTs"`, `"updatedAt"`, `"lastLoginAt"` are `BIGINT` storing Unix milliseconds. A type parser (`types.setTypeParser(20, ...)`) ensures these are returned as JS numbers, not strings.

**Migrations:** every schema change goes in a numbered file in `server/migrations/` (`{ name, up(client) }`, listed in `index.js`), applied once each in its own transaction under an advisory lock and recorded in `migrations`. Never edit or reorder a shipped migration. Don't add new `ALTER`s to the `initSchema` baseline.

**Audio size budget:** recordings are ~0.24 MB/min (32 kbps); saved clips add their own cut (same rate). The free Render database is 1 GB, which is roughly 60 hours of audio in total.

**Helper functions:** `parseDeck(row)` and `parseSession(row)` in db.js set defaults for JSONB fields that may be null (no JSON parsing needed).

## Data Model

**Deck** — A structured sales pitch deck:
- `cards: {}` — Map of card ID to card object. Each card has: `id`, `title`, `type` (pitch/discovery/close/objection), `prompt` (rich-text string), `overview[]` (bullet points), `answers[]` (each with `id`, `label`, `next` card ID), `intendedPath` (boolean)
- `rootCard` — ID of the entry card
- `objStacks[]` — Objection stacks, each with: `id`, `label`, `icon`, `rootCard`, `cards{}` (own card sub-tree), `targetCard` (optional — card ID to navigate to after resolution instead of returning), and deck-style permissions `createdBy`, `visibility` (public/private), `accessList`, `editorIds` (see Stack permissions). Array order = the owner's order everywhere.
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
- `events[]` — Array of `{ type:"visit", cardId, cardTitle, cardType, isObjCard, stackId, stackLabel, intendedPath, ts, durationMs }` (`stackId` on runs recorded since stack stats; older ones match stacks by card id, then label)
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
| `src/lib/richtext.js` | `parseRichText`, `stripMarkup` (fills `{{NAME}}`), `NAME_TOKEN`, `nameText`, `fillName`, `scriptLength` (visible chars, NAME = 6), `oneLine` |
| `src/lib/viewer.js` | `setViewerName`, `getViewerName` — the signed-in first name shown by `{{NAME}}` blocks |
| `src/lib/library.js` | `openLibrary({tab, clipId})`, `onOpenLibrary` — opens the Library sheet from anywhere |
| `src/components/ClipSave.jsx` | `SaveClipDialog`, `useSavedSegments`, `LibraryButton`, `HeartIcon`, `LibraryIcon`, `CLIP_COLOR`, `clipTint` |
| `src/components/Library.jsx` | `LibrarySheet` (lazy chunk "library": ♥ Clips — mine/shared — and ★ Highlights; clip pop-out card with player, session details, share/rename/delete), `useClipAudio` |
| `src/components/AccessFields.jsx` | `AccessFields` (who can use / who can edit an objection stack), `accessSummary` |
| `src/components/desktop/StackStats.jsx` | `StackStats`, `computeStackStats` — the Objections stage when no card is open |
| `server/routes/clipRoutes.js` | `/api/clips` — save (ffmpeg cut), list, play, rename, delete, share |
| `src/lib/api.js` | `apiGet`, `apiPut`, `apiPost`, `apiDel`, `setUnauthHandler`, `setSessionReplacedHandler`, `setStoredToken`, `getStoredToken`, `fetchWithTimeout` (75s default — covers free-tier cold start), `apiPostWithRetry` (retries network/5xx; used for finished-session saves), `lsGet`/`lsSet` (try/catch-safe localStorage) |
| `src/lib/styles.js` | `solidBtn`, `ghostBtn`, `ghostSm`, `iconBtn`, `labelSt`, `inputSt`, `cardBg`, `badgeSt`, `dividerV` |
| `src/components/ErrorBoundary.jsx` | `ErrorBoundary` (wraps `<App/>` in `main.jsx`; shows reload screen on render crash) |
| `src/components/ui.jsx` | `TypeBadge`, `Handle`, `IntendedBadge`, `SectionHdr`, `StatBox`, `BarRow`, `CopyIcon` (every copy/duplicate action), `IncrementalList` (renders long lists in steps as they scroll near) |
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
| `src/components/AudioPlayer.jsx` | `useSessionAudio`, `useNoiseGraph` (playback noise-reduction routing for any `<audio>`), `AudioMiniBar`, `AudioPlayback` (♥ per segment + "Save a part…" range picker when `canClip`), `CardClipPlayer`, `NoiseToggle`, `UploadNotice`, `wallClockToAudioMs`, `segColor`, `msToMmss` |
| `src/components/RecordingSetup.jsx` | `RecordingSetup` (mic picker, level, test, call audio), `RecIndicator` |
| `src/lib/useRecorder.js` | `useRecorder`, `buildAudioSegments`, `pickMimeType`, `recorderSupported`, `callAudioSupported` |
| `src/lib/audioUpload.js` | `uploadSessionAudio`, `retrySessionAudio`, `useUploadStatus` |
| `src/lib/deckOps.js` | `newDeckTemplate`, `collectBranch`, `cloneCards`, `cloneStack`, `duplicateDeck`, `activeDecks`, `liveStacks`, `archivedStacks`, `canEditStack`, `canManageStack`, `reorderStacks`, `upsertStackCard`, `deleteStackCard`, `confirmStackDelete` |
| `src/lib/dataCache.js` | `cachedGet`, `useCachedGet`, `peek`, `invalidate`, `clearCache` — stale-while-revalidate GET cache |
| `src/lib/useViewport.js` | `startViewportTracking`, `useKeyboardOpen`, `keyboardIsOpen`, `revealOnFocus`, `revealField`, `resetStrayScroll`, `isCoarsePointer` |
| `src/lib/brand.js` | `getBrand`, `syncBrand`, `setBrand`, `cachedLogoVer` — org name/logo/accent store + device cache |
| `src/components/ImportPicker.jsx` | `ImportPicker` — `mode="cards"` (cards, optionally with their downstream branch, from another deck), `"stacks"` (whole stacks from any deck; from this deck it duplicates, keeping the return target), `"stackCards"` (objection cards from any deck's stack into the stack being edited) |
| `src/components/Reorder.jsx` | `ReorderList` — drag-handle (mouse/touch/pen) + ↑/↓ keyboard reordering; used for the owner's deck order (deck switcher, Home phone + desktop) |
| `src/components/AdminPanel.jsx` | `AdminPanel` (Users / Teams / Share Codes / Organization; split from Panels.jsx, lazy-loaded), `ResetPasswordDialog`, `InviteCard` |
| `src/lib/noiseReduction.js` | `createNoiseReduction(ctx)` (high-pass 85 Hz → low-pass 7.5 kHz → adaptive noise gate, bypassable), `playbackNoiseReduction`/`setPlaybackNoiseReduction` (per-device pref, default on) |
| `public/noise-reduction-worklet.js` | `overcard-noise-gate` AudioWorklet: learns the background-noise floor and turns it down between words (max −18 dB) |
| `src/components/Highlights.jsx` | `HL_COLOR`, `HighlightChip`, `HighlightBanner`, `HighlightEditor`, `HomeHighlights`, `allowedHighlightTeams`, `canEditHighlight`, `highlightLabel` |
| `src/lib/pressFeedback.js` | `startPressFeedback` (main.jsx), `PRESS_CSS` — the one button press animation |
| `src/lib/useSlidingIndicator.js` | `useSlidingIndicator(containerRef, activeKey, deps)` — measures `[data-tab]` children for a sliding highlight |
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
| GET | `/api/decks` | Yes | No | Decks this user may see, each with `canEdit` / `canManage` / `editorIds` (see Deck permissions) |
| POST | `/api/decks` | Yes | Yes | Create new deck — accepts starting `cards`, `rootCard`, `objStacks` (template / duplicate) |
| PUT | `/api/decks/order` | Yes | Owner | `{ids}` — the deck order every list shows (unknown ids ignored; unlisted decks keep their order after) |
| PUT | `/api/decks/:id` | Yes | Yes | Update deck fields + access list. Stacks a non-owner omits are kept (only the owner deletes stacks) |
| POST | `/api/decks/:id/archive` | Yes | Yes | Archive (sets `archivedAt`) |
| POST | `/api/decks/:id/restore` | Yes | Yes | Restore an archived deck |
| GET | `/api/decks/:id/access` | Yes | Owner/creator | Get deck access list |
| PUT | `/api/decks/:id/access` | Yes | Owner/creator | Set deck access list (any team in the org) |
| PUT | `/api/decks/:id/editors` | Yes | Owner/creator | `{userIds}` — admins who may edit the deck (non-admins dropped) |

`PUT /api/decks/:id` also carries the stacks' permission fields — see Stack permissions. Stack-only editors (no deck rights) may PUT too; only their stacks change.
| DELETE | `/api/decks/:id` | Yes | Owner | Permanently delete deck (sessions keep their snapshot) |

### Sessions
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/sessions` | Yes | List sessions (supports `?scope=`, `?deckId=`, `?mode=`, `?outcome=`, `?from=`, `?to=`, `?limit=`). One query: feedback/share counts are LATERAL joins |
| POST | `/api/sessions` | Yes | Save a finished run (requires `id`; deck must be in the caller's org). Ends its live row |
| GET | `/api/sessions/live` | Admin | Runs in progress this admin may watch (owner: all; admins: all only while the org has no teams, else reps sharing a team) |
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

### Session Highlights
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/sessions/highlights?deckId=&limit=` | Any org member | Highlighted sessions the caller may see, newest highlight first (`_highlight:true`, plus `highlight`) |
| PUT | `/api/sessions/:id/highlight` | Admin/owner | `{scope:"org"|"team", teamId?, note?}` — finished sessions only |
| DELETE | `/api/sessions/:id/highlight` | Admin/owner | Remove it |

**Who sees a highlight:** the owner sees all of the org's; everyone else (admins too) sees org-wide ones plus those of teams they belong to (`user_teams`) or administer (`team_admins`) — one predicate, `highlightVisibleSql` in db.js. **Who sets one:** any admin for org-wide; for a team, the owner (any team) or an admin of/member of that team; editing/removing needs the same rights over the current highlight. Session lists attach `session.highlight` only when visible to the caller. A visible highlight grants **read** access (`canAccessFeedback`: feedback list, audio, audio meta); writing feedback stays admin/share-recipient only. Changes publish `highlight.changed {sessionId}` on the `org:<orgId>` channel. UI (`src/components/Highlights.jsx`): ★ chip on rows and review header, `HighlightBanner` + admin `HighlightEditor` in `SessionReview`, a deck-specific Highlights filter in the Sessions tab (phone: ★ header button → highlights view; desktop/tablet: "★ Highlights" pill, which also drives the overview analytics), a Highlighted KPI / "All ↔ ★ Highlights" toggle in analytics, and `HomeHighlights` (latest 3, all decks) on Home. A highlight whose deck isn't in the user's decks opens read-only in an overlay (`App.openHighlight`).

### Saved Clips
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/clips?view=mine\|shared` | Yes | The caller's clips, or clips shared with them (`sharedByName`, `shareNote`) — never the audio |
| POST | `/api/clips` | Anyone who can read the session | `{sessionId, startMs, endMs, title (≤50), segId?}` → 201 clip. 1 s–10 min, inside the recording; cut with ffmpeg (WebM/Opus, or MP4/AAC for MP4 recordings); `meta` is built server-side. 30/15 min per account, 2 cuts at once |
| GET | `/api/clips/:id` | Owner of the clip, share recipient, org owner | Clip + meta |
| GET | `/api/clips/:id/audio` | Same | The clip's own audio; honours `Range` |
| PUT | `/api/clips/:id` | Clip's owner | `{title}` |
| DELETE | `/api/clips/:id` | Clip's owner or org owner | |
| POST | `/api/clips/:id/share` | Clip's owner or org owner | `{toUserId, note?}` → notification `clip_share` |
| GET / DELETE | `/api/clips/:id/shares[/:shareId]` | Clip's owner or org owner | List / revoke |

Who may *save* a clip is `db.canReadSession` (the session-read rule: owner and admins org-wide, the rep, share recipients, people a highlight is visible to). Clips publish `clip.changed {clipId}` to the owner and recipients; `live.js` invalidates `/clips`.

### Notifications
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/notifications` | Yes | `{ items (latest 30, with sessionName/deckId), unreadCount }` |
| POST | `/api/notifications/read` | Yes | `{ ids }` or `{ sessionId }` marks those read; empty body marks all |

Created when someone else leaves feedback on your session (`type: "feedback"`) or shares one with you (`type: "share"`). Client store: `src/lib/notifications.js` (updated live; 5-minute safety poll); UI: `NotificationBell` in the desktop shell and mobile header; opening your own session's review marks its notifications read.

### Live events
`GET /api/events` (auth: cookie or Bearer) is a Server-Sent Events stream. Channels come from the signed-in user only: `user:<id>`, `org:<orgId>` (everyone; id-only "refetch" events such as `highlight.changed`) and, for admins/owner, `orgAdmins:<orgId>`. Events: `session.started/progress/finished` (admins), `session.changed`, `feedback.changed`, `share.changed` (owner + share recipients + admins), `notification.new/read`, `users.changed` (admins), `auth.ended {reason: replaced|password|removed|logout}`, `auth.changed`. Payloads carry ids; clients refetch through the normal endpoints (progress carries the live run).

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

- **Button press feedback:** `startPressFeedback()` sets `data-pressed` (touch: after 70 ms, cancelled by movement/scroll) and `data-press` (animating); `PRESS_CSS` scales with the CSS `scale` property, which composes with a button's inline `transform`. Never reintroduce `:active{transform:…}` — it overrode centred/rotated buttons (the deck-switcher pen jumped). Name transition properties; never `transition:"all …"`.
- **Tab navigation:** the phone tab bar (`MobileTabBar` in App.jsx) and the sidebar/rail/drawer (`SlideList` in DesktopSidebar.jsx) draw one org-accent (`SESS_COLOR`/`accentA`) indicator that slides between `[data-tab]` items; per-tab colours (`TAB_ACCENTS`) remain only outside the nav. Each tab renders inside `TabPane` (App.jsx), whose `tabIn` entrance uses the `translate` property with fill-mode `backwards` so no transform lingers (it would trap `position:fixed` sheets); phones slide in the direction of travel (`--tab-dx`), desktop/tablet rise (`--tab-dy`).
- **Phone landscape** (`useDesktop().isMobile && .landscape`): App swaps the top bar + bottom tab bar for `LandscapeRail` (deck button, tabs with the sliding indicator, bell + profile; labels hide under 340px tall) and gives content the full width/height. Play's `Navigator` takes `split` (card left, responses right, each scrolling); the Play start screen, Home (`data-cols` CSS columns — keep sections as direct children) and the stack editor (details + save | cards) go two-column; SessionsMobile shows list + review side by side (`wrapLand`, `listView`). Sheets get a 10px top gap on short screens (`--sheet-gap`); size sheets with `SHEET_MAX_H`, never `vh`.
- **Tab load speed:** `lazyNamed` (App.jsx) renders a chunk's components synchronously once loaded — React.lazy suspends on every first render and holds the reveal ~300ms. Chunks prefetch on idle; MainApp also warms the active deck's `/sessions` + highlights (+ admin `scope=org`) data. `dataCache` keys ignore query-param order. SessionsMobile always revalidates its list (a review opened right after a call waits for it: `listFresh`).
- **Deck order:** the owner drags decks (`ReorderList`) in the deck switcher or Home's deck quick start; `App.reorderDecks` applies it locally and `PUT /decks/order`. Every deck list renders the `decks` array order — never re-sort decks client-side.
- **Tree rows:** `TreeView` rows always use the card type's `TM` colour; intended path is shown by the green ★ only.
- **Deck permissions** (db.js `deckPermsFor`, enforced in deckRoutes + `deckUsableBy`): *see/use* — the owner every deck; everyone else (admins too) decks that are org-wide, assigned to one of their teams (admins: member or team admin) or to them, or that they may edit; archived decks only for those who may edit. *Edit* — owner, the creator (while an admin), admins in `deck_editors`. *Manage* (teams/visibility + editors) — owner and creator; an editor's save keeps visibility as is. The client trusts `deck.canEdit` (Cards/Objections `readOnly`, switcher pen) and `deck.canManage` (who-can-use + editors in the switcher form).
- **Stack permissions** (db.js `stackPermsFor` / `viewStacks` / `viewDeck`, deckRoutes `mergeStacks`): *see* — deck viewers when the stack is org-wide or assigned to them/their team (archived only for its editors); *edit* — owner, the stack's creator (admin), admins in its `editorIds` (deck editors do NOT edit other people's stacks, but may create new ones); *manage* (visibility/assignees/editors) — owner + creator. GET /decks drops hidden stacks and adds `canEdit`/`canManage`. PUT merges stack by stack: stacks the caller can't edit keep the stored copy, non-managers keep the stored perm fields, only the owner's order and deletes count. Client: `canEditStack(stack, readOnly)` — a stack made on this device (no flags yet) is editable. Migration 011 credited existing stacks to their deck's creator and gave them the deck's editors as stack editors, so nobody lost access.
- **Objections desktop/tablet:** opens on the last-opened stack (per deck, `overcard_obj_sel_<deckId>`) or the first; with no card open the stage shows `StackStats` (comes up in, times raised, avg time, close rate when raised vs deck, back on pitch; where it comes up, path reach, exits, recent calls → review). The owner drags stacks (`ReorderList`) on desktop and phone; read-only stacks open `StackReadView` with the stats.
- **Text limits:** `LIMITS` in constants.js / validate.js — card title 21, script 180 visible chars, bullet 36, deck name 21, stack label 21, session title 50, clip title 50. The server never refuses a deck save over text (autosave sends whole decks; copies of older cards and stale copies must keep saving): it cuts new/changed deck names, titles, bullets and labels, caps a changed script's raw size (2000) and drops delivery cues that aren't in `INFLECTIONS` (`cleanPrompt` — the label goes into the editor's HTML), never touches unchanged content, and truncates session titles. The 180-character script limit is enforced by the editor; `CardEditorSheet` only checks fields that were edited.
- **Scripts are one line:** `RichPromptEditor` blocks Enter (`beforeinput` insertParagraph/insertLineBreak + keydown), flattens pasted breaks, and enforces 180 visible chars in `beforeinput`/paste with a revert fallback; live counter under the editor.
- **NAME block:** stored as `{{NAME}}` (a bare `[NAME]` would read as an inflection); the toolbar `[NAME]` button inserts a non-editable chip (a typed `[NAME]` converts too). A trailing chip gets a zero-width-space text node so the caret never lands inside it (stripped on save). Every display shows the viewer's first name: `RichPromptDisplay` and `stripMarkup` read `lib/viewer.js`, set by `App` from `authUser.firstName`.
- **Markup safety:** `escH` (Editor.jsx) escapes `& < > " '`; `parseRichText`/`stripMarkup`/`scriptLength` treat anything over 4000 raw chars as plain text (the markup regexes are quadratic). ffmpeg cuts force the input container (`-f matroska|mov|ogg`) and `-protocol_whitelist file`, and a cutting slot is taken before a recording is loaded.
- **Saved clips & Library:** Playback tab ♥ (per segment and per visit in `CardClipPlayer`) and "Save a part…" (pink drag handles on `SegmentTrack`, ←/→ on a focused handle, "Now" buttons, preview) open `SaveClipDialog`; only offered when the recording came from the server. The Library (header button next to the bell on desktop, phone top bar and landscape rail; command palette "Library"; `clip_share` notifications) shows clips (mine / shared with me, search, deck filter) and highlights; a clip opens as a pop-out card (desktop: right pane; phone: sheet over the list) with its own player (`useClipAudio` + `useNoiseGraph`), all session details from `meta`, share/rename/delete and "Open session". Its keyboard (Space plays the clip) silences the review / tab shortcuts underneath (`isLibraryOpen`). It opens during a call too; "Open session" is still refused then.
- **Live monitor audience:** `session.started` / `session.progress` go through `realtime.publishLive` to `getLiveWatcherIds` (owner; admins sharing a team with the rep, or every admin when the org has no teams), cached 20s and reset after any admin people/team change. `GET /sessions/live` applies the same rule.
- **Deck switch dissolve:** picking a deck (switcher, Home "Play") calls `switchDeckWithDissolve` — a full-screen cover with the deck fades in, the deck swaps while it's opaque (200ms), and it fades out (640ms total); the chosen switcher row shows "✓ opening".
- **Search (command palette):** ⌘K/Ctrl+K on desktop, the search pill on tablet, the search button in the phone top bar / landscape rail (phones: full-screen). Finds tabs, decks, cards (deck + objection-stack cards, title then script) and sessions (name, rep, deck, contact; admins search the org). `App.openFromSearch` routes: deck → `switchDeckWithDissolve`; card → `focusRequest` ({deckId, cardId, stackId, nonce}) opens it in Cards/Objections (each tab's `focus` / `onFocusDone`); session → `pendingReview` in Sessions (admins' scope widened to the org for another rep's session; decks you can't open → read-only overlay). Results in another deck get an "other deck" tag and the palette asks "Switch decks?" before opening; deck switches are refused during a live call.
- **Cards Tree mode:** opening a card works like List mode — the tree folds into a "Tree" `PaneRail` (or a resizable pane with ‹ Collapse; persisted `overcard_cards_treeRail`) and the card opens on the `CardStage`.
- **Sidebar:** expanded desktop sidebar 320px (collapsed 72px), tablet drawer 360px. No save status in the sidebar — it lives in the top bar next to the profile button.
- **Tab icons:** `TabIcon` (`src/components/TabIcons.jsx`) — flat line icons in `currentColor`; every nav colours the active one `SESS_COLOR`.
- **Keyboard on phones:** the phone shell, sign-in, sign-up, reset and first-deck screens are pinned to the visible viewport (`position:fixed; top:var(--vvt); height:var(--vvh)`), so typing scrolls one container instead of the page panning; the phone tab bar collapses while the keyboard is open. On touch devices any focused field glides to just above the middle of the visible area (`useViewport` focusin + `revealField(el,{center:true})`).
- **Archive vs delete:** admins archive decks/stacks (restorable); only the owner permanently deletes. The server enforces both: `DELETE /decks` is owner-only, and `PUT /decks` from a non-owner keeps any stored stack the payload omits, so stale copies never delete stacks.
- **Copying cards/stacks:** `ImportPicker` + `deckOps.cloneCards/cloneStack` give every copied card/answer/stack a fresh id and rewrite `next` links through an old→new map; links to cards that weren't copied become `null`, copied cards join off the intended path, and a copied stack's `targetCard` is cleared. `duplicateDeck` keeps intended flags and remaps stack targets.
- **Objections desktop/tablet:** `ObjectionsDesktop` mirrors CardsDesktop — stack switcher, List (path-ordered card list + CardStage) / Tree (same as Cards Tree mode: the tree folds into a "Tree" `PaneRail` or a resizable pane with ‹ Collapse, persisted `overcard_obj_treeRail`, and the card opens on the CardStage), and an "After resolving" strip. Stack edits save immediately via `onUpdateDeck` (no Save Stack step); phones still use the buffered `ObjStackEditor`. `CardStage` takes `endLabel` to say where a stack returns.
- **On-screen keyboard:** `startViewportTracking()` (main.jsx) publishes `--vvh/--vvt/--kb/--sheet-gap`. The desktop/tablet shell and every mobile sheet (`overlayFill()`, `SHEET_MAX_H`) size to the visible viewport. Containers with `overflow:hidden` that browsers might scroll to reveal a field carry `data-noscroll` and are snapped back on blur. Editor backdrops dismiss the keyboard first and confirm before discarding edits. Rich-text toolbar buttons use the `tap()` helper in Editor.jsx (no focus/selection loss on touch). Never use `100vh/dvh` for a sheet that contains inputs.
- **Data cache:** read session/admin/org data through `cachedGet`/`useCachedGet` (`src/lib/dataCache.js`), not `apiGet`, so tab revisits render instantly. Every successful `apiPut/Post/Del/PutBlob` invalidates cached URLs under the same first path segment; `clearCache()` runs on login/logout. Home derives admin team views from one `scope=org` list using `orgTeams[].memberIds`.
- **Code splitting:** App lazy-loads Home, Sessions, Cards/Objections, AdminPanel, Signup and the command palette (each in its own `Suspense`; Play stays eager and outside them) and prefetches the chunks on idle.
- **Org mark:** `OrgMark` reads `authUser` or the brand store (`src/lib/brand.js`); use `wide`/`withName` for headers. Sizes: full-screen states 64/56/48 (desktop/tablet/phone), headers 22–44.

- **Startup resilience:** `App` checks `/auth/me` with a 75s timeout (shows "Waking up the server" after 5s). Only 401/403 route to login; network errors/timeouts/5xx show a "Can't reach the server" retry screen. Deck load failures show a retry screen too.
- **Org branding & theme:** orgs have `logo` (raster `data:` URL ≤ ~300 KB, client-resized to 256px by `BrandingFields`; SVG rejected server-side) and `"accentColor"` (#RRGGBB), edited by the owner (Admin → Organization) or at org creation. `/auth/me` returns `orgName`, `orgLogo`, `orgAccent`. `App` calls `setAccentColor(authUser.orgAccent)` before rendering; `SESS_COLOR` in `constants.js` is a live binding that becomes the org accent, and `accentA(alpha)` replaces hard-coded `rgba(168,255,62,…)`. Never hard-code the lime accent again — use `SESS_COLOR` / `accentA()`; wrap any navy surface colour (backgrounds, panels, sheets, inputs) in `themed("…")` so it becomes a dark version of the org accent (unchanged navy when the org has none; sign-in/sign-up/reset screens stay navy); `solidBtn` picks black/white text by luminance (`inkOn`). Semantic colours (card types, Live/Practice `STYPE`, outcomes) are intentionally not themed. `OrgMark` shows the org logo (or initial) wherever the OverCard "O" used to be inside the app.
- **Sign-in:** `LoginScreen` reads `useDesktop()` directly (it renders outside `DesktopCtx`): desktop and landscape tablets get a split brand panel + large form, portrait tablets a larger single column, portrait phones the compact column, landscape phones brand beside form. The logo height is a `clamp(…svh…)` so every layout fits without scrolling.
- **Full-screen pre-app screens** (login, sign-up, reset, first deck, loading/errors): size with `height:"100%"` (never `100vh` — it includes mobile browser bars), `boxSizing:"border-box"` with any padding (MainApp's global reset isn't mounted yet), `overflowY:"auto"`, and centre the content with `margin:"auto"` so a short screen scrolls instead of clipping. Landscape variants key off `useDesktop().landscape` (phones: two columns).
- **Recording:** `src/lib/useRecorder.js` is the only recorder (used by `PlayMobile` and `PlayDesktop`): device list with permission + `devicechange`, optional call audio (`getDisplayMedia` mixed with the mic via Web Audio, desktop only), level meter, 3s test, mono 32 kbps, mime fallback webm→mp4. Navigators close the current card's visit on EVERY card change (forward, back, jump, exit objection, restart) and once more on finish, so segments tile the recording. `finishSession` → save session JSON → `uploadSessionAudio()` (`src/lib/audioUpload.js`: IndexedDB backup first, upload with retries, local copy deleted on success, "Retry upload" on failure). UI: `src/components/RecordingSetup.jsx` (`RecordingSetup`, `RecIndicator`).
- **Noise reduction:** automatic on both ends. Recording asks the browser for noise suppression on the mic *and* shared call audio, then runs each source through `createNoiseReduction` before mixing (the level meter and the "Test" recording use the same chain). Playback routes the `<audio>` element through the same chain via one shared AudioContext (`createMediaElementSource`, created inside the first play click); `ctl.noiseReduction`/`ctl.setNoiseReduction` crossfade it on/off (toggle in the Playback tab and the desktop mini-bar; remembered per device). Downloads are always the original file. Without AudioWorklet support only the filters run. The worklet must stay a same-origin file in `public/` (CSP `script-src 'self'`).
- **Playback:** `useSessionAudio(session)` in `AudioPlayer.jsx` owns one `<audio>` per `SessionReview`, loading server → device fallback. Modes: full recording, or `playClip(seg)` which stops at the segment end (rAF-precise). Views: `AudioMiniBar` (every tab), `AudioPlayback` (Playback tab: segment timeline, transport, list in order / by card), Path-tab ▶ per visit, Notes "▶ hear this" (via `wallClockToAudioMs`). WebM without a duration header is fixed by seeking far ahead once on load.
- **Empty org:** A new org has no decks. `MainApp` shows admins/owners a "Create your first deck" form (and everyone a Sign out button) instead of the main shell, since most tabs require a deck.
- **API errors:** `apiGet/Put/Post/Del` throw `Error(message)` using the server's `{ error }` text when present (falls back to `"API <status>"`), with `.status` set.
- **Three layouts:** `useDesktop()` returns `layout` = desktop (≥1024px, mouse) | tablet (768–1023px, or touch tablets) | mobile, plus `landscape` (window wider than tall). App passes `DesktopCtx` with `isDesktop:true` on tablet too, so every `XDesktop/XMobile` switch shows the desktop component; tablet-aware code checks `desktop.compact` (smaller type, 44px touch targets, icon rail + ☰ drawer, in-session Play side rails as drawers) and `desktop.splitPanes` (list + detail side by side only when ≥960px wide, otherwise list ↔ detail with back buttons). Phones are unchanged.
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
| `LIMITS` | `src/lib/constants.js` (+ `server/validate.js`) | Text limits (see Key Patterns) |
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

**Clip cutting** needs the `ffmpeg-static` binary, which `npm install` downloads (no system ffmpeg needed on Render). Without it `POST /api/clips` answers 503.

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
