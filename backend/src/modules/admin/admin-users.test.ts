import {
  adminBulkResponseSchema,
  adminUserDetailSchema,
  adminUsersResponseSchema,
  auditLogResponseSchema,
} from '@zuvo/protocol';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { subscribeDevice } from '../../../test/push-helpers.ts';
import { signedIn } from '../../../test/realtime-helpers.ts';
import { chatModels } from '../../chats/chats.service.ts';

// Admin → Users v2: filters, sorts, pages, one person's page, signing out, bulk, CSV and reasons.

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;
let admin: Person;
const WHY = { reason: 'team change' };
const MB = 1024 * 1024;
const GB = 1024 * MB;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
  admin = await signedIn(built.app, 'admin@corremadvisory.com');
});
afterAll(async () => {
  await built.cleanup();
});

async function stores(owner: Person, size: number, name = 'plan.pdf') {
  await chatModels(app()).Media.create({
    ownerId: new Types.ObjectId(owner.id),
    kind: 'document',
    mime: 'application/pdf',
    size,
    name,
    status: 'ready',
    storageKey: `ab/${new Types.ObjectId().toString()}`,
  });
}

async function list(query = '') {
  const response = await call(admin, 'GET', `/v1/admin/users${query}`);
  expect(response.statusCode, response.body).toBe(200);
  return adminUsersResponseSchema.parse(response.json());
}

