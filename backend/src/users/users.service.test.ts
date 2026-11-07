import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectIndexedQuery } from '../../test/expect-indexed-query.ts';
import { buildTestApp } from '../../test/helpers.ts';
import { insertUser } from '../../test/user-helpers.ts';
import { escapeRegex, usersModel } from './user-record.ts';
import {
  searchUsers,
  setUsername,
  suggestUsername,
  updateProfile,
  usernameAvailability,
} from './users.service.ts';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => ctx.app;
const DAY = 86_400_000;

beforeAll(async () => {
  ctx = await buildTestApp();
});
afterAll(async () => {
  await ctx.cleanup();
});

describe('usernames', () => {
  it('reports rule problems before touching the database', async () => {
    const id = new Types.ObjectId().toString();
    expect((await usernameAvailability(app(), 'ab', id)).reason).toBe('too_short');
    expect((await usernameAvailability(app(), 'admin', id)).reason).toBe('reserved');
    expect((await usernameAvailability(app(), '1abc', id)).reason).toBe('invalid');
    expect((await usernameAvailability(app(), 'a..b', id)).reason).toBe('invalid');
  });

  it('treats a name as available to its own owner and taken for everyone else', async () => {
    const owner = await insertUser(app(), { email: 'owner@corremadvisory.com', username: 'riya' });
    expect(await usernameAvailability(app(), 'riya', owner)).toMatchObject({ available: true });
    const other = new Types.ObjectId().toString();
    expect(await usernameAvailability(app(), 'riya', other)).toMatchObject({
      available: false,
      reason: 'taken',
    });
  });

  it('suggests the email name, then a numbered one when it is taken', async () => {
    expect(await suggestUsername(app(), 'akhilesh@corremadvisory.com')).toBe('akhilesh');
    await insertUser(app(), { email: 'a1@corremadvisory.com', username: 'akhilesh' });
    expect(await suggestUsername(app(), 'akhilesh@corremadvisory.com')).toBe('akhilesh2');
  });

  it('lets only one of two simultaneous claims win (unique index)', async () => {
    const a = await insertUser(app(), { email: 'race-a@corremadvisory.com' });
    const b = await insertUser(app(), { email: 'race-b@corremadvisory.com' });
    await usersModel(app()).init();
    const results = await Promise.allSettled([
      setUsername(app(), a, 'sameName'.toLowerCase()),
      setUsername(app(), b, 'samename'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((r) => r.status === 'rejected');
    expect(failed?.status === 'rejected' && failed.reason).toMatchObject({
      code: 'USERNAME_TAKEN',
    });
  });

  it('allows the first username freely, then one change per 30 days', async () => {
    const id = await insertUser(app(), { email: 'changer@corremadvisory.com' });
    await setUsername(app(), id, 'changer');
    await expect(setUsername(app(), id, 'changer2')).rejects.toMatchObject({
      code: 'USERNAME_CHANGE_TOO_SOON',
      details: { nextChangeAt: expect.any(String) },
    });
    await usersModel(app()).updateOne(
      { _id: new Types.ObjectId(id) },
      { $set: { usernameChangedAt: new Date(Date.now() - 31 * DAY) } },
    );
    expect((await setUsername(app(), id, 'changer2')).username).toBe('changer2');
  });
});

describe('people search', () => {
  let viewer: string;

  beforeAll(async () => {
    viewer = await insertUser(app(), {
      email: 'viewer@corremadvisory.com',
      displayName: 'Viewer Person',
      username: 'viewer',
      searchTerms: ['viewer', 'person'],
    });
    await insertUser(app(), {
      email: 'meera@corremadvisory.com',
      displayName: 'Meera Nair',
      username: 'meera.n',
      searchTerms: ['meera', 'nair', 'meera.n', 'n'],
      about: 'Secret about',
      privacy: { about: 'nobody', profilePhoto: 'nobody' },
      avatar: { small: 'a/b', large: 'c/d', version: 'v1' },
      lastLoginAt: new Date(),
    });
    await insertUser(app(), {
      email: 'gone@corremadvisory.com',
      displayName: 'Meera Gone',
      username: 'meeragone',
      searchTerms: ['meera', 'gone', 'meeragone'],
      status: 'deactivated',
    });
  });

  it('finds by username prefix, name-word prefix and exact email; hides private fields', async () => {
    for (const q of ['mee', 'Nai', 'meera nair', 'meera@corremadvisory.com']) {
      const { items } = await searchUsers(app(), { viewerId: viewer, q, limit: 20 });
      expect(items.map((p) => p.username)).toEqual(['meera.n']);
      expect(items[0]).toMatchObject({ about: null, avatar: null });
    }
    expect(
      (await searchUsers(app(), { viewerId: viewer, q: 'meera@corr', limit: 20 })).items,
    ).toEqual([]);
  });

  it('excludes the caller and deactivated users, and treats regex characters literally', async () => {
    const self = await searchUsers(app(), { viewerId: viewer, q: 'viewer', limit: 20 });
    expect(self.items).toEqual([]);
    const gone = await searchUsers(app(), { viewerId: viewer, q: 'gone', limit: 20 });
    expect(gone.items).toEqual([]);
    const regex = await searchUsers(app(), { viewerId: viewer, q: '.*', limit: 20 });
    expect(regex.items).toEqual([]);
  });

  it('pages with a cursor', async () => {
    for (const n of [1, 2, 3]) {
      await insertUser(app(), {
        email: `pager${n}@corremadvisory.com`,
        displayName: `Pager ${n}`,
        searchTerms: ['pager', String(n)],
      });
    }
    const first = await searchUsers(app(), { viewerId: viewer, q: 'pager', limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await searchUsers(app(), {
      viewerId: viewer,
      q: 'pager',
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });

  it('suggests active people when the query is empty', async () => {
    const { items } = await searchUsers(app(), { viewerId: viewer, q: '', limit: 20 });
    expect(items.map((p) => p.username)).toContain('meera.n');
    expect(items.map((p) => p.username)).not.toContain('meeragone');
  });

  it('keeps the search index in sync with profile edits', async () => {
    const id = await insertUser(app(), { email: 'rename@corremadvisory.com', username: 'renamer' });
    await updateProfile(app(), id, { displayName: 'Zubin Mehta' });
    const { items } = await searchUsers(app(), { viewerId: viewer, q: 'zub', limit: 20 });
    expect(items.map((p) => p.id)).toEqual([id]);
  });

  it('uses indexes for every search query shape (no COLLSCAN)', async () => {
    const Users = usersModel(app());
    // Me, and anyone who blocked me.
    const notMe = { $nin: [new Types.ObjectId(viewer), new Types.ObjectId()] };
    await expectIndexedQuery(
      Users.find({ status: 'active', _id: notMe }).sort({ lastLoginAt: -1 }).limit(20),
    );
    await expectIndexedQuery(Users.findOne({ email: 'meera@corremadvisory.com', _id: notMe }));
    await expectIndexedQuery(
      Users.find({ searchTerms: { $all: [new RegExp(`^${escapeRegex('mee')}`)] }, _id: notMe })
        .sort({ _id: 1 })
        .limit(21),
    );
    await expectIndexedQuery(Users.findOne({ username: { $eq: 'meera.n', $type: 'string' } }));
  });
});
