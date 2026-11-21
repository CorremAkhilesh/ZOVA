import {
  adminAnnouncementsResponseSchema,
  announcementBannersResponseSchema,
} from '@zuvo/protocol';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { signedIn } from '../../../test/realtime-helpers.ts';
import { announcementText } from '../../admin/announcements.ts';
import { chatModels } from '../../chats/chats.service.ts';
import { registerAnnouncementModels } from '../../db/announcement-models.ts';

// Announcements: a banner for everyone or chosen people, and/or a chat message from the admin.

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;
let admin: Person;
const WHY = { reason: 'Planned maintenance' };
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
  admin = await signedIn(built.app, 'admin@corremadvisory.com');
});
afterAll(async () => {
  await built.cleanup();
});

const announce = (body: object, who: Person | null = admin) =>
  call(who, 'POST', '/v1/admin/announcements', {
    title: 'Maintenance tonight',
    body: 'The app is down from 10 to 11 pm.',
    level: 'warning',
    audience: { kind: 'all' },
    banner: true,
    message: false,
    ...WHY,
    ...body,
  });
const banners = async (who: Person) =>
  announcementBannersResponseSchema.parse((await call(who, 'GET', '/v1/announcements')).json())
    .items;
const titles = async (who: Person) => (await banners(who)).map((item) => item.title);

describe('banners', () => {
  it('everyone sees one for all; closing it hides it on my devices only; ending hides it for all', async () => {
    const [one, two] = [await person(), await person()];
    const made = await announce({ title: 'For all', endsAt: inDays(2) });
    expect(made.statusCode, made.body).toBe(200);
    const { id } = made.json().announcement;
    expect(made.json().announcement).toMatchObject({
      state: 'active',
      audience: 'all',
      level: 'warning',
    });
    expect(await titles(one)).toContain('For all');
    expect(await titles(two)).toContain('For all');

    expect((await call(one, 'POST', `/v1/announcements/${id}/dismiss`)).statusCode).toBe(200);
    expect(await titles(one)).not.toContain('For all');
    expect(await titles(two)).toContain('For all');

    const ended = await call(admin, 'POST', `/v1/admin/announcements/${id}/end`, WHY);
    expect(ended.json().announcement.state).toBe('ended');
    expect(await titles(two)).not.toContain('For all');
  });

  it('only the chosen people see one meant for them', async () => {
    const [chosen, other] = [await person(), await person()];
    await announce({ title: 'Just for you', audience: { kind: 'some', userIds: [chosen.id] } });
    expect(await titles(chosen)).toContain('Just for you');
    expect(await titles(other)).not.toContain('Just for you');
  });

  it('goes on its own when its end passes', async () => {
    const who = await person();
    const { id } = (await announce({ title: 'Short', endsAt: inDays(1) })).json().announcement;
    await registerAnnouncementModels(app().mongo).Announcement.updateOne(
      { _id: new Types.ObjectId(id) },
      { $set: { endsAt: new Date(Date.now() - 1000) } },
    );
    expect(await titles(who)).not.toContain('Short');
  });
});

describe('as a message', () => {
  it('reaches each person as a chat message from the admin', async () => {
    const who = await person();
    const made = await announce({
      title: 'Holiday',
      body: 'Office closed Friday.',
      banner: false,
      message: true,
      audience: { kind: 'some', userIds: [who.id] },
    });
    expect(made.json().announcement).toMatchObject({
      state: 'ended',
      recipients: 1,
      message: true,
    });
    await vi.waitFor(
      async () =>
        expect(
          await chatModels(app()).Message.exists({
            senderId: new Types.ObjectId(admin.id),
            text: announcementText('Holiday', 'Office closed Friday.'),
          }),
        ).not.toBeNull(),
      { timeout: 10_000 },
    );
  });
});

describe('admin list and audit', () => {
  it('lists newest first with paging, and audits making and ending', async () => {
    await announce({ title: 'First' });
    await announce({ title: 'Second' });
    const page = adminAnnouncementsResponseSchema.parse(
      (await call(admin, 'GET', '/v1/admin/announcements?limit=1')).json(),
    );
    expect(page.items[0]?.title).toBe('Second');
    expect(page.nextCursor).not.toBeNull();
    const log = (await call(admin, 'GET', '/v1/admin/audit-log?limit=1')).json().items[0];
    expect(log).toMatchObject({
      action: 'announcement.create',
      reason: 'Planned maintenance',
      details: { title: 'Second', audience: 'all', banner: 'yes', message: 'no' },
    });
  });
});

describe('validation and access', () => {
  it('needs a banner or a message, a sensible end, a reason, and text', async () => {
    expect((await announce({ banner: false, message: false })).statusCode).toBe(400);
    expect((await announce({ endsAt: inDays(-1) })).statusCode).toBe(400);
    expect((await announce({ endsAt: inDays(120) })).statusCode).toBe(400);
    expect((await announce({ reason: '' })).statusCode).toBe(400);
    expect((await announce({ title: '' })).statusCode).toBe(400);
    expect((await announce({ body: 'x'.repeat(1001) })).statusCode).toBe(400);
    const nobody = new Types.ObjectId().toString();
    expect((await announce({ audience: { kind: 'some', userIds: [nobody] } })).statusCode).toBe(
      400,
    );
  });

  it('admins only to make, list and end; a session to read and close banners', async () => {
    const who = await person();
    expect((await announce({}, who)).statusCode).toBe(403);
    expect((await call(who, 'GET', '/v1/admin/announcements')).statusCode).toBe(403);
    const { id } = (await announce({ title: 'Locked' })).json().announcement;
    expect((await call(who, 'POST', `/v1/admin/announcements/${id}/end`, WHY)).statusCode).toBe(
      403,
    );
    expect((await call(null, 'GET', '/v1/announcements')).statusCode).toBe(401);
    const nobody = new Types.ObjectId().toString();
    expect((await call(who, 'POST', `/v1/announcements/${nobody}/dismiss`)).statusCode).toBe(404);
  });
});
