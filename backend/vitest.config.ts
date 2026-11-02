import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    // The first run downloads the MongoDB binary used by mongodb-memory-server.
    hookTimeout: 120_000,
    testTimeout: 20_000,
  },
});
