import { pino } from 'pino';
import { EnvError, loadEnv } from './config/env.ts';
import { createEmailWorker } from './jobs/email-worker.ts';
import { startWorkerPinsCleanup } from './jobs/pins-cleanup.ts';
import { startWorkerMediaCleanup } from './jobs/worker-media-cleanup.ts';
import { connectWorkerMongo } from './jobs/worker-mongo.ts';
import { startWorkerPush } from './jobs/worker-push.ts';
import { connectionsLine, describeConnections } from './lib/connections.ts';
import { loggerOptions } from './lib/logger.ts';
import { checkEvictionPolicy, createBullConnection } from './lib/redis.ts';
import { handleShutdown } from './lib/shutdown.ts';
import { createMailer } from './mail/mailer.ts';

/** Background job process: runs separately from the API so slow jobs never block requests. */
async function main() {
  const env = loadEnv();
  const logger = pino({ ...loggerOptions(env), name: 'worker' });
  if (!env.REDIS_URL) {
    logger.fatal('REDIS_URL is required to run the worker');
    process.exit(1);
  }

  const connection = createBullConnection(env.REDIS_URL, 'zuvo-worker');
  const mailer = createMailer(env);
  const emailWorker = createEmailWorker(connection, mailer, logger);
  // One MongoDB client for every job.
  const db = await connectWorkerMongo(env, logger);
  const mediaCleanup = await startWorkerMediaCleanup(env, db.mongo, connection, logger);
  const pinsCleanup = await startWorkerPinsCleanup(env, db.mongo, connection, logger);
  const push = await startWorkerPush(env, db.mongo, connection, logger);

  handleShutdown(logger, async () => {
    await emailWorker.close();
    await mediaCleanup.close();
    await pinsCleanup.close();
    await push?.close();
    await db.close();
    mailer.close();
    await connection.quit();
  });
  await emailWorker.waitUntilReady();
  await checkEvictionPolicy(connection, logger);
  logger.info(
    `worker started: email queue, media cleanup, expired pins${push ? ', web push' : ''}`,
  );
  logger.info(describeConnections(env), connectionsLine(env));
}

main().catch((error: unknown) => {
  const message =
    error instanceof EnvError || error instanceof Error ? error.message : String(error);
  process.stderr.write(`Worker failed to start: ${message}\n`);
  process.exit(1);
});
