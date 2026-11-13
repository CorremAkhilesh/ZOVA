import { describe, expect, it } from 'vitest';
import { healthResponseSchema, readyResponseSchema } from './health.ts';

const timestamp = '2026-11-02T10:30:00.000Z';

describe('healthResponseSchema', () => {
  it('accepts a valid response', () => {
    const body = { status: 'ok', version: '0.0.0', uptime: 12.5, timestamp };
    expect(healthResponseSchema.parse(body)).toEqual(body);
  });

  it('rejects a negative uptime', () => {
    const body = { status: 'ok', version: '0.0.0', uptime: -1, timestamp };
    expect(healthResponseSchema.safeParse(body).success).toBe(false);
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
