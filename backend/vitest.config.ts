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
    testTimeout: 20_000,
  },
});
