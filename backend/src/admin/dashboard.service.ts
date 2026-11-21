import type { AdminDashboard, CheckStatus } from '@zuvo/protocol';
import { Queue } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import { lastBackup } from '../db/system-status.ts';
import { EMAIL_QUEUE } from '../jobs/email-queue.ts';
import { getBuildInfo } from '../lib/build-info.ts';
import { withTimeout } from '../lib/timeout.ts';
import { APP_VERSION } from '../lib/version.ts';
import { checkReadiness } from '../modules/health/readiness.ts';
import { activityStats } from './dashboard-activity.ts';
import { storageStats } from './dashboard-storage.ts';

/** The dashboard is worked out at most once a minute per API process: it reads whole collections. */
export const DASHBOARD_CACHE_MS = 60_000;

const cache = new WeakMap<FastifyInstance, { at: number; value: AdminDashboard }>();

async function emailQueueHealth(
  app: FastifyInstance,
): Promise<AdminDashboard['health']['emailQueue']> {
  if (!app.redis || !app.env.REDIS_URL) return null;
  // A passed-in connection is shared: closing the queue leaves it open.
  const queue = new Queue(EMAIL_QUEUE, { connection: app.redis });
  try {
    const counts = await withTimeout(queue.getJobCounts('waiting', 'failed'), 3000, 'email queue');
    return { status: 'ok', waiting: counts.waiting ?? 0, failed: counts.failed ?? 0 };
  } catch (error) {
    app.log.warn({ err: error }, 'admin dashboard: could not read the email queue');
    return { status: 'error' as CheckStatus, waiting: 0, failed: 0 };
  } finally {
    await queue.close().catch(() => undefined);
  }
}

async function health(app: FastifyInstance): Promise<AdminDashboard['health']> {
  const [ready, emailQueue] = await Promise.all([
    checkReadiness({ mongo: app.mongo, redis: app.redis, storage: app.storage, logger: app.log }),
    emailQueueHealth(app),
  ]);
  return { ...ready.checks, emailQueue };
}

/** GET /v1/admin/dashboard. Counts and sizes only: no message text, file content or file name. */
export async function adminDashboard(
  app: FastifyInstance,
  now = new Date(),
  options: { fresh?: boolean } = {},
): Promise<AdminDashboard> {
  const cached = cache.get(app);
  if (!options.fresh && cached && now.getTime() - cached.at < DASHBOARD_CACHE_MS) {
    return cached.value;
  }
  const [activity, storage, checks] = await Promise.all([
    activityStats(app, now),
    storageStats(app),
    health(app),
  ]);
  const { commit, builtAt } = getBuildInfo();
  const value: AdminDashboard = {
    generatedAt: now.toISOString(),
    ...activity,
    storage,
    health: checks,
    build: { version: APP_VERSION, commit, builtAt },
    // Recorded by the nightly backup on the host (deploy/scripts/backup.sh → backup-done.js).
    lastBackupAt: (await lastBackup(app.mongo))?.finishedAt.toISOString() ?? null,
  };
  cache.set(app, { at: now.getTime(), value });
  return value;
}
