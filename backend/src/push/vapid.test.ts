import { execFileSync } from 'node:child_process';
import { createECDH, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateRequestDetails } from 'web-push';
import { testEnvSource } from '../../test/helpers.ts';
import { EnvError, loadEnv } from '../config/env.ts';
import {
  generateVapidKeys,
  isValidSubscriptionKeys,
  isVapidPrivateKey,
  isVapidPublicKey,
  vapidKeysMatch,
} from './vapid.ts';

function issuesFor(overrides: Record<string, string | undefined>): string[] {
  try {
    loadEnv(testEnvSource(overrides));
  } catch (error) {
    if (error instanceof EnvError) return error.issues;
    throw error;
  }
  return [];
}

/** A browser's subscription keys: a real P-256 point and a 16-byte secret. */
function browserKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  };
}

describe('VAPID key format', () => {
  it('accepts a generated pair, and knows the keys belong together', () => {
    const keys = generateVapidKeys();
    expect(isVapidPublicKey(keys.publicKey)).toBe(true);
    expect(isVapidPrivateKey(keys.privateKey)).toBe(true);
    expect(vapidKeysMatch(keys)).toBe(true);
    expect(vapidKeysMatch({ ...keys, publicKey: generateVapidKeys().publicKey })).toBe(false);
  });

  it('refuses anything that is not base64url of the right length', () => {
    const { publicKey, privateKey } = generateVapidKeys();
    expect(isVapidPublicKey(`${publicKey}=`)).toBe(false);
    expect(isVapidPublicKey(publicKey.slice(0, -4))).toBe(false);
    expect(isVapidPublicKey(Buffer.alloc(65, 1).toString('base64url'))).toBe(false); // not 0x04…
    expect(isVapidPublicKey('not a key!')).toBe(false);
    expect(isVapidPrivateKey(privateKey.slice(0, -2))).toBe(false);
    expect(isVapidPrivateKey(Buffer.alloc(33).toString('base64url'))).toBe(false);
    expect(isVapidPrivateKey(privateKey.replace(/./, '+'))).toBe(false);
    expect(vapidKeysMatch({ publicKey, privateKey: 'short' })).toBe(false);
  });

  it('is what the web-push library accepts to sign a request', () => {
    const keys = generateVapidKeys();
    const details = generateRequestDetails(
      { endpoint: 'https://push.example.test/abc', keys: browserKeys() },
      JSON.stringify({ hello: 'world' }),
      { vapidDetails: { subject: 'mailto:nova@corremadvisory.com', ...keys }, TTL: 60 },
    );
    expect(String(details.headers.Authorization)).toMatch(/^vapid t=.+, k=/);
    expect(String(details.headers.Authorization)).toContain(keys.publicKey);
  });

  it('checks subscription keys: a P-256 point and a 16-byte auth secret', () => {
    expect(isValidSubscriptionKeys(browserKeys())).toBe(true);
    expect(isValidSubscriptionKeys({ p256dh: 'BOr5', auth: 'k3y' })).toBe(false);
    expect(
      isValidSubscriptionKeys({ ...browserKeys(), auth: randomBytes(8).toString('base64url') }),
    ).toBe(false);
    // The fixed fake keys E2E can use: right shape, never encrypted to (memory sender).
    expect(isValidSubscriptionKeys({ p256dh: `B${'A'.repeat(86)}`, auth: 'A'.repeat(22) })).toBe(
      true,
    );
  });

  it('pnpm vapid:gen prints a valid, matching pair', () => {
    const script = resolve(import.meta.dirname, '../../../infra/scripts/gen-vapid.mjs');
    const output = execFileSync(process.execPath, [script], { encoding: 'utf8' });
    const publicKey = /^VAPID_PUBLIC_KEY=(.+)$/m.exec(output)?.[1] ?? '';
    const privateKey = /^VAPID_PRIVATE_KEY=(.+)$/m.exec(output)?.[1] ?? '';
    expect(vapidKeysMatch({ publicKey, privateKey })).toBe(true);
    expect(issuesFor({ VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey })).toEqual([]);
  });
});

describe('VAPID env', () => {
  it('is optional outside production, with a mailto: subject by default', () => {
    const env = loadEnv(testEnvSource({ VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '' }));
    expect(env.VAPID_PUBLIC_KEY).toBeUndefined();
    expect(env.VAPID_SUBJECT).toBe('mailto:nova@corremadvisory.com');
  });

  it('is required in production', () => {
    const issues = issuesFor({ NODE_ENV: 'production', REDIS_URL: 'redis://r:6379' });
    expect(issues).toContain('VAPID_PUBLIC_KEY is required in production');
    expect(issues).toContain('VAPID_PRIVATE_KEY is required in production');
  });

  it('refuses a malformed key, half a pair, or keys that do not match', () => {
    const keys = generateVapidKeys();
    expect(issuesFor({ VAPID_PUBLIC_KEY: 'abc', VAPID_PRIVATE_KEY: keys.privateKey })).toContain(
      'VAPID_PUBLIC_KEY must be a base64url P-256 public key (65 bytes)',
    );
    expect(issuesFor({ VAPID_PUBLIC_KEY: keys.publicKey })).toContain(
      'VAPID_PRIVATE_KEY must be set with the other VAPID key',
    );
    expect(
      issuesFor({
        VAPID_PUBLIC_KEY: generateVapidKeys().publicKey,
        VAPID_PRIVATE_KEY: keys.privateKey,
      }),
    ).toContain('VAPID_PUBLIC_KEY does not belong to VAPID_PRIVATE_KEY');
    expect(issuesFor({ VAPID_SUBJECT: 'nova@corremadvisory.com' })).toContain(
      'VAPID_SUBJECT must be a mailto: or https: URL',
    );
  });
});
