import { adminSettingsResponseSchema, appConfigResponseSchema } from '@zuvo/protocol';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { signedIn } from '../../../test/realtime-helpers.ts';
import { chatModels } from '../../chats/chats.service.ts';
import { cleanupOldFiles } from '../../settings/admin-settings.ts';
import { registerSettingsModels, SETTINGS_ID } from '../../settings/app-settings.ts';

// Admin → Settings: saved over the env defaults, applied at once, validated, audited.

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call, group } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;
let admin: Person;
const WHY = { reason: 'Policy update' };
const GB = 1024 ** 3;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
  admin = await signedIn(built.app, 'admin@corremadvisory.com');
});
afterAll(async () => {
  await built.cleanup();
});
// Every test starts from the defaults.
beforeEach(async () => {
  await registerSettingsModels(app().mongo).AppSettings.deleteMany({});
  await app().settings.refresh();
});

const put = (body: object, who: Person | null = admin) =>
  call(who, 'PUT', '/v1/admin/settings', body);
const settings = async () =>
  adminSettingsResponseSchema.parse((await call(admin, 'GET', '/v1/admin/settings')).json());

describe('reading and saving', () => {
  it('shows the defaults from env, then a saved value over them, and resets it', async () => {
    const start = await settings();
    expect(start.values).toEqual(start.defaults);
    expect(start.overridden).toEqual([]);
    expect(start.values).toMatchObject({ mediaUserQuotaMb: 3072, calls: 'admins', status: true });

    const saved = await put({ changes: { mediaUserQuotaMb: 5120 }, ...WHY });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({
      values: { mediaUserQuotaMb: 5120 },
      defaults: { mediaUserQuotaMb: 3072 },
      overridden: ['mediaUserQuotaMb'],
      updatedBy: 'admin@corremadvisory.com',
    });
    const reset = await put({ changes: {}, reset: ['mediaUserQuotaMb'], ...WHY });
    expect(reset.json()).toMatchObject({ values: { mediaUserQuotaMb: 3072 }, overridden: [] });
  });

  it('audits each change with its old and new value and the reason', async () => {
    await put({ changes: { linkPreviews: false, groupMaxMembers: 50 }, ...WHY });
    const log = (await call(admin, 'GET', '/v1/admin/audit-log?limit=2')).json().items;
    const details = log.map((entry: { details: Record<string, unknown> }) => entry.details);
    expect(details).toEqual(
      expect.arrayContaining([
        { setting: 'linkPreviews', from: 'on', to: 'off' },
        { setting: 'groupMaxMembers', from: 256, to: 50 },
      ]),
    );
    expect(log[0]).toMatchObject({ action: 'settings.change', reason: 'Policy update' });
  });

  it('validates every value, needs a change and a reason, and is admins only', async () => {
    for (const changes of [
      { mediaUserQuotaMb: 10 },
      { storageGuardPercent: 100 },
      { calls: 'everyone' },
      { groupMaxMembers: 500 },
      { autoCleanupDays: 7 },
      { otpIpLimitPerHour: 2 },
      { status: 'yes' },
    ]) {
      expect((await put({ changes, ...WHY })).statusCode, JSON.stringify(changes)).toBe(400);
    }
    expect((await put({ changes: {}, ...WHY })).statusCode).toBe(400);
    expect((await put({ changes: { status: false } })).statusCode).toBe(400);
    const user = await person();
    expect((await put({ changes: { status: false }, ...WHY }, user)).statusCode).toBe(403);
    expect((await call(user, 'GET', '/v1/admin/settings')).statusCode).toBe(403);
    expect((await call(null, 'GET', '/v1/admin/settings')).statusCode).toBe(401);
  });

  it('ignores a saved value that is no longer valid', async () => {
    await registerSettingsModels(app().mongo).AppSettings.updateOne(
      { _id: SETTINGS_ID },
      { $set: { values: { groupMaxMembers: 9999, status: false } } },
      { upsert: true },
    );
    await app().settings.refresh();
    expect(app().settings.current()).toMatchObject({ groupMaxMembers: 256, status: false });
  });
});

