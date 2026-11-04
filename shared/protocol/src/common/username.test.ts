import { describe, expect, it } from 'vitest';
import {
  normalizeUsername,
  RESERVED_USERNAMES,
  usernameBaseFromEmail,
  usernameProblem,
  usernameSchema,
} from './username.ts';

describe('usernameProblem', () => {
  it.each(['asha', 'a_b', 'asha.verma', 'r2d2', 'abc', 'a'.repeat(20), 'a.b.c', 'x_1.y_2'])(
    'allows %s',
    (name) => {
      expect(usernameProblem(name)).toBeNull();
    },
  );

  it.each([
    ['ab', 'too_short'],
    ['a'.repeat(21), 'too_long'],
    ['1asha', 'invalid'],
    ['_asha', 'invalid'],
    ['.asha', 'invalid'],
    ['asha..verma', 'invalid'],
    ['asha.', 'invalid'],
    ['Asha', 'invalid'],
    ['asha-verma', 'invalid'],
    ['asha verma', 'invalid'],
    ['आशा', 'invalid'],
    ['admin', 'reserved'],
    ['support', 'reserved'],
    ['zuvo', 'reserved'],
    ['correm', 'reserved'],
    ['help', 'reserved'],
    ['system', 'reserved'],
  ])('rejects %j as %s', (name, problem) => {
    expect(usernameProblem(name)).toBe(problem);
  });

  it('reserves the key names from the brief', () => {
    for (const name of ['admin', 'support', 'zuvo', 'correm', 'help', 'system']) {
      expect(RESERVED_USERNAMES.has(name)).toBe(true);
    }
  });
});

describe('usernameSchema', () => {
  it('normalizes case, whitespace and a leading @', () => {
    expect(normalizeUsername('  @Asha.Verma ')).toBe('asha.verma');
    expect(usernameSchema.parse(' @Asha ')).toBe('asha');
  });

  it('explains what is wrong', () => {
    const result = usernameSchema.safeParse('admin');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('This username is reserved');
  });
});

describe('usernameBaseFromEmail', () => {
  it.each([
    ['akhilesh@corremadvisory.com', 'akhilesh'],
    ['Akhilesh.Kumar@corremadvisory.com', 'akhilesh.kumar'],
    ['asha+test@corremadvisory.com', 'asha'],
    ['a..b@corremadvisory.com', 'a.b'],
    ['99problems@corremadvisory.com', 'problems'],
    ['jo@corremadvisory.com', 'userjo'],
    ['first-last@corremadvisory.com', 'firstlast'],
    ['averyveryverylongname.here@corremadvisory.com', 'averyveryverylong'],
  ])('%s → %s', (email, base) => {
    expect(usernameBaseFromEmail(email)).toBe(base);
    expect(usernameProblem(base)).toBeNull();
  });
});