/** Every page, in order. */
async function all(query: string) {
  const items = [];
  let cursor: string | null = null;
  do {
    const page = await list(`?limit=2&${query}${cursor ? `&cursor=${cursor}` : ''}`);
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

const audits = async () =>
  auditLogResponseSchema.parse((await call(admin, 'GET', '/v1/admin/audit-log?limit=20')).json())
    .items;

describe('the list', () => {
  it('filters: active, deactivated, admins, notifications off, storage 80%+', async () => {
    const [full, quiet, gone, pushed] = [
      await person(),
      await person(),
      await person(),
      await person(),
    ];
    await stores(full, 2.5 * GB);
    await subscribeDevice(app(), pushed.cookie);
    await call(admin, 'POST', `/v1/admin/users/${gone.id}/deactivate`, WHY);

    const ids = async (filter: string) => (await all(`filter=${filter}`)).map((row) => row.id);
    expect(await ids('storageHigh')).toContain(full.id);
    expect(await ids('storageHigh')).not.toContain(quiet.id);
    expect(await ids('deactivated')).toEqual(expect.arrayContaining([gone.id]));
    expect(await ids('active')).not.toContain(gone.id);
    expect(await ids('admins')).toContain(admin.id);
    expect(await ids('admins')).not.toContain(quiet.id);
    const off = await ids('pushOff');
    expect(off).toContain(quiet.id);
    expect(off).not.toContain(pushed.id);
    expect(off).not.toContain(gone.id);
    const row = (await all('filter=all')).find((item) => item.id === pushed.id);
    expect(row).toMatchObject({ pushOn: true, deviceCount: 1, quotaCustom: false });
    expect(row?.lastActiveAt).not.toBeNull();
  });

  it('sorts by storage and name, and pages through everyone once', async () => {
    const big = await person();
    await stores(big, 9 * GB);
    expect((await list('?sort=storage&limit=1')).items[0]?.id).toBe(big.id);
    const byName = await all('sort=name');
    const names = byName.map((row) => (row.displayName ?? row.email).toLocaleLowerCase());
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(new Set(byName.map((row) => row.id)).size).toBe(byName.length);
    expect(byName.length).toBe((await all('sort=newest')).length);
  });

  it('rejects an unknown filter or sort, and a cursor from another view ends the list', async () => {
    expect((await call(admin, 'GET', '/v1/admin/users?filter=everyone')).statusCode).toBe(400);
    expect((await call(admin, 'GET', '/v1/admin/users?sort=age')).statusCode).toBe(400);
    expect(await list(`?cursor=${new Types.ObjectId().toString()}`)).toEqual({
      items: [],
      nextCursor: null,
    });
  });
});

describe('one person', () => {
  it('shows devices, storage by kind and the limit; never a file name', async () => {
    const who = await person();
    await subscribeDevice(app(), who.cookie);
    await stores(who, 3 * MB, 'salaries-2026.xlsx');
    const response = await call(admin, 'GET', `/v1/admin/users/${who.id}`);
    expect(response.statusCode, response.body).toBe(200);
    const detail = adminUserDetailSchema.parse(response.json());
    expect(detail.user.id).toBe(who.id);
    expect(detail.devices).toHaveLength(1);
    expect(detail.devices[0]?.pushOn).toBe(true);
    expect(detail.storage).toMatchObject({ usedBytes: 3 * MB, custom: false });
    expect(detail.storage.byKind.document).toBe(3 * MB);
    expect(response.body).not.toContain('salaries');
  });

  it('admins only, and 404 for nobody', async () => {
    const who = await person();
    expect((await call(null, 'GET', `/v1/admin/users/${who.id}`)).statusCode).toBe(401);
    expect((await call(who, 'GET', `/v1/admin/users/${admin.id}`)).statusCode).toBe(403);
    const nobody = new Types.ObjectId().toString();
    expect((await call(admin, 'GET', `/v1/admin/users/${nobody}`)).statusCode).toBe(404);
  });
});

describe('signing someone out', () => {
  it('ends every session now, keeps the account, and audits the reason', async () => {
    const who = await person();
    const response = await call(admin, 'POST', `/v1/admin/users/${who.id}/sign-out`, WHY);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().revokedSessions).toBeGreaterThanOrEqual(1);
    expect((await call(who, 'GET', '/v1/auth/me')).statusCode).toBe(401);
    expect((await list(`?q=${who.email}`)).items[0]?.status).toBe('active');
    expect((await audits())[0]).toMatchObject({
      action: 'user.signout',
      target: { id: who.id },
      reason: 'team change',
    });
  });

  it('needs a reason, and never signs out the admin doing it', async () => {
    const who = await person();
    expect((await call(admin, 'POST', `/v1/admin/users/${who.id}/sign-out`, {})).statusCode).toBe(
      400,
    );
    expect(
      (await call(admin, 'POST', `/v1/admin/users/${who.id}/sign-out`, { reason: ' a ' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await call(admin, 'POST', `/v1/admin/users/${admin.id}/sign-out`, WHY)).statusCode,
    ).toBe(409);
  });
});

describe('reasons on every change', () => {
  it('deactivate, role and storage limit need one; the audit keeps it and what changed', async () => {
    const who = await person();
    const url = `/v1/admin/users/${who.id}`;
    expect((await call(admin, 'POST', `${url}/deactivate`, {})).statusCode).toBe(400);
    expect((await call(admin, 'PUT', `${url}/role`, { role: 'admin' })).statusCode).toBe(400);
    expect((await call(admin, 'PUT', `${url}/storage-quota`, { quotaMb: 5120 })).statusCode).toBe(
      400,
    );
    const set = await call(admin, 'PUT', `${url}/storage-quota`, { quotaMb: 5120, ...WHY });
    expect(set.statusCode, set.body).toBe(200);
    expect((await audits())[0]).toMatchObject({
      action: 'storage.quota',
      reason: 'team change',
      details: { fromMb: null, toMb: 5120, defaultMb: 3072 },
    });
  });
});

describe('bulk', () => {
  it('acts on each person through the usual checks, and says who was refused', async () => {
    const [one, two] = [await person(), await person()];
    const nobody = new Types.ObjectId().toString();
    const response = await call(admin, 'POST', '/v1/admin/users/bulk', {
      userIds: [one.id, admin.id, nobody, two.id],
      action: 'deactivate',
      ...WHY,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(adminBulkResponseSchema.parse(response.json()).results).toEqual([
      { id: one.id, ok: true, code: null },
      { id: admin.id, ok: false, code: 'CONFLICT' },
      { id: nobody, ok: false, code: 'NOT_FOUND' },
      { id: two.id, ok: true, code: null },
    ]);
    expect((await call(one, 'GET', '/v1/auth/me')).statusCode).toBe(401);
  });

  it('sets a storage limit for many, which then applies to each', async () => {
    const [one, two] = [await person(), await person()];
    const response = await call(admin, 'POST', '/v1/admin/users/bulk', {
      userIds: [one.id, two.id],
      action: 'storageQuota',
      quotaMb: 10_240,
      ...WHY,
    });
    expect(response.json().results.every((row: { ok: boolean }) => row.ok)).toBe(true);
    const mine = await call(one, 'GET', '/v1/me/storage');
    expect(mine.json().quotaBytes).toBe(10 * GB);
  });

  it('validates: a limit for the storage action, at most 100 people, each once, a reason', async () => {
    const who = await person();
    const bulk = (body: object) => call(admin, 'POST', '/v1/admin/users/bulk', body);
    expect((await bulk({ userIds: [who.id], action: 'storageQuota', ...WHY })).statusCode).toBe(
      400,
    );
    expect((await bulk({ userIds: [who.id, who.id], action: 'signOut', ...WHY })).statusCode).toBe(
      400,
    );
    const many = Array.from({ length: 101 }, () => new Types.ObjectId().toString());
    expect((await bulk({ userIds: many, action: 'signOut', ...WHY })).statusCode).toBe(400);
    expect((await bulk({ userIds: [who.id], action: 'signOut' })).statusCode).toBe(400);
    expect(
      (
        await call(who, 'POST', '/v1/admin/users/bulk', {
          userIds: [who.id],
          action: 'signOut',
          ...WHY,
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe('CSV', () => {
  it('downloads the filtered list with a header, safe cells, and an audit entry', async () => {
    const trick = await person();
    await call(trick, 'PATCH', '/v1/me/profile', { displayName: '=HYPERLINK("x")' });
    const response = await call(admin, 'GET', '/v1/admin/users/export?filter=active&sort=name');
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toMatch(/attachment; filename="people-/);
    const lines = response.body.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toContain('"Email"');
    expect(lines.some((line) => line.includes(trick.email))).toBe(true);
    expect(response.body).not.toContain('"=HYPERLINK');
    expect((await audits())[0]).toMatchObject({
      action: 'users.export',
      target: { id: admin.id },
      details: { filter: 'active' },
    });
    expect((await call(trick, 'GET', '/v1/admin/users/export')).statusCode).toBe(403);
  });
});
