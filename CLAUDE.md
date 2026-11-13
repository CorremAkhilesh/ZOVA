# Zuvo — WhatsApp-class messenger as a Web App + PWA

- **Owner:** Correm Advisory India Pvt. Ltd.
- **Domain:** corremadvisory.com
- **Brand:** the brand name lives **only** in `shared/config/brand.ts`. Never hard-code it elsewhere.

---

## 1. Product

### Identity & delivery

- A WhatsApp-like messenger with its **own** modern, clean, premium UI.
  - Deep indigo `#4F46E5` primary + teal accent, light and dark themes.
  - As easy as WhatsApp, but **never** copy WhatsApp's green, logo or layout.
- Delivered as a **web app + installable PWA**: Windows/macOS/Linux via Chrome/Edge, Android,
  iPhone via Add to Home Screen. **No native apps.**

### v1 — core

- Email OTP login, profile, unique `@username`
- 1:1 chats + groups (≤ 256 members, admins, invite links)
- Text, photos, videos, documents (≤ 1 GB), voice notes (waveform, playback speed)
- Sent / delivered / read ticks (with privacy toggle), typing indicator, online / last seen
- Reply, forward, copy, edit (within 15 min), delete for everyone, reactions, star
- Pin, mute, archive, mark unread; block, report
- Global search, media gallery
- Web Push, unread badge, PWA install
- English + Hindi

### v1 — advanced

- Multi-device sync, drafts sync
- Chat folders, Saved Messages, pinned messages
- Scheduled messages, polls
- @mentions + reply privately
- Code blocks + rich formatting
- Command palette (`Ctrl+K`)
- Chat lock (PIN), disappearing messages
- Quiet hours / DND
- Wallpapers + accent colors
- New-login alerts

### v2

- Voice/video calls, status/stories, communities/channels, E2E secret chats, passkeys

---

## 2. Tech stack

> Change only via an ADR in `docs/adr/`.

### Monorepo

- pnpm workspaces + Turborepo + Biome + lefthook
- Folders: `frontend/`, `backend/`, `shared/` (`protocol`, `config`, `ui-tokens`), `infra/`, `docs/`, `.github/`
- Shared packages (`@zuvo/config`, `@zuvo/ui-tokens`, `@zuvo/protocol`) are internal "just-in-time"
  packages: `exports` point at TypeScript source, no build step; the backend bundles them for production.
- TypeScript 7 (native compiler) — see `docs/adr/0001-typescript-version.md`.

### frontend/

- React 19, TypeScript strict, Vite
- TanStack Router (file routes) + TanStack Query, Zustand
- Tailwind v4 + shadcn/ui + Motion + lucide-react
- Dexie (offline cache), vite-plugin-pwa (`injectManifest`)
- socket.io-client, i18next
- Vitest + Testing Library + Playwright

### backend/

- Node.js LTS, TypeScript strict
- Fastify (+ Zod type provider)
- Socket.IO with Redis adapter
- Mongoose on MongoDB Atlas, Redis (ioredis), BullMQ
- Better Auth (email OTP plugin + MongoDB adapter)
- Nodemailer + React Email via Hostinger SMTP (`smtp.hostinger.com:465` SSL, from `nova@corremadvisory.com`)
- web-push (VAPID), pino logs, Vitest
- Media stored on the VPS disk behind a `StorageDriver` interface (S3/R2 later)

### shared/protocol

- Zod schemas for **every** REST DTO and Socket.IO event, used by both frontend and backend.

### Message storage

- Messages are stored server-side in MongoDB so every device syncs full history
  (`docs/adr/0002-message-storage.md`). Ordering, sockets and the sync cursor: `docs/protocol.md`.

---

## 3. Database

### MongoDB

- MongoDB Atlas cluster `cluster0.zitp2pj.mongodb.net`, shared by local and VPS.
- Separate databases on the same cluster, selected via the `MONGODB_DB` env variable:

  | Database             | Used by                               |
  | -------------------- | ------------------------------------- |
  | `zuvo_dev<N>`        | each developer on the shared machine  |
  | `zuvo_dev`           | staging                               |
  | `zuvo_prod`          | production                            |
  | `zuvo_test_<random>` | tests — throwaway, dropped afterwards |

