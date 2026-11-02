import { pino } from 'pino';
import { EnvError, loadEnv } from './config/env.ts';
import { createEmailWorker } from './jobs/email-worker.ts';
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

  handleShutdown(logger, async () => {
    await emailWorker.close();
    mailer.close();
    await connection.quit();
  });
  await emailWorker.waitUntilReady();
  await checkEvictionPolicy(connection, logger);
  logger.info('worker started: email queue');
}

main().catch((error: unknown) => {
  const message =
    error instanceof EnvError || error instanceof Error ? error.message : String(error);
  process.stderr.write(`Worker failed to start: ${message}\n`);
  process.exit(1);
});
