import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { vi } from 'vitest';
import { isMemoryMailer } from '../src/mail/memory-mailer.ts';

export const ORIGIN = 'http://localhost:5173';

/** Headers every browser request carries: Origin (CSRF check) and optionally the session cookie. */
export function headers(cookie?: string) {
  return { origin: ORIGIN, ...(cookie ? { cookie } : {}) };
}

/** Turns Set-Cookie response headers into a Cookie request header. */
export function cookieFrom(response: LightMyRequestResponse): string {
  const raw = response.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((cookie) => cookie.split(';')[0]).join('; ');
}

export function outbox(app: FastifyInstance) {
  if (!isMemoryMailer(app.mailer)) throw new Error('tests need the in-memory mailer');
  return app.mailer;
}

export function requestOtp(
  app: FastifyInstance,
  email: string,
  extra: Record<string, string> = {},
) {
  return app.inject({
    method: 'POST',
    url: '/v1/auth/otp/request',
    headers: { ...headers(), ...extra },
    payload: { email },
  });
}

/** Waits for the OTP email (sent in the background) and returns the code from its subject. */
export async function readOtp(
  app: FastifyInstance,
  email: string,
  previous?: string,
): Promise<string> {
  let code = '';
  await vi.waitFor(
    () => {
      const subject = outbox(app).lastTo(email)?.subject ?? '';
      const match = /^(\d{6}) is your /.exec(subject);
      if (!match?.[1] || match[1] === previous) throw new Error('no new OTP yet');
      code = match[1];
      // The email is rendered and sent in the background; allow for slow, busy machines.
    },
    { timeout: 15_000, interval: 50 },
  );
  return code;
}

export function verifyOtp(app: FastifyInstance, email: string, code: string) {
  return app.inject({
    method: 'POST',
    url: '/v1/auth/otp/verify',
    headers: headers(),
    payload: { email, code },
  });
}

/** Full sign-in: request, read the code, verify. Returns the session cookie and the response. */
export async function signIn(app: FastifyInstance, email: string) {
  // Same account on several "devices" in one test: skip the 60 s resend cooldown.
  await app.otpThrottle.resetEmail(email);
  const requested = await requestOtp(app, email);
  if (requested.statusCode !== 200) throw new Error(`OTP request failed: ${requested.body}`);
  const code = await readOtp(app, email);
  const verified = await verifyOtp(app, email, code);
  if (verified.statusCode !== 200) throw new Error(`OTP verify failed: ${verified.body}`);
  return { cookie: cookieFrom(verified), response: verified };
}

export function me(app: FastifyInstance, cookie?: string) {
  return app.inject({ method: 'GET', url: '/v1/auth/me', headers: headers(cookie) });
}
