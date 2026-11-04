import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against the production build (`vite preview`), so the service worker and manifest are
 * real. Build first: `pnpm --filter @zuvo/frontend test:e2e` does both.
 */
const PORT = 5192;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Firefox, WebKit and a mobile viewport run in CI (CLAUDE.md §7).
    ...(CI
      ? [
          { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
          { name: 'webkit', use: { ...devices['Desktop Safari'] } },
          { name: 'mobile', use: { ...devices['Pixel 7'] } },
        ]
      : []),
  ],
  webServer: {
    command: 'pnpm exec vite preview',
    url: BASE_URL,
    reuseExistingServer: !CI,
    timeout: 120_000,
  },
});
