import { PIN_ATTEMPTS_MAX } from '@zuvo/protocol';
import { describe, expect, it } from 'vitest';
import type { LockDoc } from '../db/lock-models.ts';
import { afterWrongPin, LOCKOUT_DECAY_MS, lockoutLevel, lockoutMs } from './attempts.ts';
import { toLockStatus } from './lock-store.ts';
import { hashPin, PIN_HASH_OPTIONS, pinPepper, verifyPin } from './pin-hash.ts';
import { webAuthnConfig } from './webauthn-config.ts';

const pepper = pinPepper('test-secret-test-secret-test-secret-123');
const NOW = new Date('2026-11-12T10:00:00.000Z');

function lockDoc(fields: Partial<LockDoc> = {}): LockDoc {
  return {
    _id: undefined as unknown as LockDoc['_id'],
    pinHash: 'hash',
    appLockEnabled: false,
    idleMinutes: 5,
    failedAttempts: 0,
    lockouts: 0,
    lastLockoutAt: null,
    lockedUntil: null,
    lastVerifiedAt: null,
    challenge: null,
    reset: null,
    updatedAt: NOW,
    ...fields,
  };
}

describe('PIN hashing', () => {
  it('stores an argon2id hash with the OWASP parameters, never the PIN', async () => {
    const stored = await hashPin('482915', pepper);
    expect(stored).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(stored).not.toContain('482915');
    expect(PIN_HASH_OPTIONS).toMatchObject({ memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  });

  it('verifies the right PIN and refuses a wrong one, another pepper or garbage', async () => {
    const stored = await hashPin('1234', pepper);
    expect(await verifyPin(stored, '1234', pepper)).toBe(true);
    expect(await verifyPin(stored, '1235', pepper)).toBe(false);
    expect(await verifyPin(stored, '1234', pinPepper('another-secret-another-secret-12345'))).toBe(
      false,
    );
    expect(await verifyPin('not a hash', '1234', pepper)).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPin('1234', pepper)).not.toBe(await hashPin('1234', pepper));
  });
});

describe('lockout schedule', () => {
  it('doubles from 1 minute up to 1 hour', () => {
    const minutes = [0, 1, 2, 3, 4, 5, 6, 7, 20].map((level) => lockoutMs(level) / 60_000);
    expect(minutes).toEqual([1, 2, 4, 8, 16, 32, 60, 60, 60]);
  });

  it('counts lockouts in a row only while the last one is recent', () => {
    const recent = new Date(NOW.getTime() - 60_000);
    const old = new Date(NOW.getTime() - LOCKOUT_DECAY_MS - 1);
    expect(lockoutLevel({ lockouts: 3, lastLockoutAt: recent }, NOW)).toBe(3);
    expect(lockoutLevel({ lockouts: 3, lastLockoutAt: old }, NOW)).toBe(0);
    expect(lockoutLevel({ lockouts: 3, lastLockoutAt: null }, NOW)).toBe(0);
  });

  it('a wrong PIN counts; the last allowed one locks and starts the count again', () => {
    expect(afterWrongPin(lockDoc({ failedAttempts: 0 }), NOW)).toEqual({ failedAttempts: 1 });
    const locked = afterWrongPin(
      lockDoc({ failedAttempts: PIN_ATTEMPTS_MAX - 1, lockouts: 2, lastLockoutAt: NOW }),
      NOW,
    );
    expect(locked).toMatchObject({ failedAttempts: 0, lockouts: 3, lastLockoutAt: NOW });
    expect(locked.lockedUntil?.getTime()).toBe(NOW.getTime() + 4 * 60_000);
  });
});

describe('lock status', () => {
  it('has defaults when nothing is set, and never shows the hash', () => {
    expect(toLockStatus(null, 0, NOW)).toEqual({
      pinSet: false,
      appLock: { enabled: false, idleMinutes: 5 },
      lockedUntil: null,
      attemptsLeft: PIN_ATTEMPTS_MAX,
      biometricCount: 0,
    });
    const status = toLockStatus(lockDoc({ failedAttempts: 2, idleMinutes: 15 }), 1, NOW);
    expect(status).toMatchObject({ pinSet: true, attemptsLeft: 3, biometricCount: 1 });
    expect(status.appLock.idleMinutes).toBe(15);
    expect(JSON.stringify(status)).not.toContain('hash');
  });

  it('shows a lockout only while it lasts, and app lock only with a PIN', () => {
    const until = new Date(NOW.getTime() + 60_000);
    expect(toLockStatus(lockDoc({ lockedUntil: until }), 0, NOW)).toMatchObject({
      lockedUntil: until.toISOString(),
      attemptsLeft: 0,
    });
    expect(toLockStatus(lockDoc({ lockedUntil: NOW }), 0, NOW).lockedUntil).toBeNull();
    const noPin = lockDoc({ pinHash: null, appLockEnabled: true, idleMinutes: 7 });
    expect(toLockStatus(noPin, 0, NOW).appLock).toEqual({ enabled: false, idleMinutes: 5 });
  });
});

describe('WebAuthn relying party', () => {
  it('is the app host, accepting the app and the CORS origins', () => {
    const config = webAuthnConfig({
      APP_URL: 'https://app.zuvo.corremadvisory.com/',
      CORS_ORIGINS: ['https://app.zuvo.corremadvisory.com', 'http://localhost:5191'],
    });
    expect(config.rpID).toBe('app.zuvo.corremadvisory.com');
    expect(config.expectedOrigin).toEqual([
      'https://app.zuvo.corremadvisory.com',
      'http://localhost:5191',
    ]);
  });
});
