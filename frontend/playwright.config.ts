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
  fullyParallel: true,
  // Local runs share a busy machine: two workers keep auth calls under their timeouts.
  ...(CI ? {} : { workers: 2 }),
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
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
      timeout: 180_000,
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
