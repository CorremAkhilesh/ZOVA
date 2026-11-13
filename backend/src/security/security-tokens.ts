import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { registerSecurityModels } from '../db/security-models.ts';
import { AppError } from '../lib/errors.ts';

export const REVOKE_TOKEN_TTL_DAYS = 7;
const DAY_MS = 86_400_000;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const tokens = (app: FastifyInstance) => registerSecurityModels(app.mongo).SecurityToken;

/**
 * Creates a single-use "revoke all sessions" token: 256 random bits, returned once in plain text
 * (for the email link) and stored only as a SHA-256 hash, valid for 7 days.
 */
export async function createRevokeToken(
  app: FastifyInstance,
  userId: string,
  now = new Date(),
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await tokens(app).create({
    tokenHash: hash(token),
    userId,
    purpose: 'revoke-all-sessions',
    expiresAt: new Date(now.getTime() + REVOKE_TOKEN_TTL_DAYS * DAY_MS),
    usedAt: null,
  });
  return token;
}

/** Atomically marks the token used and returns its user. Reused, unknown or expired → error. */
export async function consumeRevokeToken(app: FastifyInstance, token: string): Promise<string> {
  const tokenHash = hash(token);
  const now = new Date();
  const claimed = await tokens(app).findOneAndUpdate(
    { tokenHash, usedAt: null, expiresAt: { $gt: now } },
    { $set: { usedAt: now } },
    { returnDocument: 'after' },
  );
  if (claimed) return claimed.userId;

  const existing = await tokens(app).findOne({ tokenHash }).lean();
  if (existing && !existing.usedAt && existing.expiresAt <= now) {
    throw new AppError(
      'SECURITY_TOKEN_EXPIRED',
      'This link has expired. Sign in and use Settings → Devices instead.',
    );
  }
  throw new AppError('SECURITY_TOKEN_INVALID', 'This link has already been used or is not valid.');
}
