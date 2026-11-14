# CI runbook

Workflow: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).
Runs on every push to `dev`, every pull request into `main`, and on demand (**Actions → CI → Run workflow**).
A newer push to the same branch cancels the run that is still going.

CI uses **no secrets**. It never connects to MongoDB Atlas, the real SMTP server or the VPS. Every
value is fake and local to the runner, and `NODE_ENV=test`.

## What runs when

| Trigger                       | Quality, tests, build, security | E2E shards                                                                          | Target time |
| ----------------------------- | ------------------------------- | ----------------------------------------------------------------------------------- | ----------- |
| push to `dev`                 | all                             | Chromium × 3                                                                        | ≤ 10 min    |
| pull request into `main`      | all                             | Chromium × 3, Firefox × 3, WebKit × 3, mobile (Pixel 7) × 2, dev-proxy Chromium × 3 | ≤ 20 min    |
| manual run (**Run workflow**) | all                             | same as a pull request                                                              | ≤ 20 min    |

The shard list comes from [`.github/scripts/e2e-matrix.mjs`](../../.github/scripts/e2e-matrix.mjs)
(`node .github/scripts/e2e-matrix.mjs full` prints the full matrix). Change shard counts there; aim for about 5 minutes of tests
per shard.

Run #60 (before the split, one E2E job for every browser): E2E 39 min 18 s, wall ≈ 39 min. Since
then a push to `dev` runs Chromium only, in 3 shards, on the app that the build job already built.

## Jobs

All jobs share [`.github/actions/setup`](../../.github/actions/setup/action.yml). It installs Node
from `.nvmrc` and pnpm from `packageManager`, restores the pnpm store and Turborepo caches, and runs
`pnpm install --frozen-lockfile`.

