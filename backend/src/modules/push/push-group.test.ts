import type { PushPayload } from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import {
  discardPendingPushes,
  flushPushes,
  pushesTo,
  subscribeDevice,
} from '../../../test/push-helpers.ts';
import { uuidv7 } from '../../../test/realtime-helpers.ts';
import { MemoryCounterStore } from '../../auth/counter-store.ts';
import { chatModels, oid } from '../../chats/chats.service.ts';
import { sendMessage } from '../../chats/messages.service.ts';
import { runPushJob } from '../../push/notify.ts';
import { usersModel } from '../../users/user-record.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call, group, say } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;

const named = async (name: string) => {
  const who = await person();
  await usersModel(app()).updateOne({ _id: oid(who.id) }, { $set: { displayName: name } });
  await subscribeDevice(app(), who.cookie);
  return who;
};

const mention = (from: Person, chatId: string, target: Person) =>
  sendMessage(app(), {
    userId: from.id,
    chatId,
    clientMsgId: uuidv7(),
    text: '@Bob look',
    mentions: [{ userId: target.id, offset: 0, length: 4 }],
  });

const bodies = (who: Person) =>
  pushesTo(app(), who.id).map(
    (push) => (push.payload as Extract<PushPayload, { kind: 'message' }>).body,
  );

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
});
afterAll(async () => {
  await built.cleanup();
});

describe('group notifications', () => {
  it('show the group name and "Sender: text" to every other member', async () => {
    const riya = await named('Riya');
    const bob = await named('Bob');
    const chatId = await group(riya, [bob], 'Launch team');
    await say(riya, chatId, 'ship it');
    await flushPushes(app());
    expect(pushesTo(app(), bob.id)[0]?.payload).toMatchObject({
      title: 'Launch team',
      body: 'Riya: ship it',
    });
    expect(pushesTo(app(), riya.id)).toEqual([]);
  });

  it('get through a mute when I am mentioned, and only then', async () => {
    const riya = await named('Riya');
    const bob = await named('Bob');
    const chatId = await group(riya, [bob]);
    await chatModels(app()).ChatMember.updateOne(
      { chatId: oid(chatId), userId: oid(bob.id) },
      { $set: { mutedUntil: new Date('9999-12-31') } },
    );
    await say(riya, chatId, 'chatter');
    await flushPushes(app());
    expect(pushesTo(app(), bob.id)).toEqual([]);
    await say(riya, chatId, 'more chatter');
    await mention(riya, chatId, bob);
    await say(riya, chatId, 'even more');
    await flushPushes(app());
    // Only the mention counts: the muted chatter around it is not announced.
    expect(bodies(bob)).toEqual(['Riya: @Bob look']);
  });

  it('stop for someone removed before the push went out', async () => {
    const riya = await named('Riya');
    const carol = await named('Carol');
    const chatId = await group(riya, [carol]);
    await say(riya, chatId, 'about Carol…');
    const removed = await call(riya, 'DELETE', `/v1/chats/${chatId}/members/${carol.id}`);
    expect(removed.statusCode).toBe(200);
    await flushPushes(app());
    expect(bodies(carol).filter((body) => body.includes('about Carol'))).toEqual([]);
  });
});

describe('runPushJob', () => {
  it('says why it skipped: not a member, nothing new, no devices', async () => {
    const riya = await named('Riya');
    const outsider = await named('Olga');
    const chatId = await group(riya, [], 'Solo');
    const context = app().push.context();
    expect(await runPushJob(context, { userId: outsider.id, chatId })).toEqual({
      status: 'skipped',
      reason: 'not_member',
    });
    // The group's own "created" system message is all there is: never announced.
    expect(await runPushJob(context, { userId: riya.id, chatId })).toEqual({
      status: 'skipped',
      reason: 'system',
    });
    const quiet = await person();
    const second = await group(riya, [quiet]);
    await say(riya, second, 'hi');
    await discardPendingPushes(app());
    expect(await runPushJob(context, { userId: quiet.id, chatId: second })).toEqual({
      status: 'skipped',
      reason: 'no_devices',
    });
  });

  it('holds back past the per-person rate, and gives the messages to a later push', async () => {
    const riya = await named('Riya');
    const bob = await named('Bob');
    const chatId = await group(riya, [bob]);
    await say(riya, chatId, 'one');
    await discardPendingPushes(app());
    const counter = new MemoryCounterStore();
    for (let n = 0; n < 30; n++) await counter.increment(`zuvo:push:rate:${bob.id}`, 60);
    const context = { ...app().push.context(), counter };
    expect(await runPushJob(context, { userId: bob.id, chatId })).toEqual({
      status: 'skipped',
      reason: 'rate_limited',
    });
    await counter.remove(`zuvo:push:rate:${bob.id}`);
    await say(riya, chatId, 'two');
    await discardPendingPushes(app());
    expect(await runPushJob(context, { userId: bob.id, chatId })).toMatchObject({
      status: 'sent',
      count: 2,
    });
  });

  it('asks the queue to retry when every device failed for a passing reason', async () => {
    const riya = await named('Riya');
    const bob = await named('Bob');
    const chatId = await group(riya, [bob]);
    await say(riya, chatId, 'flaky network');
    await discardPendingPushes(app());
    const send = vi.fn(async () => ({
      ok: false as const,
      gone: false,
      statusCode: 503,
      reason: 'x',
    }));
    const context = { ...app().push.context(), sender: { send } };
    await expect(runPushJob(context, { userId: bob.id, chatId })).rejects.toThrow(
      'every push attempt failed',
    );
    // Given back: the retry notifies the same messages.
    expect(await runPushJob(app().push.context(), { userId: bob.id, chatId })).toMatchObject({
      status: 'sent',
      count: 1,
    });
  });
});
