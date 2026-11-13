import { defineConfig, devices } from '@playwright/test';
import { assertPortsFree } from '../port-guard';

/**
 * Visual sanity screenshots + axe on the key screens, in every viewport and theme. Not part of the
 * E2E suite (its files end in `.visual.ts`, which neither E2E config matches). Run it by hand:
 *
 *   pnpm exec vite build --outDir test-results/visual-build --emptyOutDir
 *   pnpm exec playwright test -c e2e/visual/visual.config.ts
 *
 * It serves its own build folder, so a parallel `vite build` into dist/ cannot change it mid-run.
 * Screenshots: test-results/visual/<viewport>-<theme>-<screen>.png, axe: test-results/visual/axe.json.
 */
const PORT = Number(process.env.E2E_WEB_PORT ?? 5294);
const API_PORT = Number(process.env.E2E_API_PORT ?? 4297);
const BASE_URL = `http://127.0.0.1:${PORT}`;

await assertPortsFree([PORT, API_PORT]);

export default defineConfig({
  testDir: '.',
  testMatch: '*.visual.ts',
  outputDir: '../../test-results/visual-run',
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 30 * 60_000,
  use: { ...devices['Desktop Chrome'], baseURL: BASE_URL, trace: 'off', actionTimeout: 30_000 },
  projects: [{ name: 'visual' }],
  webServer: [
    {
      command: 'pnpm e2e:server',
      cwd: '../../../backend',
      url: `http://127.0.0.1:${API_PORT}/v1/health`,
      env: { E2E_API_PORT: String(API_PORT), E2E_APP_ORIGIN: BASE_URL },
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: `pnpm exec vite preview --outDir test-results/visual-build --port ${PORT} --strictPort`,
      cwd: '../..',
      url: BASE_URL,
      env: { ZUVO_API_TARGET: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
