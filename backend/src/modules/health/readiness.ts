import type { CheckStatus, ReadyResponse } from '@zuvo/protocol';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import type { Connection } from 'mongoose';
import { withTimeout } from '../../lib/timeout.ts';
import type { StorageDriver } from '../../storage/driver.ts';

export interface ReadinessDeps {
  mongo: Connection;
  redis: Pick<Redis, 'ping'> | null;
  storage: Pick<StorageDriver, 'checkWritable'>;
  logger: Pick<FastifyBaseLogger, 'warn'>;
}

const CHECK_TIMEOUT_MS = 3000;

async function runCheck(
  name: string,
  check: () => Promise<unknown>,
  logger: ReadinessDeps['logger'],
): Promise<CheckStatus> {
  try {
    await withTimeout(check(), CHECK_TIMEOUT_MS, `${name} check`);
    return 'ok';
  } catch (error) {
    logger.warn({ err: error, check: name }, 'readiness check failed');
    return 'error';
  }
}

async function pingMongo(mongo: Connection): Promise<void> {
  if (!mongo.db) throw new Error('mongodb is not connected');
  await mongo.db.command({ ping: 1 });
}

export async function checkReadiness(deps: ReadinessDeps): Promise<ReadyResponse> {
  const { mongo, redis, storage, logger } = deps;
  const [mongodb, redisStatus, storageStatus] = await Promise.all([
    runCheck('mongodb', () => pingMongo(mongo), logger),
    redis ? runCheck('redis', () => redis.ping(), logger) : Promise.resolve<CheckStatus>('skipped'),
    runCheck('storage', () => storage.checkWritable(), logger),
  ]);
  const checks = { mongodb, redis: redisStatus, storage: storageStatus };
  const ready = Object.values(checks).every((status) => status !== 'error');
  return {
    status: ready ? 'ready' : 'not_ready',
    checks,
    timestamp: new Date().toISOString(),
  };
}
