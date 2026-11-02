import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { apiErrorSchema } from './error.ts';
import { fromIsoDateTime, isoDateTimeSchema, objectIdSchema, toIsoDateTime } from './id.ts';
import { cursorPageQuerySchema, cursorPageSchema, PAGE_LIMIT_DEFAULT } from './pagination.ts';

describe('apiErrorSchema', () => {
  it('accepts a valid error with details', () => {
    const error = {
      code: 'VALIDATION_FAILED',
      message: 'Invalid input',
      requestId: 'req_1',
      details: { field: 'email' },
    };
    expect(apiErrorSchema.parse(error)).toEqual(error);
  });

  it('rejects unknown error codes', () => {
    const result = apiErrorSchema.safeParse({ code: 'NOPE', message: 'x', requestId: 'r' });
    expect(result.success).toBe(false);
  });
});

describe('objectIdSchema', () => {
  it('accepts and lowercases a 24-char hex id', () => {
    expect(objectIdSchema.parse('65F0C2A1B2C3D4E5F6A7B8C9')).toBe('65f0c2a1b2c3d4e5f6a7b8c9');
  });

  it.each(['', '123', 'zzzzzzzzzzzzzzzzzzzzzzzz', '65f0c2a1b2c3d4e5f6a7b8c9a'])(
    'rejects %j',
    (value) => {
      expect(objectIdSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('ISO date-times', () => {
  it('round-trips a Date', () => {
    const date = new Date('2026-11-02T10:30:00.000Z');
    const iso = toIsoDateTime(date);
    expect(isoDateTimeSchema.parse(iso)).toBe(iso);
    expect(fromIsoDateTime(iso).getTime()).toBe(date.getTime());
  });

  it('rejects non-ISO strings', () => {
    expect(isoDateTimeSchema.safeParse('02/11/2026').success).toBe(false);
  });
});

describe('cursor pagination', () => {
  it('applies the default limit and coerces query strings', () => {
    expect(cursorPageQuerySchema.parse({})).toEqual({ limit: PAGE_LIMIT_DEFAULT });
    expect(cursorPageQuerySchema.parse({ limit: '20', cursor: 'abc' })).toEqual({
      limit: 20,
      cursor: 'abc',
    });
  });

  it.each(['0', '101', '1.5'])('rejects limit %s', (limit) => {
    expect(cursorPageQuerySchema.safeParse({ limit }).success).toBe(false);
  });

  it('builds a page schema around an item schema', () => {
    const page = cursorPageSchema(z.object({ id: z.string() }));
    expect(page.parse({ items: [{ id: 'a' }], nextCursor: null })).toEqual({
      items: [{ id: 'a' }],
      nextCursor: null,
    });
  });
});
