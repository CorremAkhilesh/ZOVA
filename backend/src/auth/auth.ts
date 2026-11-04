import { brand } from '@zuvo/config';
import { OTP_LENGTH, OTP_MAX_ATTEMPTS, OTP_TTL_SECONDS, SESSION_TTL_SECONDS } from '@zuvo/protocol';
import { betterAuth, type SecondaryStorage } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { emailOTP } from 'better-auth/plugins';
import type { Db, MongoClient } from 'mongodb';
import type { EmailDispatcher } from '../mail/dispatcher.ts';
import { otpEmail } from '../mail/templates/otp-email.tsx';
import { type OtpThrottle, ThrottledError } from './otp-throttle.ts';
import {
  type AccessPolicy,
  accountDeactivated,
  assertAllowedEmail,
  isAdminEmail,
} from './policy.ts';

/** Header our Fastify layer sets from `request.ip` (proxy-aware); client values are overwritten. */
export const CLIENT_IP_HEADER = 'x-zuvo-client-ip';
export const AUTH_BASE_PATH = '/v1/auth';
export const COOKIE_PREFIX = 'zuvo';

export interface AuthOptions {
  db: Db;
  client: MongoClient;
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
  production: boolean;
  policy: AccessPolicy;
  throttle: OtpThrottle;
  dispatcher: EmailDispatcher;
  secondaryStorage: SecondaryStorage | undefined;
  rateLimitEnabled: boolean;
  /** Called after a sign-in on an account that had signed in before (new-login alert). */
  onNewLogin?: (login: NewLogin) => Promise<void>;
  /** An ADMIN_EMAILS account that is not an admin yet has just signed in: promote and audit it. */
  onAdminEmailSignIn?: (email: string) => Promise<void>;
}

export interface NewLogin {
  userId: string;
  email: string;
  userAgent: string | null;
  signedInAt: Date;
}

function throttled(error: ThrottledError): APIError {
  return new APIError('TOO_MANY_REQUESTS', {
    code: 'RATE_LIMITED',
    message: error.message,
    retryAfterSeconds: error.retryAfterSeconds,
  });
}

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/**
 * Before any OTP is generated or sent: per-IP limit (rejected requests count too), organization
 * domain, sign-in type, account status, then the per-email cooldown and hourly cap.
 */
async function guardOtpRequest(ctx: HookContext, { policy, throttle }: AuthOptions) {
  try {
    await throttle.checkIp(ctx.headers?.get(CLIENT_IP_HEADER) ?? 'unknown');
    const email = assertAllowedEmail(ctx.body?.email, policy);
    if (ctx.body?.type !== 'sign-in') {
      throw new APIError('BAD_REQUEST', { code: 'BAD_REQUEST', message: 'Unsupported code type.' });
    }
    const found = await ctx.context.internalAdapter.findUserByEmail(email);
    if ((found?.user as { status?: string } | undefined)?.status === 'deactivated') {
      throw accountDeactivated();
    }
    await throttle.checkEmail(email);
    await throttle.resetAttempts(email);
  } catch (error) {
    if (error instanceof ThrottledError) throw throttled(error);
    throw error;
  }
}

