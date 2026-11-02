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
- Nodemailer + React Email via Hostinger SMTP (`smtp.hostinger.com:465` SSL, from `no-reply@corremadvisory.com`)
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

  | Database    | Used by                 |
  |-------------|-------------------------|
  | `zuvo_dev`  | local PC + staging      |
  | `zuvo_prod` | production              |
  | `zuvo_test_<random>` | tests — throwaway, dropped afterwards |

- Tests must **NEVER** touch `zuvo_dev` or `zuvo_prod`.
- Connection string only in env (`MONGODB_URI`) — never in code, docs or git.
- Proper indexes for every query, TTL indexes for expiring data, transactions where needed.

### Redis
- Local/dev: Redis Cloud free plan.
- Staging/production: Redis container on the VPS.
- Configured via `REDIS_URL`.

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

---

## 5. Environments & workflow

### Local (Windows PC)
- **No Docker locally.** Run frontend + backend with Node (`pnpm dev`).
- Connects to MongoDB Atlas (`zuvo_dev`) and Redis Cloud.

### VPS (Ubuntu + Docker Engine + Docker Compose + Caddy auto-HTTPS)

| Stack      | Hosts                                                                                          | DB          |
|------------|------------------------------------------------------------------------------------------------|-------------|
| staging    | `dev-app.zuvo.corremadvisory.com`, `dev-api.zuvo.corremadvisory.com`                           | `zuvo_dev`  |
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
