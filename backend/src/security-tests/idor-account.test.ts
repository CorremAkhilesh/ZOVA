import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { headers } from '../../test/auth-helpers.ts';
import { groupClient } from '../../test/group-helpers.ts';
import { buildTestApp } from '../../test/helpers.ts';
import { subscribeDevice } from '../../test/push-helpers.ts';
import { jpegWithExif, multipartFile, uploadAvatar } from '../../test/user-helpers.ts';
import { dbSnapshot, expectRefused } from './idor-helpers.ts';

/**
 * IDOR: things that belong to one account — folders, scheduled messages, sessions, push devices,
 * wallpapers, reports and admin routes, and profiles (privacy settings honoured).
 */
/** Signing several people in through the real OTP flow is slow on a busy machine. */
const SETUP_TIMEOUT = 600_000;
let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call, say } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;
let asha: Person;
let bharat: Person;
let chetan: Person;
let chatId = '';
let ownChatId = '';
let folderId = '';
let scheduledId = '';
let deviceId = '';
let wallpaperId = '';
let messageId = '';

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
  [asha, bharat, chetan] = [await person(), await person(), await person()];
  chatId = (await call(asha, 'POST', '/v1/chats/direct', { userId: bharat.id })).json().chat.id;
  ownChatId = (await call(chetan, 'POST', '/v1/chats/direct', { userId: asha.id })).json().chat.id;
  messageId = (await say(bharat, chatId, 'secret')).message.id;
  folderId = (
    await call(asha, 'POST', '/v1/me/folders', { name: 'Work', chatIds: [chatId] })
  ).json().folder.id;
  const sendAt = new Date(Date.now() + 3_600_000).toISOString();
  scheduledId = (
    await call(asha, 'POST', '/v1/me/scheduled', { chatId, text: 'later', sendAt })
  ).json().item.id;
  await subscribeDevice(app(), asha.cookie);
  deviceId = (await call(asha, 'GET', '/v1/me/push')).json().devices[0].id;
  const { payload, contentType } = multipartFile(await jpegWithExif(), 'beach.jpg');
  const wallpaper = await app().inject({
    method: 'POST',
    url: '/v1/me/wallpapers',
    headers: { ...headers(asha.cookie), 'content-type': contentType },
    payload,
  });
  wallpaperId = wallpaper.json().image.id;
  expect((await uploadAvatar(app(), asha.cookie, await jpegWithExif())).statusCode).toBe(200);
}, SETUP_TIMEOUT);
afterAll(async () => {
  await built.cleanup();
});

