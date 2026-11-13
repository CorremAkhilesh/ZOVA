import { chatResponseSchema } from '@zuvo/protocol';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { headers } from '../../../test/auth-helpers.ts';
import { groupClient, systemKinds, texts } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { closeAllSockets, uuidv7 } from '../../../test/realtime-helpers.ts';
import { sendMessage } from '../../chats/messages.service.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const api = groupClient(app);
const { person, call, group, say, history, members, summary, setRole } = api;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
});
afterAll(async () => {
  closeAllSockets();
  await built.cleanup();
});

const png = () =>
  sharp({ create: { width: 64, height: 64, channels: 3, background: '#4F46E5' } })
    .png()
    .toBuffer();

async function uploadPhoto(who: { cookie: string }, chatId: string) {
  const boundary = 'x';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    await png(),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return app().inject({
    method: 'POST',
    url: `/v1/chats/${chatId}/group/photo`,
    headers: {
      ...headers(who.cookie),
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: body,
  });
}

describe('creating a group', () => {
  it('makes me the owner and everyone else a member, with one message saying so', async () => {
    const [asha, bharat, chitra] = [await person(), await person(), await person()];
    const chatId = await group(asha, [bharat, chitra], 'Launch');
    const list = await members(asha, chatId);
    expect(list.map((member) => [member.user.id, member.role])).toEqual([
      [asha.id, 'owner'],
      [bharat.id, 'member'],
      [chitra.id, 'member'],
    ]);
    expect(await summary(bharat, chatId)).toMatchObject({
      type: 'group',
      group: { name: 'Launch', memberCount: 3, myRole: 'member', active: true },
    });
    expect(systemKinds(await history(chitra, chatId))).toEqual(['created']);
  });

  it.each([
    ['no name', { name: ' ', memberIds: [] }],
    ['a name too long', { name: 'x'.repeat(101), memberIds: [] }],
    ['a description too long', { name: 'a', description: 'x'.repeat(501), memberIds: [] }],
    ['a bad member id', { name: 'a', memberIds: ['nope'] }],
  ])('refuses %s', async (_label, payload) => {
    expect((await call(await person(), 'POST', '/v1/groups', payload)).statusCode).toBe(400);
  });

  it('needs a session', async () => {
    const response = await call(null, 'POST', '/v1/groups', { name: 'a', memberIds: [] });
    expect(response.statusCode).toBe(401);
  });

  it('refuses unknown people', async () => {
    const response = await call(await person(), 'POST', '/v1/groups', {
      name: 'a',
      memberIds: ['a'.repeat(24)],
    });
    expect(response.statusCode).toBe(400);
  });

  it('is limited to 10 an hour', async () => {
    const asha = await person();
    for (let n = 0; n < 10; n += 1) await group(asha);
    const over = await call(asha, 'POST', '/v1/groups', { name: 'a', memberIds: [] });
    expect(over.statusCode).toBe(429);
  });
});

describe('sending in a group', () => {
  it('reaches every member, in order', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await group(asha, [bharat]);
    await say(asha, chatId, 'one');
    await say(bharat, chatId, 'two');
    expect(texts(await history(asha, chatId))).toEqual(['one', 'two']);
    expect(texts(await history(bharat, chatId))).toEqual(['one', 'two']);
  });

  it('is refused for someone outside it', async () => {
    const [asha, stranger] = [await person(), await person()];
    const chatId = await group(asha);
    await expect(say(stranger, chatId, 'hi')).rejects.toThrow('Chat not found');
    expect((await call(stranger, 'GET', `/v1/chats/${chatId}/messages`)).statusCode).toBe(404);
    expect((await call(stranger, 'GET', `/v1/chats/${chatId}/members`)).statusCode).toBe(404);
  });
});