- Tests must **NEVER** touch `zuvo_dev` or `zuvo_prod`.
- Connection string only in env (`MONGODB_URI`) — never in code, docs or git.
- Indexes follow the **Database indexing standard** (section 8). Transactions where needed.

### Redis

| Environment        | Redis                                                                        |
| ------------------ | ---------------------------------------------------------------------------- |
| local PC           | Own Memurai **user process** on `127.0.0.1:6391` (`pnpm redis:start`)        |
| staging/production | Redis container on the VPS: password-protected, internal Docker network only |
| CI                 | `redis` service container in GitHub Actions                                  |

- **Local:** no Windows service and no admin rights. `backend/scripts/redis.ts` generates the
  config from `REDIS_URL` and runs `C:\Program Files\Memurai\memurai.exe` as the current user, with
  config, data and log in `backend/storage/redis/` (gitignored). `pnpm dev` starts it automatically.
- **One machine, many developers:** the local PC is a remote Windows server shared by users `dev1`, `dev2`,
  and so on. Every developer uses their **own** `MONGODB_DB` (`zuvo_dev1`, `zuvo_dev7`) and their **own**
  Redis port and password. Sharing either means workers steal each other's jobs and test data mixes. The API
  and worker log `Using MONGODB_DB=… and Redis host:port` at startup, so this is easy to check.
- **Shared machine:** the local PC also runs a shared `Memurai` Windows service on port 6379, used
  by other projects. **Never** use, reconfigure or stop it. The script refuses port 6379.
- Every Zuvo Redis has a password, `maxmemory-policy noeviction` (BullMQ requires it) and AOF
  persistence. It is never exposed publicly. The API and worker log a warning at startup if the
  eviction policy is not `noeviction`.
- Configured via `REDIS_URL` (`redis://:<password>@host:port`; `rediss://` = TLS). Required in
  production. In development it may be empty: rate limiting falls back to in-memory, `/v1/ready`
  reports Redis as `skipped`, and the worker refuses to start.

### Tests and external services

- Tests **never** use MongoDB Atlas or the shared `Memurai` service on port 6379.
- **MongoDB:** `mongodb-memory-server` in replica-set mode (so transactions work), started once per
  test run. Each test file uses its own `zuvo_test_<random>` database and drops it afterwards. With
  `NODE_ENV=test`, env validation **rejects** any `MONGODB_DB` that doesn't start with `zuvo_test_`.
- **Redis:**
  - **Unit tests (local + CI):** Redis is injected. Tests pass a small stub or `null`, which gives the
    in-memory rate limiter and a `skipped` readiness check. No Redis server is needed on Windows.
  - **Redis integration tests** (BullMQ, the Redis rate-limit store) run only when `REDIS_TEST_URL` is
    set. CI sets it to a real `redis` service container. Locally, set it to database 15 of the
    local Memurai (`redis://:<password>@127.0.0.1:6391/15`). The tests only create and delete keys
    under a random per-run prefix.

---

## 3a. Media storage

- **What:** all media (photos, videos, audio, voice notes, documents) is stored on disk through a
  `StorageDriver` interface: `save` (streaming), `read` (with HTTP byte ranges), `delete`, `exists`,
  `stat`. The first implementation is `LocalDiskDriver`. S3/R2 can be added later as another driver,
  with no other code changes.
- **Location** comes from env `MEDIA_STORAGE_PATH`:

  | Environment | Path                                      |
  | ----------- | ----------------------------------------- |
  | local PC    | `backend/storage/uploads` (gitignored)    |
  | staging     | `/srv/zuvo/staging/media` (Docker volume) |
  | production  | `/srv/zuvo/prod/media` (Docker volume)    |

- **Private files.** Media is served only through the API after an authorization check (chat members
  only), using short-lived signed URLs (15 min). Range requests must work so audio and video can seek.
- **Limits and safety:**
  - Max 1 GB per file, set by env `MEDIA_MAX_FILE_MB` (default 1024). The app reads the limit from
    `GET /v1/config`, so both sides always use the same one. Pictures stay at 100 MB: they are decoded
    on both sides, and a larger one goes as a document.
  - New uploads are refused (`507 STORAGE_FULL`) if the disk would go above 90%.
  - Voice notes: at most `VOICE_MAX_SECONDS` long (default 900) and 64 MB. Formats and browser support:
    `docs/adr/0004-voice-notes.md`.
  - MIME type allow-list, verified by file signature (magic bytes), never by extension.
  - Images are compressed on the client before upload.
  - Files get random storage keys (sharded folders). User file names are never used on disk.
  - Storage keys are validated, which protects against path traversal.