| Job (check name)                                          | What it does                                                                                                                                                                                                                                                        | Fails when                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Quality (Biome + typecheck)**                           | `pnpm lint` (Biome lint + format) and `pnpm typecheck` (TypeScript 7, including the service worker config)                                                                                                                                                          | any lint/format issue or type error                                      |
| **Backend + shared tests (coverage ≥ 80%)**               | Starts Redis 8 (password, `noeviction`, health-checked) and sets `REDIS_TEST_URL`, so the Redis integration tests that are skipped locally **run here**. Runs the shared-package tests, then backend tests with coverage on `mongodb-memory-server` (binary cached) | a test fails, or coverage < 80% (lines, branches, functions, statements) |
| **Frontend tests (coverage ≥ 70%)**                       | Vitest unit, component and axe accessibility tests with coverage                                                                                                                                                                                                    | a test fails, or coverage < 70%                                          |
| **Build + bundle budget**                                 | `pnpm build` (production) for every package, `pnpm --filter @zuvo/frontend size`, then uploads `frontend/dist` + `backend/dist` as the `app-build` artifact and plans the E2E shards                                                                                | build error, or main bundle > 200 KB gzip                                |
| **E2E &lt;suite&gt; &lt;i&gt;/&lt;n&gt;** (one per shard) | Downloads `app-build` (no rebuild), restores the cached browser it needs (one cache per browser and Playwright version), starts the in-memory test API and `vite preview` (or the Vite dev server for dev-proxy), runs `playwright test --project … --shard i/n`    | any test fails after its one retry                                       |
| **E2E**                                                   | Merges the shards' blob reports into one HTML report (`playwright-report` artifact), then passes only if every shard passed. **This is the E2E check to require.**                                                                                                  | any shard failed, was cancelled or did not run                           |
| **Security (audit + secret scan)**                        | `pnpm audit --audit-level high` and a [gitleaks](https://github.com/gitleaks/gitleaks) scan of the **full git history**                                                                                                                                             | a high/critical advisory, or a leaked secret                             |

Redis is started with `docker run` instead of a `services:` container because service containers
cannot pass arguments to `redis-server` (password, eviction policy).

### E2E settings

- **Retries: 1** in both Playwright configs. A test that needs more is flaky: fix the cause.
- **Workers:** 2 per shard in `playwright.config.ts` (each test drives 2–3 browsers, beside the
  test API and `vite preview`, on a 4-vCPU runner); 1 in `playwright.dev.config.ts` (the dev server
  compiles on first use). Both are `fullyParallel`, so shards split the suite test by test.
- **Accounts:** most tests sign people up through the API (`signUpByApi` in `e2e/helpers.ts`:
  the same calls the sign-up screens make), which takes a fraction of the time of the screens.
  `auth.spec.ts`, the profile test, the smoke test and the PWA tests still go through the screens.
- **No waiting for clocks:** test-only hooks make server timers due now — `POST
  /v1/test/expire-messages` (disappearing messages) and `POST /v1/test/run-scheduled` (scheduled
  messages). Both exist only with `NODE_ENV=test`; the timers themselves have backend tests.
- **Sent before acted on:** a message has no menu until the server has accepted it. Use
  `expectSent()` / `messageMenu()` from `e2e/chat-helpers.ts` before right-clicking a message or
  leaving the page.

## Debugging a failure

1. Open the run: **Actions → CI → the failed run → the red job → the red step**. For E2E, the red
   shard job says which test failed (annotations), and the **E2E** job is red too.
2. Reproduce locally with the same command:

   | Job           | Local command                                                                                                                                   |
   | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
   | quality       | `pnpm lint` · `pnpm typecheck` (`pnpm format` fixes formatting)                                                                                 |
   | test-backend  | `pnpm --filter @zuvo/backend test:coverage` (set `REDIS_TEST_URL` in `backend/.env`)                                                            |
   | test-frontend | `pnpm --filter @zuvo/frontend test:coverage`                                                                                                    |
   | E2E shard     | `pnpm --filter @zuvo/frontend build`, then in `frontend/`: `CI=1 pnpm exec playwright test --project chromium --shard 2/3` (as in the job name) |
   | one E2E test  | `CI=1 pnpm exec playwright test --project firefox -g "profile photo" --repeat-each 5`                                                           |
   | dev-proxy     | `CI=1 pnpm exec playwright test -c playwright.dev.config.ts --shard 1/3`                                                                        |
   | build         | `pnpm build` · `pnpm --filter @zuvo/frontend size`                                                                                              |
   | security      | `pnpm audit --audit-level high`                                                                                                                 |

   `CI=1` turns on the Firefox, WebKit and mobile projects, one retry and the blob reporter. On the
   shared machine pick free ports: `E2E_API_PORT`/`E2E_WEB_PORT` (and `E2E_DEV_API_PORT`/
   `E2E_DEV_WEB_PORT` for dev-proxy).

3. **E2E report:** every run with E2E uploads **`playwright-report`** (from the **E2E** job): one
   HTML report for all shards and browsers, with the traces, screenshots and retries of failed
   tests. Download it from the run's **Artifacts**, unzip it, and run
   `pnpm --filter @zuvo/frontend exec playwright show-report <folder>`. Filter by project
   (`project:webkit`) or by status (`s:flaky`) at the top. To open one trace:
   `pnpm --filter @zuvo/frontend exec playwright show-trace trace.zip`. Each shard's raw blob report
   is the `blob-report-<suite>-<i>` artifact; to merge some yourself:
   `pnpm exec playwright merge-reports --reporter html <folder with the .zip files>`.
4. **Coverage:** `coverage-backend` and `coverage-frontend` artifacts contain the HTML report
   (`index.html`).
5. **Audit failure:** run `pnpm audit` and update the affected package. If no fix exists, add a
   `pnpm.overrides` entry and explain why in the PR.
6. **Gitleaks failure:** remove the secret, **rotate it** (it is already in git history), and ask
   before rewriting history.

## Re-running

- **One shard:** open the run, click the red shard job (for example **E2E webkit 2/3**), then
  **Re-run this job** (top right). Then re-run the **E2E** job as well, so the merged report and the
  required check pick up the new result (or use **Re-run failed jobs**, which re-runs both).
- **Re-run failed jobs:** run page → **Re-run jobs → Re-run failed jobs**. Use this for flaky
  infrastructure; flaky tests must be fixed.
- **Fresh run without a push:** **Actions → CI → Run workflow** (choose the branch). This runs the
  full browser matrix, like a pull request.
- **Stale cache:** the MongoDB binary cache is keyed on `pnpm-lock.yaml`, each browser cache on the
  Playwright version. To clear one, go to **Actions → Caches** and delete the entry.

## Branch protection

Set in **Settings → Rules → Rulesets** (or **Settings → Branches → Branch protection rules**).
Only the owner changes these.

### `main`

- **Require a pull request before merging** (from `dev`; merge commits, as in the README).
- **Require status checks to pass**, with **Require branches to be up to date before merging**.
  Required checks (exact job names):
  - `Quality (Biome + typecheck)`
  - `Backend + shared tests (coverage ≥ 80%)`
  - `Frontend tests (coverage ≥ 70%)`
  - `Build + bundle budget`
  - `E2E`
  - `Security (audit + secret scan)`

  Require **`E2E`**, not the shard jobs (`E2E chromium 1/3`, …): the shard list changes with the
  trigger and with shard counts, while `E2E` is always there and only passes when every shard
  passed. A check appears in the picker only after it has run once, so open the first pull request
  (or start a manual run) before choosing them. If a job is renamed, update this list and the
  ruleset in the same change.
- **Block force pushes** and **restrict deletions**.
- Optional: **Require conversation resolution before merging**.

### `dev`

- **Restrict deletions** and **block force pushes**. No pull request is required: work is pushed
  to `dev` directly, and every push runs CI.
