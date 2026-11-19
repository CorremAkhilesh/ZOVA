import {
  chatResponseSchema,
  presenceEventSchema,
  publicProfileResponseSchema,
  statusFeedResponseSchema,
  statusViewersResponseSchema,
  userSearchResponseSchema,
} from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { headers } from '../../../test/auth-helpers.ts';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import {
  closeAllSockets,
  connect,
  listen,
  signedIn,
  uuidv7,
} from '../../../test/realtime-helpers.ts';
import { sendMessage } from '../../chats/messages.service.ts';

// ADMIN_EMAILS accounts are invisible to normal users: search, suggestions, groups, "@", status,
// profile lookup and presence. Only an admin starts a chat with one; the user may answer there.

let built: Awaited<ReturnType<typeof buildTestApp>>;
let url: string;
const app = () => built.app;
const { person, call, group, say, members } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;
let admin: Person;
let riya: Person;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
  url = await listen(built.app);
  admin = await signedIn(built.app, 'admin@corremadvisory.com');
  expect(
    (await call(admin, 'PATCH', '/v1/me/profile', { displayName: 'Zuvo Admin' })).statusCode,
  ).toBe(200);
  expect((await call(admin, 'PUT', '/v1/me/username', { username: 'novaadmin' })).statusCode).toBe(
    200,
  );
  riya = await person();
});
afterAll(async () => {
  closeAllSockets();
  await built.cleanup();
});

const search = async (who: Person, q: string) => {
  const response = await call(who, 'GET', `/v1/users/search?q=${encodeURIComponent(q)}`);
  expect(response.statusCode, response.body).toBe(200);
  return userSearchResponseSchema.parse(response.json()).items.map((item) => item.id);
};
const direct = (who: Person, other: Person) =>
  call(who, 'POST', '/v1/chats/direct', { userId: other.id });

describe('a normal user never finds an admin', () => {
  it('not in suggestions, nor by name, @username or email; an admin finds everyone', async () => {
    for (const q of ['', 'zuvo', 'zuvo admin', 'novaadmin', 'admin@corremadvisory.com']) {
      expect(await search(riya, q), q).not.toContain(admin.id);
    }
    expect(await search(admin, '')).toContain(riya.id);
    expect(await search(admin, riya.email)).toEqual([riya.id]);
  });

  it('their profile is "not found" until the admin has a chat with them', async () => {
    const other = await person();
    expect((await call(other, 'GET', `/v1/users/${admin.id}`)).statusCode).toBe(404);
    expect((await call(admin, 'GET', `/v1/users/${other.id}`)).statusCode).toBe(200);
    expect((await direct(admin, other)).statusCode).toBe(200);
    const shown = await call(other, 'GET', `/v1/users/${admin.id}`);
    expect(publicProfileResponseSchema.parse(shown.json()).user.displayName).toBe('Zuvo Admin');
  });
});

describe('chats with an admin', () => {
  it('a normal user cannot start one (404); the admin can, and the user replies there', async () => {
    const user = await person();
    expect((await direct(user, admin)).statusCode).toBe(404);
    const opened = await direct(admin, user);
    expect(opened.statusCode).toBe(200);
    const chatId = chatResponseSchema.parse(opened.json()).chat.id;
    await say(admin, chatId, 'Welcome to the team');
    // The chat now exists: the user can open it and answer.
    expect((await direct(user, admin)).statusCode).toBe(200);
    const reply = await say(user, chatId, 'Thank you!');
    expect(reply.message.text).toBe('Thank you!');
  });

  it('a normal user cannot put an admin in a group, new or existing (404)', async () => {
    const [owner, member] = [await person(), await person()];
    const create = await call(owner, 'POST', '/v1/groups', {
      name: 'Team',
      memberIds: [member.id, admin.id],
    });
    expect(create.statusCode).toBe(404);
    const chatId = await group(owner, [member]);
    const add = await call(owner, 'POST', `/v1/chats/${chatId}/members`, { userIds: [admin.id] });
    expect(add.statusCode).toBe(404);
    expect((await members(owner, chatId)).map((m) => m.user.id)).not.toContain(admin.id);
  });

  it('in a group the admin made, members do not list or "@" the admin; the admin sees all', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await group(admin, [asha, bharat]);
    expect((await members(asha, chatId)).map((m) => m.user.id).sort()).toEqual(
      [asha.id, bharat.id].sort(),
    );
    expect((await members(admin, chatId)).map((m) => m.user.id)).toContain(admin.id);
    const mention = (who: Person, target: Person) =>
      sendMessage(app(), {
        userId: who.id,
        chatId,
        clientMsgId: uuidv7(),
        text: '@someone hi',
        mentions: [{ userId: target.id, offset: 0, length: 8 }],
      });
    await expect(mention(asha, admin)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(mention(asha, bharat)).resolves.toBeTruthy();
    await expect(mention(admin, asha)).resolves.toBeTruthy();
  });
});

