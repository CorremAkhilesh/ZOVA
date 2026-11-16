import type { PushPayload } from '@zuvo/protocol';
import { sendNotification, WebPushError } from 'web-push';
import type { VapidKeys } from './vapid.ts';

export interface PushTarget {
  userId: string;
  sessionId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushOptions {
  /** Seconds the push service keeps it for an offline device. */
  ttlSeconds: number;
  urgency: 'normal' | 'high';
  /** A newer push with the same topic replaces one still waiting (base64url, ≤ 32 characters). */
  topic?: string | undefined;
}

/** `gone`: the push service says this subscription no longer exists (404/410); delete it. */
export type PushResult =
  | { ok: true }
  | { ok: false; gone: boolean; statusCode: number | null; reason: string };

export interface PushSender {
  send(target: PushTarget, payload: PushPayload, options: PushOptions): Promise<PushResult>;
}

/** 24 hours: an old "new message" is not worth showing after that. */
export const MESSAGE_PUSH_TTL_SECONDS = 24 * 3600;

const TOPIC = /^[A-Za-z0-9_-]{1,32}$/;

/** Standard Web Push (RFC 8291 encryption, RFC 8292 VAPID) through the web-push library. */
export function webPushSender(keys: VapidKeys & { subject: string }): PushSender {
  const vapidDetails = {
    subject: keys.subject,
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
  };
  return {
    async send(target, payload, options) {
      try {
        await sendNotification(
          { endpoint: target.endpoint, keys: target.keys },
          JSON.stringify(payload),
          {
            vapidDetails,
            TTL: options.ttlSeconds,
            urgency: options.urgency,
            ...(options.topic && TOPIC.test(options.topic) ? { topic: options.topic } : {}),
            timeout: 10_000,
          },
        );
        return { ok: true };
      } catch (error) {
        if (error instanceof WebPushError) {
          const gone = error.statusCode === 404 || error.statusCode === 410;
          return { ok: false, gone, statusCode: error.statusCode, reason: 'push service refused' };
        }
        // Bad keys never work: treat them like a subscription that is gone.
        const message = error instanceof Error ? error.message : '';
        const badKeys = /p256dh|auth secret|subscription/i.test(message);
        return {
          ok: false,
          gone: badKeys,
          statusCode: null,
          reason: badKeys ? 'bad keys' : 'network',
        };
      }
    },
  };
}

export interface RecordedPush extends Omit<PushTarget, 'keys'> {
  payload: PushPayload;
  options: PushOptions;
  at: string;
}

/** Tests and E2E: keeps every push in memory. Endpoints listed in `gone` answer 410. */
export interface MemoryPushSender extends PushSender {
  readonly sent: RecordedPush[];
  readonly gone: Set<string>;
  clear(): void;
}

export function createMemoryPushSender(): MemoryPushSender {
  const sent: RecordedPush[] = [];
  const gone = new Set<string>();
  return {
    sent,
    gone,
    async send(target, payload, options) {
      if (gone.has(target.endpoint)) {
        return { ok: false, gone: true, statusCode: 410, reason: 'push service refused' };
      }
      const { userId, sessionId, endpoint } = target;
      sent.push({ userId, sessionId, endpoint, payload, options, at: new Date().toISOString() });
      return { ok: true };
    },
    clear() {
      sent.length = 0;
      gone.clear();
    },
  };
}

export function isMemoryPushSender(sender: PushSender): sender is MemoryPushSender {
  return 'sent' in sender && Array.isArray((sender as MemoryPushSender).sent);
}

/** For logs: the push service's host, never the full endpoint (it is a capability URL). */
export function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'invalid';
  }
}
