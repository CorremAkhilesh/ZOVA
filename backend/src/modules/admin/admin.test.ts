import {
  adminUserResponseSchema,
  adminUsersResponseSchema,
  auditLogResponseSchema,
} from '@zuvo/protocol';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { headers, me, signIn } from '../../../test/auth-helpers.ts';
import { expectIndexedQuery } from '../../../test/expect-indexed-query.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { insertUser } from '../../../test/user-helpers.ts';
import { assertNotLastAdmin, findTarget } from '../../admin/admin.service.ts';
import { registerSecurityModels } from '../../db/security-models.ts';
import { usersModel } from '../../users/user-record.ts';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => ctx.app;
let admin: { cookie: string; id: string };
let user: { cookie: string; id: string };

beforeAll(async () => {
  ctx = await buildTestApp();
  // admin@ is in ADMIN_EMAILS for tests, so the account starts as an admin.
  const a = await signIn(app(), 'admin@corremadvisory.com');
  admin = { cookie: a.cookie, id: a.response.json().user.id };
  const u = await signIn(app(), 'dev@corremadvisory.com');
  user = { cookie: u.cookie, id: u.response.json().user.id };
});
afterAll(async () => {
  await ctx.cleanup();
});

const call = (method: 'GET' | 'POST' | 'PUT', url: string, cookie?: string, payload?: object) =>
  app().inject({ method, url, headers: headers(cookie), ...(payload ? { payload } : {}) });

describe('admin access', () => {
  it('is admin-only: 401 without a session, 403 for users', async () => {
    for (const [method, url] of [
      ['GET', '/v1/admin/users'],
      ['GET', '/v1/admin/audit-log'],
      ['PUT', `/v1/admin/users/${admin.id}/role`],
      ['POST', `/v1/admin/users/${admin.id}/deactivate`],
    ] as const) {
      expect((await call(method, url)).statusCode, url).toBe(401);
      expect((await call(method, url, user.cookie, { role: 'user' })).statusCode, url).toBe(403);
    }
  });
});

describe('Admin → Users', () => {
  it('lists users newest first with search and cursor pagination', async () => {
    for (const n of [1, 2, 3]) {
      await insertUser(app(), {
        email: `tester${n}@corremadvisory.com`,
        displayName: `Tester ${n}`,
        searchTerms: ['tester', String(n)],
      });
    }
    const page = adminUsersResponseSchema.parse(
      (await call('GET', '/v1/admin/users?limit=2&q=tester', admin.cookie)).json(),
    );
    expect(page.items.map((u) => u.email)).toEqual([
      'tester3@corremadvisory.com',
      'tester2@corremadvisory.com',
    ]);
    const next = await call(
      'GET',
      `/v1/admin/users?limit=2&q=tester&cursor=${page.nextCursor}`,
      admin.cookie,
    );
    expect(adminUsersResponseSchema.parse(next.json())).toMatchObject({ nextCursor: null });
    const byEmail = await call('GET', '/v1/admin/users?q=dev@', admin.cookie);
    expect(byEmail.json().items.map((u: { email: string }) => u.email)).toEqual([
      'dev@corremadvisory.com',
    ]);
    const all = await call('GET', '/v1/admin/users', admin.cookie);
    expect(all.json().items.length).toBeGreaterThanOrEqual(5);
  });

  it('promotes and demotes, but never yourself and never the last admin', async () => {
    const self = await call('PUT', `/v1/admin/users/${admin.id}/role`, admin.cookie, {
      role: 'user',
    });
    expect(self.statusCode).toBe(409);
    const selfOff = await call('POST', `/v1/admin/users/${admin.id}/deactivate`, admin.cookie);
    expect(selfOff.statusCode).toBe(409);

    const promoted = await call('PUT', `/v1/admin/users/${user.id}/role`, admin.cookie, {
      role: 'admin',
    });
    expect(adminUserResponseSchema.parse(promoted.json()).user.role).toBe('admin');
    // Now dev@ is an admin too; demote dev@ back — two admins exist, so it is allowed.
    const demoted = await call('PUT', `/v1/admin/users/${user.id}/role`, admin.cookie, {
      role: 'user',
    });
    expect(demoted.json().user.role).toBe('user');
  });

  it('keeps at least one active admin (guard against concurrent demotions)', async () => {
    // An acting admin always counts too, so via the API this only triggers in a race; check the
    // guard directly: admin@ is now the only active admin.
    const target = await findTarget(app(), admin.id);
    await expect(assertNotLastAdmin(app(), target)).rejects.toMatchObject({ code: 'LAST_ADMIN' });
    const second = await insertUser(app(), { email: 'boss@corremadvisory.com', role: 'admin' });
    await expect(assertNotLastAdmin(app(), target)).resolves.toBeUndefined();
    await usersModel(app()).updateOne(
      { _id: new Types.ObjectId(second) },
      { $set: { role: 'user' } },
    );
  });

  it('deactivates (revoking sessions) and reactivates, auditing every change', async () => {
    const off = await call('POST', `/v1/admin/users/${user.id}/deactivate`, admin.cookie);
    expect(off.json()).toMatchObject({ user: { status: 'deactivated' } });
    expect((await me(app(), user.cookie)).statusCode).toBe(401);
    await call('POST', `/v1/admin/users/${user.id}/reactivate`, admin.cookie);
    expect(
      (await call('POST', '/v1/admin/users/000000000000000000000000/reactivate', admin.cookie))
        .statusCode,
    ).toBe(404);

    const log = auditLogResponseSchema.parse(
      (await call('GET', '/v1/admin/audit-log?limit=2', admin.cookie)).json(),
    );
    expect(log.items.map((e) => e.action)).toEqual(['user.reactivate', 'user.deactivate']);
    expect(log.items[0]).toMatchObject({
      actor: { id: admin.id, email: 'admin@corremadvisory.com' },
      target: { id: user.id, email: 'dev@corremadvisory.com' },
    });
    const older = await call(
      'GET',
      `/v1/admin/audit-log?limit=10&cursor=${log.nextCursor}`,
      admin.cookie,
    );
    expect(older.json().items.map((e: { action: string }) => e.action)).toEqual([
      'user.demote',
      'user.promote',
    ]);
  });

  it('uses indexes for the admin queries', async () => {
    const Audit = registerSecurityModels(app().mongo).AuditLog;
    const at = new Date();
    await expectIndexedQuery(
      Audit.find({ $or: [{ at: { $lt: at } }, { at, _id: { $lt: new Types.ObjectId() } }] })
        .sort({ at: -1, _id: -1 })
        .limit(51),
    );
    await expectIndexedQuery(usersModel(app()).find({ role: 'admin', status: 'active' }));
    await expectIndexedQuery(usersModel(app()).find({ email: /^dev@/ }).sort({ _id: -1 }));
  });
});
