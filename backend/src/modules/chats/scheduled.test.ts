import {
  chatResponseSchema,
  messageSchema,
  okResponseSchema,
  SCHEDULED_MAX,
  scheduledListResponseSchema,
  scheduledResponseSchema,
} from '@zuvo/protocol';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { mediaClient, PDF } from '../../../test/media-helpers.ts';
import {
  closeAllSockets,
  connect,
  listen,
  record,
  waitUntil,
} from '../../../test/realtime-helpers.ts';
import { oid } from '../../chats/chats.service.ts';
import { scheduledModels, uuidv7 } from '../../chats/scheduled.service.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call, group, history } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
});
afterAll(async () => {
  closeAllSockets();
  await built.cleanup();
});

const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
const direct = async (who: Person, other: Person) =>
  chatResponseSchema.parse(
    (await call(who, 'POST', '/v1/chats/direct', { userId: other.id })).json(),
  ).chat.id;
const schedule = (who: Person | null, body: Record<string, unknown>) =>
  call(who, 'POST', '/v1/me/scheduled', { sendAt: inMinutes(60), ...body });
const created = async (who: Person, body: Record<string, unknown>) => {
  const response = await schedule(who, body);
  expect(response.statusCode).toBe(200);
  return scheduledResponseSchema.parse(response.json()).item;
};
const list = async (who: Person, chatId?: string) => {
  const response = await call(who, 'GET', `/v1/me/scheduled${chatId ? `?chatId=${chatId}` : ''}`);
  expect(response.statusCode).toBe(200);
  return scheduledListResponseSchema.parse(response.json()).items;
};

describe('scheduling', () => {
  it('stores text for later, lists mine soonest first, and tells my other devices', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const socket = await connect(await listen(app()), asha.cookie);
    const events = record(socket, 'scheduled:updated');
    const later = await created(asha, { chatId, text: 'later', sendAt: inMinutes(120) });
    const sooner = await created(asha, { chatId, text: 'sooner', sendAt: inMinutes(30) });
    expect(later).toMatchObject({ status: 'pending', failure: null, messageId: null, media: null });
    expect((await list(asha)).map((item) => item.text)).toEqual(['sooner', 'later']);
    expect((await list(asha, chatId)).map((item) => item.id)).toEqual([sooner.id, later.id]);
    expect(await list(bharat)).toEqual([]);
    expect(await history(bharat, chatId)).toEqual([]);
    await waitUntil(() => expect(events).toHaveLength(2));
    expect(events[0]).toEqual({ chatId, failed: null });
    socket.close();
  });

  it('edits text and time while waiting, and cancels', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const item = await created(asha, { chatId, text: 'draft' });
    const sendAt = inMinutes(90);
    const edited = await call(asha, 'PATCH', `/v1/me/scheduled/${item.id}`, {
      text: 'final',
      sendAt,
    });
    expect(edited.statusCode).toBe(200);
    expect(scheduledResponseSchema.parse(edited.json()).item).toMatchObject({
      text: 'final',
      sendAt: new Date(sendAt).toISOString(),
    });
    const empty = await call(asha, 'PATCH', `/v1/me/scheduled/${item.id}`, { text: '  ' });
    expect(empty.statusCode).toBe(400);
    const removed = await call(asha, 'DELETE', `/v1/me/scheduled/${item.id}`);
    expect(okResponseSchema.parse(removed.json()).ok).toBe(true);
    expect(await list(asha)).toEqual([]);
    expect((await call(asha, 'DELETE', `/v1/me/scheduled/${item.id}`)).statusCode).toBe(404);
  });

  it('sends now: the message arrives and the item says what it became', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const item = await created(asha, { chatId, text: 'right away' });
    const response = await call(asha, 'POST', `/v1/me/scheduled/${item.id}/send-now`);
    expect(response.statusCode).toBe(200);
    const sent = scheduledResponseSchema.parse(response.json()).item;
    expect(sent.status).toBe('sent');
    const [message] = await history(bharat, chatId);
    expect(message).toMatchObject({ id: sent.messageId, text: 'right away', senderId: asha.id });
    expect(await list(asha)).toEqual([]);
    // Sent: no longer waiting, so it cannot be changed, sent again or cancelled.
    const url = `/v1/me/scheduled/${item.id}`;
    expect((await call(asha, 'PATCH', url, { text: 'x' })).statusCode).toBe(409);
    expect((await call(asha, 'POST', `${url}/send-now`)).statusCode).toBe(409);
    expect((await call(asha, 'DELETE', url)).statusCode).toBe(409);
  });

  it('schedules a finished upload of mine with a caption, once', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const mediaId = await mediaClient(app()).ready(asha, 'document', 'plan.pdf', PDF);
    const item = await created(asha, { chatId, mediaId, text: 'the plan' });
    expect(item.media).toMatchObject({ id: mediaId, kind: 'document', name: 'plan.pdf' });
    const again = await schedule(asha, { chatId, mediaId });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('MEDIA_NOT_ATTACHABLE');
    const theirs = await mediaClient(app()).ready(bharat, 'document', 'b.pdf', PDF);
    expect((await schedule(asha, { chatId, mediaId: theirs })).statusCode).toBe(409);
    const response = await call(asha, 'POST', `/v1/me/scheduled/${item.id}/send-now`);
    expect(scheduledResponseSchema.parse(response.json()).item.status).toBe('sent');
    const [message] = messageSchema.array().parse(await history(bharat, chatId));
    expect(message).toMatchObject({ type: 'document', text: 'the plan' });
  });

  it('keeps mentions for a group, checked like a sent message', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await group(asha, [bharat]);
    const text = '@bharat look';
    const mentions = [{ userId: bharat.id, offset: 0, length: 7 }];
    const item = await created(asha, { chatId, text, mentions });
    const outsider = await person();
    const bad = [{ userId: outsider.id, offset: 0, length: 7 }];
    expect((await schedule(asha, { chatId, text, mentions: bad })).statusCode).toBe(400);
    await call(asha, 'POST', `/v1/me/scheduled/${item.id}/send-now`);
    const [message] = (await history(bharat, chatId)).filter((m) => !m.system);
    expect(message?.mentions?.map((mention) => mention.userId)).toEqual([bharat.id]);
  });
});

