import { inviteResponseSchema } from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { headers } from '../../test/auth-helpers.ts';
import { groupClient } from '../../test/group-helpers.ts';
import { buildTestApp } from '../../test/helpers.ts';
import { closeAllSockets, connect, listen, record, uuidv7 } from '../../test/realtime-helpers.ts';
import { type Attempt, dbSnapshot, expectRefused } from './idor-helpers.ts';

/**
 * IDOR: chats (1:1 and group), group admin actions, invite links, and chat events on the socket.
 * Chetan is in neither chat; Bharat is a plain member of Asha's group.
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
let inviteCode = '';

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
  url = await listen(built.app);
  [asha, bharat, chetan] = [await person(), await person(), await person()];
  const direct = await call(asha, 'POST', '/v1/chats/direct', { userId: bharat.id });
  directId = direct.json().chat.id;
  groupId = await group(asha, [bharat], 'Board');
  await say(asha, directId, 'secret direct');
  await say(asha, groupId, 'secret group');
  const settings = {
    editInfo: 'admins',
    addMembers: 'admins',
    pinMessages: 'admins',
    disappearing: 'admins',
  };
  expect(
    (await call(asha, 'PUT', `/v1/chats/${groupId}/group/settings`, settings)).statusCode,
  ).toBe(200);
  const invite = await call(asha, 'POST', `/v1/chats/${groupId}/invite`);
  inviteCode = inviteResponseSchema.parse(invite.json()).code ?? '';
  // Chetan has a PIN, so a chat-lock attempt fails on membership, not on "set a PIN first".
  expect((await call(chetan, 'PUT', '/v1/me/lock/pin', { pin: '2468' })).statusCode).toBe(200);
}, SETUP_TIMEOUT);
afterAll(async () => {
  closeAllSockets();
  await built.cleanup();
});

/** Everything one person can do to a chat, by URL. */
function chatAttempts(chatId: string): Attempt[] {
  const base = `/v1/chats/${chatId}`;
  return [
    { method: 'GET', url: base },
    { method: 'GET', url: `${base}/messages` },
    { method: 'GET', url: `${base}/media?tab=media` },
    { method: 'POST', url: `${base}/read`, payload: { seq: 1 } },
    { method: 'PATCH', url: `${base}/prefs`, payload: { pinned: true, archived: true } },
    { method: 'POST', url: `${base}/clear` },
    { method: 'DELETE', url: base },
    {
      method: 'PUT',
      url: `${base}/draft`,
      payload: { text: 'x', replyTo: null, updatedAt: new Date().toISOString() },
    },
    { method: 'PUT', url: `${base}/disappearing`, payload: { timer: '24h' } },
    { method: 'PUT', url: `${base}/wallpaper`, payload: { wallpaper: null } },
    { method: 'PUT', url: `${base}/lock`, payload: { locked: true } },
    { method: 'POST', url: `${base}/reply`, payload: { clientMsgId: uuidv7(), text: 'hi' } },
  ];
}

function groupAttempts(chatId: string, target: Person, newcomer: Person): Attempt[] {
  const base = `/v1/chats/${chatId}`;
  return [
    { method: 'PATCH', url: `${base}/group`, payload: { name: 'Hacked' } },
    { method: 'PUT', url: `${base}/group/settings`, payload: { editInfo: 'all' } },
    { method: 'DELETE', url: `${base}/group/photo` },
    { method: 'POST', url: `${base}/members`, payload: { userIds: [newcomer.id] } },
    { method: 'DELETE', url: `${base}/members/${target.id}` },
    { method: 'PUT', url: `${base}/members/${target.id}/role`, payload: { role: 'admin' } },
    { method: 'POST', url: `${base}/transfer`, payload: { userId: newcomer.id } },
    { method: 'GET', url: `${base}/invite` },
    { method: 'POST', url: `${base}/invite` },
    { method: 'DELETE', url: `${base}/invite` },
  ];
}

