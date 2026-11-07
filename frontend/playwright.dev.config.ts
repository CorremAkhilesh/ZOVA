import { defineConfig, devices } from '@playwright/test';
import { assertPortsFree } from './e2e/port-guard';

/**
 * The critical chat flows through the Vite dev server, the way `pnpm dev` runs the app: a development
 * build (React StrictMode runs effects twice) behind the dev proxy. The main config tests the
 * production build, which cannot see bugs that only exist in development.
 * Own ports and Vite cache, so it can run beside a `pnpm dev` on this shared machine.
 */
const PORT = 5193;
const API_PORT = 4198;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CI = Boolean(process.env.CI);

await assertPortsFree([PORT, API_PORT]);

export default defineConfig({
  testDir: './e2e',
  testMatch: /(chat|presence|media|media-sender|voice|groups|messages|search-moderation)\.spec\.ts/,
  grep: /two people chat|second device|both people open|stuck tab|ticks, read-receipt|photos with captions|upload interrupted|over the limit|no room in the browser|sender|expired video|voice note|cancelling discards|seeking moves|recorded offline|group|message actions|forward to two|made offline|searches a word|formatted message|link with a preview|blocks A|reports B/,
  outputDir: './test-results/dev',
  workers: 1,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['github'], ['list']] : [['list']],
  use: { baseURL: BASE_URL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    {
      name: 'dev-chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
        },
      },
    },
  ],
  webServer: [
    {
      command: 'pnpm e2e:server',
      cwd: '../backend',
      url: `http://127.0.0.1:${API_PORT}/v1/health`,
      env: { E2E_API_PORT: String(API_PORT), E2E_APP_ORIGIN: BASE_URL },
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: `pnpm exec vite --port ${PORT}`,
      url: BASE_URL,
      env: {
        ZUVO_API_TARGET: `http://127.0.0.1:${API_PORT}`,
        ZUVO_VITE_CACHE: 'node_modules/.vite-e2e',
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
