import { afterEach, describe, expect, it, vi } from 'vitest';
import { getUserDb } from '@/features/sync/local-db';
import { useSyncStore } from '@/features/sync/store';
import { HttpResponse, http, server } from '@/test/msw';
import { markViewed } from './actions';
import { statusFixture } from './status-test-fixtures';

afterEach(() => {
  useSyncStore.setState({ client: null });
});

describe('marking a status as viewed', () => {
  it('a database closed meanwhile (sign-out with the viewer open) is no unhandled error', async () => {
    server.use(http.post('*/v1/statuses/:id/view', () => HttpResponse.json({ ok: true })));
    const db = getUserDb('someone-else');
    await db.open();
    useSyncStore.setState({ client: { db } as never });
    // Signed out: this device's database is closed for good.
    db.close({ disableAutoOpen: true });
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    markViewed(statusFixture('riya', { text: 'hello', viewed: false }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
