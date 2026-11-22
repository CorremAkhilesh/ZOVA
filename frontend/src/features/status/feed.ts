import {
  type CreateStatusBody,
  okResponseSchema,
  type Status,
  type StatusFeedResponse,
  type StatusPrivacy,
  statusFeedResponseSchema,
  statusPrivacyResponseSchema,
  statusResponseSchema,
  statusViewersResponseSchema,
} from '@zuvo/protocol';
import { useLocalDb } from '@/features/chats/queries';
import type { LocalDb } from '@/features/sync/local-db';
import { useLive } from '@/features/sync/use-live';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api-client';

export const statusApi = {
  feed: () => apiGet('/v1/statuses', statusFeedResponseSchema),
  create: (body: CreateStatusBody) => apiPost('/v1/statuses', body, statusResponseSchema),
  remove: (id: string) => apiDelete(`/v1/statuses/${id}`, okResponseSchema),
  view: (id: string, reaction?: string | null) =>
    apiPost(
      `/v1/statuses/${id}/view`,
      reaction === undefined ? {} : { reaction },
      okResponseSchema,
    ),
  viewers: (id: string) => apiGet(`/v1/statuses/${id}/viewers`, statusViewersResponseSchema),
  mute: (userId: string, muted: boolean) =>
    muted
      ? apiPut(`/v1/statuses/mutes/${userId}`, undefined, okResponseSchema)
      : apiDelete(`/v1/statuses/mutes/${userId}`, okResponseSchema),
  privacy: () => apiGet('/v1/me/status-privacy', statusPrivacyResponseSchema),
  setPrivacy: (privacy: StatusPrivacy) =>
    apiPut('/v1/me/status-privacy', privacy, statusPrivacyResponseSchema),
};

/** The feed, kept on this device (offline first) in the meta table. */
const FEED_KEY = 'statusFeed';

const running = (status: Status, now: number) => Date.parse(status.expiresAt) > now;

/** Drops what has expired: a status lasts 24 hours wherever it is shown. */
export function withoutExpired(feed: StatusFeedResponse, now = Date.now()): StatusFeedResponse {
  return {
    mine: feed.mine.filter((status) => running(status, now)),
    people: feed.people
      .map((person) => ({
        ...person,
        statuses: person.statuses.filter((status) => running(status, now)),
      }))
      .filter((person) => person.statuses.length > 0),
  };
}

async function storeFeed(db: LocalDb, feed: StatusFeedResponse) {
  await db.meta.put({ key: FEED_KEY, value: JSON.stringify(withoutExpired(feed)) });
}

/**
 * Signed out (or the account changed) while the feed was on its way: this device's database is
 * closed for good and nothing is kept. Anything else is a real failure and is reported.
 */
export function ignoreClosed(error: unknown) {
  if ((error as { name?: string } | null)?.name === 'DatabaseClosedError') return;
  console.error('[status] could not keep the feed', error);
}

let inFlight: Promise<void> | null = null;
let again = false;

/**
 * Fetches the feed and keeps it on this device. Called when the Status tab opens, on `status:changed`,
 * on reconnect, and when the sync log says statuses changed. Calls during a fetch fetch once more.
 */
export function refreshStatuses(db: LocalDb): Promise<void> {
  if (inFlight) {
    again = true;
    return inFlight;
  }
  inFlight = (async () => {
    do {
      again = false;
      const feed = await statusApi.feed().catch(() => null);
      if (feed) await storeFeed(db, feed).catch(ignoreClosed);
    } while (again);
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** After I post, delete or view: change the copy on this device at once, then ask the server. */
export async function patchFeed(
  db: LocalDb,
  change: (feed: StatusFeedResponse) => StatusFeedResponse,
): Promise<void> {
  const row = await db.meta.get(FEED_KEY);
  const parsed = row ? statusFeedResponseSchema.safeParse(JSON.parse(row.value)) : null;
  if (parsed?.success) await storeFeed(db, change(parsed.data));
}

/** The feed as this device has it, without anything expired. Undefined until read; null if never fetched. */
export function useStatusFeed(): StatusFeedResponse | null | undefined {
  const db = useLocalDb();
  return useLive(async () => {
    if (!db) return undefined;
    const row = await db.meta.get(FEED_KEY);
    if (!row) return null;
    const parsed = statusFeedResponseSchema.safeParse(JSON.parse(row.value));
    return parsed.success ? withoutExpired(parsed.data) : null;
  }, [db]);
}
