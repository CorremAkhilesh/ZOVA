import { adminDashboardSchema } from '@zuvo/protocol';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { signedIn } from '../../../test/realtime-helpers.ts';
import { adminDashboard } from '../../admin/dashboard.service.ts';
import { dayKey, lastDays, recordActivity } from '../../admin/report-days.ts';
import { callModels } from '../../calls/call-finish.ts';
import { chatModels } from '../../chats/chats.service.ts';
import { registerActivityModels } from '../../db/activity-models.ts';

// Admin → Dashboard: admin only, counts that add up, and never any content.

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call, group, say } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;
let admin: Person;
const GB = 1024 ** 3;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
  admin = await signedIn(built.app, 'admin@corremadvisory.com');
});
afterAll(async () => {
  await built.cleanup();
});

const fresh = () => adminDashboard(app(), new Date(), { fresh: true });

async function storedFile(owner: Person, size: number, name: string) {
  await chatModels(app()).Media.create({
    ownerId: new Types.ObjectId(owner.id),
    kind: 'document',
    mime: 'application/pdf',
    size,
    name,
    status: 'ready',
    storageKey: `aa/${new Types.ObjectId().toString()}`,
  });
}

describe('GET /v1/admin/dashboard', () => {
  it('admins only: 401 signed out, 403 for a normal user', async () => {
    const user = await person();
    expect((await call(null, 'GET', '/v1/admin/dashboard')).statusCode).toBe(401);
    expect((await call(user, 'GET', '/v1/admin/dashboard')).statusCode).toBe(403);
  });

  it('answers in the protocol shape, with 30 days ending today', async () => {
    const response = await call(admin, 'GET', '/v1/admin/dashboard');
    expect(response.statusCode, response.body).toBe(200);
    const body = adminDashboardSchema.parse(response.json());
    expect(body.series).toHaveLength(30);
    expect(body.series.at(-1)?.date).toBe(dayKey(new Date()));
    expect(body.health.mongodb).toBe('ok');
    // No Redis in tests: no queue to ask.
    expect(body.health.emailQueue).toBeNull();
    expect(body.storage.disk?.guardPercent).toBe(85);
  });
});

describe('the numbers', () => {
  it('counts people by status and role, and who is active today and this week', async () => {
    const [one, two, gone] = [await person(), await person(), await person()];
    expect(
      (await call(admin, 'POST', `/v1/admin/users/${gone.id}/deactivate`, { reason: 'left' }))
        .statusCode,
    ).toBe(200);
    // Earlier this week (not today): counts for the week only.
    const days = lastDays(new Date(), 7);
    await recordActivity(app(), one.id, new Date(`${days[2]}T06:00:00Z`));
    await recordActivity(app(), two.id);
    await recordActivity(app(), two.id); // twice the same day: once

    const body = await fresh();
    expect(body.users.deactivated).toBeGreaterThanOrEqual(1);
    expect(body.users.active).toBe(body.users.total - body.users.deactivated);
    expect(body.users.admins).toBeGreaterThanOrEqual(1);
    const { ActivityDay } = registerActivityModels(app().mongo);
    expect(body.users.activeToday).toBe(
      await ActivityDay.countDocuments({ day: dayKey(new Date()) }),
    );
    expect(body.users.active7d).toBeGreaterThanOrEqual(2);
    expect(body.series.find((day) => day.date === days[2])?.activeUsers).toBeGreaterThanOrEqual(1);
  });

  it('counts messages people sent today (not system lines) and calls started', async () => {
    const before = await fresh();
    const [a, b] = [await person(), await person()];
    const chatId = await group(a, [b]); // adds system lines, which do not count
    await say(a, chatId, 'one');
    await say(b, chatId, 'two');
    await callModels(app()).Call.collection.insertOne({ userIds: [], status: 'ended' });

    const after = await fresh();
    expect(after.today.messages - before.today.messages).toBe(2);
    expect(after.today.calls - before.today.calls).toBe(1);
    expect(after.series.at(-1)?.messages).toBe(after.today.messages);
  });

  it('shares of push, and the storage of everyone and of the top people', async () => {
    const heavy = await person();
    await storedFile(heavy, 5 * GB, 'big.pdf');
    const body = await fresh();
    expect(body.notifications.percent).toBeGreaterThanOrEqual(0);
    expect(body.notifications.percent).toBeLessThanOrEqual(100);
    expect(body.storage.filesBytes).toBeGreaterThanOrEqual(5 * GB);
    expect(body.storage.topUsers[0]).toMatchObject({
      id: heavy.id,
      usedBytes: 5 * GB,
      quotaBytes: 3072 * 1024 * 1024,
    });
    expect(body.storage.topUsers.length).toBeLessThanOrEqual(10);
  });

  it('reads the disk and its guard, and says so when the disk cannot be read', async () => {
    const space = vi.spyOn(app().storage, 'space');
    space.mockResolvedValueOnce({ total: 1000 * GB, free: 120 * GB });
    expect((await fresh()).storage.disk).toEqual({
      totalBytes: 1000 * GB,
      usedBytes: 880 * GB,
      percent: 88,
      guardPercent: 85,
    });
    space.mockRejectedValueOnce(new Error('no statfs'));
    expect((await fresh()).storage.disk).toBeNull();
    space.mockRestore();
  });
});

describe('privacy', () => {
  it('never contains a message text, a file name or a storage key', async () => {
    const [a, b] = [await person(), await person()];
    const chatId = await group(a, [b], 'Secret project');
    await say(a, chatId, 'the merger is on friday');
    await storedFile(a, 1024, 'salaries-2026.xlsx');
    const text = JSON.stringify(await fresh());
    for (const secret of ['merger', 'salaries-2026', 'Secret project', 'aa/', 'sha256']) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('caching', () => {
  it('works the numbers out at most once a minute', async () => {
    const first = await adminDashboard(app(), new Date('2030-01-01T10:00:00Z'), { fresh: true });
    const again = await adminDashboard(app(), new Date('2030-01-01T10:00:30Z'));
    expect(again.generatedAt).toBe(first.generatedAt);
    const later = await adminDashboard(app(), new Date('2030-01-01T10:01:01Z'));
    expect(later.generatedAt).not.toBe(first.generatedAt);
  });
});
