import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';
import { headers } from '../../test/auth-helpers.ts';

/**
 * Collections an ordinary signed-in request may touch without changing anyone's data: the
 * session's "last active" stamp and Better Auth's verification rows.
 */
const VOLATILE = new Set(['session', 'verification']);

/** Every document of every collection (volatile ones left out), to prove nothing changed. */
export async function dbSnapshot(app: FastifyInstance): Promise<Record<string, unknown[]>> {
  const db = app.mongo.db;
  if (!db) throw new Error('MongoDB is not connected');
  const snapshot: Record<string, unknown[]> = {};
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  for (const { name } of collections.sort((a, b) => a.name.localeCompare(b.name))) {
    if (VOLATILE.has(name)) continue;
    snapshot[name] = await db.collection(name).find({}).sort({ _id: 1 }).toArray();
  }
  // A group's list-order stamp is written up to a second after its last message (group-activity.ts).
  return JSON.parse(JSON.stringify(snapshot), (name, value) =>
    name === 'lastActivityAt' ? undefined : value,
  ) as Record<string, unknown[]>;
}

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** One attempt on someone else's resource. */
export interface Attempt {
  method: Method;
  url: string;
  payload?: object;
}

export function attempt(app: FastifyInstance, cookie: string, { method, url, payload }: Attempt) {
  return app.inject({
    method,
    url,
    headers: headers(cookie),
    ...(payload ? { payload } : {}),
  });
}

/**
 * Each attempt is refused with one of `statuses` (404 by default: someone else's resource looks
 * exactly like a missing one), and the response carries no data, only an error.
 */
export async function expectRefused(
  app: FastifyInstance,
  cookie: string,
  attempts: Attempt[],
  statuses: number[] = [404],
): Promise<void> {
  const results: string[] = [];
  for (const one of attempts) {
    const response: LightMyRequestResponse = await attempt(app, cookie, one);
    const ok = statuses.includes(response.statusCode) && typeof response.json().code === 'string';
    if (!ok) results.push(`${one.method} ${one.url} → ${response.statusCode} ${response.body}`);
  }
  expect(results, 'these attempts were not refused').toEqual([]);
}
