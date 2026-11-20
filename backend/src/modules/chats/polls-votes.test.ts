import { chatResponseSchema, pollMessageResponseSchema, pushPayloadSchema } from '@zuvo/protocol';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectIndexedQuery } from '../../../test/expect-indexed-query.ts';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { pushesTo, subscribeDevice } from '../../../test/push-helpers.ts';
import { signedIn, uuidv7, waitUntil } from '../../../test/realtime-helpers.ts';
import { chatModels } from '../../chats/chats.service.ts';
import { sendMessage } from '../../chats/messages.service.ts';
import { notifyPollVote } from '../../chats/poll-push.ts';

// Polls, second round: when each person voted ("View votes"), who may close a poll (its sender or a
// group admin), hidden admins' votes, and the quiet "X voted in your poll" for the poll's sender.

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call, group, setRole } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
});
afterAll(async () => {
  await built.cleanup();
});

const lunch = { question: 'Lunch?', options: ['Pizza', 'Dosa'], multiple: false };
const poll = async (who: Person, chatId: string) =>
  (await sendMessage(app(), { userId: who.id, chatId, clientMsgId: uuidv7(), poll: lunch }))
    .message;
const vote = (who: Person, chatId: string, messageId: string, optionIds: string[]) =>
  call(who, 'PUT', `/v1/chats/${chatId}/messages/${messageId}/vote`, { optionIds });
const voted = async (who: Person, chatId: string, messageId: string, optionIds: string[]) =>
  pollMessageResponseSchema.parse((await vote(who, chatId, messageId, optionIds)).json()).message
    .poll;
const asSeenBy = async (who: Person, chatId: string, messageId: string) => {
  const items = (await call(who, 'GET', `/v1/chats/${chatId}/messages`)).json().items as Array<{
    id: string;
    poll?: {
      options: Array<{ id: string; voterIds: string[] }>;
      votedAt?: Record<string, string>;
    };
  }>;
  return items.find((item) => item.id === messageId)?.poll;
};
const close = (who: Person, chatId: string, messageId: string) =>
  call(who, 'POST', `/v1/chats/${chatId}/messages/${messageId}/close-poll`);
async function storedMessage(messageId: string) {
  const found = await chatModels(app()).Message.findById(messageId).lean();
  if (!found) throw new Error('no message');
  return found;
}

describe('vote times', () => {
  it('each vote has its time; changing it moves the time, taking it back removes it', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await group(asha, [bharat]);
    const message = await poll(asha, chatId);
    const at = (await voted(bharat, chatId, message.id, ['0']))?.votedAt?.[bharat.id] ?? '';
    expect(at).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const changed = (await voted(bharat, chatId, message.id, ['1']))?.votedAt?.[bharat.id] ?? '';
    expect(Date.parse(changed)).toBeGreaterThan(Date.parse(at));
    const removed = await voted(bharat, chatId, message.id, []);
    expect(removed?.votedAt?.[bharat.id]).toBeUndefined();
    expect((await asSeenBy(asha, chatId, message.id))?.votedAt).toEqual({});
  });
});

describe('closing', () => {
  it('its sender or a group admin; never another member, nor the other person in a 1:1 chat', async () => {
    const [asha, bharat, chitra] = [await person(), await person(), await person()];
    const chatId = await group(asha, [bharat, chitra]);
    const first = await poll(bharat, chatId);
    expect((await close(chitra, chatId, first.id)).statusCode).toBe(403);
    // Asha owns the group: she may close Bharat's poll.
    expect((await close(asha, chatId, first.id)).statusCode).toBe(200);
    const second = await poll(bharat, chatId);
    await setRole(asha, chatId, chitra, 'admin');
    expect((await close(chitra, chatId, second.id)).statusCode).toBe(200);
    const directId = chatResponseSchema.parse(
      (await call(asha, 'POST', '/v1/chats/direct', { userId: bharat.id })).json(),
    ).chat.id;
    const third = await poll(asha, directId);
    expect((await close(bharat, directId, third.id)).statusCode).toBe(403);
  });
});

describe('hidden admins', () => {
  it('a hidden admin’s vote is seen by that admin only', async () => {
    const admin = await signedIn(app(), 'admin@corremadvisory.com');
    const [asha, bharat] = [await person(), await person()];
    const chatId = await group(admin, [asha, bharat]);
    const message = await poll(asha, chatId);
    expect((await vote(admin, chatId, message.id, ['0'])).statusCode).toBe(200);
    expect((await vote(bharat, chatId, message.id, ['0'])).statusCode).toBe(200);
    const seen = await asSeenBy(asha, chatId, message.id);
    expect(seen?.options[0]?.voterIds).toEqual([bharat.id]);
    expect(Object.keys(seen?.votedAt ?? {})).toEqual([bharat.id]);
    const own = await asSeenBy(admin, chatId, message.id);
    expect(own?.options[0]?.voterIds.sort()).toEqual([admin.id, bharat.id].sort());
  });
});

describe('"X voted in your poll"', () => {
  it('a quiet notification for the sender, one per poll; none for taking a vote back', async () => {
    const [asha, bharat] = [await person(), await person()];
    await subscribeDevice(app(), asha.cookie);
    const chatId = await group(asha, [bharat]);
    const message = await poll(asha, chatId);
    await vote(bharat, chatId, message.id, ['1']);
    await waitUntil(() => expect(pushesTo(app(), asha.id)).toHaveLength(1));
    const payload = pushPayloadSchema.parse(pushesTo(app(), asha.id)[0]?.payload);
    expect(payload).toMatchObject({ kind: 'poll', silent: true, tag: `poll:${message.id}` });
    expect(payload.title).toMatch(/voted in your poll/);
    await vote(bharat, chatId, message.id, []);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(pushesTo(app(), asha.id)).toHaveLength(1);
    expect(pushesTo(app(), bharat.id)).toHaveLength(0);
  });

  it('not in a muted chat, not with the setting off, not for my own vote', async () => {
    const [asha, bharat] = [await person(), await person()];
    await subscribeDevice(app(), asha.cookie);
    const chatId = await group(asha, [bharat]);
    const message = await poll(asha, chatId);
    await vote(bharat, chatId, message.id, ['0']);
    const stored = await storedMessage(message.id);
    expect(await notifyPollVote(app(), { message: stored, voterId: asha.id })).toBe('own');
    await call(asha, 'PUT', '/v1/me/push/settings', { pollVotes: false });
    expect(await notifyPollVote(app(), { message: stored, voterId: bharat.id })).toBe('off');
    await call(asha, 'PUT', '/v1/me/push/settings', { pollVotes: true });
    await chatModels(app()).ChatMember.updateOne(
      { chatId: new Types.ObjectId(chatId), userId: new Types.ObjectId(asha.id) },
      { $set: { mutedUntil: new Date(Date.now() + 3600_000) } },
    );
    expect(await notifyPollVote(app(), { message: stored, voterId: bharat.id })).toBe('muted');
  });
});

describe('indexes', () => {
  it('a vote and a close find the poll by _id', async () => {
    await expectIndexedQuery(
      chatModels(app()).Message.find({
        _id: new Types.ObjectId(),
        'poll.closedAt': null,
        deletedForEveryoneAt: null,
      }),
    );
  });
});
