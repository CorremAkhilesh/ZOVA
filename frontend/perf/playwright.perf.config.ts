import { defineConfig, devices } from '@playwright/test';
import { assertPortsFree } from '../e2e/port-guard';

/**
 * Performance benchmarks against the production build (docs/runbooks/performance.md). Not part of
 * the E2E suite: `pnpm --filter @zuvo/frontend perf` (build first).
 *
 * Starts its own test API (in-memory MongoDB) and `vite preview`, like the E2E config. With
 * PERF_EXTERNAL_SERVERS=1 it uses ones you started yourself on the same ports instead.
 */
const PORT = Number(process.env.E2E_WEB_PORT ?? 5194);
const API_PORT = Number(process.env.E2E_API_PORT ?? 4197);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const EXTERNAL = process.env.PERF_EXTERNAL_SERVERS === '1';

if (!EXTERNAL) await assertPortsFree([PORT, API_PORT]);

export default defineConfig({
  testDir: '.',
  testMatch: '*.perf.ts',
  outputDir: '../test-results/perf',
  // One at a time: parallel runs would measure each other.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  timeout: 15 * 60_000,
  use: {
    baseURL: BASE_URL,
    trace: 'off',
    ...devices['Desktop Chrome'],
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        // Lets the session benchmark read performance.memory with real (unbucketed) numbers.
        '--enable-precise-memory-info',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  projects: [{ name: 'chromium' }],
  webServer: EXTERNAL
    ? []
    : [
        {
          command: 'pnpm e2e:server',
          cwd: '../../backend',
          url: `http://127.0.0.1:${API_PORT}/v1/health`,
          env: { E2E_API_PORT: String(API_PORT), E2E_APP_ORIGIN: BASE_URL },
          reuseExistingServer: false,
          timeout: 180_000,
        },
        {
          command: `pnpm exec vite preview --port ${PORT} --strictPort`,
          cwd: '..',
          url: BASE_URL,
          env: { ZUVO_API_TARGET: `http://127.0.0.1:${API_PORT}` },
          reuseExistingServer: false,
          timeout: 120_000,
        },
      ],
});