- **Cleanup:** deleting a message for everyone, or a disappearing message expiring, also deletes its
  file (background job). A daily job removes orphaned files.
- **Uploads:** chunked and resumable, see `docs/adr/0003-media-uploads.md`.
- **Backups:** the media folder is backed up daily along with the database. Send an alert email when
  disk usage passes 80%.
- **Known dev limitation:** local and staging share the `zuvo_dev` database but not the media folder,
  so media from one environment shows a friendly "Media not available" placeholder in the other. This
  must **never** crash the app.

---

## 4. Auth rules

- **Email + 6-digit OTP only**
  - 10 min TTL, max 5 attempts, 60 s resend cooldown
  - Rate limits per email and per IP
  - Same response whether the email exists or not
- **Session**
  - httpOnly + Secure + SameSite cookie
  - **Absolute** expiry of 7 days from login — no sliding extension; after 7 days the user must log in again with OTP
  - Warn in-app 24 h before expiry
- **Session management**
  - Sessions list with device / browser / last active; revoke one or all
  - New-login alert email with "This wasn't me" (revokes all sessions)
- CSRF protection
- Authorization checks on **every** route and socket event

### Organization-only access

- Only emails ending in `@corremadvisory.com` can sign up or log in. Everyone else is rejected.
- Configurable via env `ALLOWED_EMAIL_DOMAINS` (comma-separated, default `corremadvisory.com`).
- Enforced on the **backend** before any OTP is generated or any email is sent, and re-checked at
  OTP verify and at session creation. The frontend check is only for UX.
- Validation, in this order:
  1. trim + lowercase
  2. valid email format (exactly one `@`, no spaces)
  3. **exact** match of the domain after the last `@` against the allow-list
- Must reject (unit tests required for all of these when auth is built):
  - `user@corremadvisory.com.evil.com`
  - `user@evilcorremadvisory.com`
  - `user@sub.corremadvisory.com`
  - emails containing spaces
  - emails with multiple `@`
- Error for rejected domains: **"Only @corremadvisory.com email addresses can use Zuvo"**.
  Rate limits still apply to rejected requests. (This error is exempt from the "same response" rule
  above, which is about hiding whether an _allowed_ email has an account.)
- An admin can deactivate a user. Deactivation revokes all of that user's sessions immediately and
  blocks future logins.
- **No self-service account deletion.** Accounts belong to the organization: users cannot delete
  their own account; an admin deactivates it instead. Admins cannot deactivate or demote themselves,
  and there is always at least one active admin. Every admin action is written to `audit_logs`.

### Implementation (Better Auth)

- **Better Auth** (email OTP plugin, MongoDB adapter, Redis secondary storage for rate limits,
  verification data and a session cache) is mounted at `/v1/auth/*`. The frontend uses only the
  typed wrappers:

  | Endpoint                                                             | Purpose                                                 |
  | -------------------------------------------------------------------- | ------------------------------------------------------- |
  | `POST /v1/auth/otp/request`                                          | Email a code (same response whether the account exists) |
  | `POST /v1/auth/otp/verify`                                           | Sign in; the first success creates the account          |
  | `GET /v1/auth/me`                                                    | Session + user + `expiresAt` (401 `SESSION_EXPIRED`)    |
  | `POST /v1/auth/logout`                                               | Sign out this device                                    |
  | `POST /v1/admin/users/:id/deactivate` · `/reactivate`                | Admin only; deactivation revokes all sessions           |
  | `GET/PATCH /v1/me/profile` · `PUT /v1/me/username`                   | Own profile; username changes at most every 30 days     |
  | `POST/DELETE /v1/me/avatar` · `GET/PUT /v1/me/privacy`               | Photo (≤ 5 MB, magic bytes, sharp) and privacy          |
  | `GET /v1/users/search` · `GET /v1/users/:id`                         | People search and profiles (privacy applied)            |
  | `GET /v1/me/sessions` · `DELETE /v1/me/sessions/:id`                 | Devices; also `POST /v1/me/sessions/revoke-others`      |
  | `POST /v1/auth/not-me`                                               | Single-use link token from the new-login email          |
  | `GET /v1/admin/users` · `PUT …/:id/role` · `GET /v1/admin/audit-log` | Admin only; changes are audited                         |

