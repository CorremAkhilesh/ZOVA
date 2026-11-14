import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { headers } from '../../test/auth-helpers.ts';
import { groupClient } from '../../test/group-helpers.ts';
import { buildTestApp } from '../../test/helpers.ts';
import { mediaClient, PDF } from '../../test/media-helpers.ts';
import { closeAllSockets, connect, listen, uuidv7 } from '../../test/realtime-helpers.ts';
import { sendMessage } from '../chats/messages.service.ts';
import { dbSnapshot, expectRefused } from './idor-helpers.ts';

/**
 * IDOR: uploads (state, chunks, poster, complete, cancel), downloads (session, signed links,
 * thumbnails) and attaching someone else's file to my own message or scheduled message.
 */
/** Signing several people in through the real OTP flow is slow on a busy machine. */
const SETUP_TIMEOUT = 600_000;
let built: Awaited<ReturnType<typeof buildTestApp>>;
let url = '';
const app = () => built.app;
const { person, call } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;
let asha: Person;
let bharat: Person;
let chetan: Person;
let chatId = '';
let ownChatId = '';
/** Sent to Bharat. */
let sentId = '';
/** Still uploading. */
let pendingId = '';
/** Uploaded, never sent. */
let readyId = '';

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
  url = await listen(built.app);
  [asha, bharat, chetan] = [await person(), await person(), await person()];
  chatId = (await call(asha, 'POST', '/v1/chats/direct', { userId: bharat.id })).json().chat.id;
  ownChatId = (await call(chetan, 'POST', '/v1/chats/direct', { userId: asha.id })).json().chat.id;
  const media = mediaClient(app());
  sentId = await media.ready(asha, 'document', 'secret.pdf', PDF);
  await sendMessage(app(), { userId: asha.id, chatId, clientMsgId: uuidv7(), mediaId: sentId });
  readyId = await media.ready(asha, 'document', 'draft.pdf', PDF);
  pendingId = (
    await media.start(asha, { kind: 'document', name: 'big.pdf', mime: 'x', size: 5000 })
  ).json().uploadId;
}, SETUP_TIMEOUT);
afterAll(async () => {
  closeAllSockets();
  await built.cleanup();
});

describe('someone else’s files', () => {
  it('cannot be read, resumed, finished, cancelled or given a poster, and nothing changes', async () => {
    const before = await dbSnapshot(app());
    for (const id of [sentId, readyId, pendingId]) {
      await expectRefused(app(), chetan.cookie, [
        { method: 'GET', url: `/v1/uploads/${id}` },
        { method: 'POST', url: `/v1/uploads/${id}/complete` },
        { method: 'DELETE', url: `/v1/uploads/${id}` },
        { method: 'GET', url: `/v1/media/${id}/link` },
        { method: 'GET', url: `/v1/media/${id}/content` },
        { method: 'GET', url: `/v1/media/${id}/content?variant=thumb` },
      ]);
      const chunk = await app().inject({
        method: 'PATCH',
        url: `/v1/uploads/${id}`,
        headers: {
          ...headers(chetan.cookie),
          'content-type': 'application/offset+octet-stream',
          'upload-offset': '0',
        },
        payload: randomBytes(16),
      });
      expect(chunk.statusCode).toBe(404);
      const poster = await app().inject({
        method: 'PUT',
        url: `/v1/uploads/${id}/poster`,
        headers: { ...headers(chetan.cookie), 'content-type': 'application/octet-stream' },
        payload: randomBytes(16),
      });
      expect([404, 415]).toContain(poster.statusCode);
    }
    expect(await dbSnapshot(app())).toEqual(before);
  });

  it('a signed link only opens the file it was made for, and cannot be forged', async () => {
    const link = await app().inject({
      method: 'GET',
      url: `/v1/media/${sentId}/link`,
      headers: headers(bharat.cookie),
    });
    expect(link.statusCode).toBe(200);
    const signed = new URL(link.json().url as string, 'http://x');
    const forged = `/v1/media/${sentId}/content?exp=${signed.searchParams.get('exp')}&sig=${'A'.repeat(43)}`;
    const swapped = `/v1/media/${readyId}/content${signed.search}`;
    for (const target of [forged, swapped]) {
      const response = await app().inject({ method: 'GET', url: target });
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('MEDIA_LINK_INVALID');
    }
  });

  it('cannot be attached to my own message or scheduled message', async () => {
    const socket = await connect(url, chetan.cookie);
    const before = await dbSnapshot(app());
    for (const mediaId of [sentId, readyId]) {
      const ack = await socket.timeout(30_000).emitWithAck('message:send', {
        chatId: ownChatId,
        clientMsgId: uuidv7(),
        mediaIds: [mediaId],
      });
      expect(ack.ok).toBe(false);
      const scheduled = await call(chetan, 'POST', '/v1/me/scheduled', {
        chatId: ownChatId,
        mediaId,
        sendAt: new Date(Date.now() + 3_600_000).toISOString(),
      });
      expect([404, 409]).toContain(scheduled.statusCode);
    }
    expect(await dbSnapshot(app())).toEqual(before);
  });

  it('the chat gallery is for members only', async () => {
    await expectRefused(app(), chetan.cookie, [
      { method: 'GET', url: `/v1/chats/${chatId}/media?tab=media` },
    ]);
    const member = await call(bharat, 'GET', `/v1/chats/${chatId}/media?tab=docs`);
    expect(member.statusCode).toBe(200);
    expect(member.body).toContain(sentId);
  });
});