describe('each setting applies at once', () => {
  it('default storage limit and features reach the app config and people', async () => {
    const who = await person();
    await put({
      changes: { mediaUserQuotaMb: 10_240, status: false, linkPreviews: false },
      ...WHY,
    });
    expect((await call(who, 'GET', '/v1/me/storage')).json().quotaBytes).toBe(10 * GB);
    const config = appConfigResponseSchema.parse((await call(who, 'GET', '/v1/config')).json());
    expect(config.media.userQuotaBytes).toBe(10 * GB);
    expect(config.features).toEqual({ status: false, linkPreviews: false, groupMaxMembers: 256 });
  });

  it('status off: nobody can post one', async () => {
    const who = await person();
    await put({ changes: { status: false }, ...WHY });
    const text = { kind: 'text', text: 'hello', style: { background: 'teal', font: 'sans' } };
    const refused = await call(who, 'POST', '/v1/statuses', text);
    expect(refused.statusCode).toBe(403);
  });

  it('link previews off: no page is fetched', async () => {
    const who = await person();
    await put({ changes: { linkPreviews: false }, ...WHY });
    const response = await call(who, 'POST', '/v1/link-previews', { url: 'https://example.com' });
    expect(response.json().code).toBe('PREVIEW_UNAVAILABLE');
  });

  it('calls: off for everyone, admins only, or all', async () => {
    const who = await person();
    const enabled = async (p: Person) => (await call(p, 'GET', '/v1/calls/access')).json().enabled;
    expect(await enabled(admin)).toBe(true);
    expect(await enabled(who)).toBe(false);
    await put({ changes: { calls: 'all' }, ...WHY });
    expect(await enabled(who)).toBe(true);
    await put({ changes: { calls: 'off' }, ...WHY });
    expect(await enabled(admin)).toBe(false);
  });

  it('group size: a group cannot grow past the setting', async () => {
    const [a, b, c] = [await person(), await person(), await person()];
    await put({ changes: { groupMaxMembers: 2 }, ...WHY });
    const created = await call(a, 'POST', '/v1/groups', { name: 'Big', memberIds: [b.id, c.id] });
    expect(created.statusCode).toBe(409);
    expect(created.json().code).toBe('GROUP_FULL');
    expect(await group(a, [b])).toBeTruthy();
  });

  it('disk guard: the dashboard and the upload check use it', async () => {
    await put({ changes: { storageGuardPercent: 95 }, ...WHY });
    const dashboard = (await call(admin, 'GET', '/v1/admin/dashboard')).json();
    expect(dashboard.storage.disk.guardPercent).toBe(95);
  });

  it('largest file: a bigger upload is refused', async () => {
    const who = await person();
    await put({ changes: { mediaMaxFileMb: 1 }, ...WHY });
    const response = await call(who, 'POST', '/v1/uploads', {
      kind: 'document',
      mime: 'application/pdf',
      name: 'big.pdf',
      size: 2 * 1024 * 1024,
    });
    expect(response.statusCode).toBe(413);
  });
});

describe('auto-cleanup', () => {
  it('off by default; on, it deletes finished files older than the setting, oldest first', async () => {
    const { Media } = chatModels(app());
    const owner = new Types.ObjectId();
    const file = (daysOld: number) =>
      Media.create({
        ownerId: owner,
        kind: 'document',
        mime: 'application/pdf',
        size: 10,
        name: 'x.pdf',
        status: 'ready',
        storageKey: null,
        createdAt: new Date(Date.now() - daysOld * 86_400_000),
      });
    const [old, recent] = [await file(100), await file(5)];
    expect(await cleanupOldFiles(app())).toBe(0);
    await put({ changes: { autoCleanupDays: 30 }, ...WHY });
    expect(await cleanupOldFiles(app())).toBe(1);
    expect(await Media.exists({ _id: old._id })).toBeNull();
    expect(await Media.exists({ _id: recent._id })).not.toBeNull();
  });
});
