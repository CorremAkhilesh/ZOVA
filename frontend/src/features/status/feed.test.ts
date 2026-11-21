import { describe, expect, it, vi } from 'vitest';
import { getUserDb } from '@/features/sync/local-db';
import { ME_ID } from '@/test/chat-fixtures';
import { refreshStatuses, statusApi } from './feed';

describe('refreshing the status feed', () => {
  it('a database closed while the feed was on its way (sign-out) is no error', async () => {
    const db = getUserDb(ME_ID);
    await db.open();
    let arrive: (feed: Awaited<ReturnType<typeof statusApi.feed>>) => void = () => undefined;
    const fetching = vi
      .spyOn(statusApi, 'feed')
      .mockReturnValue(new Promise((resolve) => (arrive = resolve)));
    const refresh = refreshStatuses(db);
    // Signed out meanwhile: the database closes for good before the answer arrives.
    db.close({ disableAutoOpen: true });
    arrive({ mine: [], people: [] });
    await expect(refresh).resolves.toBeUndefined();
    fetching.mockRestore();
  });
});
