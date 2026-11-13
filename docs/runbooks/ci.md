# CI runbook

Workflow: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).
Runs on every push to `dev`, every pull request into `main`, and on demand (**Actions → CI → Run workflow**).
A newer push to the same branch cancels the run that is still going.

CI uses **no secrets**. It never connects to MongoDB Atlas, the real SMTP server or the VPS. Every
value is fake and local to the runner, and `NODE_ENV=test`.

## Jobs

All jobs share [`.github/actions/setup`](../../.github/actions/setup/action.yml). It installs Node
from `.nvmrc` and pnpm from `packageManager`, restores the pnpm store and Turborepo caches, and runs
`pnpm install --frozen-lockfile`.

| Job               | What it does                                                                                                                                                                                                                                                        | Fails when                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **quality**       | `pnpm lint` (Biome lint + format) and `pnpm typecheck` (TypeScript 7, including the service worker config)                                                                                                                                                          | any lint/format issue or type error                                      |
| **test-backend**  | Starts Redis 8 (password, `noeviction`, health-checked) and sets `REDIS_TEST_URL`, so the Redis integration tests that are skipped locally **run here**. Runs the shared-package tests, then backend tests with coverage on `mongodb-memory-server` (binary cached) | a test fails, or coverage < 80% (lines, branches, functions, statements) |
| **test-frontend** | Vitest unit, component and axe accessibility tests with coverage                                                                                                                                                                                                    | a test fails, or coverage < 70%                                          |
| **e2e**           | Builds the frontend, starts `vite preview`, runs Playwright on Chromium, Firefox, WebKit and a mobile viewport (browsers cached). The PWA checks (manifest, service worker, offline, no `/v1` caching) run on Chromium                                              | any E2E failure (report + traces uploaded)                               |
| **build**         | `pnpm build` for every package, then `pnpm --filter @zuvo/frontend size`                                                                                                                                                                                            | build error, or main bundle > 200 KB gzip                                |
| **security**      | `pnpm audit --audit-level high` and a [gitleaks](https://github.com/gitleaks/gitleaks) scan of the **full git history**                                                                                                                                             | a high/critical advisory, or a leaked secret                             |

Redis is started with `docker run` instead of a `services:` container because service containers
cannot pass arguments to `redis-server` (password, eviction policy).

## Debugging a failure

1. Open the run: **Actions → CI → the failed run → the red job → the red step**.
2. Reproduce locally with the same command:

   | Job           | Local command                                                                        |
   | ------------- | ------------------------------------------------------------------------------------ |
   | quality       | `pnpm lint` · `pnpm typecheck` (`pnpm format` fixes formatting)                      |
   | test-backend  | `pnpm --filter @zuvo/backend test:coverage` (set `REDIS_TEST_URL` in `backend/.env`) |
   | test-frontend | `pnpm --filter @zuvo/frontend test:coverage`                                         |
   | e2e           | `pnpm --filter @zuvo/frontend test:e2e` (Chromium only locally)                      |
   | build         | `pnpm build` · `pnpm --filter @zuvo/frontend size`                                   |
   | security      | `pnpm audit --audit-level high`                                                      |

3. **E2E artifacts:** failed runs upload `playwright-report` (HTML report plus traces). Download it
   from the run's **Artifacts** section, unzip it, and run `pnpm exec playwright show-report <folder>`.
   To open a single trace: `pnpm exec playwright show-trace trace.zip`.
4. **Coverage:** `coverage-backend` and `coverage-frontend` artifacts contain the HTML report
   (`index.html`).
5. **Audit failure:** run `pnpm audit` and update the affected package. If no fix exists, add a
   `pnpm.overrides` entry and explain why in the PR.
6. **Gitleaks failure:** remove the secret, **rotate it** (it is already in git history), and ask
   before rewriting history.

## Re-running

- **Re-run failed jobs:** run page → **Re-run jobs → Re-run failed jobs**. Use this for flaky
  infrastructure; flaky tests must be fixed.
- **Fresh run without a push:** **Actions → CI → Run workflow** (choose the branch).
- **Stale cache:** caches are keyed on `pnpm-lock.yaml`. To clear one, go to **Actions → Caches**
  and delete the entry.
