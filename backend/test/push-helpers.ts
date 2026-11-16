import { randomBytes } from 'node:crypto';
import { pushSubscribeResponseSchema } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { isMemoryPushSender, type MemoryPushSender } from '../src/push/sender.ts';
import { headers } from './auth-helpers.ts';

/** Keys of the right shape (a P-256 point, a 16-byte secret). The memory sender never encrypts. */
export const FAKE_PUSH_KEYS = { p256dh: `B${'A'.repeat(86)}`, auth: 'A'.repeat(22) };

export const fakeSubscription = (
  endpoint = `https://push.example.test/${randomBytes(8).toString('hex')}`,
) => ({
  endpoint,
  expirationTime: null,
  keys: FAKE_PUSH_KEYS,
});

/** Turns push on for the device behind this cookie. */
export async function subscribeDevice(app: FastifyInstance, cookie: string, endpoint?: string) {
  const body = fakeSubscription(endpoint);
  const response = await app.inject({
    method: 'PUT',
    url: '/v1/me/push/subscription',
    headers: headers(cookie),
    payload: body,
  });
  if (response.statusCode !== 200) throw new Error(`subscribe failed: ${response.body}`);
  return {
    endpoint: body.endpoint,
    device: pushSubscribeResponseSchema.parse(response.json()).device,
  };
}

export function pushOutbox(app: FastifyInstance): MemoryPushSender {
  const sender = app.push.sender;
  if (!sender || !isMemoryPushSender(sender)) throw new Error('tests need the memory push sender');
  return sender;
}

/** Runs every pending (coalescing) push job now and waits for it. */
export async function flushPushes(app: FastifyInstance) {
  const scheduler = app.push.scheduler as { flush?: () => Promise<void> };
  if (!scheduler.flush) throw new Error('tests need the in-process push scheduler');
  // Scheduling happens just after a send returns: let it land first.
  await app.push.idle();
  await scheduler.flush();
}

export const pushesTo = (app: FastifyInstance, userId: string) =>
  pushOutbox(app).sent.filter((push) => push.userId === userId);

/** Drops pending push jobs without running them (tests that run runPushJob themselves). */
export async function discardPendingPushes(app: FastifyInstance) {
  await app.push.idle();
  await app.push.scheduler.close();
}
