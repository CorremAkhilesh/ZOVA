import {
  adminPushResponseSchema,
  auditLogResponseSchema,
  chatResponseSchema,
  messageSchema,
  pushSettingsResponseSchema,
  remindResponseSchema,
} from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { subscribeDevice } from '../../../test/push-helpers.ts';
import { signedIn } from '../../../test/realtime-helpers.ts';

// Admin → Notifications: who gets notified on which device, the reminder, and the member count a
// normal member sees in a group with a hidden admin.

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call, group, summary } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;
let admin: Person;

const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
  admin = await signedIn(built.app, 'admin@corremadvisory.com');
});
afterAll(async () => {
  await built.cleanup();
});

/** Every page of the overview, as the admin page loads it. */
async function overview(who: Person = admin) {
  const items = [];
  let cursor: string | null = null;
  do {
    const query: string = cursor ? `?limit=2&cursor=${cursor}` : '?limit=2';
    const response = await call(who, 'GET', `/v1/admin/notifications${query}`);
    expect(response.statusCode, response.body).toBe(200);
    const page = adminPushResponseSchema.parse(response.json());
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

describe('GET /v1/admin/notifications', () => {
  it('admins only: 401 signed out, 403 for a normal user, 400 for a bad limit', async () => {
    const user = await person();
    expect((await call(null, 'GET', '/v1/admin/notifications')).statusCode).toBe(401);
    expect((await call(user, 'GET', '/v1/admin/notifications')).statusCode).toBe(403);
    expect((await call(admin, 'GET', '/v1/admin/notifications?limit=0')).statusCode).toBe(400);
  });

  it('lists every device, with push on or off, platform, installed and permission', async () => {
    const [on, off] = [await person(), await person()];
    await subscribeDevice(app(), on.cookie);
    const report = await app().inject({
      method: 'PUT',
      url: '/v1/me/push/client',
      headers: { origin: 'http://localhost:5173', cookie: on.cookie, 'user-agent': ANDROID },
      payload: { permission: 'granted', installed: true, enabled: true },
    });
    expect(report.statusCode, report.body).toBe(200);
    expect((await call(off, 'PUT', '/v1/me/push/client', { permission: 'nope' })).statusCode).toBe(
      400,
    );

    const rows = await overview();
    const onRow = rows.find((row) => row.user.id === on.id);
    const offRow = rows.find((row) => row.user.id === off.id);
    expect(onRow?.pushOn).toBe(true);
    expect(onRow?.devices[0]).toMatchObject({
      pushOn: true,
      installed: true,
      permission: 'granted',
    });
    expect(offRow?.pushOn).toBe(false);
    expect(offRow?.devices[0]).toMatchObject({ pushOn: false, installed: null, permission: null });
    // Paged by cursor: nobody twice.
    expect(new Set(rows.map((row) => row.user.id)).size).toBe(rows.length);
  });
});

describe('POST /v1/admin/notifications/remind', () => {
  it('messages each chosen person in their language, audited; admins only', async () => {
    const [english, hindi] = [await person(), await person()];
    await call(hindi, 'PATCH', '/v1/me/profile', { language: 'hi' });
    expect(
      (await call(english, 'POST', '/v1/admin/notifications/remind', { userIds: [hindi.id] }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call(admin, 'POST', '/v1/admin/notifications/remind', { userIds: [] })).statusCode,
    ).toBe(400);
    const response = await call(admin, 'POST', '/v1/admin/notifications/remind', {
      userIds: [english.id, hindi.id, admin.id],
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(remindResponseSchema.parse(response.json()).sent).toBe(2);

    const lastText = async (who: Person) => {
      const chat = await call(who, 'POST', '/v1/chats/direct', { userId: admin.id });
      const chatId = chatResponseSchema.parse(chat.json()).chat.id;
      const history = await call(who, 'GET', `/v1/chats/${chatId}/messages`);
      return messageSchema.array().parse(history.json().items).at(-1)?.text ?? '';
    };
    expect(await lastText(english)).toContain('turn on notifications');
    expect(await lastText(hindi)).toContain('नोटिफ़िकेशन');
    const audit = auditLogResponseSchema.parse(
      (await call(admin, 'GET', '/v1/admin/audit-log')).json(),
    );
    expect(audit.items.filter((entry) => entry.action === 'notifications.remind')).toHaveLength(2);
  });
});

describe('notification settings', () => {
  it('start all on, and change only what is sent', async () => {
    const user = await person();
    const read = await call(user, 'GET', '/v1/me/push');
    expect(read.json().settings).toMatchObject({
      sound: true,
      tone: 'chime',
      soundMessages: true,
      soundMentions: true,
      soundSent: true,
      soundOpenChat: true,
    });
    const saved = await call(user, 'PUT', '/v1/me/push/settings', {
      tone: 'glass',
      soundVolume: 30,
    });
    expect(pushSettingsResponseSchema.parse(saved.json()).settings).toMatchObject({
      tone: 'glass',
      soundVolume: 30,
      sound: true,
    });
    expect((await call(user, 'PUT', '/v1/me/push/settings', { tone: 'horn' })).statusCode).toBe(
      400,
    );
  });
});

describe('a group with a hidden admin', () => {
  it('normal members do not count the admin; the admin does', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await group(admin, [asha, bharat]);
    expect((await summary(asha, chatId)).group?.memberCount).toBe(2);
    expect((await summary(admin, chatId)).group?.memberCount).toBe(3);
    const plain = await group(asha, [bharat]);
    expect((await summary(asha, plain)).group?.memberCount).toBe(2);
  });
});