describe('another account’s things', () => {
  it('folders, scheduled messages, sessions, push devices and wallpapers look missing', async () => {
    const before = await dbSnapshot(app());
    await expectRefused(app(), chetan.cookie, [
      { method: 'PATCH', url: `/v1/me/folders/${folderId}`, payload: { name: 'Mine now' } },
      { method: 'DELETE', url: `/v1/me/folders/${folderId}` },
      { method: 'PATCH', url: `/v1/me/scheduled/${scheduledId}`, payload: { text: 'changed' } },
      { method: 'POST', url: `/v1/me/scheduled/${scheduledId}/send-now` },
      { method: 'DELETE', url: `/v1/me/scheduled/${scheduledId}` },
      { method: 'DELETE', url: `/v1/me/sessions/${asha.sessionId}` },
      { method: 'PATCH', url: `/v1/me/sessions/${asha.sessionId}`, payload: { name: 'Gone' } },
      { method: 'DELETE', url: `/v1/me/push/devices/${deviceId}` },
      { method: 'GET', url: `/v1/me/wallpapers/${wallpaperId}` },
      { method: 'DELETE', url: `/v1/me/wallpapers/${wallpaperId}` },
      {
        method: 'PUT',
        url: `/v1/chats/${ownChatId}/wallpaper`,
        payload: { wallpaper: { kind: 'image', id: wallpaperId } },
      },
      {
        method: 'PATCH',
        url: '/v1/me/appearance',
        payload: { wallpaper: { kind: 'image', id: wallpaperId } },
      },
      // Scheduling into, or filing, a chat I am not in.
      {
        method: 'POST',
        url: '/v1/me/scheduled',
        payload: { chatId, text: 'hi', sendAt: new Date(Date.now() + 3_600_000).toISOString() },
      },
      { method: 'POST', url: '/v1/reports', payload: reportOf(chatId, messageId) },
    ]);
    expect(await dbSnapshot(app())).toEqual(before);
  });

  it('lists never include someone else’s folders, scheduled messages, sessions or devices', async () => {
    for (const path of [
      '/v1/me/folders',
      `/v1/me/scheduled?chatId=${chatId}`,
      '/v1/me/scheduled',
      '/v1/me/sessions',
      '/v1/me/push',
      '/v1/me/wallpapers',
    ]) {
      const response = await call(chetan, 'GET', path);
      expect(response.statusCode, path).toBe(200);
      for (const id of [folderId, scheduledId, asha.sessionId, deviceId, wallpaperId, chatId]) {
        expect(response.body, path).not.toContain(id);
      }
    }
  });

  it('a folder never files a chat I am not in', async () => {
    const response = await call(chetan, 'POST', '/v1/me/folders', {
      name: 'Spy',
      chatIds: [chatId],
    });
    if (response.statusCode === 200) expect(response.json().folder.chatIds).not.toContain(chatId);
    else expect([400, 404]).toContain(response.statusCode);
  });
});

describe('admin routes and reports', () => {
  it('are refused to someone who is not an admin, and nothing changes', async () => {
    expect((await call(asha, 'POST', '/v1/reports', reportOf(chatId, messageId))).statusCode).toBe(
      200,
    );
    const before = await dbSnapshot(app());
    await expectRefused(
      app(),
      chetan.cookie,
      [
        { method: 'GET', url: '/v1/admin/users' },
        { method: 'GET', url: '/v1/admin/audit-log' },
        { method: 'POST', url: `/v1/admin/users/${asha.id}/deactivate` },
        { method: 'POST', url: `/v1/admin/users/${asha.id}/reactivate` },
        { method: 'PUT', url: `/v1/admin/users/${chetan.id}/role`, payload: { role: 'admin' } },
        { method: 'GET', url: '/v1/admin/reports' },
        { method: 'GET', url: `/v1/admin/reports/${messageId}` },
        {
          method: 'POST',
          url: `/v1/admin/reports/${messageId}/resolve`,
          payload: { action: 'deactivate' },
        },
      ],
      [403],
    );
    expect(await dbSnapshot(app())).toEqual(before);
  });
});

describe('profiles', () => {
  it('honour privacy: no photo, about or last seen when set to nobody', async () => {
    const privacy = {
      lastSeen: 'nobody',
      profilePhoto: 'nobody',
      about: 'nobody',
      readReceipts: true,
    };
    expect((await call(asha, 'PUT', '/v1/me/privacy', privacy)).statusCode).toBe(200);
    expect(
      (await call(asha, 'PATCH', '/v1/me/profile', { about: 'private note' })).statusCode,
    ).toBe(200);
    const profile = await call(chetan, 'GET', `/v1/users/${asha.id}`);
    expect(profile.statusCode).toBe(200);
    expect(profile.body).not.toContain('private note');
    expect(profile.json().user).toMatchObject({ about: null, avatar: null });
    const avatar = await call(chetan, 'GET', `/v1/users/${asha.id}/avatar`);
    expect(avatar.statusCode).toBe(404);
    // Search shows the same, privacy-applied profile, and never an email address.
    const search = await call(chetan, 'GET', `/v1/users/search?q=${asha.email.split('@')[0]}`);
    expect(search.body).not.toContain('private note');
    expect(search.body).not.toContain(asha.email);
  });
});

function reportOf(target: string, message: string) {
  return {
    target: { kind: 'message', chatId: target, messageIds: [message] },
    reason: 'spam',
  };
}
