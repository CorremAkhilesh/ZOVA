import { DEFAULT_QUIET_HOURS, type PushPayload } from '@zuvo/protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { headers } from '../../../test/auth-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { flushPushes, pushesTo, pushOutbox, subscribeDevice } from '../../../test/push-helpers.ts';
import {
  closeAllSockets,
  connect,
  listen,
  signedIn,
  uuidv7,
} from '../../../test/realtime-helpers.ts';
import { chatModels, getOrCreateDirectChat, oid } from '../../chats/chats.service.ts';
import { deleteForEveryone } from '../../chats/message-actions.service.ts';
import { sendMessage } from '../../chats/messages.service.ts';
import { markRead } from '../../chats/receipts.service.ts';
import { blockUser } from '../../moderation/blocks.service.ts';
import { usersModel } from '../../users/user-record.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
let url: string;
const app = () => built.app;
let seed = 0;

/** Alice writes to Bob, who has push on. */
async function pair() {
  seed += 1;
  const alice = await signedIn(app(), `deliver${seed}a@corremadvisory.com`);
  const bob = await signedIn(app(), `deliver${seed}b@corremadvisory.com`);
  await usersModel(app()).updateOne({ _id: oid(alice.id) }, { $set: { displayName: 'Alice' } });
  const chat = await getOrCreateDirectChat(app(), alice.id, bob.id);
  const device = await subscribeDevice(app(), bob.cookie);
  return { alice, bob, chatId: chat.id, device };
}

const say = (userId: string, chatId: string, text: string) =>
  sendMessage(app(), { userId, chatId, clientMsgId: uuidv7(), text });

const messagePayloads = (userId: string) =>
  pushesTo(app(), userId).map((push) => push.payload as Extract<PushPayload, { kind: 'message' }>);

const setMember = (chatId: string, userId: string, fields: Record<string, unknown>) =>
  chatModels(app()).ChatMember.updateOne(
    { chatId: oid(chatId), userId: oid(userId) },
    { $set: fields },
  );

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
  url = await listen(app());
});
afterEach(() => closeAllSockets());
afterAll(async () => {
  await built.cleanup();
});

describe('a new message', () => {
  it('reaches the recipient’s devices with the sender and text, never the sender’s own', async () => {
    const { alice, bob, chatId, device } = await pair();
    await subscribeDevice(app(), alice.cookie);
    await say(alice.id, chatId, 'Lunch at 1?');
    await flushPushes(app());
    const [push] = pushesTo(app(), bob.id);
    expect(push).toMatchObject({
      endpoint: device.endpoint,
      options: { urgency: 'high', ttlSeconds: 86_400, topic: chatId },
    });
    expect(push?.payload).toMatchObject({
      kind: 'message',
      chatId,
      tag: `chat:${chatId}`,
      title: 'Alice',
      body: 'Lunch at 1?',
      count: 1,
      badge: 1,
      hidden: false,
      silent: false,
    });
    expect(pushesTo(app(), alice.id)).toEqual([]);
  });

  it('turns a burst into one notification "(+N more)", and never notifies twice', async () => {
    const { alice, bob, chatId } = await pair();
    await say(alice.id, chatId, 'one');
    await say(alice.id, chatId, 'two');
    const last = await say(alice.id, chatId, 'three');
    await flushPushes(app());
    await flushPushes(app());
    expect(messagePayloads(bob.id)).toEqual([
      expect.objectContaining({ body: 'three (+2 more)', count: 3, seq: last.message.seq }),
    ]);
    await say(alice.id, chatId, 'four');
    await flushPushes(app());
    expect(messagePayloads(bob.id).map((p) => p.body)).toEqual(['three (+2 more)', 'four']);
  });

  it('is skipped when read meanwhile, deleted for everyone, or blocked', async () => {
    const read = await pair();
    const sent = await say(read.alice.id, read.chatId, 'seen already');
    await markRead(app(), read.bob.id, read.chatId, sent.message.seq);

    const deleted = await pair();
    const gone = await say(deleted.alice.id, deleted.chatId, 'oops');
    await deleteForEveryone(app(), deleted.alice.id, deleted.chatId, gone.message.id);

    const blocked = await pair();
    await say(blocked.alice.id, blocked.chatId, 'hello?');
    await blockUser(app(), blocked.bob.id, blocked.alice.id);

    await flushPushes(app());
    expect(pushesTo(app(), read.bob.id)).toEqual([]);
    expect(pushesTo(app(), deleted.bob.id)).toEqual([]);
    expect(pushesTo(app(), blocked.bob.id)).toEqual([]);
  });

  it('hides the sender and text in a locked chat, with app lock or with the preview off', async () => {
    const locked = await pair();
    await setMember(locked.chatId, locked.bob.id, { locked: true });
    const preview = await pair();
    await usersModel(app()).updateOne(
      { _id: oid(preview.bob.id) },
      { $set: { pushSettings: { showPreview: false, sound: false } } },
    );
    await say(locked.alice.id, locked.chatId, 'secret one');
    await say(preview.alice.id, preview.chatId, 'secret two');
    await flushPushes(app());
    for (const bob of [locked.bob, preview.bob]) {
      const [payload] = messagePayloads(bob.id);
      expect(payload).toMatchObject({ title: 'New message', body: '', hidden: true });
      expect(JSON.stringify(payload)).not.toMatch(/secret|Alice/);
    }
    expect(messagePayloads(preview.bob.id)[0]?.silent).toBe(true);
  });

  it('is written in the language the person saved in their profile', async () => {
    const { alice, bob, chatId } = await pair();
    const saved = await app().inject({
      method: 'PATCH',
      url: '/v1/me/profile',
      headers: headers(bob.cookie),
      payload: { language: 'hi' },
    });
    expect(saved.json().profile.language).toBe('hi');
    await setMember(chatId, bob.id, { locked: true });
    await say(alice.id, chatId, 'secret');
    await flushPushes(app());
    expect(messagePayloads(bob.id)[0]).toMatchObject({ title: 'नया संदेश', hidden: true });
  });

  it('respects a mute, and quiet hours with their chat exception', async () => {
    const muted = await pair();
    await setMember(muted.chatId, muted.bob.id, { mutedUntil: new Date('9999-12-31') });
    const quiet = await pair();
    await usersModel(app()).updateOne(
      { _id: oid(quiet.bob.id) },
      { $set: { quietHours: { ...DEFAULT_QUIET_HOURS, mode: 'on' } } },
    );
    const allowed = await pair();
    await usersModel(app()).updateOne(
      { _id: oid(allowed.bob.id) },
      {
        $set: {
          quietHours: { ...DEFAULT_QUIET_HOURS, mode: 'on', allowChatIds: [allowed.chatId] },
        },
      },
    );
    for (const { alice, chatId } of [muted, quiet, allowed]) await say(alice.id, chatId, 'psst');
    await flushPushes(app());
    expect(pushesTo(app(), muted.bob.id)).toEqual([]);
    expect(pushesTo(app(), quiet.bob.id)).toEqual([]);
    expect(messagePayloads(allowed.bob.id)).toHaveLength(1);
  });
});

