import type { PushPayload } from '@zuvo/protocol';
import { type Connection, Types } from 'mongoose';
import type { Logger } from 'pino';
import type { PushSubscriptionDoc } from '../db/push-models.ts';
import { liveSessionIds } from './gather.ts';
import {
  endpointHost,
  MESSAGE_PUSH_TTL_SECONDS,
  type PushOptions,
  type PushSender,
} from './sender.ts';
import { pushModels } from './subscriptions.service.ts';

interface DeviceContext {
  mongo: Connection;
  log: Pick<Logger, 'info' | 'warn'>;
  sender: PushSender;
}

/**
 * A person's subscriptions whose session still exists and has not expired. The others are deleted
 * now: the TTL index removes them too, but only about once a minute.
 */
export async function liveDevices(
  ctx: Omit<DeviceContext, 'sender'>,
  userId: string,
  filter: { sessionId?: string } = {},
): Promise<PushSubscriptionDoc[]> {
  const { PushSubscription } = pushModels(ctx.mongo);
  const docs = await (filter.sessionId
    ? PushSubscription.find({ sessionId: filter.sessionId })
    : PushSubscription.find({ userId: new Types.ObjectId(userId) }).sort({ createdAt: -1 })
  ).lean();
  const mine = docs.filter((doc) => doc.userId.toString() === userId);
  const live = await liveSessionIds(ctx.mongo, [...new Set(mine.map((doc) => doc.sessionId))]);
  const ended = mine.filter((doc) => !live.has(doc.sessionId));
  if (ended.length > 0) {
    await PushSubscription.deleteMany({ _id: { $in: ended.map((doc) => doc._id) } });
    ctx.log.info({ userId, removed: ended.length }, 'push subscriptions of ended sessions removed');
  }
  return mine.filter((doc) => live.has(doc.sessionId));
}

export interface DeliveryResult {
  delivered: number;
  /** Failed for a reason worth trying again (network, 5xx, 429). */
  retryable: number;
  removed: number;
}

/** Sends one payload to these devices. A 404/410 (or keys that can never work) deletes the device. */
export async function deliverToDevices(
  ctx: DeviceContext,
  devices: PushSubscriptionDoc[],
  payload: PushPayload,
  options: Partial<PushOptions> = {},
): Promise<DeliveryResult> {
  const { PushSubscription } = pushModels(ctx.mongo);
  const full: PushOptions = { ttlSeconds: MESSAGE_PUSH_TTL_SECONDS, urgency: 'normal', ...options };
  const results = await Promise.all(
    devices.map(async (device) => ({
      device,
      result: await ctx.sender.send(
        {
          userId: device.userId.toString(),
          sessionId: device.sessionId,
          endpoint: device.endpoint,
          keys: device.keys,
        },
        payload,
        full,
      ),
    })),
  );
  const delivered = results.filter(({ result }) => result.ok).map(({ device }) => device._id);
  const gone: Types.ObjectId[] = [];
  let retryable = 0;
  for (const { device, result } of results) {
    if (result.ok) continue;
    const host = endpointHost(device.endpoint);
    ctx.log.warn(
      {
        userId: device.userId.toString(),
        statusCode: result.statusCode,
        host,
        reason: result.reason,
        kind: payload.kind,
      },
      'push failed',
    );
    if (result.gone) gone.push(device._id);
    else retryable += 1;
  }
  if (delivered.length > 0) {
    await PushSubscription.updateMany(
      { _id: { $in: delivered } },
      { $set: { lastUsedAt: new Date() } },
    );
  }
  if (gone.length > 0) await PushSubscription.deleteMany({ _id: { $in: gone } });
  return { delivered: delivered.length, retryable, removed: gone.length };
}
