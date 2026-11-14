import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { groupClient } from '../../test/group-helpers.ts';
import { buildTestApp } from '../../test/helpers.ts';
import { closeAllSockets, connect, listen, uuidv7 } from '../../test/realtime-helpers.ts';
import { sendMessage } from '../chats/messages.service.ts';
import { type Attempt, dbSnapshot, expectRefused } from './idor-helpers.ts';

/**
 * IDOR: messages (history, edit, delete, info), reactions, stars, pins, polls, view-once, forward
 * and reply quoting. Chetan is not in Asha and Bharat's chats; Bharat did not send Asha's messages.
 */
/** Signing several people in through the real OTP flow is slow on a busy machine. */
const SETUP_TIMEOUT = 600_000;
let built: Awaited<ReturnType<typeof buildTestApp>>;
let url = '';
const app = () => built.app;
const { person, call, group, say } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;
let asha: Person;
let bharat: Person;
let chetan: Person;
let directId = '';
let groupId = '';
/** Chetan's own chat with Asha: a chat id he may use, with someone else's message id. */
let ownId = '';
let textId = '';
let pollId = '';
let groupTextId = '';

const direct = async (who: Person, other: Person) =>
  (await call(who, 'POST', '/v1/chats/direct', { userId: other.id })).json().chat.id as string;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
  url = await listen(built.app);
  [asha, bharat, chetan] = [await person(), await person(), await person()];
  directId = await direct(asha, bharat);
  groupId = await group(asha, [bharat], 'Board');
  ownId = await direct(chetan, asha);
  textId = (await say(asha, directId, 'secret direct')).message.id;
  groupTextId = (await say(asha, groupId, 'secret group')).message.id;
  pollId = (
    await sendMessage(app(), {
      userId: asha.id,
      chatId: groupId,
      clientMsgId: uuidv7(),
      poll: { question: 'Secret?', options: ['Yes', 'No'], multiple: false },
    })
  ).message.id;
  // Only admins may pin in this group.
  expect(
    (await call(asha, 'PUT', `/v1/chats/${groupId}/group/settings`, { pinMessages: 'admins' }))
      .statusCode,
  ).toBe(200);
  // Bharat stars a message, so there is something of his to steal or undo.
  expect(
    (await call(bharat, 'PUT', `/v1/chats/${directId}/messages/${textId}/star`)).statusCode,
  ).toBe(200);
}, SETUP_TIMEOUT);
afterAll(async () => {
  closeAllSockets();
  await built.cleanup();
});

function messageAttempts(chatId: string, messageId: string): Attempt[] {
  const base = `/v1/chats/${chatId}/messages/${messageId}`;
  return [
    { method: 'PATCH', url: base, payload: { text: 'edited by someone else' } },
    { method: 'DELETE', url: `${base}?scope=everyone` },
    { method: 'DELETE', url: `${base}?scope=me` },
    { method: 'GET', url: `${base}/info` },
    { method: 'PUT', url: `${base}/reaction`, payload: { emoji: '👍' } },
    { method: 'DELETE', url: `${base}/reaction` },
    { method: 'PUT', url: `${base}/star` },
    { method: 'DELETE', url: `${base}/star` },
    { method: 'PUT', url: `${base}/pin`, payload: { duration: '24h' } },
    { method: 'DELETE', url: `${base}/pin` },
    { method: 'PUT', url: `${base}/vote`, payload: { optionIds: ['0'] } },
    { method: 'POST', url: `${base}/close-poll` },
    { method: 'POST', url: `${base}/view-once` },
  ];
}

describe('someone outside the chat', () => {
  it('cannot touch its messages, even through a chat of his own, and nothing changes', async () => {
    const before = await dbSnapshot(app());
    await expectRefused(app(), chetan.cookie, [
      ...messageAttempts(directId, textId),
      ...messageAttempts(groupId, groupTextId),
      ...messageAttempts(groupId, pollId),
      // His own chat id with someone else's message id.
      ...messageAttempts(ownId, textId),
      ...messageAttempts(ownId, pollId),
    ]);
    expect(await dbSnapshot(app())).toEqual(before);
  });

  it('cannot forward out of, or into, a chat he is not in', async () => {
    const before = await dbSnapshot(app());
    const own = (await say(chetan, ownId, 'mine')).message.id;
    const afterOwn = await dbSnapshot(app());
    await expectRefused(app(), chetan.cookie, [
      {
        method: 'POST',
        url: '/v1/forward',
        payload: {
          forwardId: uuidv7(),
          messages: [{ chatId: directId, messageId: textId }],
          chatIds: [ownId],
        },
      },
      {
        method: 'POST',
        url: '/v1/forward',
        payload: {
          forwardId: uuidv7(),
          messages: [{ chatId: ownId, messageId: own }],
          chatIds: [groupId],
        },
      },
    ]);
    expect(await dbSnapshot(app())).toEqual(afterOwn);
    expect(afterOwn).not.toEqual(before);
  });

  it('cannot quote a message from a chat he is not in', async () => {
    const socket = await connect(url, chetan.cookie);
    const before = await dbSnapshot(app());
    const ack = await socket.timeout(30_000).emitWithAck('message:send', {
      chatId: ownId,
      clientMsgId: uuidv7(),
      text: 'quoting',
      replyTo: { chatId: directId, messageId: textId },
    });
    expect(ack).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await dbSnapshot(app())).toEqual(before);
  });

  it('sees nothing of theirs in his stars', async () => {
    const all = await call(chetan, 'GET', '/v1/stars');
    expect(all.statusCode).toBe(200);
    expect(all.body).not.toContain(textId);
    const scoped = await call(chetan, 'GET', `/v1/stars?chatId=${directId}`);
    expect(scoped.body).not.toContain('secret');
  });
});

describe('a member who did not send the message', () => {
  it('cannot edit it, delete it for everyone, read its info or close its poll', async () => {
    const before = await dbSnapshot(app());
    await expectRefused(
      app(),
      bharat.cookie,
      [
        {
          method: 'PATCH',
          url: `/v1/chats/${directId}/messages/${textId}`,
          payload: { text: 'x' },
        },
        { method: 'DELETE', url: `/v1/chats/${directId}/messages/${textId}?scope=everyone` },
        { method: 'GET', url: `/v1/chats/${directId}/messages/${textId}/info` },
        { method: 'POST', url: `/v1/chats/${groupId}/messages/${pollId}/close-poll` },
        // Pinning in this group is for admins only (set above).
        {
          method: 'PUT',
          url: `/v1/chats/${groupId}/messages/${groupTextId}/pin`,
          payload: { duration: '24h' },
        },
      ],
      [403],
    );
    expect(await dbSnapshot(app())).toEqual(before);
  });
});
