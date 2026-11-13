import { chatResponseSchema, scheduledResponseSchema } from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectIndexedQuery } from '../../test/expect-indexed-query.ts';
import { groupClient, texts } from '../../test/group-helpers.ts';
import { buildTestApp } from '../../test/helpers.ts';
import { mediaClient, PDF } from '../../test/media-helpers.ts';
import {
  closeAllSockets,
  connect,
  listen,
  record,
  waitUntil,
} from '../../test/realtime-helpers.ts';
import { cleanupOrphans } from '../media/media.service.ts';
import { usersModel } from '../users/user-record.ts';
import { chatModels, oid } from './chats.service.ts';
import { scheduledModels } from './scheduled.service.ts';
import { claimDue, STUCK_MS, sweepScheduled } from './scheduled-runner.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
let url = '';
const app = () => built.app;
const { person, call, group, history } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
  url = await listen(built.app);
});
afterAll(async () => {
  closeAllSockets();
  await built.cleanup();
});

const HOUR = 3600_000;
const direct = async (who: Person, other: Person) =>
  chatResponseSchema.parse(
    (await call(who, 'POST', '/v1/chats/direct', { userId: other.id })).json(),
  ).chat.id;
async function scheduled(who: Person, chatId: string, extra: Record<string, unknown> = {}) {
  const sendAt = new Date(Date.now() + HOUR).toISOString();
  const response = await call(who, 'POST', '/v1/me/scheduled', { chatId, sendAt, ...extra });
  expect(response.statusCode).toBe(200);
  return scheduledResponseSchema.parse(response.json()).item;
}
const stored = (id: string) => scheduledModels(app()).Scheduled.findById(id).lean();
const later = (ms = HOUR + 60_000) => new Date(Date.now() + ms);

describe('sending at the time', () => {
  it('sends nothing early, then exactly once when due', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const item = await scheduled(asha, chatId, { text: 'happy birthday' });
    await sweepScheduled(app(), later(HOUR - 60_000));
    expect((await stored(item.id))?.status).toBe('pending');
    await sweepScheduled(app(), later());
    await sweepScheduled(app(), later());
    const doc = await stored(item.id);
    expect(doc).toMatchObject({ status: 'sent', failure: null });
    expect(texts(await history(bharat, chatId))).toEqual(['happy birthday']);
    expect((await history(bharat, chatId))[0]?.id).toBe(doc?.messageId?.toString());
  });

  it('retries a send stuck for over 2 minutes, still storing the message once', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const item = await scheduled(asha, chatId, { text: 'once' });
    const due = later();
    const first = await claimDue(app(), item.id, due);
    expect(first?.status).toBe('sending');
    // Claimed again too soon: nothing; another process holds it.
    expect(await claimDue(app(), item.id, due)).toBeNull();
    // The first send got through, then the process died before recording it.
    const { sendMessage } = await import('./messages.service.ts');
    await sendMessage(app(), {
      userId: asha.id,
      chatId,
      clientMsgId: first?.clientMsgId ?? '',
      text: 'once',
    });
    await sweepScheduled(app(), new Date(due.getTime() + STUCK_MS + 1000));
    expect((await stored(item.id))?.status).toBe('sent');
    expect(texts(await history(bharat, chatId))).toEqual(['once']);
  });
});

