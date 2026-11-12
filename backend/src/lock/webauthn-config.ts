import type { Env } from '../config/env.ts';

/**
 * The relying party is the app: rpID = APP_URL's host name, and answers are accepted from the same
 * origins as sign-in (APP_URL + CORS_ORIGINS, Better Auth's trustedOrigins). Browsers allow
 * WebAuthn only on https:// or http://localhost, so http://127.0.0.1 in development cannot use it.
 */
export function webAuthnConfig(env: Pick<Env, 'APP_URL' | 'CORS_ORIGINS'>) {
  const rpID = new URL(env.APP_URL).hostname;
  const origins = [env.APP_URL, ...env.CORS_ORIGINS].map((url) => new URL(url).origin);
  return { rpID, expectedOrigin: [...new Set(origins)] };
}

/** How long a register/unlock ceremony may take. */
export const CHALLENGE_TTL_MS = 2 * 60_000;
/** Adding a fingerprint needs a correct PIN this recently. */
export const RECENT_PIN_MS = 5 * 60_000;
/** Devices per person that can unlock without the PIN. */
export const BIOMETRIC_MAX = 10;