describe('refusals', () => {
  it('rejects a past or too-near time, too far ahead, nothing to send, and bad ids', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const soon = new Date(Date.now() + 5_000).toISOString();
    expect((await schedule(asha, { chatId, text: 'x', sendAt: soon })).statusCode).toBe(400);
    expect((await schedule(asha, { chatId, text: 'x', sendAt: inMinutes(-5) })).statusCode).toBe(
      400,
    );
    const far = inMinutes(366 * 24 * 60);
    expect((await schedule(asha, { chatId, text: 'x', sendAt: far })).statusCode).toBe(400);
    expect((await schedule(asha, { chatId, text: '   ' })).statusCode).toBe(400);
    expect((await schedule(asha, { chatId: 'nope', text: 'x' })).statusCode).toBe(400);
    expect((await schedule(asha, { chatId, text: 'x', sendAt: 'tomorrow' })).statusCode).toBe(400);
    const item = await created(asha, { chatId, text: 'ok' });
    const url = `/v1/me/scheduled/${item.id}`;
    expect((await call(asha, 'PATCH', url, {})).statusCode).toBe(400);
    expect((await call(asha, 'PATCH', url, { sendAt: inMinutes(-1) })).statusCode).toBe(400);
    expect((await call(asha, 'GET', '/v1/me/scheduled?chatId=bad')).statusCode).toBe(400);
  });

  it('only in a chat I am in, and only for the signed in', async () => {
    const [asha, bharat, outsider] = [await person(), await person(), await person()];
    const chatId = await direct(asha, bharat);
    expect((await schedule(outsider, { chatId, text: 'hi' })).statusCode).toBe(404);
    expect((await schedule(null, { chatId, text: 'hi' })).statusCode).toBe(401);
    expect((await call(null, 'GET', '/v1/me/scheduled')).statusCode).toBe(401);
  });

  it("never lets anyone see or touch someone else's", async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const item = await created(asha, { chatId, text: 'mine' });
    const url = `/v1/me/scheduled/${item.id}`;
    expect(await list(bharat, chatId)).toEqual([]);
    expect((await call(bharat, 'PATCH', url, { text: 'theirs' })).statusCode).toBe(404);
    expect((await call(bharat, 'POST', `${url}/send-now`)).statusCode).toBe(404);
    expect((await call(bharat, 'DELETE', url)).statusCode).toBe(404);
    expect((await call(null, 'DELETE', url)).statusCode).toBe(401);
    expect((await list(asha))[0]).toMatchObject({ id: item.id, text: 'mine', status: 'pending' });
  });

  it(`allows ${SCHEDULED_MAX} waiting at once`, async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const now = new Date();
    await scheduledModels(app()).Scheduled.insertMany(
      Array.from({ length: SCHEDULED_MAX }, () => ({
        _id: new Types.ObjectId(),
        userId: oid(asha.id),
        chatId: oid(chatId),
        text: 'waiting',
        sendAt: new Date(Date.now() + 3600_000),
        clientMsgId: uuidv7(),
        createdAt: now,
        updatedAt: now,
      })),
    );
    const refused = await schedule(asha, { chatId, text: 'one more' });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe('SCHEDULED_LIMIT_REACHED');
    // Someone else's count is their own.
    expect((await schedule(bharat, { chatId, text: 'mine' })).statusCode).toBe(200);
  });
});
