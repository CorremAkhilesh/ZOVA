import { describe, expect, it } from 'vitest';
import { healthResponseSchema, readyResponseSchema } from './health.ts';

const timestamp = '2026-11-02T10:30:00.000Z';

describe('healthResponseSchema', () => {
  const base = { status: 'ok', version: '0.0.0', uptime: 12.5, timestamp };

  it('accepts a production build: short commit and build time', () => {
    const body = { ...base, commit: '489eed1', builtAt: timestamp };
    expect(healthResponseSchema.parse(body)).toEqual(body);
  });

  it('accepts "unknown" and no build time (local dev, or no .git in the build)', () => {
    const body = { ...base, commit: 'unknown', builtAt: null };
    expect(healthResponseSchema.parse(body)).toEqual(body);
  });

  it('rejects a missing or malformed commit and a negative uptime', () => {
    expect(healthResponseSchema.safeParse(base).success).toBe(false);
    for (const commit of ['489EED1', '489eed108a70c7c1', 'main', '']) {
      expect(healthResponseSchema.safeParse({ ...base, commit, builtAt: null }).success).toBe(
        false,
      );
    }
    const negative = { ...base, commit: 'unknown', builtAt: null, uptime: -1 };
    expect(healthResponseSchema.safeParse(negative).success).toBe(false);
  });
});

describe('readyResponseSchema', () => {
  it('accepts a not-ready response with a failing dependency', () => {
    const body = {
      status: 'not_ready',
      checks: { mongodb: 'ok', redis: 'error', storage: 'ok' },
      timestamp,
    };
    expect(readyResponseSchema.parse(body)).toEqual(body);
  });

  it('requires every dependency check', () => {
    const body = { status: 'ready', checks: { mongodb: 'ok', redis: 'skipped' }, timestamp };
    expect(readyResponseSchema.safeParse(body).success).toBe(false);
  });
});