- **Checks run in a Better Auth before-hook:** per-IP limit, then domain, deactivated account, 60 s
  cooldown and 5 codes/email/hour, all **before** any code exists. The domain and account status are
  re-checked at verify and in the session-create database hook.
- **Cookie:** `zuvo.session_token`, host-only, `httpOnly`, `SameSite=Lax`, and `Secure` (with the
  `__Secure-` prefix) in production. Lax rather than Strict so opening the app from an email link
  isn't treated as logged out; cross-site writes are blocked by Lax plus Better Auth's origin check
  (`trustedOrigins` = `APP_URL` + `CORS_ORIGINS`).
- **Sessions:** 7 days absolute (`disableSessionRefresh`), stored in MongoDB (and cached in Redis).
- **Production is same-origin:** Caddy serves the app and proxies `/v1` and `/socket.io` on the app
  domain, so set `API_URL` = `APP_URL` = `https://app.zuvo.corremadvisory.com`.
- **OTP emails** go through the BullMQ `email` queue (`pnpm dev` also starts the worker). Codes are
  stored hashed, jobs are deleted once sent, and email content is redacted from logs.
- **`NODE_ENV=test`:** an in-memory mailer, plus `GET /v1/test/outbox/latest` (test only) so tests and
  E2E can read codes. E2E uses `pnpm --filter @zuvo/backend e2e:server` (in-memory MongoDB, port 4197). E2E never reuses a
  running server: it refuses to run if its ports are taken, since the owner could be a real API.
- **Env:** `AUTH_SECRET` (32+ random characters, unique per environment), `ADMIN_EMAILS`,
  `OTP_IP_LIMIT_PER_HOUR`.
- **Admin account:** `novaadmin@corremadvisory.com` (emails are lowercased, so `novaAdmin@…` is the
  same account). `ADMIN_EMAILS` must be set in every environment, staging and production included.
  It promotes a listed account to admin on its next sign-in (new or existing account), written to
  the audit log as a system action, and never demotes anyone.
- **Emergency role change** (e.g. no admin can sign in), run where the env points at the database:
  `pnpm --filter @zuvo/backend admin:role -- --email <email> --role <admin|user>`. It asks for
  confirmation, keeps at least one active admin and writes an audit log entry.

### Email sender identity

- Sender address: `nova@corremadvisory.com`.
- `MAIL_FROM` must **always equal** `SMTP_USER` (Hostinger rejects mail sent from any other address).
  The backend should validate this at startup.
- Every email "From" display name must come from `shared/config/brand.ts` — never hard-coded.
  `MAIL_FROM` in env holds only the address.

---

## 5. Environments & workflow

### Local (Windows PC)

- **No Docker locally.** `pnpm dev` starts Redis, the backend and the frontend (Vite, which proxies `/v1`
  and `/socket.io` to the backend). Shared machine: every dev server binds 127.0.0.1 only, on ports checked
  to be free.
- Connects to MongoDB Atlas (your own `zuvo_dev<N>`) and your own local Memurai process (your own port and
  password from `REDIS_URL`, started by `pnpm dev`).
- **Per-developer ports and database.** Each developer picks their own; defaults apply when nothing is set.
  README → "Running on the shared server" shows how to choose and check them.

  | Setting                                | Where                 | Default | dev7 (owner) |
  | -------------------------------------- | --------------------- | ------- | ------------ |
  | API port `PORT`                        | `backend/.env`        | 4000    | 4007         |
  | Vite dev port `ZUVO_DEV_PORT`          | `frontend/.env.local` | 5191    | 5197         |
  | Vite preview port `ZUVO_PREVIEW_PORT`  | `frontend/.env.local` | 5192    | 5198         |
  | API port for the proxy `ZUVO_API_PORT` | `frontend/.env.local` | 4000    | 4007         |
  | Redis (`REDIS_URL`)                    | `backend/.env`        |         | 6391         |
  | `MONGODB_DB`                           | `backend/.env`        |         | `zuvo_dev7`  |

  `APP_URL` and `CORS_ORIGINS` name your own Vite port (add the preview port to `CORS_ORIGINS` to test Web
  Push, which needs the built app). E2E uses its own ports (4197/5194, dev proxy 4198/5193).

