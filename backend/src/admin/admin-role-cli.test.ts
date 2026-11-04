import type { Connection } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectTestDb } from '../../test/helpers.ts';
import { registerAuthModels } from '../db/auth-models.ts';
import { registerSecurityModels } from '../db/security-models.ts';
import { parseRoleArgs, runAdminRole, USAGE } from './admin-role-cli.ts';
import { changeRoleByEmail, SYSTEM_ACTOR } from './role-change.ts';

let db: Awaited<ReturnType<typeof connectTestDb>>;
let connection: Connection;

beforeAll(async () => {
  db = await connectTestDb();
  connection = db.connection;
});
afterAll(async () => {
  await db.cleanup();
});

const users = () => registerAuthModels(connection).AuthUser.collection;
const audit = () => registerSecurityModels(connection).AuditLog;

async function seed(email: string, role: 'admin' | 'user', status = 'active') {
  await users().insertOne({ email, role, status, emailVerified: true, createdAt: new Date() });
}
const roleOf = async (email: string) => (await users().findOne({ email }))?.role;

beforeEach(async () => {
  await users().deleteMany({});
  await audit().deleteMany({});
});

function run(argv: string[], answer: boolean) {
  const lines: string[] = [];
  const questions: string[] = [];
  const done = runAdminRole(connection, {
    argv,
    database: 'zuvo_test_x',
    confirm: async (question) => {
      questions.push(question);
      return answer;
    },
    print: (line) => lines.push(line),
  });
  return { done, lines, questions };
}

describe('parseRoleArgs', () => {
  it('reads --email (normalized) and --role, ignoring the pnpm "--" separator', () => {
    expect(
      parseRoleArgs(['--', '--email', ' NovaAdmin@corremadvisory.com', '--role', 'admin']),
    ).toEqual({
      email: 'novaadmin@corremadvisory.com',
      role: 'admin',
    });
  });

  it('rejects missing or invalid arguments with the usage line', () => {
    expect(() => parseRoleArgs(['--role', 'admin'])).toThrow(USAGE);
    expect(() => parseRoleArgs(['--email', 'not-an-email', '--role', 'admin'])).toThrow(USAGE);
    expect(() => parseRoleArgs(['--email', 'a@corremadvisory.com', '--role', 'owner'])).toThrow(
      USAGE,
    );
    expect(() =>
      parseRoleArgs(['--email', 'a@corremadvisory.com', '--role', 'user', '--x']),
    ).toThrow();
  });
});

describe('admin:role script', () => {
  it('asks first, then promotes and writes a CLI audit entry', async () => {
    await seed('dev@corremadvisory.com', 'user');
    const { done, lines, questions } = run(
      ['--email', 'dev@corremadvisory.com', '--role', 'admin'],
      true,
    );
    expect(await done).toBe(0);
    expect(questions[0]).toBe(
      'Set role of dev@corremadvisory.com to "admin" in database zuvo_test_x?',
    );
    expect(lines[0]).toMatch(/now "admin"/);
    expect(await roleOf('dev@corremadvisory.com')).toBe('admin');
    const entries = await audit().find().lean();
    expect(entries).toMatchObject([
      {
        action: 'user.promote',
        actorId: 'cli',
        actorEmail: 'cli (admin:role)',
        targetEmail: 'dev@corremadvisory.com',
      },
    ]);
  });

  it('changes nothing when the answer is no', async () => {
    await seed('dev@corremadvisory.com', 'user');
    const { done, lines } = run(['--email', 'dev@corremadvisory.com', '--role', 'admin'], false);
    expect(await done).toBe(1);
    expect(lines).toEqual(['Cancelled. Nothing changed.']);
    expect(await roleOf('dev@corremadvisory.com')).toBe('user');
    expect(await audit().countDocuments()).toBe(0);
  });

  it('refuses to demote the last active admin', async () => {
    await seed('boss@corremadvisory.com', 'admin');
    await seed('old@corremadvisory.com', 'admin', 'deactivated');
    const { done, lines } = run(['--email', 'boss@corremadvisory.com', '--role', 'user'], true);
    expect(await done).toBe(1);
    expect(lines[0]).toMatch(/^Refused: There must always be at least one admin/);
    expect(await roleOf('boss@corremadvisory.com')).toBe('admin');
  });

  it('demotes when another active admin remains', async () => {
    await seed('boss@corremadvisory.com', 'admin');
    await seed('nova@corremadvisory.com', 'admin');
    const { done } = run(['--email', 'boss@corremadvisory.com', '--role', 'user'], true);
    expect(await done).toBe(0);
    expect(await roleOf('boss@corremadvisory.com')).toBe('user');
    expect((await audit().findOne().lean())?.action).toBe('user.demote');
  });

  it('reports unknown accounts and no-op changes without auditing', async () => {
    const missing = run(['--email', 'ghost@corremadvisory.com', '--role', 'admin'], true);
    expect(await missing.done).toBe(1);
    expect(missing.lines[0]).toMatch(/^Refused: No account for ghost@/);

    await seed('boss@corremadvisory.com', 'admin');
    const same = run(['--email', 'boss@corremadvisory.com', '--role', 'admin'], true);
    expect(await same.done).toBe(0);
    expect(same.lines[0]).toMatch(/already "admin"/);
    expect(await audit().countDocuments()).toBe(0);
  });
});

describe('changeRoleByEmail', () => {
  it('records the system actor for ADMIN_EMAILS promotions', async () => {
    await seed('nova@corremadvisory.com', 'user');
    const result = await changeRoleByEmail(connection, {
      email: 'Nova@CorremAdvisory.com',
      role: 'admin',
      actor: SYSTEM_ACTOR,
    });
    expect(result).toMatchObject({
      changed: true,
      role: 'admin',
      email: 'nova@corremadvisory.com',
    });
    expect(await audit().findOne().lean()).toMatchObject({
      actorId: 'system',
      actorEmail: 'system (ADMIN_EMAILS)',
      ipAddress: null,
    });
  });
});
