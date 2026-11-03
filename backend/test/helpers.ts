import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mongoose from 'mongoose';
import { inject } from 'vitest';
import { type AppDeps, buildApp } from '../src/app.ts';
import { type Env, loadEnv } from '../src/config/env.ts';
import type { Mailer } from '../src/mail/mailer.ts';

/** A complete, valid env for tests. Never contains real credentials or real databases. */
export function testEnvSource(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: 'test',
    PORT: '4000',
    APP_URL: 'http://localhost:5173',
    API_URL: 'http://localhost:4000',
    CORS_ORIGINS: 'http://localhost:5173',
    MONGODB_URI: 'mongodb://127.0.0.1:27017',
    MONGODB_DB: 'zuvo_test_example',
    REDIS_URL: '',
    SMTP_HOST: 'smtp.example.test',
    SMTP_PORT: '465',
    SMTP_SECURE: 'true',
    SMTP_USER: 'nova@corremadvisory.com',
    SMTP_PASS: 'test-password',
    MAIL_FROM: 'nova@corremadvisory.com',
    ALLOWED_EMAIL_DOMAINS: 'corremadvisory.com',
    MEDIA_STORAGE_PATH: './storage/test',
    LOG_LEVEL: 'silent',
    ...overrides,
  };
}

export const fakeMailer: Mailer = {
  send: async () => ({ messageId: 'test-message-id' }),
  verify: async () => {},
  close: () => {},
};

export async function makeTempDir(
  prefix: string,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), `zuvo-${prefix}-`));
  return { path, cleanup: () => rm(path, { recursive: true, force: true }) };
}

/**
 * Builds the app against the in-memory MongoDB with a throwaway `zuvo_test_<random>` database.
 * `cleanup` drops the database, closes the app and removes the temp media folder.
 */
export async function buildTestApp(deps: Partial<AppDeps> = {}) {
  const media = await makeTempDir('media');
  const env: Env = loadEnv(
    testEnvSource({
      MONGODB_URI: inject('mongoUri'),
      MONGODB_DB: `zuvo_test_${randomBytes(6).toString('hex')}`,
      MEDIA_STORAGE_PATH: media.path,
    }),
  );
  const app = await buildApp(env, { redis: null, mailer: fakeMailer, ...deps });

  const cleanup = async () => {
    await app.mongo.dropDatabase();
    await app.close();
    await media.cleanup();
  };
  return { app, env, cleanup };
}

/**
 * A bare Mongoose connection to a throwaway `zuvo_test_<random>` database on the in-memory server.
 * `cleanup` drops the database and closes the connection.
 */
export async function connectTestDb(options: { monitorCommands?: boolean } = {}) {
  const connection = mongoose.createConnection(inject('mongoUri'), {
    dbName: `zuvo_test_${randomBytes(6).toString('hex')}`,
    autoIndex: true,
    autoCreate: true,
    monitorCommands: options.monitorCommands ?? false,
  });
  await connection.asPromise();
  const cleanup = async () => {
    await connection.dropDatabase();
    await connection.close();
  };
  return { connection, cleanup };
}