### VPS (Ubuntu + Docker Engine + Docker Compose + Caddy auto-HTTPS)

| Stack      | Hosts                                                                | DB          |
| ---------- | -------------------------------------------------------------------- | ----------- |
| staging    | `dev-app.zuvo.corremadvisory.com`, `dev-api.zuvo.corremadvisory.com` | `zuvo_dev`  |
| production | `app.zuvo.corremadvisory.com`, `api.zuvo.corremadvisory.com`         | `zuvo_prod` |

- **No separate landing website** (decided in Step 19; the old Step 21 is skipped). Install guides, FAQ,
  privacy note and contact live in the app under Settings → Help & About (`/help/...`).
  `zuvo.corremadvisory.com` may later simply redirect to the app.

### Git & CI/CD

- Work only on `dev`.
- Push to `dev` → GitHub Actions runs CI (`.github/workflows/ci.yml`: quality, backend + frontend tests
  with coverage gates, E2E on 4 browsers, build + bundle budget, audit + gitleaks; see
  `docs/runbooks/ci.md`). CI never uses secrets, Atlas or real SMTP.
- **Deploys come later.** The app is built first and deployed to the VPS at the end (Steps 22–25).
  Until then a push to `dev` runs **CI only**: no deploy workflow exists and nothing reaches staging.
- Planned once deploys exist:
  - push to `dev` → CI, then deploy to **staging**
  - merge `dev` → `main` (**only when the owner says so**) → deploy **production**
  - images on GHCR; deploys over SSH with health checks and auto-rollback
- Setting up or changing the VPS: `docs/runbooks/vps-checklist.md`.
- Secrets live in GitHub Secrets and `/srv/zuvo/*.env` on the VPS.

---

## 6. Working rules

- **One step at a time.** After each step:
  1. lint + typecheck + tests
  2. Conventional Commit
  3. push to `dev`
  4. report: summary, how to test it, manual actions for the owner
  5. **STOP and wait.**
- Never commit/push/merge to `main` unless told to.
- Never commit secrets; keep `.env.example` complete.
- Production quality:
  - strict TS (no `any`), small files (< 300 lines), feature-based folders
  - tests for logic, input validation everywhere
  - latest stable package versions, lockfile committed
- Ask before anything destructive.
- If something in this brief is wrong or a better option exists, propose it and ask.
- The standards in sections 7 and 8 apply to **every** step.

---

## 7. Testing standard

### Backend

- **Unit tests** for every service, helper and validator.
- **API integration tests** with Fastify `inject` + `mongodb-memory-server`, covering for each route:
  success, invalid input, unauthenticated and forbidden.
- **Security tests for every resource:** user A must never read or modify user B's chats, messages,
  media or sessions.
- **Realtime tests** with two Socket.IO clients.
- **Contract tests:** every response matches its `@zuvo/protocol` schema.

### Frontend

- **Unit tests** for hooks, stores and utils.
- **Component tests** with Testing Library + MSW, covering the loading, empty, error and success states.
- **Accessibility checks** with axe on every screen.
- **Playwright E2E** for critical flows (two users chatting) on Chromium, Firefox, WebKit and a
  mobile viewport.

### Rules

- **Coverage thresholds enforced in CI:** backend ≥ 80% lines/branches, frontend ≥ 70%.
- **Every bug fix** comes with a test that fails before the fix.
- **No skipped tests** without a written reason next to the skip.

---

## 8. Database indexing standard

- **Every query is supported by an index:** no collection scans. Each model file declares its
  indexes next to the schema, with a comment naming the query each index serves.
- **Index types:**
  - compound indexes in **ESR order** (Equality, Sort, Range)
  - unique indexes (email, username)
  - partial indexes where fields are optional
  - TTL indexes for expiring data (OTP, sessions, disappearing messages)
  - a text index only where search needs it
- **Cursor-based pagination only.** Never use skip/offset on large collections.
- **`expectIndexedQuery()`** (backend test helper) runs `explain()` and fails if the plan contains
  `COLLSCAN`. Every repository query gets such a test.
- **Slow query logging:** queries over 100 ms are logged with the collection name and query shape
  (never values).
- **Production never builds indexes on app start.** `pnpm --filter @zuvo/backend db:sync-indexes`
  runs during deploy.