describe('someone outside a chat', () => {
  it('can neither read nor change a 1:1 chat or a group, and nothing changes', async () => {
    const before = await dbSnapshot(app());
    await expectRefused(app(), chetan.cookie, chatAttempts(directId));
    await expectRefused(app(), chetan.cookie, [
      ...chatAttempts(groupId),
      ...groupAttempts(groupId, bharat, chetan),
      { method: 'GET', url: `/v1/chats/${groupId}/members` },
      { method: 'GET', url: `/v1/chats/${groupId}/photo` },
      { method: 'POST', url: `/v1/chats/${groupId}/leave` },
    ]);
    expect(await dbSnapshot(app())).toEqual(before);
  });

  it('never sees either chat in the chat list, sync or search', async () => {
    const list = await call(chetan, 'GET', '/v1/chats');
    expect(list.statusCode).toBe(200);
    const sync = await call(chetan, 'GET', '/v1/sync');
    expect(sync.statusCode).toBe(200);
    const search = await call(chetan, 'GET', '/v1/search/messages?q=secret');
    expect(search.statusCode).toBe(200);
    for (const body of [list.body, sync.body, search.body]) {
      expect(body).not.toContain(directId);
      expect(body).not.toContain(groupId);
      expect(body).not.toContain('secret');
    }
    const scoped = await call(chetan, 'GET', `/v1/search/messages?q=secret&chatId=${groupId}`);
    expect(scoped.body).not.toContain('secret');
  });

  it('is refused on the socket too: send, read, delivered, typing, voice played', async () => {
    const socket = await connect(url, chetan.cookie);
    const watcher = await connect(url, bharat.cookie);
    const typing = record(watcher, 'typing:update');
    const before = await dbSnapshot(app());
    for (const chatId of [directId, groupId]) {
      const sent = await socket
        .timeout(30_000)
        .emitWithAck('message:send', { chatId, clientMsgId: uuidv7(), text: 'let me in' });
      expect(sent).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
      for (const event of ['read:update', 'delivered:update'] as const) {
        const ack = await socket.timeout(30_000).emitWithAck(event, { chatId, seq: 1 });
        expect(ack).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
      }
      const played = await socket
        .timeout(30_000)
        .emitWithAck('voice:played', { chatId, messageId: '0123456789abcdef01234567' });
      expect(played.ok).toBe(false);
      await socket.timeout(30_000).emitWithAck('typing:start', { chatId });
    }
    // Typing from an outsider reaches nobody in the chat.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(typing).toEqual([]);
    expect(await dbSnapshot(app())).toEqual(before);
  });
});

describe('a plain member of a group', () => {
  it('cannot do what only admins may, and nothing changes', async () => {
    const before = await dbSnapshot(app());
    await expectRefused(
      app(),
      bharat.cookie,
      [
        ...groupAttempts(groupId, asha, chetan),
        { method: 'PUT', url: `/v1/chats/${groupId}/disappearing`, payload: { timer: '24h' } },
      ],
      [403, 404],
    );
    expect(await dbSnapshot(app())).toEqual(before);
  });
});

describe('invite links', () => {
  it('preview shows the group, never its messages; a revoked code stops working', async () => {
    const preview = await app().inject({
      method: 'GET',
      url: `/v1/invites/${inviteCode}`,
      headers: headers(chetan.cookie),
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.body).not.toContain('secret');
    expect((await call(asha, 'DELETE', `/v1/chats/${groupId}/invite`)).statusCode).toBe(200);
    const before = await dbSnapshot(app());
    await expectRefused(app(), chetan.cookie, [
      { method: 'GET', url: `/v1/invites/${inviteCode}` },
      { method: 'GET', url: `/v1/invites/${inviteCode}/photo` },
      { method: 'POST', url: `/v1/invites/${inviteCode}/join` },
    ]);
    expect(await dbSnapshot(app())).toEqual(before);
  });
});
