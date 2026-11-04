import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineConfig } from 'vitest/config';

// Only REDIS_TEST_URL is taken from backend/.env (the process env wins, e.g. in CI).
// Nothing else from .env reaches the tests.
const fileEnv = existsSync('.env') ? parseEnv(readFileSync('.env', 'utf8')) : {};
const REDIS_TEST_URL = process.env.REDIS_TEST_URL ?? fileEnv.REDIS_TEST_URL ?? '';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    env: { REDIS_TEST_URL },
    // The first run downloads the MongoDB binary used by mongodb-memory-server.
    hookTimeout: 120_000,
    // Auth flows do several database round trips; parallel files on slow machines need headroom.
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        // Process entry points and CLI scripts: thin wiring, exercised by the live checks.
        'src/main.ts',
        'src/worker.ts',
        'src/scripts/**',
      ],
      // CLAUDE.md §7: backend ≥ 80% lines/branches, enforced in CI via `test:coverage`.
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
    },
  },
});
