# Zuvo

[![CI](https://github.com/CorremAkhilesh/ZOVA/actions/workflows/ci.yml/badge.svg?branch=dev)](https://github.com/CorremAkhilesh/ZOVA/actions/workflows/ci.yml)

A modern, private messenger for the Correm Advisory team, delivered as a web app and an installable
PWA (Windows, macOS, Linux, Android and iPhone). Owned by Correm Advisory India Pvt. Ltd.

The full product and engineering brief lives in [CLAUDE.md](CLAUDE.md).

> **Status:** monorepo foundation + shared packages (`@zuvo/config`, `@zuvo/ui-tokens`, `@zuvo/protocol`). No app code yet.

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

## Setup

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

Secrets you must fill in yourself in `backend\.env`: `MONGODB_URI`, `REDIS_URL`, `SMTP_PASS`.
Never commit `.env` files — they are gitignored.

---

## Scripts

Run these from the repo root:

| Command          | What it does                                                       |
| ---------------- | ------------------------------------------------------------------ |
| `pnpm dev`       | Start Redis, the backend (:4000) and the frontend (:5191) together |
| `pnpm build`     | Build every package                                                |
| `pnpm lint`      | Lint + format check the whole repo with Biome                      |
| `pnpm format`    | Auto-fix lint issues and format the whole repo                     |
| `pnpm typecheck` | TypeScript type-check every package                                |
| `pnpm test`      | Run all tests                                                      |
| `pnpm clean`     | Delete build output, coverage and caches                           |

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

`infra/` and `.github/` are added as the project grows.

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
| `pnpm --filter @zuvo/frontend build`         | Production build into `frontenddist`             |

The chat screens currently show **sample data** (marked "Sample data") so the design can be judged
before the real chat features exist.

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

`pnpm dev` (and `dev:worker`) run `redis:start` first, so you rarely need to start it yourself. It
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

## Branch workflow

1. Work only on **`dev`**.
2. Every push to `dev` runs CI and deploys to **staging**
   (`dev-app.zuvo.corremadvisory.com`).
3. When staging is approved, `dev` is merged into **`main`**, which deploys **production**
   (`app.zuvo.corremadvisory.com`).

### Commit messages

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
