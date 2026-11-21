import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectIndexedQuery } from '../../test/expect-indexed-query.ts';
import { connectTestDb } from '../../test/helpers.ts';
import { registerAuthModels } from '../db/auth-models.ts';
import { baseFilter, csvCell, usersCsv } from './users-list.ts';

// Admin → Users reads people through an index whatever the filter (CLAUDE.md §8).

let db: Awaited<ReturnType<typeof connectTestDb>>;
beforeAll(async () => {
  db = await connectTestDb();
});
afterAll(async () => {
  await db.cleanup();
});

describe('Admin → Users list indexes', () => {
  it('every filter and search, newest first', async () => {
    const { AuthUser } = registerAuthModels(db.connection);
    const filters = [
      'all',
      'active',
      'deactivated',
      'admins',
      'suspended',
      'pushOff',
      'storageHigh',
    ] as const;
    for (const filter of filters) {
      for (const q of ['', 'asha', 'asha@corr']) {
        await expectIndexedQuery(
          AuthUser.find(baseFilter({ q, filter, sort: 'newest' })).sort({ _id: -1 }),
        );
      }
    }
  });
});

describe('CSV', () => {
  it('quotes every cell and never lets one be read as a formula', () => {
    expect(csvCell('Asha "A" Verma')).toBe('"Asha ""A"" Verma"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+91 99')).toBe(`"'+91 99"`);
    expect(csvCell('-1')).toBe(`"'-1"`);
    expect(csvCell('@me')).toBe(`"'@me"`);
    expect(csvCell(null)).toBe('""');
    expect(csvCell(42)).toBe('"42"');
  });

  it('starts with a byte-order mark and a header, one line per person', () => {
    const csv = usersCsv([
      {
        id: 'a',
        email: 'asha@corremadvisory.com',
        displayName: 'आशा',
        username: null,
        role: 'user',
        status: 'active',
        lastLoginAt: null,
        createdAt: '2026-11-01T00:00:00.000Z',
        storageBytes: 5 * 1024 * 1024,
        quotaBytes: 3 * 1024 ** 3,
        quotaCustom: false,
        lastActiveAt: null,
        deviceCount: 0,
        pushOn: false,
        suspendedUntil: null,
        suspendReason: null,
      },
    ]);
    expect(csv.startsWith('﻿"Name","Email"')).toBe(true);
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"आशा","asha@corremadvisory.com","","user","active"');
    expect(lines[1]).toContain('"off","","5","3072"');
  });
});
