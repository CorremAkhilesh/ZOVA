import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { me, signIn } from '../../../test/auth-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { insertUser } from '../../../test/user-helpers.ts';
import { registerSecurityModels } from '../../db/security-models.ts';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
let ctx: TestApp;
// One app (and database) for the file: each test uses its own accounts.
// Mixed case in env: emails are normalized, so NovaAdmin@ and novaadmin@ are the same account.
beforeAll(async () => {
  ctx = await buildTestApp(
    {},
    { ADMIN_EMAILS: 'NovaAdmin@corremadvisory.com,boss@corremadvisory.com' },
  );
});
afterAll(async () => {
  await ctx.cleanup();
});
const start = async () => ctx.app;

const auditEntries = (app: TestApp['app'], targetEmail: string) =>
  registerSecurityModels(app.mongo).AuditLog.find({ targetEmail }).sort({ at: 1 }).lean();
const roleAfterSignIn = async (app: TestApp['app'], email: string) => {
  const { cookie } = await signIn(app, email);
  return (await me(app, cookie)).json().user.role as string;
};

describe('ADMIN_EMAILS', () => {
  it('makes a new account an admin at its first sign-in, audited as a system action', async () => {
    const app = await start();
    expect(await roleAfterSignIn(app, 'novaadmin@corremadvisory.com')).toBe('admin');
    expect(await auditEntries(app, 'novaadmin@corremadvisory.com')).toMatchObject([
      { action: 'user.promote', actorId: 'system', targetEmail: 'novaadmin@corremadvisory.com' },
    ]);
  });

  it('promotes an EXISTING user on their next sign-in, once', async () => {
    const app = await start();
    await insertUser(app, {
      email: 'boss@corremadvisory.com',
      role: 'user',
      lastLoginAt: new Date(Date.now() - 86_400_000),
    });
    expect(await roleAfterSignIn(app, 'boss@corremadvisory.com')).toBe('admin');
    expect(await roleAfterSignIn(app, 'boss@corremadvisory.com')).toBe('admin');
    expect(await auditEntries(app, 'boss@corremadvisory.com')).toHaveLength(1);
  });

  it('never demotes an admin who is not listed, and ignores everyone else', async () => {
    const app = await start();
    await insertUser(app, { email: 'akhilesh@corremadvisory.com', role: 'admin' });
    expect(await roleAfterSignIn(app, 'akhilesh@corremadvisory.com')).toBe('admin');
    expect(await roleAfterSignIn(app, 'dev@corremadvisory.com')).toBe('user');
    expect(await auditEntries(app, 'akhilesh@corremadvisory.com')).toHaveLength(0);
    expect(await auditEntries(app, 'dev@corremadvisory.com')).toHaveLength(0);
  });
});
