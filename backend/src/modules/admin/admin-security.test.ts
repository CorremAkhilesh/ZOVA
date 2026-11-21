import { adminSecurityResponseSchema, auditLogResponseSchema } from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readOtp, requestOtp, verifyOtp } from '../../../test/auth-helpers.ts';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { signedIn } from '../../../test/realtime-helpers.ts';
import { maskIp } from '../../security/security-events.ts';

// Admin → Security (sessions, locks, wrong codes) and the audit log's filters and CSV.

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;
let admin: Person;
const WHY = { reason: 'Verified by phone' };

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
  admin = await signedIn(built.app, 'admin@corremadvisory.com');
});
afterAll(async () => {
  vi.useRealTimers();
  await built.cleanup();
});

const security = async () =>
  adminSecurityResponseSchema.parse((await call(admin, 'GET', '/v1/admin/security')).json());

describe('Admin → Security', () => {
  it('lists wrong codes with a masked address, the lock they caused, and unlocks it', async () => {
    await call(admin, 'PUT', '/v1/admin/settings', {
      changes: { otpFailuresPerEmailPerDay: 5 },
      reason: 'Test the lock',
    });
    const email = 'locked.out@corremadvisory.com';
    expect((await requestOtp(app(), email)).statusCode).toBe(200);
    const code = await readOtp(app(), email);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await verifyOtp(app(), email, wrong);
    expect((await verifyOtp(app(), email, code)).json().code).toBe('RATE_LIMITED');

    const state = await security();
    const failures = state.failures.filter((row) => row.email === email);
    expect(failures).toHaveLength(5);
    expect(failures[0]?.ip).toBe('127.0.0.*');
    const lock = state.locks.find((row) => row.email === email);
    expect(lock).toBeDefined();
    expect(Date.parse(lock?.until ?? '') - Date.now()).toBeGreaterThan(3600_000);

    const unlocked = await call(admin, 'POST', `/v1/admin/security/locks/${lock?.id}/unlock`, WHY);
    expect(unlocked.statusCode, unlocked.body).toBe(200);
    expect((await security()).locks.map((row) => row.email)).not.toContain(email);
    // At once: no lock, and no wait for the resend cooldown.
    expect(await app().otpThrottle.lockedFor(email)).toBe(0);
    expect((await requestOtp(app(), email)).statusCode).toBe(200);
    const log = (await call(admin, 'GET', '/v1/admin/audit-log?action=security.unlock')).json();
    expect(log.items[0]).toMatchObject({ reason: 'Verified by phone', details: { email } });
    await call(admin, 'PUT', '/v1/admin/settings', {
      changes: {},
      reset: ['otpFailuresPerEmailPerDay'],
      reason: 'Back to normal',
    });
  });

  it('counts signed-in devices and people', async () => {
    const before = await security();
    await person();
    const after = await security();
    expect(after.sessions.active).toBe(before.sessions.active + 1);
    expect(after.sessions.people).toBe(before.sessions.people + 1);
  });

  it('admins only; unknown locks are 404; unlocking needs a reason', async () => {
    const who = await person();
    expect((await call(who, 'GET', '/v1/admin/security')).statusCode).toBe(403);
    expect((await call(null, 'GET', '/v1/admin/security')).statusCode).toBe(401);
    const url = '/v1/admin/security/locks/0123456789abcdef01234567/unlock';
    expect((await call(admin, 'POST', url, WHY)).statusCode).toBe(404);
    expect((await call(admin, 'POST', url, {})).statusCode).toBe(400);
  });
});

describe('Admin → Audit log filters and CSV', () => {
  it('filters by action, admin, person and time; refuses a backwards range', async () => {
    const who = await person();
    await call(admin, 'PUT', `/v1/admin/users/${who.id}/storage-quota`, {
      quotaMb: 5120,
      reason: 'Video team',
    });
    const read = async (query: string) =>
      auditLogResponseSchema.parse(
        (await call(admin, 'GET', `/v1/admin/audit-log?${query}`)).json(),
      ).items;
    const byAction = await read('action=storage.quota');
    expect(byAction.every((entry) => entry.action === 'storage.quota')).toBe(true);
    expect((await read(`target=${encodeURIComponent(who.email.toUpperCase())}`))[0]).toMatchObject({
      action: 'storage.quota',
      reason: 'Video team',
    });
    expect((await read('actor=admin@corremadvisory.com')).length).toBeGreaterThan(0);
    expect(await read('actor=nobody@corremadvisory.com')).toEqual([]);
    const later = new Date(Date.now() + 3600_000).toISOString();
    expect(await read(`from=${encodeURIComponent(later)}`)).toEqual([]);
    const bad = await call(
      admin,
      'GET',
      `/v1/admin/audit-log?from=${encodeURIComponent(later)}&to=${encodeURIComponent(new Date(0).toISOString())}`,
    );
    expect(bad.statusCode).toBe(400);
    expect((await call(admin, 'GET', '/v1/admin/audit-log?action=nope')).statusCode).toBe(400);
  });

  it('downloads the filtered log as CSV, and that is audited too', async () => {
    const response = await call(admin, 'GET', '/v1/admin/audit-log/export?action=settings.change');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    const lines = response.body.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('"When","Action","Admin","Person","Reason","Details","IP address"');
    expect(lines.slice(1).every((line) => line.includes('"settings.change"'))).toBe(true);
    const log = (await call(admin, 'GET', '/v1/admin/audit-log?action=audit.export')).json();
    expect(log.items[0]).toMatchObject({
      action: 'audit.export',
      details: { action: 'settings.change' },
    });
    const who = await person();
    expect((await call(who, 'GET', '/v1/admin/audit-log/export')).statusCode).toBe(403);
  });
});

describe('maskIp', () => {
  it('keeps the network, never the host', () => {
    expect(maskIp('203.0.113.45')).toBe('203.0.113.*');
    expect(maskIp('::ffff:198.51.100.7')).toBe('198.51.100.*');
    expect(maskIp('2001:db8:85a3:0:0:8a2e:370:7334')).toBe('2001:db8:85a3::*');
    expect(maskIp(null)).toBe('unknown');
    expect(maskIp('not an ip')).toBe('unknown');
  });
});