describe('status and presence', () => {
  const TEXT = { kind: 'text', text: 'notice', style: { background: 'teal', font: 'sans' } };
  const feed = async (who: Person) =>
    statusFeedResponseSchema.parse((await call(who, 'GET', '/v1/statuses')).json());

  it('an admin’s status reaches nobody normal; a normal user’s status hides admin views', async () => {
    const user = await person();
    expect((await call(admin, 'POST', '/v1/statuses', TEXT)).statusCode).toBe(200);
    const mine = await call(user, 'POST', '/v1/statuses', TEXT);
    const statusId = mine.json().status.id as string;
    expect((await feed(user)).people.map((p) => p.user.id)).not.toContain(admin.id);
    expect((await feed(admin)).people.map((p) => p.user.id)).toContain(user.id);
    expect((await call(admin, 'POST', `/v1/statuses/${statusId}/view`, {})).statusCode).toBe(200);
    const viewers = statusViewersResponseSchema.parse(
      (await call(user, 'GET', `/v1/statuses/${statusId}/viewers`)).json(),
    );
    expect(viewers.viewers.map((v) => v.user.id)).not.toContain(admin.id);
    const adminStatus = (await feed(admin)).mine[0]?.id ?? '';
    expect((await call(user, 'POST', `/v1/statuses/${adminStatus}/view`, {})).statusCode).toBe(404);
  });

  it('a normal user never sees the admin online or their last seen, even in their chat', async () => {
    const user = await person();
    await direct(admin, user);
    const watcher = await connect(url, user.cookie);
    await connect(url, admin.cookie);
    const ack = await watcher.timeout(10_000).emitWithAck('presence:subscribe', {
      userIds: [admin.id],
    });
    if (!ack.ok) throw new Error(ack.error.code);
    expect(presenceEventSchema.array().parse(ack.data.users)).toEqual([
      { userId: admin.id, online: false, lastSeenAt: null },
    ]);
    const adminSocket = await connect(url, admin.cookie);
    const back = await adminSocket.timeout(10_000).emitWithAck('presence:subscribe', {
      userIds: [user.id],
    });
    if (!back.ok) throw new Error(back.error.code);
    expect(back.data.users[0]?.online).toBe(true);
  });
});

describe('ADMIN_CHAT_USER_CAN_REPLY=false', () => {
  let quiet: Awaited<ReturnType<typeof buildTestApp>>;
  beforeAll(async () => {
    quiet = await buildTestApp({}, { ADMIN_CHAT_USER_CAN_REPLY: 'false' });
  });
  afterAll(async () => {
    await quiet.cleanup();
  });

  it('makes a chat the admin started announcement-only; other chats are unchanged', async () => {
    const boss = await signedIn(quiet.app, 'admin@corremadvisory.com');
    const [user, friend] = [
      await signedIn(quiet.app, 'quiet1@corremadvisory.com'),
      await signedIn(quiet.app, 'quiet2@corremadvisory.com'),
    ];
    const open = async (who: Person, other: Person) =>
      chatResponseSchema.parse(
        (
          await quiet.app.inject({
            method: 'POST',
            url: '/v1/chats/direct',
            headers: headers(who.cookie),
            payload: { userId: other.id },
          })
        ).json(),
      ).chat.id;
    const send = (who: Person, chatId: string) =>
      sendMessage(quiet.app, { userId: who.id, chatId, clientMsgId: uuidv7(), text: 'hi' });
    const announcements = await open(boss, user);
    await expect(send(boss, announcements)).resolves.toBeTruthy();
    await expect(send(user, announcements)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(send(user, await open(user, friend))).resolves.toBeTruthy();
  });
});
