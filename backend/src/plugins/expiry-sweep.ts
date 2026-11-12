import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { expireDueMessages } from '../chats/expiry.service.ts';
import { expireStaleViewOnce } from '../chats/view-once.service.ts';
import { cleanupDeletedMedia } from '../media/media-access.ts';

export const SWEEP_EVERY_MS = 30_000;

export interface SweepResult {
  messages: number;
  viewOnce: number;
  files: number;
}

/** Disappearing messages, then stale view once, then the files either left behind. */
export async function sweepOnce(
  app: FastifyInstance,
  now: Date = new Date(),
): Promise<SweepResult> {
  const messages = await expireDueMessages(app, now);
  const viewOnce = await expireStaleViewOnce(app, now);
  const files = await cleanupDeletedMedia(app, 200, now);
  return { messages, viewOnce, files };
}

export interface ExpirySweep {
  /** Runs a pass now, after any pass already running. */
  run(now?: Date): Promise<SweepResult>;
}

declare module 'fastify' {
  interface FastifyInstance {
    expirySweep: ExpirySweep;
  }
}

interface ExpirySweepOptions {
  /** Null: never on its own (tests call `run`). */
  every: number | null;
  sweep?: (app: FastifyInstance, now: Date) => Promise<SweepResult>;
}

/**
 * Runs in the API process, not the worker, because only the API can tell sockets. Once at startup
 * and then every `every` ms; passes never overlap, and closing waits for the one running.
 */
async function expirySweep(app: FastifyInstance, options: ExpirySweepOptions) {
  const sweep = options.sweep ?? sweepOnce;
  let chain: Promise<unknown> = Promise.resolve();
  let busy = false;
  let timer: NodeJS.Timeout | undefined;

  const run = (now?: Date) => {
    const pass = chain.then(() => sweep(app, now ?? new Date()));
    chain = pass.catch(() => undefined);
    return pass;
  };
  const tick = () => {
    if (busy) return;
    busy = true;
    run()
      .then((result) => {
        if (result.messages || result.viewOnce || result.files) {
          app.log.info(result, 'expired messages removed');
        }
      })
      .catch((error: unknown) => app.log.error({ err: error }, 'expiry sweep failed'))
      .finally(() => {
        busy = false;
      });
  };

  app.decorate('expirySweep', { run });
  if (options.every !== null) {
    const every = options.every;
    app.addHook('onReady', async () => {
      tick();
      timer = setInterval(tick, every);
      timer.unref();
    });
  }
  app.addHook('onClose', async () => {
    clearInterval(timer);
    await chain;
  });
}

export const expirySweepPlugin = fp(expirySweep, { name: 'expiry-sweep', fastify: '5.x' });
