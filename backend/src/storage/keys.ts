import { randomBytes } from 'node:crypto';

/** `ab/cd/<32 hex chars>`: two shard levels keep any one folder small. */
const KEY_PATTERN = /^[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{32}$/;

/** Generates a random 128-bit storage key in sharded form. Never derived from user input. */
export function generateKey(): string {
  const id = randomBytes(16).toString('hex');
  return `${id.slice(0, 2)}/${id.slice(2, 4)}/${id}`;
}

/** Strict key check — the first line of defence against path traversal. */
export function isValidKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}
