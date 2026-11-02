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
- Text, photos, videos, documents (≤ 100 MB), voice notes (waveform, playback speed)
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

- Messages are stored server-side in MongoDB so every device syncs full history.

---

## 3. Database

### MongoDB

- MongoDB Atlas cluster `cluster0.zitp2pj.mongodb.net`, shared by local and VPS.
- Separate databases on the same cluster, selected via the `MONGODB_DB` env variable:

  | Database             | Used by                               |
  | -------------------- | ------------------------------------- |
  | `zuvo_dev`           | local PC + staging                    |
  | `zuvo_prod`          | production                            |
  | `zuvo_test_<random>` | tests — throwaway, dropped afterwards |

- Tests must **NEVER** touch `zuvo_dev` or `zuvo_prod`.
- Connection string only in env (`MONGODB_URI`) — never in code, docs or git.
- Proper indexes for every query, TTL indexes for expiring data, transactions where needed.

### Redis

| Environment        | Redis                                                                        |
| ------------------ | ---------------------------------------------------------------------------- |
| local PC           | Own Memurai **user process** on `127.0.0.1:6391` (`pnpm redis:start`)        |
| staging/production | Redis container on the VPS: password-protected, internal Docker network only |
| CI                 | `redis` service container in GitHub Actions                                  |

- **Local:** no Windows service and no admin rights. `backend/scripts/redis.ts` generates the
  config from `REDIS_URL` and runs `C:\Program Files\Memurai\memurai.exe` as the current user, with
  config, data and log in `backend/storage/redis/` (gitignored). `pnpm dev` starts it automatically.
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
  - Max 100 MB per file.
  - MIME type allow-list, verified by file signature (magic bytes), never by extension.
  - Images are compressed on the client before upload.
  - Files get random storage keys (sharded folders). User file names are never used on disk.
  - Storage keys are validated, which protects against path traversal.
- **Cleanup:** deleting a message for everyone, or a disappearing message expiring, also deletes its
  file (background job). A daily job removes orphaned files.
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

### Email sender identity

- Sender address: `nova@corremadvisory.com`.
- `MAIL_FROM` must **always equal** `SMTP_USER` (Hostinger rejects mail sent from any other address).
  The backend should validate this at startup.
- Every email "From" display name must come from `shared/config/brand.ts` — never hard-coded.
  `MAIL_FROM` in env holds only the address.

---

## 5. Environments & workflow

### Local (Windows PC)

- **No Docker locally.** Run frontend + backend with Node (`pnpm dev`).
- Connects to MongoDB Atlas (`zuvo_dev`) and its own local Memurai process (`127.0.0.1:6391`, started by `pnpm dev`).

### VPS (Ubuntu + Docker Engine + Docker Compose + Caddy auto-HTTPS)

| Stack      | Hosts                                                                                             | DB          |
| ---------- | ------------------------------------------------------------------------------------------------- | ----------- |
| staging    | `dev-app.zuvo.corremadvisory.com`, `dev-api.zuvo.corremadvisory.com`                              | `zuvo_dev`  |
| production | `zuvo.corremadvisory.com` (landing), `app.zuvo.corremadvisory.com`, `api.zuvo.corremadvisory.com` | `zuvo_prod` |

### Git & CI/CD

- Work only on `dev`.
- Push to `dev` → GitHub Actions runs CI, then deploys to **staging**.
- Merge `dev` → `main` (**only when the owner says so**) → deploys **production**.
- Images on GHCR; deploys over SSH with health checks and auto-rollback.
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
