import { describe, expect, it } from 'vitest';
import { otpCodeSchema, requestOtpBodySchema, sessionResponseSchema } from './auth.ts';
import { updateProfileBodySchema } from './profile.ts';

describe('auth contracts', () => {
  it('normalizes the email on OTP requests', () => {
    expect(requestOtpBodySchema.parse({ email: ' A@CorremAdvisory.com ' })).toEqual({
      email: 'a@corremadvisory.com',
    });
  });

  it.each(['12345', '1234567', '12a456', ' 123456'])('rejects the code %j', (code) => {
    expect(otpCodeSchema.safeParse(code).success).toBe(false);
  });

  it('accepts a 6-digit code', () => {
    expect(otpCodeSchema.parse('012345')).toBe('012345');
  });

  it('trims display names and rejects empty or too long ones', () => {
    expect(updateProfileBodySchema.parse({ displayName: '  Asha  ' })).toEqual({
      displayName: 'Asha',
    });
    expect(updateProfileBodySchema.safeParse({ displayName: '   ' }).success).toBe(false);
    expect(updateProfileBodySchema.safeParse({ displayName: 'x'.repeat(51) }).success).toBe(false);
  });

  it('describes a session with its absolute expiry', () => {
    const now = new Date().toISOString();
    const parsed = sessionResponseSchema.parse({
      user: {
        id: 'u1',
        email: 'a@corremadvisory.com',
        displayName: null,
        username: null,
        about: 'Hey there!',
        avatar: null,
        role: 'user',
        status: 'active',
        createdAt: now,
      },
      session: { id: 's1', createdAt: now, expiresAt: now },
      needsProfile: true,
    });
    expect(parsed.needsProfile).toBe(true);
    // A copy saved before the language was part of the session reads English.
    expect(parsed.user.language).toBe('en');
  });

  it('saves the language, English or Hindi only', () => {
    expect(updateProfileBodySchema.parse({ language: 'hi' })).toEqual({ language: 'hi' });
    expect(updateProfileBodySchema.safeParse({ language: 'fr' }).success).toBe(false);
    expect(updateProfileBodySchema.safeParse({}).success).toBe(false);
  });
});
