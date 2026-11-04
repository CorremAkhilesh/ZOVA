/**
 * API for Playwright E2E: in-memory MongoDB, NODE_ENV=test (in-memory mailer + test outbox route),
 * no Redis, fake SMTP settings. Never touches Atlas, Redis Cloud/Memurai or real SMTP.
 *   pnpm --filter @zuvo/backend e2e:server
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { buildApp } from '../app.ts';
import { loadEnv } from '../config/env.ts';
import { handleShutdown } from '../lib/shutdown.ts';

const PORT = Number(process.env.E2E_API_PORT ?? 4100);
/** The frontend preview origin: the browser talks to the API through its /v1 proxy. */
const APP_ORIGIN = process.env.E2E_APP_ORIGIN ?? 'http://127.0.0.1:5192';

const mongo = await MongoMemoryReplSet.create({
  replSet: { count: 1, storageEngine: 'wiredTiger' },
  instanceOpts: [{ launchTimeout: 60_000 }],
});

const env = loadEnv({
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: String(PORT),
  APP_URL: APP_ORIGIN,
  API_URL: APP_ORIGIN,
  CORS_ORIGINS: APP_ORIGIN,
  MONGODB_URI: mongo.getUri(),
  MONGODB_DB: 'zuvo_test_e2e',
  REDIS_URL: '',
  SMTP_HOST: 'smtp.invalid',
  SMTP_PORT: '465',
  SMTP_SECURE: 'true',
  SMTP_USER: 'nova@corremadvisory.com',
  SMTP_PASS: 'not-used-in-tests',
  MAIL_FROM: 'nova@corremadvisory.com',
  ALLOWED_EMAIL_DOMAINS: 'corremadvisory.com',
  AUTH_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e',
  ADMIN_EMAILS: '',
  // Every browser project shares one IP; keep the per-IP OTP limit out of the way.
  OTP_IP_LIMIT_PER_HOUR: '10000',
  MEDIA_STORAGE_PATH: './storage/e2e',
  LOG_LEVEL: 'warn',
});

const app = await buildApp(env);
handleShutdown(app.log, async () => {
  await app.close();
  await mongo.stop();
});
await app.listen({ host: '127.0.0.1', port: PORT });
process.stdout.write(`E2E API ready on http://127.0.0.1:${PORT}\n`);
