import { z } from 'zod';
import { emailSchema } from '../common/email.ts';
import { isoDateTimeSchema } from '../common/id.ts';

/** OTP rules (CLAUDE.md §4) — shared so the UI shows the same numbers the server enforces. */
export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 10 * 60;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Warn this long before the session's absolute expiry. */
export const SESSION_EXPIRY_WARNING_SECONDS = 24 * 60 * 60;

export const userRoleSchema = z.enum(['user', 'admin']);
export const userStatusSchema = z.enum(['active', 'deactivated']);
export const displayNameSchema = z.string().trim().min(1, 'Enter your name').max(50);
export const otpCodeSchema = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');

/** POST /v1/auth/otp/request */
export const requestOtpBodySchema = z.object({ email: emailSchema });
export const requestOtpResponseSchema = z.object({
  status: z.literal('sent'),
  /** Same response whether or not an account exists. */
  expiresInSeconds: z.number().int().positive(),
  resendAfterSeconds: z.number().int().nonnegative(),
});

/** POST /v1/auth/otp/verify — signs in, creating the account on first success. */
export const verifyOtpBodySchema = z.object({ email: emailSchema, code: otpCodeSchema });

export const sessionUserSchema = z.object({
  id: z.string().min(1),
  email: z.email(),
  displayName: z.string().nullable(),
  username: z.string().nullable(),
  avatarKey: z.string().nullable(),
  role: userRoleSchema,
  status: userStatusSchema,
  createdAt: isoDateTimeSchema,
});

export const sessionInfoSchema = z.object({
  id: z.string().min(1),
  createdAt: isoDateTimeSchema,
  /** Absolute expiry: 7 days after sign-in, never extended. */
  expiresAt: isoDateTimeSchema,
});

/** GET /v1/auth/me and the verify response. */
export const sessionResponseSchema = z.object({
  user: sessionUserSchema,
  session: sessionInfoSchema,
  /** True until the user has chosen a display name (first login). */
  needsProfile: z.boolean(),
});

/** POST /v1/auth/logout */
export const signOutResponseSchema = z.object({ status: z.literal('signed_out') });

/** PATCH /v1/me/profile */
export const updateProfileBodySchema = z.object({ displayName: displayNameSchema });
export const updateProfileResponseSchema = z.object({ user: sessionUserSchema });

/** POST /v1/admin/users/:id/deactivate | /reactivate */
export const adminUserParamsSchema = z.object({ id: z.string().min(1).max(64) });
export const adminUserStatusResponseSchema = z.object({
  user: z.object({ id: z.string(), email: z.email(), status: userStatusSchema }),
  revokedSessions: z.number().int().nonnegative(),
});

/** `details` on auth errors. */
export const otpInvalidDetailsSchema = z.object({
  attemptsRemaining: z.number().int().nonnegative(),
});
export const rateLimitedDetailsSchema = z.object({
  retryAfterSeconds: z.number().int().nonnegative(),
});

export type RequestOtpBody = z.infer<typeof requestOtpBodySchema>;
export type RequestOtpResponse = z.infer<typeof requestOtpResponseSchema>;
export type VerifyOtpBody = z.infer<typeof verifyOtpBodySchema>;
export type SessionUser = z.infer<typeof sessionUserSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type UpdateProfileBody = z.infer<typeof updateProfileBodySchema>;
export type AdminUserStatusResponse = z.infer<typeof adminUserStatusResponseSchema>;
