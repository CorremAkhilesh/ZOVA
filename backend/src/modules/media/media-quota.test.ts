import {
  adminStorageQuotaResponseSchema,
  adminUsersResponseSchema,
  apiErrorSchema,
  storageUsageSchema,
} from '@zuvo/protocol';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { headers, outbox } from '../../../test/auth-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { mediaClient, PDF } from '../../../test/media-helpers.ts';
import { signedIn } from '../../../test/realtime-helpers.ts';
import { registerSecurityModels } from '../../db/security-models.ts';

const MB = 1024 * 1024;
const GB = 1024 * MB;

type Person = Awaited<ReturnType<typeof signedIn>>;

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const client = () => mediaClient(app());
let people = 0;
const person = () => {
  people += 1;
  return signedIn(app(), `quota${people}@corremadvisory.com`);
};
const admin = () => signedIn(app(), 'admin@corremadvisory.com');
const doc = (size: number, kind = 'document') => ({
  kind,
  name: 'big.pdf',
  mime: 'application/pdf',
  size,
});

beforeAll(async () => {
  built = await buildTestApp();
});
afterAll(() => built.cleanup());
beforeEach(() => {
  // Plenty of disk: these tests are about each person's share of it.
  vi.spyOn(app().storage, 'space').mockResolvedValue({ total: 10_000 * GB, free: 9_000 * GB });
  return () => vi.restoreAllMocks();
});

const usage = async (who: Person) => {
  const response = await app().inject({
    method: 'GET',
    url: '/v1/me/storage',
    headers: headers(who.cookie),
  });
  expect(response.statusCode).toBe(200);
  return storageUsageSchema.parse(response.json());
};

const setQuota = (by: Person, id: string, quotaMb: unknown) =>
  app().inject({
    method: 'PUT',
    url: `/v1/admin/users/${id}/storage-quota`,
    headers: headers(by.cookie),
    payload: { quotaMb, reason: 'test' },
  });

describe('3 GB per person', () => {
  it('counts uploads still on their way, and refuses what would go past it', async () => {
    const who = await person();
    for (let i = 0; i < 3; i++) {
      expect((await client().start(who, doc(GB))).statusCode).toBe(200);
    }
    const over = await client().start(who, doc(1));
    expect(over.statusCode).toBe(413);
    expect(apiErrorSchema.parse(over.json())).toMatchObject({
      code: 'STORAGE_QUOTA_EXCEEDED',
      details: { usedBytes: 3 * GB, quotaBytes: 3 * GB },
    });
  });

  it('gives the room back when an upload is cancelled', async () => {
    const who = await person();
    const first = (await client().start(who, doc(GB))).json();
    await client().start(who, doc(GB));
    await client().start(who, doc(GB - 1));
    expect((await client().start(who, doc(2))).statusCode).toBe(413);
    const cancelled = await app().inject({
      method: 'DELETE',
      url: `/v1/uploads/${first.uploadId}`,
      headers: headers(who.cookie),
    });
    expect(cancelled.statusCode, cancelled.body).toBeLessThan(300);
    expect((await client().start(who, doc(GB))).statusCode).toBe(200);
  });

  it('is one person’s own: someone else’s files do not count', async () => {
    const full = await person();
    await client().start(full, doc(GB));
    await client().start(full, doc(GB));
    await client().start(full, doc(GB));
    expect((await client().start(await person(), doc(GB))).statusCode).toBe(200);
  });
});

describe('GET /v1/me/storage', () => {
  it('shows my finished files by kind, what is on its way, and my limit', async () => {
    const who = await person();
    await client().ready(who, 'document', 'a.pdf', PDF);
    await client().start(who, doc(5 * MB, 'video'));
    expect(await usage(who)).toEqual({
      usedBytes: PDF.length,
      pendingBytes: 5 * MB,
      quotaBytes: 3 * GB,
      byKind: { image: 0, video: 0, audio: 0, voice: 0, document: PDF.length },
    });
    expect((await usage(await person())).usedBytes).toBe(0);
  });

  it('needs a session', async () => {
    const response = await app().inject({ method: 'GET', url: '/v1/me/storage' });
    expect(response.statusCode).toBe(401);
  });
});

describe('an admin changes one person’s limit', () => {
  it('raises it, the person can upload more, and it is audited', async () => {
    const boss = await admin();
    const who = await person();
    for (let i = 0; i < 3; i++) await client().start(who, doc(GB));
    const response = await setQuota(boss, who.id, 5120);
    expect(response.statusCode).toBe(200);
    expect(adminStorageQuotaResponseSchema.parse(response.json())).toEqual({
      quotaBytes: 5 * GB,
      custom: true,
    });
    expect((await client().start(who, doc(GB))).statusCode).toBe(200);
    expect((await usage(who)).quotaBytes).toBe(5 * GB);
    const audit = await registerSecurityModels(app().mongo)
      .AuditLog.findOne({ action: 'storage.quota', targetId: who.id })
      .lean();
    expect(audit?.actorEmail).toBe('admin@corremadvisory.com');

    const list = await app().inject({
      method: 'GET',
      url: `/v1/admin/users?q=${encodeURIComponent(who.email)}`,
      headers: headers(boss.cookie),
    });
    expect(adminUsersResponseSchema.parse(list.json()).items[0]?.quotaBytes).toBe(5 * GB);
  });

  it('null puts the default back', async () => {
    const boss = await admin();
    const who = await person();
    await setQuota(boss, who.id, 5120);
    const response = await setQuota(boss, who.id, null);
    expect(response.json()).toEqual({ quotaBytes: 3 * GB, custom: false });
    expect((await usage(who)).quotaBytes).toBe(3 * GB);
  });

  it.each([0, 99, 1.5, 'lots', 2_000_000])('refuses %s MB', async (quotaMb) => {
    const who = await person();
    expect((await setQuota(await admin(), who.id, quotaMb)).statusCode).toBe(400);
  });

  it('is admin-only, needs a session, and answers 404 for nobody', async () => {
    const who = await person();
    expect((await setQuota(who, who.id, 5120)).statusCode).toBe(403);
    const anonymous = await app().inject({
      method: 'PUT',
      url: `/v1/admin/users/${who.id}/storage-quota`,
      headers: headers(),
      payload: { quotaMb: 5120, reason: 'test' },
    });
    expect(anonymous.statusCode).toBe(401);
    expect((await setQuota(await admin(), '0123456789abcdef01234567', 5120)).statusCode).toBe(404);
  });
});

describe('the server-wide guard at 85%', () => {
  it('refuses uploads past 85% and emails the admins once, not on every refusal', async () => {
    vi.spyOn(app().storage, 'space').mockResolvedValue({ total: 100 * GB, free: 15 * GB + 100 });
    const who = await person();
    expect((await client().start(who, doc(100))).statusCode).toBe(200);
    const refused = await client().start(who, doc(101));
    expect(refused.statusCode).toBe(507);
    expect(refused.json()).toMatchObject({ code: 'STORAGE_FULL' });
    await client().start(who, doc(101));
    const alerts = () => outbox(app()).outbox.filter((mail) => /disk/i.test(mail.subject));
    await vi.waitFor(() => expect(alerts()).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]?.to).toBe('admin@corremadvisory.com');
    expect(alerts()[0]?.text).toContain('85%');
  });
});
