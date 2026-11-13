import type { PushPayload } from '@zuvo/protocol';

/**
 * Reads a push message without zod (the service worker stays small). Checks the shape the app relies
 * on; anything else is null, and the worker still shows a plain "New message" (every push must show
 * a notification).
 */
export function parsePushPayload(raw: unknown): PushPayload | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as Record<string, unknown>;
  const str = (key: string) => typeof data[key] === 'string';
  const bool = (key: string) => typeof data[key] === 'boolean';
  const count = (key: string, min: number) =>
    typeof data[key] === 'number' && Number.isInteger(data[key]) && (data[key] as number) >= min;
  if (data.v !== 1 || !str('tag') || !str('title') || !str('body') || !bool('silent')) return null;
  if (!str('sentAt') || Number.isNaN(Date.parse(data.sentAt as string))) return null;
  if (data.kind === 'test') return data as PushPayload;
  if (data.kind !== 'message' || !str('chatId') || !bool('hidden')) return null;
  if (!count('seq', 1) || !count('count', 1) || !count('badge', 0)) return null;
  return data as PushPayload;
}

/** The JSON inside a push message, or null when it is missing or not JSON. */
export function readPushJson(data: { json(): unknown } | null | undefined): unknown {
  try {
    return data ? data.json() : null;
  } catch {
    return null;
  }
}
