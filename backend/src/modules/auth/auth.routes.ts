import {
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
  requestOtpBodySchema,
  requestOtpResponseSchema,
  sessionResponseSchema,
  signOutResponseSchema,
  verifyOtpBodySchema,
} from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authErrorFromBody, rethrowAuthError } from '../../auth/errors.ts';
import {
  type AuthSessionRecord,
  type AuthUserRecord,
  forwardCookies,
  resolveSession,
  toSessionResponse,
  toWebHeaders,
} from '../../auth/session.ts';
import { AppError } from '../../lib/errors.ts';

/** Tight per-IP limit on the OTP endpoints, on top of the per-email OTP throttle. */
const otpRateLimit = { rateLimit: { max: 20, timeWindow: '1 minute' } };

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/auth/otp/request',
    {
      config: otpRateLimit,
      schema: {
        tags: ['auth'],
        summary: 'Email a 6-digit sign-in code (same response whether or not the account exists)',
        body: requestOtpBodySchema,
        response: { 200: requestOtpResponseSchema },
      },
    },
    async (request) => {
      await app.auth.api
        .sendVerificationOTP({
          body: { email: request.body.email, type: 'sign-in' },
          headers: toWebHeaders(request),
        })
        .catch(rethrowAuthError);
      return {
        status: 'sent' as const,
        expiresInSeconds: OTP_TTL_SECONDS,
        resendAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS,
      };
    },
  );

  app.post(
    '/auth/otp/verify',
    {
      config: otpRateLimit,
      schema: {
        tags: ['auth'],
        summary: 'Verify the code and sign in; the first success creates the account',
        body: verifyOtpBodySchema,
        response: { 200: sessionResponseSchema },
      },
    },
    async (request, reply) => {
      const { email, code } = request.body;
      const response = await app.auth.api
        .signInEmailOTP({
          body: { email, otp: code },
          headers: toWebHeaders(request),
          asResponse: true,
        })
        .catch(rethrowAuthError);
      const body = (await response.json().catch(() => ({}))) as {
        code?: string;
        message?: string;
        token?: string;
      };

      if (!response.ok) {
        if (body.code === 'INVALID_OTP') {
          const attemptsRemaining = await app.otpThrottle.recordFailure(email);
          throw attemptsRemaining > 0
            ? new AppError('OTP_INVALID', 'That code is not right. Check it and try again.', {
                attemptsRemaining,
              })
            : new AppError('OTP_ATTEMPTS_EXCEEDED', 'Too many wrong codes. Request a new one.', {
                attemptsRemaining: 0,
              });
        }
        throw authErrorFromBody(response.status, body);
      }

      const context = await app.auth.$context;
      const found = body.token ? await context.internalAdapter.findSession(body.token) : null;
      if (!found) throw new AppError('INTERNAL_ERROR', 'Could not start the session.');
      await app.otpThrottle.resetAttempts(email);
      forwardCookies(response, reply);
      return toSessionResponse(
        found.session as AuthSessionRecord,
        (await context.internalAdapter.findUserById(found.user.id)) as AuthUserRecord,
      );
    },
  );

  app.get(
    '/auth/me',
    {
      schema: {
        tags: ['auth'],
        summary: 'Current session and user (401 SESSION_EXPIRED when the session ended)',
        response: { 200: sessionResponseSchema },
      },
    },
    async (request) => {
      const { session, user } = await resolveSession(request);
      const context = await app.auth.$context;
      const record = (await context.internalAdapter.findUserById(user.id)) as AuthUserRecord;
      return toSessionResponse(session, record);
    },
  );

  app.post(
    '/auth/logout',
    {
      schema: {
        tags: ['auth'],
        summary: 'Sign out this device',
        response: { 200: signOutResponseSchema },
      },
    },
    async (request, reply) => {
      const response = await app.auth.api
        .signOut({ headers: toWebHeaders(request), asResponse: true })
        .catch(() => null);
      if (response) forwardCookies(response, reply);
      return { status: 'signed_out' as const };
    },
  );
};