describe('announcement mode', () => {
  it('lets only admins send, and a member can send again when it ends', async () => {
    const [asha, bharat, chitra] = [await person(), await person(), await person()];
    const chatId = await group(asha, [bharat, chitra]);
    await setRole(asha, chatId, chitra, 'admin');
    const on = await call(asha, 'PUT', `/v1/chats/${chatId}/group/settings`, {
      sendMessages: 'admins',
    });
    expect(chatResponseSchema.parse(on.json()).chat.group?.settings.sendMessages).toBe('admins');
    await expect(say(bharat, chatId, 'can I?')).rejects.toThrow('Only admins');
    await say(chitra, chatId, 'admin here');
    await say(asha, chatId, 'owner here');
    await call(asha, 'PUT', `/v1/chats/${chatId}/group/settings`, { sendMessages: 'all' });
    await say(bharat, chatId, 'back');
    expect(texts(await history(asha, chatId))).toEqual(['admin here', 'owner here', 'back']);
  });

  it('a media message is held to the same rule', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await group(asha, [bharat]);
    await call(asha, 'PUT', `/v1/chats/${chatId}/group/settings`, { sendMessages: 'admins' });
    await expect(
      sendMessage(app(), {
        userId: bharat.id,
        chatId,
        clientMsgId: uuidv7(),
        mediaId: 'a'.repeat(24),
      }),
    ).rejects.toThrow('Only admins');
  });
});

describe('group settings', () => {
  it('are for admins only', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await group(asha, [bharat]);
    const url = `/v1/chats/${chatId}/group/settings`;
    expect((await call(bharat, 'PUT', url, { editInfo: 'admins' })).statusCode).toBe(403);
    expect((await call(asha, 'PUT', url, { editInfo: 'admins' })).statusCode).toBe(200);
    expect((await call(asha, 'PUT', url, { editInfo: 'nobody' })).statusCode).toBe(400);
    expect((await call(null, 'PUT', url, { editInfo: 'all' })).statusCode).toBe(401);
  });

  it('say so in a message, only when something changed', async () => {
    const asha = await person();
    const chatId = await group(asha);
    const url = `/v1/chats/${chatId}/group/settings`;
    await call(asha, 'PUT', url, { addMembers: 'all' });
    await call(asha, 'PUT', url, { addMembers: 'all' });
    const messages = await history(asha, chatId);
    expect(systemKinds(messages)).toEqual(['created', 'settings_changed']);
    expect(messages.at(-1)?.system?.value).toBe('addMembers:all');
  });
});

describe('editing group info', () => {
  it('follows the setting, and says what changed', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await group(asha, [bharat]);
    const url = `/v1/chats/${chatId}/group`;
    expect((await call(bharat, 'PATCH', url, { name: 'New' })).statusCode).toBe(200);
    await call(asha, 'PUT', `${url}/settings`, { editInfo: 'admins' });
    expect((await call(bharat, 'PATCH', url, { name: 'Nope' })).statusCode).toBe(403);
    expect((await call(asha, 'PATCH', url, { description: 'About us' })).statusCode).toBe(200);
    expect((await call(asha, 'PATCH', url, {})).statusCode).toBe(400);
    expect((await summary(bharat, chatId)).group).toMatchObject({
      name: 'New',
      description: 'About us',
    });
    const messages = await history(asha, chatId);
    expect(systemKinds(messages)).toEqual([
      'created',
      'renamed',
      'settings_changed',
      'description_changed',
    ]);
    expect(messages[1]?.system?.value).toBe('New');
  });

  it('a photo goes through the same pipeline as avatars, for members only', async () => {
    const [asha, bharat, stranger] = [await person(), await person(), await person()];
    const chatId = await group(asha, [bharat]);
    expect((await uploadPhoto(stranger, chatId)).statusCode).toBe(404);
    const set = await uploadPhoto(asha, chatId);
    expect(set.statusCode).toBe(200);
    const url = chatResponseSchema.parse(set.json()).chat.group?.photo?.small ?? '';
    expect(url).toContain(`/v1/chats/${chatId}/photo`);
    const seen = await app().inject({ method: 'GET', url, headers: headers(bharat.cookie) });
    expect(seen.statusCode).toBe(200);
    expect(seen.headers['content-type']).toContain('image/webp');
    const hidden = await app().inject({ method: 'GET', url, headers: headers(stranger.cookie) });
    expect(hidden.statusCode).toBe(404);
    const gone = await call(asha, 'DELETE', `/v1/chats/${chatId}/group/photo`);
    expect(chatResponseSchema.parse(gone.json()).chat.group?.photo).toBeNull();
    expect(systemKinds(await history(asha, chatId))).toEqual([
      'created',
      'photo_changed',
      'photo_changed',
    ]);
  });
});
