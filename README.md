# Zuvo

[![CI](https://github.com/CorremAkhilesh/ZOVA/actions/workflows/ci.yml/badge.svg?branch=dev)](https://github.com/CorremAkhilesh/ZOVA/actions/workflows/ci.yml)

A private, WhatsApp-class messenger for the Correm Advisory team, delivered as a web app and an installable
PWA for Windows, macOS, Linux, Android and iPhone. There are no native apps. Only `@corremadvisory.com`
addresses can sign in. Owned by Correm Advisory India Pvt. Ltd.

## What works today

- **Sign-in:** email and a 6-digit code, 7-day sessions, a list of signed-in devices, new-login alerts.
- **People:** profiles, a unique `@username`, privacy settings, and admin tools with an audit log.
- **Chat:** real-time one-to-one messages, ticks, typing and last seen, and offline use with a local
  database that syncs when back online.
- **Media:** photos, videos and documents up to 1 GB, with resumable uploads, albums, a viewer and a gallery.
- **Voice:** voice notes with a waveform, speed and played status, plus a player for audio files.
- **Everywhere:** English and Hindi, light and dark themes.

Group chats, search, and the rest of the plan are in [CLAUDE.md](CLAUDE.md), the full product and engineering
brief. Known later work is in [docs/backlog.md](docs/backlog.md).

## Tech stack

| Area     | What it uses                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------- |
| Monorepo | pnpm workspaces, Turborepo, Biome, lefthook, TypeScript 7                                         |
| Frontend | React 19, Vite, TanStack Router and Query, Zustand, Tailwind v4, shadcn/ui, Dexie, Socket.IO      |
| Backend  | Node.js 24, Fastify, Socket.IO, Better Auth, Mongoose, BullMQ, Nodemailer, web-push               |
| Data     | MongoDB Atlas, Redis (Memurai on Windows), media files on disk behind a `StorageDriver` interface |
| Shared   | `@zuvo/protocol` (Zod schemas for every REST call and socket event), `config`, `ui-tokens`        |
| Tests    | Vitest, Testing Library, MSW, axe, Playwright, `mongodb-memory-server`                            |

Decisions behind this are in [docs/adr/](docs/adr/), and the sync design is in
[docs/protocol.md](docs/protocol.md).

## Run it locally on Windows

You need Node.js 24, pnpm 10 and Git (versions and install commands are below). Docker is not needed.

```powershell
git clone https://github.com/CorremAkhilesh/ZOVA.git ZUVO
cd ZUVO
git switch dev
pnpm install
Copy-Item backend\.env.example backend\.env
notepad backend\.env    # fill in MONGODB_URI, REDIS_URL, SMTP_PASS, AUTH_SECRET and ADMIN_EMAILS
pnpm dev
```

Then open **<http://127.0.0.1:5191>** and sign in with your `@corremadvisory.com` email. `pnpm dev` starts
Redis, the API on port 4000, the email worker and the frontend on port 5191. To test two people on one
machine, use a normal window and an Incognito window.

This is a shared machine: never touch the `Memurai` service on port 6379, and never commit `.env` or
`backend/storage/`.

## Branch workflow

Work only on **`dev`**, using [Conventional Commits](https://www.conventionalcommits.org). Every push runs
CI. **`main`** only changes through a pull request from `dev`, merged with a merge commit, and only when the
owner says so.

Staging and production deploys are planned but not set up yet: see
[docs/runbooks/vps-checklist.md](docs/runbooks/vps-checklist.md).

---

## Prerequisites (Windows)

| Tool    | Version | Install                                                                    |
| ------- | ------- | -------------------------------------------------------------------------- |
| Node.js | 24 LTS  | `winget install OpenJS.NodeJS.LTS` (or download from <https://nodejs.org>) |
| pnpm    | 10.34+  | `npm install -g pnpm@10`                                                   |
| Git     | latest  | `winget install Git.Git`                                                   |

Check them in **PowerShell** or **Git Bash**:

```powershell
node --version   # v24.x
pnpm --version   # 10.34 or newer
git --version
```

> Docker is **not** needed on your PC. Docker is only used on the VPS.

---

## Setup in detail

```powershell
# 1. Clone and switch to the working branch
git clone <repo-url> ZUVO
cd ZUVO
git switch dev

# 2. Install dependencies (also installs the git hooks)
pnpm install

# 3. Create your local backend env file and fill in the secrets
Copy-Item backend\.env.example backend\.env
notepad backend\.env
```

Secrets you must fill in yourself in `backend\.env`: `MONGODB_URI`, `REDIS_URL`, `SMTP_PASS`, `AUTH_SECRET`.
Never commit `.env` files — they are gitignored.

---

## Scripts

Run these from the repo root:

| Command          | What it does                                                            |
| ---------------- | ----------------------------------------------------------------------- |
| `pnpm dev`       | Start Redis, the API (:4000), the email worker and the frontend (:5191) |
| `pnpm build`     | Build every package                                                     |
| `pnpm lint`      | Lint + format check the whole repo with Biome                           |
| `pnpm format`    | Auto-fix lint issues and format the whole repo                          |
| `pnpm typecheck` | TypeScript type-check every package                                     |
| `pnpm test`      | Run all tests                                                           |
| `pnpm clean`     | Delete build output, coverage and caches                                |

---

## Folder structure

```text
ZUVO/
├─ frontend/        React PWA (@zuvo/frontend)
├─ backend/         Fastify + Socket.IO API (@zuvo/backend)
├─ shared/          Code shared by both sides
│  ├─ protocol/     Zod schemas for REST DTOs and socket events
│  ├─ config/       Brand name and shared config
│  └─ ui-tokens/    Design tokens (colors, spacing, typography)
├─ infra/           Docker Compose, Caddy and VPS deploy files
├─ docs/            Documentation and ADRs (docs/adr/)
└─ .github/         GitHub Actions workflows
```

Shared packages export TypeScript source directly (no build step). After changing design tokens, run
`pnpm --filter @zuvo/ui-tokens generate` to regenerate `tokens.css` (a test fails if you forget).

`infra/` is added when the VPS is set up.

---

## Frontend

`pnpm dev` serves the app at **<http://127.0.0.1:5191>**. It listens on 127.0.0.1 only, and the
port is fixed because 5173 and 5175 are used by other projects on this machine. Requests to `/v1`
and `/socket.io` are proxied to the backend, so cookies are same-origin in development.

| Command (from the repo root)                 | What it does                                     |
| -------------------------------------------- | ------------------------------------------------ |
| `pnpm --filter @zuvo/frontend dev`           | Frontend only                                    |
| `pnpm --filter @zuvo/frontend test`          | Unit, component and accessibility tests (Vitest) |
| `pnpm --filter @zuvo/frontend test:coverage` | Same, with coverage (fails under 70%)            |
| `pnpm --filter @zuvo/frontend test:e2e`      | Playwright smoke test (Chromium locally)         |
| `pnpm --filter @zuvo/frontend build`         | Production build into `frontend/dist`            |

The chat screens read from a local database (Dexie) that the sync engine keeps up to date, so they
work offline. See `docs/protocol.md`.

---

## Backend

Run these from the repo root. All of them read `backend\.env`.

| Command                                                                | What it does                                   |
| ---------------------------------------------------------------------- | ---------------------------------------------- |
| `pnpm --filter @zuvo/backend dev`                                      | API with hot reload on <http://localhost:4000> |
| `pnpm --filter @zuvo/backend dev:worker`                               | Background job worker (needs `REDIS_URL`)      |
| `pnpm --filter @zuvo/backend mail:test -- --to you@corremadvisory.com` | Send a branded test email over SMTP            |
| `pnpm --filter @zuvo/backend build`                                    | Bundle the API and worker into `backend\dist`  |
| `pnpm --filter @zuvo/backend start`                                    | Run the built API (`node dist/main.js`)        |

Endpoints:

- <http://localhost:4000/v1/health>: liveness
- <http://localhost:4000/v1/ready>: MongoDB, Redis and media-folder checks
- <http://localhost:4000/docs>: API reference (not available in production)

Backend tests use an in-memory MongoDB. The first run downloads the MongoDB binary, which is slow;
later runs are fast. They never touch Atlas or the shared Memurai service. Redis integration tests run
only when `REDIS_TEST_URL` is set in `backend\.env` (database 15 of Zuvo's local Redis).

To send the test email through the queue instead of directly, start `dev:worker` and add `--queue`:
`pnpm --filter @zuvo/backend mail:test -- --to you@corremadvisory.com --queue`

### Signing in locally

1. `backend\.env` needs `AUTH_SECRET` (32+ random characters), a working `SMTP_PASS` and
   `REDIS_URL`. Add your email to `ADMIN_EMAILS` to get the admin role on first login.
2. `pnpm dev` starts Redis, the API, the **email worker** and the frontend.
3. Open <http://127.0.0.1:5191> and enter your `@corremadvisory.com` email.
4. The 6-digit code arrives by email (check spam). Type or paste it, then choose your name.

Only `@corremadvisory.com` addresses can sign in. Sessions last 7 days and are never extended.

### Local Redis (Memurai on port 6391)

Locally, Zuvo runs its **own** Memurai process as your normal user: no Windows service and no admin
rights. It listens on `127.0.0.1:6391`. Port and password come from `REDIS_URL` in `backend\.env`
(`redis://:<password>@127.0.0.1:6391`). The script writes the config, data and log to
`backend\storage\redis\`, which is gitignored.

> This is a shared machine. The **`Memurai` Windows service on port 6379** belongs to other
> projects. Never stop, restart or reconfigure it, and never point Zuvo at it. The scripts refuse to
> use port 6379.

```powershell
pnpm redis:start    # starts it in the background (does nothing if it is already running)
pnpm redis:status   # running/stopped, pid, uptime, eviction policy
pnpm redis:stop     # saves data and stops it
```

`pnpm dev` runs `redis:start` once before it starts anything else, so you rarely need to start it
yourself. Running only the backend (`pnpm --filter @zuvo/backend dev`) does not start Redis. It
keeps running after you stop `pnpm dev`. Use `pnpm redis:stop` when you are done. It does not
start again automatically after a reboot; the next `pnpm dev` starts it.

If it does not start, check `backend\storage\redis\memurai.log`.

### Troubleshooting

- **`querySrv ECONNREFUSED _mongodb._tcp…`**: Node on some Windows machines cannot resolve
  `mongodb+srv://` addresses. In Atlas, go to **Connect → Drivers** and copy the **standard**
  connection string instead (it starts with `mongodb://` and lists three hosts). Put it in
  `MONGODB_URI`.
- **`MONGODB_URI … ECONNREFUSED / timed out`**: add your IP under Atlas → **Network Access**.

---

## Commits

Commits must follow [Conventional Commits](https://www.conventionalcommits.org) — a git hook rejects
anything else:

```text
feat: add voice note waveform
fix(auth): reject subdomains in email allow-list
docs: update setup steps
```

The pre-commit hook also runs Biome on staged files and fixes formatting automatically.

---

## Line endings

The repo uses **LF** line endings (enforced by `.gitattributes` and `.editorconfig`). Git on Windows
handles this for you; if your editor asks, choose LF.
