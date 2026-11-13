import type { FastifyBaseLogger } from 'fastify';

type Logger = Pick<FastifyBaseLogger, 'info' | 'error' | 'fatal'>;

/**
 * Runs `close` once on SIGTERM/SIGINT, then exits. A second signal or exceeding `timeoutMs`
 * forces the exit. Also exits on unhandled errors, after logging them.
 */
export function handleShutdown(logger: Logger, close: () => Promise<void>, timeoutMs = 15_000) {
  let shuttingDown = false;

  const shutdown = async (reason: string, exitCode: number) => {
    if (shuttingDown) {
      logger.error('second shutdown signal: forcing exit');
      process.exit(1);
    }
    shuttingDown = true;
    logger.info({ reason }, 'shutting down');
    const timer = setTimeout(() => {
      logger.error({ timeoutMs }, 'graceful shutdown timed out: forcing exit');
      process.exit(1);
    }, timeoutMs);
    timer.unref();
    try {
      await close();
      logger.info('shutdown complete');
      process.exit(exitCode);
    } catch (error) {
      logger.error({ err: error }, 'error during shutdown');
      process.exit(1);
    }
  };

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => void shutdown(signal, 0));
  }
  process.on('unhandledRejection', (error) => {
    logger.fatal({ err: error }, 'unhandled promise rejection');
    void shutdown('unhandledRejection', 1);
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception');
    void shutdown('uncaughtException', 1);
  });
}