describe('devices someone is looking at (window:state)', () => {
  it('skip the attended device but still notify the others, across two sockets', async () => {
    const { alice, bob, chatId, device: laptop } = await pair();
    const phone = await signedIn(app(), bob.email);
    const phoneDevice = await subscribeDevice(app(), phone.cookie);
    const laptopTab = await connect(url, bob.cookie);
    const otherTab = await connect(url, bob.cookie);
    const ack = await laptopTab
      .timeout(10_000)
      .emitWithAck('window:state', { visible: true, focused: true });
    expect(ack).toEqual({ ok: true, data: {} });
    await otherTab.timeout(10_000).emitWithAck('window:state', { visible: true, focused: false });

    await say(alice.id, chatId, 'are you there?');
    await flushPushes(app());
    expect(pushesTo(app(), bob.id).map((push) => push.endpoint)).toEqual([phoneDevice.endpoint]);

    // The tab lost focus: both devices hear about the next one.
    await laptopTab.timeout(10_000).emitWithAck('window:state', { visible: true, focused: false });
    await say(alice.id, chatId, 'hello?');
    await flushPushes(app());
    expect(
      pushesTo(app(), bob.id)
        .slice(1)
        .map((push) => push.endpoint)
        .sort(),
    ).toEqual([laptop.endpoint, phoneDevice.endpoint].sort());
  });

  it('forgets a socket once it disconnects', async () => {
    const { alice, bob, chatId } = await pair();
    const tab = await connect(url, bob.cookie);
    await tab.timeout(10_000).emitWithAck('window:state', { visible: true, focused: true });
    expect(await app().push.attendanceStore.attended([bob.sessionId])).toEqual(
      new Set([bob.sessionId]),
    );
    tab.disconnect();
    await expect
      .poll(() => app().push.attendanceStore.attended([bob.sessionId]), { timeout: 10_000 })
      .toEqual(new Set());
    await say(alice.id, chatId, 'now?');
    await flushPushes(app());
    expect(pushesTo(app(), bob.id)).toHaveLength(1);
  });

  it('refuses a malformed window:state', async () => {
    const { bob } = await pair();
    const tab = await connect(url, bob.cookie);
    const ack = await tab.timeout(10_000).emitWithAck('window:state', { visible: 'yes' } as never);
    expect(ack).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
  });
});

describe('the push service', () => {
  it('saying 410 removes the subscription', async () => {
    const { alice, bob, chatId, device } = await pair();
    pushOutbox(app()).gone.add(device.endpoint);
    await say(alice.id, chatId, 'anyone?');
    await flushPushes(app());
    const left = await app().inject({
      method: 'GET',
      url: '/v1/me/push',
      headers: { origin: 'http://localhost:5173', cookie: bob.cookie },
    });
    expect(left.json().devices).toEqual([]);
  });
});