describe('the rules, checked again at send time', () => {
  async function expectFailure(who: Person, id: string, reason: string) {
    const socket = await connect(url, who.cookie);
    const events = record(socket, 'scheduled:updated');
    await sweepScheduled(app(), later());
    expect(await stored(id)).toMatchObject({ status: 'failed', failure: reason, messageId: null });
    await waitUntil(() =>
      expect(
        events.some((event) => event.failed?.id === id && event.failed.reason === reason),
      ).toBe(true),
    );
    socket.close();
  }

  it('fails when I was removed from the group', async () => {
    const [owner, asha] = [await person(), await person()];
    const chatId = await group(owner, [asha]);
    const item = await scheduled(asha, chatId, { text: 'still here?' });
    await call(owner, 'DELETE', `/v1/chats/${chatId}/members/${asha.id}`);
    await expectFailure(asha, item.id, 'not_member');
  });

  it('fails when they blocked me', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const item = await scheduled(asha, chatId, { text: 'hello?' });
    expect((await call(bharat, 'PUT', `/v1/me/blocks/${asha.id}`)).statusCode).toBe(200);
    await expectFailure(asha, item.id, 'blocked');
  });

  it('fails when only admins may now send', async () => {
    const [owner, asha] = [await person(), await person()];
    const chatId = await group(owner, [asha]);
    const item = await scheduled(asha, chatId, { text: 'announcement?' });
    await call(owner, 'PUT', `/v1/chats/${chatId}/group/settings`, { sendMessages: 'admins' });
    await expectFailure(asha, item.id, 'admins_only');
  });

  it('fails when my account was deactivated, and when theirs was', async () => {
    const [asha, bharat, chitra] = [await person(), await person(), await person()];
    const mine = await scheduled(asha, await direct(asha, bharat), { text: 'from me' });
    const theirs = await scheduled(chitra, await direct(chitra, bharat), { text: 'to them' });
    await usersModel(app()).updateOne({ _id: oid(asha.id) }, { $set: { status: 'deactivated' } });
    await usersModel(app()).updateOne({ _id: oid(bharat.id) }, { $set: { status: 'deactivated' } });
    await sweepScheduled(app(), later());
    expect(await stored(mine.id)).toMatchObject({
      status: 'failed',
      failure: 'account_deactivated',
    });
    expect(await stored(theirs.id)).toMatchObject({
      status: 'failed',
      failure: 'account_deactivated',
    });
  });

  it('a failed one can be sent by hand once the reason is gone, or removed', async () => {
    const [owner, asha] = [await person(), await person()];
    const chatId = await group(owner, [asha]);
    const item = await scheduled(asha, chatId, { text: 'try again' });
    await call(owner, 'PUT', `/v1/chats/${chatId}/group/settings`, { sendMessages: 'admins' });
    await sweepScheduled(app(), later());
    await call(owner, 'PUT', `/v1/chats/${chatId}/group/settings`, { sendMessages: 'all' });
    const retried = await call(asha, 'POST', `/v1/me/scheduled/${item.id}/send-now`);
    expect(scheduledResponseSchema.parse(retried.json()).item.status).toBe('sent');
  });
});

describe('files', () => {
  it('an upload waiting in a scheduled message is not an orphan; once sent, it is the message’s', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const mediaId = await mediaClient(app()).ready(asha, 'document', 'later.pdf', PDF);
    const item = await scheduled(asha, chatId, { mediaId });
    const { Media } = chatModels(app());
    await Media.updateOne(
      { _id: oid(mediaId) },
      { $set: { createdAt: new Date(Date.now() - 3 * 86_400_000) } },
    );
    await cleanupOrphans(app());
    expect(await Media.exists({ _id: oid(mediaId) })).toBeTruthy();
    await sweepScheduled(app(), later());
    expect((await stored(item.id))?.status).toBe('sent');
    expect((await Media.findById(mediaId).lean())?.messageId).toBeTruthy();
  });

  it('a cancelled one lets the cleanup take the upload; a deleted upload fails the send', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const media = mediaClient(app());
    const kept = await media.ready(asha, 'document', 'a.pdf', PDF);
    const cancelled = await scheduled(asha, chatId, { mediaId: kept });
    await call(asha, 'DELETE', `/v1/me/scheduled/${cancelled.id}`);
    const { Media } = chatModels(app());
    await Media.updateOne(
      { _id: oid(kept) },
      { $set: { createdAt: new Date(Date.now() - 3 * 86_400_000) } },
    );
    await cleanupOrphans(app());
    expect(await Media.exists({ _id: oid(kept) })).toBeNull();
    const gone = await media.ready(asha, 'document', 'b.pdf', PDF);
    const item = await scheduled(asha, chatId, { mediaId: gone });
    await call(asha, 'DELETE', `/v1/uploads/${gone}`);
    await sweepScheduled(app(), later());
    expect(await stored(item.id)).toMatchObject({ status: 'failed', failure: 'media_unavailable' });
  });
});

describe('queries', () => {
  it('each one uses an index', async () => {
    const { Scheduled } = scheduledModels(app());
    const now = new Date();
    const userId = oid('0123456789abcdef01234567');
    await expectIndexedQuery(
      Scheduled.find({ status: 'pending', sendAt: { $lte: now } }).sort({ sendAt: 1 }),
    );
    await expectIndexedQuery(
      Scheduled.find({ status: 'sending', sendAt: { $lte: now }, claimedAt: { $lte: now } }),
    );
    await expectIndexedQuery(
      Scheduled.find({
        userId,
        status: { $in: ['pending', 'sending', 'failed'] },
        chatId: userId,
      }).sort({ sendAt: 1 }),
    );
    await expectIndexedQuery(Scheduled.find({ userId, status: { $in: ['pending', 'sending'] } }));
    await expectIndexedQuery(
      Scheduled.find({ mediaId: { $in: [userId] }, status: { $in: ['pending', 'sending'] } }),
    );
    await expectIndexedQuery(Scheduled.findOne({ _id: userId, userId }));
  });
});
