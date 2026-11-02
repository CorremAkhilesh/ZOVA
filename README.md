# Zuvo

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

| Command          | What it does                                   |
| ---------------- | ---------------------------------------------- |
| `pnpm dev`       | Start frontend and backend in watch mode       |
| `pnpm build`     | Build every package                            |
| `pnpm lint`      | Lint + format check the whole repo with Biome  |
| `pnpm format`    | Auto-fix lint issues and format the whole repo |
| `pnpm typecheck` | TypeScript type-check every package            |
| `pnpm test`      | Run all tests                                  |
| `pnpm clean`     | Delete build output, coverage and caches       |

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
later runs are fast. They never touch Atlas or Redis Cloud.

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
