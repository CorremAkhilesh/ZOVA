import { defineConfig, devices } from '@playwright/test';
import { assertPortsFree } from './e2e/port-guard';

/**
 * E2E runs against the production build (`vite preview`), so the service worker and manifest are
 * real. Build first: `pnpm --filter @zuvo/frontend test:e2e` does both.
 */
const PORT = Number(process.env.E2E_WEB_PORT ?? 5194);
const API_PORT = Number(process.env.E2E_API_PORT ?? 4197);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CI = Boolean(process.env.CI);

const FAKE_MIC = {
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
};

await assertPortsFree([PORT, API_PORT]);

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  // Every test makes its own accounts, so tests spread over workers and CI shards one by one.
  fullyParallel: true,
  // Two workers, each driving 2–3 browsers, fit a 4-vCPU CI runner beside the test API and
  // `vite preview`; locally they keep auth calls on the busy shared machine under their timeouts.
  workers: 2,
  forbidOnly: CI,
  // One retry at most: a test that needs more is flaky and gets fixed (docs/runbooks/ci.md).
  retries: CI ? 1 : 0,
  // CI: each shard writes a blob report; the E2E job merges them into one HTML report.
  reporter: CI ? [['github'], ['list'], ['blob']] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], ...FAKE_MIC } },
    // Firefox, WebKit and a mobile viewport run in CI (CLAUDE.md §7).
    ...(CI
      ? [
          { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
          { name: 'webkit', use: { ...devices['Desktop Safari'] } },
          { name: 'mobile', use: { ...devices['Pixel 7'] } },
        ]
      : []),
  ],
  webServer: [
    {
      // Test API: in-memory MongoDB + in-memory mailer (OTPs readable via /v1/test/outbox).
      command: 'pnpm e2e:server',
      cwd: '../backend',
      url: `http://127.0.0.1:${API_PORT}/v1/health`,
      env: { E2E_API_PORT: String(API_PORT), E2E_APP_ORIGIN: BASE_URL },
      // Never someone else's server: it could be a real API on a real database.
      reuseExistingServer: false,
      // tsx compiles the API on start: minutes on the busy shared machine, far less on CI.
      timeout: 300_000,
    },
    {
      command: `pnpm exec vite preview --port ${PORT} --strictPort`,
      url: BASE_URL,
      env: { ZUVO_API_TARGET: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
