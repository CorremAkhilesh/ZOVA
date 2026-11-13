import { z } from 'zod';
import { isoDateTimeSchema } from '../common/id.ts';

/** 4 to 6 digits. */
export const pinSchema = z.string().regex(/^\d{4,6}$/, 'Use 4 to 6 digits');
/** Wrong PINs before a lockout; each lockout doubles, from 1 minute up to 1 hour. */
export const PIN_ATTEMPTS_MAX = 5;
/** After the PIN, locked chats stay open for this long in this browser session. */
export const CHAT_UNLOCK_MINUTES = 5;
export const appLockIdleSchema = z.union([
  z.literal(1),
  z.literal(5),
  z.literal(15),
  z.literal(60),
]);

/** GET /v1/me/lock, and after every change. Never the PIN or its hash. */
export const lockStatusSchema = z.object({
  pinSet: z.boolean(),
  appLock: z.object({ enabled: z.boolean(), idleMinutes: appLockIdleSchema }),
  /** Too many wrong PINs: no more tries until then. */
  lockedUntil: isoDateTimeSchema.nullable(),
  attemptsLeft: z.number().int().nonnegative(),
  /** Windows Hello, Touch ID, a fingerprint…: how many of this person's devices can unlock. */
  biometricCount: z.number().int().nonnegative(),
});
export const lockStatusResponseSchema = z.object({ lock: lockStatusSchema });

/** PUT /v1/me/lock/pin: set it, or change it (the current PIN is then required). */
export const setPinBodySchema = z.object({ pin: pinSchema, currentPin: pinSchema.optional() });
/** POST /v1/me/lock/verify and DELETE /v1/me/lock/pin. */
export const verifyPinBodySchema = z.object({ pin: pinSchema });
/** PATCH /v1/me/lock/settings */
export const lockSettingsBodySchema = z.object({
  appLock: z.object({ enabled: z.boolean(), idleMinutes: appLockIdleSchema }),
});
/** PUT /v1/chats/:id/lock: needs a PIN set first. */
export const chatLockBodySchema = z.object({ locked: z.boolean() });

/** POST /v1/me/lock/reset/verify: the code from the email, like signing in. */
export const resetPinBodySchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});
export const resetPinRequestResponseSchema = z.object({ sent: z.literal(true) });

/** WebAuthn options and answers, passed through as JSON (see @simplewebauthn). */
const webAuthnJsonSchema = z.record(z.string(), z.unknown());
/** POST /v1/me/lock/biometric/{register,unlock}/options */
export const biometricOptionsResponseSchema = z.object({ options: webAuthnJsonSchema });
/** POST /v1/me/lock/biometric/{register,unlock}/verify */
export const biometricVerifyBodySchema = z.object({ response: webAuthnJsonSchema });

/** lock:updated (server → my devices): my PIN, app lock or locked chats changed. */
export const lockUpdatedEventSchema = z.object({});

export type LockStatus = z.infer<typeof lockStatusSchema>;
export type AppLockIdle = z.infer<typeof appLockIdleSchema>;
