import { adminUsersResponseSchema, auditLogResponseSchema } from '@zuvo/protocol';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { headers } from '../../../test/auth-helpers.ts';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { signedIn } from '../../../test/realtime-helpers.ts';
import { suspensionOf } from '../../auth/policy.ts';
import { usersModel } from '../../users/user-record.ts';

// Suspend: signed out at once, sign-in refused with the date and reason, ends on its own.

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;
let admin: Person;
const DAY = 86_400_000;
const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString();

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
  admin = await signedIn(built.app, 'admin@corremadvisory.com');
});
afterAll(async () => {
  await built.cleanup();
});

const suspend = (who: Person | null, id: string, body: object) =>
  call(who, 'POST', `/v1/admin/users/${id}/suspend`, body);
/** Past the suspension check: a code is sent, or the 60 s resend wait (checked after it) applies. */
async function notSuspended(email: string) {
  const response = await requestOtp(email);
  expect([200, 429]).toContain(response.statusCode);
  expect(response.json().code).not.toBe('ACCOUNT_SUSPENDED');
}

const requestOtp = (email: string) =>
  app().inject({
    method: 'POST',
    url: '/v1/auth/otp/request',
    headers: headers(),
    payload: { email },
  });

describe('suspending someone', () => {
  it('signs them out now and refuses sign-in with the date and the reason', async () => {
    const who = await person();
    const until = inDays(7);
    const response = await suspend(admin, who.id, { until, reason: 'Policy review' });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ suspendedUntil: until });
    expect((await call(who, 'GET', '/v1/auth/me')).statusCode).toBe(401);

    const refused = await requestOtp(who.email);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({
      code: 'ACCOUNT_SUSPENDED',
      details: { until, reason: 'Policy review' },
    });

    const rows = adminUsersResponseSchema.parse(
      (await call(admin, 'GET', '/v1/admin/users?filter=suspended')).json(),
    ).items;
    expect(rows.find((row) => row.id === who.id)).toMatchObject({
      suspendedUntil: until,
      suspendReason: 'Policy review',
      status: 'active',
    });
    const log = auditLogResponseSchema.parse(
      (await call(admin, 'GET', '/v1/admin/audit-log?limit=1')).json(),
    ).items[0];
    expect(log).toMatchObject({
      action: 'user.suspend',
      reason: 'Policy review',
      details: { until },
    });
  });

  it('ends on its own when the date passes', async () => {
    const who = await person();
    await suspend(admin, who.id, { until: inDays(1), reason: 'One day' });
    // A day later: the stored date is now in the past.
    await usersModel(app()).updateOne(
      { _id: new Types.ObjectId(who.id) },
      { $set: { suspendedUntil: new Date(Date.now() - 1000) } },
    );
    await notSuspended(who.email);
    const rows = (await call(admin, 'GET', '/v1/admin/users?filter=suspended')).json().items;
    expect(rows.map((row: { id: string }) => row.id)).not.toContain(who.id);
  });

  it('refuses a session left over from before (and its socket)', async () => {
    const who = await person();
    // Suspended straight in the database: the session was not ended.
    await usersModel(app()).updateOne(
      { _id: new Types.ObjectId(who.id) },
      { $set: { suspendedUntil: new Date(Date.now() + DAY), suspendReason: 'x' } },
    );
    expect((await call(who, 'GET', '/v1/auth/me')).statusCode).toBe(401);
  });

  it('can be ended early, with a reason, and is audited', async () => {
    const who = await person();
    await suspend(admin, who.id, { until: inDays(3), reason: 'Review' });
    const ended = await call(admin, 'POST', `/v1/admin/users/${who.id}/unsuspend`, {
      reason: 'Cleared',
    });
    expect(ended.statusCode, ended.body).toBe(200);
    expect(ended.json()).toEqual({ suspendedUntil: null });
    await notSuspended(who.email);
    const log = (await call(admin, 'GET', '/v1/admin/audit-log?limit=1')).json().items[0];
    expect(log).toMatchObject({ action: 'user.unsuspend', reason: 'Cleared' });
  });

  it('validates: a reason, a time from 5 minutes to a year ahead, never yourself', async () => {
    const who = await person();
    expect((await suspend(admin, who.id, { until: inDays(1) })).statusCode).toBe(400);
    expect((await suspend(admin, who.id, { until: 'tomorrow', reason: 'x y' })).statusCode).toBe(
      400,
    );
    const soon = new Date(Date.now() + 60_000).toISOString();
    expect((await suspend(admin, who.id, { until: soon, reason: 'Too soon' })).statusCode).toBe(
      400,
    );
    expect(
      (await suspend(admin, who.id, { until: inDays(400), reason: 'Too long' })).statusCode,
    ).toBe(400);
    expect(
      (await suspend(admin, admin.id, { until: inDays(1), reason: 'Myself' })).statusCode,
    ).toBe(409);
  });

  it('admins only', async () => {
    const who = await person();
    expect((await suspend(null, who.id, { until: inDays(1), reason: 'x y z' })).statusCode).toBe(
      401,
    );
    expect((await suspend(who, admin.id, { until: inDays(1), reason: 'x y z' })).statusCode).toBe(
      403,
    );
    const nobody = new Types.ObjectId().toString();
    expect((await suspend(admin, nobody, { until: inDays(1), reason: 'x y z' })).statusCode).toBe(
      404,
    );
  });

  it('in bulk, with a date', async () => {
    const [one, two] = [await person(), await person()];
    const response = await call(admin, 'POST', '/v1/admin/users/bulk', {
      userIds: [one.id, two.id],
      action: 'suspend',
      until: inDays(2),
      reason: 'Audit week',
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().results.every((row: { ok: boolean }) => row.ok)).toBe(true);
    expect((await requestOtp(two.email)).json().code).toBe('ACCOUNT_SUSPENDED');
    const missing = await call(admin, 'POST', '/v1/admin/users/bulk', {
      userIds: [one.id],
      action: 'suspend',
      reason: 'No date',
    });
    expect(missing.statusCode).toBe(400);
  });
});

describe('suspensionOf', () => {
  it('only a date still ahead counts', () => {
    const now = new Date('2026-11-21T10:00:00Z');
    expect(suspensionOf(null, now)).toBeNull();
    expect(suspensionOf({ suspendedUntil: null }, now)).toBeNull();
    expect(suspensionOf({ suspendedUntil: new Date('2026-11-21T09:59:59Z') }, now)).toBeNull();
    expect(
      suspensionOf({ suspendedUntil: '2026-11-22T10:00:00Z', suspendReason: 'r' }, now),
    ).toEqual({ until: new Date('2026-11-22T10:00:00Z'), reason: 'r' });
    expect(suspensionOf({ suspendedUntil: 'not a date' }, now)).toBeNull();
  });
});