export function createAuth(options: AuthOptions) {
  const { policy } = options;

  return betterAuth({
    appName: 'zuvo',
    secret: options.secret,
    baseURL: options.baseURL,
    basePath: AUTH_BASE_PATH,
    trustedOrigins: options.trustedOrigins,
    telemetry: { enabled: false },
    database: mongodbAdapter(options.db, { client: options.client }),
    ...(options.secondaryStorage ? { secondaryStorage: options.secondaryStorage } : {}),

    user: {
      additionalFields: {
        displayName: { type: 'string', required: false, input: false },
        username: { type: 'string', required: false, input: false },
        about: { type: 'string', required: false, input: false },
        role: { type: 'string', required: false, defaultValue: 'user', input: false },
        status: { type: 'string', required: false, defaultValue: 'active', input: false },
        lastLoginAt: { type: 'date', required: false, input: false },
      },
    },

    session: {
      // Absolute 7-day sessions: never extended, whatever the user does.
      expiresIn: SESSION_TTL_SECONDS,
      disableSessionRefresh: true,
      // Keep sessions in MongoDB too (listing/revoking), even with Redis as secondary storage.
      storeSessionInDatabase: true,
    },

    advanced: {
      cookiePrefix: COOKIE_PREFIX,
      // Secure everywhere except plain-http local development.
      useSecureCookies: options.production,
      // Lax: the cookie still arrives when a user opens the app from an email link (Strict would
      // look logged out on that first load). Cross-site POSTs are blocked by Lax plus Better Auth's
      // origin check. No `domain` → host-only cookie, first-party on the app origin.
      defaultCookieAttributes: { sameSite: 'lax', httpOnly: true, secure: options.production },
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },

    rateLimit: {
      enabled: options.rateLimitEnabled,
      storage: options.secondaryStorage ? 'secondary-storage' : 'memory',
      window: 60,
      max: 120,
    },

    // Only email OTP sign-in is supported; everything else Better Auth ships is switched off.
    disabledPaths: [
      '/sign-up/email',
      '/sign-in/email',
      '/sign-in/social',
      '/update-user',
      '/delete-user',
      '/change-email',
      '/change-password',
      '/set-password',
      '/request-password-reset',
      '/reset-password',
      '/send-verification-email',
      '/verify-email',
      '/link-social',
      '/unlink-account',
      '/email-otp/verify-email',
      '/email-otp/request-password-reset',
      '/email-otp/reset-password',
      '/forget-password/email-otp',
    ],

    plugins: [
      emailOTP({
        otpLength: OTP_LENGTH,
        expiresIn: OTP_TTL_SECONDS,
        allowedAttempts: OTP_MAX_ATTEMPTS,
        storeOTP: 'hashed',
        // First successful verification creates the account: sign-up and sign-in are one flow.
        disableSignUp: false,
        async sendVerificationOTP({ email, otp, type }) {
          if (type !== 'sign-in') return;
          const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);
          await options.dispatcher.dispatch(await otpEmail(email, otp, expiresAt), 'otp');
        },
      }),
    ],

    hooks: {
      // Runs BEFORE any OTP is generated or sent, and before verification.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/email-otp/send-verification-otp') await guardOtpRequest(ctx, options);
        if (ctx.path === '/sign-in/email-otp') assertAllowedEmail(ctx.body?.email, policy);
      }),
      // Runs once sign-in has finished, after Better Auth's sign-up transaction committed: writing
      // to other collections inside that transaction's window can block on it.
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-in/email-otp') return;
        const user = ctx.context.newSession?.user as { email: string; role?: string } | undefined;
        // ADMIN_EMAILS promotes on every sign-in (new or existing account); never demotes.
        if (user && user.role !== 'admin' && isAdminEmail(user.email, policy)) {
          await options.onAdminEmailSignIn?.(user.email);
        }
      }),
    },

    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            assertAllowedEmail(user.email, policy);
            // Everyone starts as a user; ADMIN_EMAILS is applied (and audited) at sign-in below.
            return {
              data: {
                ...user,
                role: 'user',
                status: 'active',
                displayName: null,
                about: brand.defaultAbout,
                searchTerms: [],
              },
            };
          },
        },
      },
      session: {
        create: {
          // Re-checked at session creation: domain and account status.
          before: async (session, ctx) => {
            const user = await ctx?.context.internalAdapter.findUserById(session.userId);
            if (!user)
              throw new APIError('UNAUTHORIZED', {
                code: 'UNAUTHENTICATED',
                message: 'Unknown user.',
              });
            assertAllowedEmail(user.email, policy);
            if ((user as { status?: string }).status === 'deactivated') throw accountDeactivated();
          },
          after: async (session, ctx) => {
            const adapter = ctx?.context.internalAdapter;
            if (!adapter) return;
            const user = await adapter.findUserById(session.userId);
            const previousLogin = (user as { lastLoginAt?: Date | null } | null)?.lastLoginAt;
            await adapter.updateUser(session.userId, { lastLoginAt: new Date() });
            // Every sign-in except the very first one (account creation) raises an alert.
            if (user && previousLogin && options.onNewLogin) {
              await options.onNewLogin({
                userId: session.userId,
                email: user.email,
                userAgent: session.userAgent ?? null,
                signedInAt: new Date(session.createdAt),
              });
            }
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
