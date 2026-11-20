import { statusResponseSchema } from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { mediaClient, png } from '../../../test/media-helpers.ts';
import {
  closeAllSockets,
  connect,
  listen,
  record,
  waitUntil,
} from '../../../test/realtime-helpers.ts';
import { chatModels, oid } from '../../chats/chats.service.ts';
import { cleanupDeletedMedia } from '../../media/media-access.ts';

// Deleting my photo status: everyone who could see it (and my other devices) hear at once, and the
// file goes with the next media cleanup, not after the status would have ended.

let built: Awaited<ReturnType<typeof buildTestApp>>;
let url = '';
const app = () => built.app;
const { person, call } = groupClient(app);

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
  url = await listen(built.app);
});
afterAll(async () => {
  closeAllSockets();
  await built.cleanup();
});

describe('deleting a photo status', () => {
  it('tells viewers and my other devices at once, and its file is removed', async () => {
    const [asha, bharat] = [await person(), await person()];
    const mediaId = await mediaClient(app()).ready(asha, 'image', 'p.png', await png());
    const posted = await call(asha, 'POST', '/v1/statuses', { kind: 'image', mediaId });
    const status = statusResponseSchema.parse(posted.json()).status;

    const heardByBharat = record(await connect(url, bharat.cookie), 'status:changed');
    const heardByMyLaptop = record(await connect(url, asha.cookie), 'status:changed');
    expect((await call(asha, 'DELETE', `/v1/statuses/${status.id}`)).statusCode).toBe(200);
    await waitUntil(() => expect(heardByBharat.length).toBeGreaterThan(0));
    await waitUntil(() => expect(heardByMyLaptop.length).toBeGreaterThan(0));

    // Gone for Bharat: not in the feed, and the file no longer opens.
    const feed = (await call(bharat, 'GET', '/v1/statuses')).json();
    expect(JSON.stringify(feed)).not.toContain(status.id);
    expect((await mediaClient(app()).content(bharat, mediaId)).statusCode).toBe(404);
    await cleanupDeletedMedia(app(), 200, new Date(Date.now() + 1000));
    expect(await chatModels(app()).Media.exists({ _id: oid(mediaId) })).toBeNull();
  });
});
