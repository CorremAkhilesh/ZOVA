import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { testEnvSource } from '../../test/helpers.ts';
import { loadEnv } from '../config/env.ts';
import { callsAllowed } from './access.ts';
import { iceServersFor, turnCredentials } from './ice.ts';

const SECRET = 'a-turn-shared-secret-of-at-least-32-chars';
const BASE = { CALLS_STUN_URLS: ['stun:stun.example.test:3478'], CALLS_TURN_TTL_SECONDS: 3600 };

describe('ICE servers', () => {
  it('STUN only when there is no TURN', () => {
    expect(iceServersFor({ ...BASE, CALLS_TURN_URLS: [] }, 'u1')).toEqual({
      iceServers: [{ urls: ['stun:stun.example.test:3478'] }],
      ttlSeconds: 0,
    });
  });

  it('TURN credentials: <expiry>:<user>, HMAC-SHA1 of it with the shared secret, expiring after the TTL', () => {
    const now = Date.UTC(2026, 10, 20, 10, 0, 0);
    const ice = iceServersFor(
      {
        ...BASE,
        CALLS_TURN_URLS: ['turn:turn.example.test:3478?transport=udp'],
        CALLS_TURN_SECRET: SECRET,
      },
      'user42',
      now,
    );
    const turn = ice.iceServers[1];
    const expiry = now / 1000 + 3600;
    expect(turn?.username).toBe(`${expiry}:user42`);
    expect(turn?.credential).toBe(
      createHmac('sha1', SECRET).update(`${expiry}:user42`).digest('base64'),
    );
    expect(ice.ttlSeconds).toBe(3600);
    // An hour later the same person gets new ones that expire an hour after that.
    const later = iceServersFor(
      { ...BASE, CALLS_TURN_URLS: ['turn:t'], CALLS_TURN_SECRET: SECRET },
      'user42',
      now + 3_600_000,
    );
    expect(later.iceServers[1]?.username).toBe(`${expiry + 3600}:user42`);
    // A different secret gives a different password: the TURN server would refuse it.
    expect(
      turnCredentials('another-secret-another-secret-123456', 'user42', expiry).credential,
    ).not.toBe(turn?.credential);
  });

  it('env: TURN URLs and secret go together; "none" turns STUN off', () => {
    expect(() => loadEnv(testEnvSource({ CALLS_TURN_URLS: 'turn:t.example.test' }))).toThrow(
      /CALLS_TURN_SECRET/,
    );
    expect(() => loadEnv(testEnvSource({ CALLS_TURN_SECRET: SECRET }))).toThrow(/CALLS_TURN_URLS/);
    expect(() => loadEnv(testEnvSource({ CALLS_STUN_URLS: 'http://x' }))).toThrow(
      /CALLS_STUN_URLS/,
    );
    expect(loadEnv(testEnvSource({ CALLS_STUN_URLS: 'none' })).CALLS_STUN_URLS).toEqual([]);
    expect(loadEnv(testEnvSource()).CALLS_ENABLED_FOR).toBe('admins');
  });
});

describe('who has calls', () => {
  const env = {
    CALLS_ENABLED_FOR: 'admins' as const,
    CALLS_TEST_EMAILS: ['tester@corremadvisory.com'],
  };
  it('admins and the test accounts while testing; everyone with "all"', () => {
    expect(callsAllowed(env, { role: 'admin', email: 'a@corremadvisory.com' })).toBe(true);
    expect(callsAllowed(env, { role: 'user', email: 'Tester@corremadvisory.com' })).toBe(true);
    expect(callsAllowed(env, { role: 'user', email: 'u@corremadvisory.com' })).toBe(false);
    expect(
      callsAllowed(
        { ...env, CALLS_ENABLED_FOR: 'all' },
        { role: 'user', email: 'u@corremadvisory.com' },
      ),
    ).toBe(true);
  });
});
