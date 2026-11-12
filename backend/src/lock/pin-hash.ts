import { createHmac } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

/** argon2id per OWASP: 19 MiB memory, 2 passes, 1 lane. */
export const PIN_HASH_OPTIONS = {
  /** Argon2id (the package's `Algorithm.Argon2id`; a const enum, so spelled out here). */
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * A server-side pepper derived from AUTH_SECRET, passed as argon2's `secret`: a short PIN copied out
 * of the database alone cannot be guessed offline.
 */
export function pinPepper(authSecret: string): Buffer {
  return createHmac('sha256', authSecret).update('zuvo:pin-pepper:v1').digest();
}

export function hashPin(pin: string, pepper: Buffer): Promise<string> {
  return hash(pin, { ...PIN_HASH_OPTIONS, secret: pepper });
}

/** False for a wrong PIN, and for anything that is not one of our hashes. */
export async function verifyPin(stored: string, pin: string, pepper: Buffer): Promise<boolean> {
  try {
    return await verify(stored, pin, { secret: pepper });
  } catch {
    return false;
  }
}
