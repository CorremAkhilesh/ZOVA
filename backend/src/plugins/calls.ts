import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Ring timeouts: one timer per ringing call, on the API instance that started it. If that instance
 * goes away, the call is still ended: a ringing call past its time counts as missed the next time
 * anyone looks (see liveCallOf in calls.service.ts).
 */
export interface CallTimers {
  schedule(callId: string, ms: number, run: () => Promise<unknown>): void;
  clear(callId: string): void;
  /** Runs a pending timer now (tests: a missed call without waiting 45 seconds). */
  fire(callId: string): Promise<void>;
}

declare module 'fastify' {
  interface FastifyInstance {
    callTimers: CallTimers;
  }
}

async function setupCalls(app: FastifyInstance) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const runs = new Map<string, () => Promise<unknown>>();
  app.decorate('callTimers', {
    schedule(callId, ms, run) {
      clearTimeout(timers.get(callId));
      runs.set(callId, run);
      const timer = setTimeout(() => {
        timers.delete(callId);
        runs.delete(callId);
        run().catch((error: unknown) => app.log.error({ err: error, callId }, 'call timer failed'));
      }, ms);
      timer.unref();
      timers.set(callId, timer);
    },
    clear(callId) {
      clearTimeout(timers.get(callId));
      timers.delete(callId);
      runs.delete(callId);
    },
    async fire(callId) {
      const run = runs.get(callId);
      this.clear(callId);
      await run?.();
    },
  } satisfies CallTimers);
  app.addHook('onClose', async () => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    runs.clear();
  });
}

export const callsPlugin = fp(setupCalls, { name: 'calls', fastify: '5.x' });
