import { resolve } from 'node:path';
import { parseAllowedDomains } from '@zuvo/protocol';
import { z } from 'zod';
import { isVapidPrivateKey, isVapidPublicKey, vapidKeysMatch } from '../push/vapid.ts';

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

const commaList = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

/** Both VAPID keys or neither (push off); a matching pair; and always set in production. */
function checkVapid(
  env: {
    NODE_ENV: string;
    VAPID_PUBLIC_KEY?: string | undefined;
    VAPID_PRIVATE_KEY?: string | undefined;
  },
  ctx: z.RefinementCtx,
) {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey } = env;
  if (env.NODE_ENV === 'production') {
    for (const name of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'] as const) {
      if (!env[name])
        ctx.addIssue({ code: 'custom', path: [name], message: 'is required in production' });
    }
  }
  if (Boolean(publicKey) !== Boolean(privateKey)) {
    const missing = publicKey ? 'VAPID_PRIVATE_KEY' : 'VAPID_PUBLIC_KEY';
    ctx.addIssue({
      code: 'custom',
      path: [missing],
      message: 'must be set with the other VAPID key',
    });
  } else if (publicKey && privateKey && !vapidKeysMatch({ publicKey, privateKey })) {
    ctx.addIssue({
      code: 'custom',
      path: ['VAPID_PUBLIC_KEY'],
      message: 'does not belong to VAPID_PRIVATE_KEY',
    });
  }
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    /** Interface to listen on. Defaults: 127.0.0.1 in development, 0.0.0.0 elsewhere (Docker). */
    HOST: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    APP_URL: z.url(),
    API_URL: z.url(),
    CORS_ORIGINS: z
      .string()
      .transform(commaList)
      .pipe(z.array(z.url()).min(1, 'must list at least one origin')),

    MONGODB_URI: z
      .string()
      .regex(/^mongodb(\+srv)?:\/\//, 'must start with mongodb:// or mongodb+srv://'),
    MONGODB_DB: z.string().regex(/^[A-Za-z0-9_-]{1,63}$/, 'must be a valid database name'),
    REDIS_URL: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .regex(/^rediss?:\/\//, 'must start with redis:// or rediss://')
        .optional(),
    ),

    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535),
    SMTP_SECURE: z.stringbool(),
    SMTP_USER: z.email(),
    SMTP_PASS: z.string().min(1),
    MAIL_FROM: z.email(),

    ALLOWED_EMAIL_DOMAINS: z.preprocess(
      emptyToUndefined,
      z.string().optional().transform(parseAllowedDomains),
    ),
    /** Signs session cookies. At least 32 random characters; unique per environment. */
    AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),
    /** Emails promoted to admin when they sign in (first or later login); never demotes. */
    ADMIN_EMAILS: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .optional()
        .transform((value) => (value ? commaList(value).map((email) => email.toLowerCase()) : [])),
    ),
    /** OTP requests allowed per client IP per hour. */
    OTP_IP_LIMIT_PER_HOUR: z.coerce.number().int().min(1).max(10_000).default(30),
    MEDIA_STORAGE_PATH: z
      .string()
      .min(1)
      .transform((path) => resolve(path)),
    /** The largest file a person can send, in MiB. The app reads it from GET /v1/config. */
    MEDIA_MAX_FILE_MB: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).max(102_400).default(1024),
    ),
    /** The longest voice note, in seconds. The app reads it from GET /v1/config. */
    VOICE_MAX_SECONDS: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(10).max(7200).default(900),
    ),
    /** Web Push (VAPID) key pair, base64url; `pnpm vapid:gen` makes one. Required in production. */
    VAPID_PUBLIC_KEY: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .refine(isVapidPublicKey, 'must be a base64url P-256 public key (65 bytes)')
        .optional(),
    ),
    VAPID_PRIVATE_KEY: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .refine(isVapidPrivateKey, 'must be a base64url P-256 private key (32 bytes)')
        .optional(),
    ),
    /** Who push services may contact about our pushes: a mailto: or https: URL. */
    VAPID_SUBJECT: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .regex(/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/, 'must be a mailto: or https: URL')
        .default('mailto:nova@corremadvisory.com'),
    ),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.MAIL_FROM.toLowerCase() !== env.SMTP_USER.toLowerCase()) {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_FROM'],
        message: 'must equal SMTP_USER (Hostinger only sends from the authenticated mailbox)',
      });
    }
    if (env.NODE_ENV === 'production' && !env.REDIS_URL) {
      ctx.addIssue({ code: 'custom', path: ['REDIS_URL'], message: 'is required in production' });
    }
    // Staging and production run with NODE_ENV=production: someone must be able to administer.
    if (env.NODE_ENV === 'production' && env.ADMIN_EMAILS.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['ADMIN_EMAILS'],
        message: 'is required in production',
      });
    }
    checkVapid(env, ctx);
    if (env.NODE_ENV === 'test' && !env.MONGODB_DB.startsWith('zuvo_test_')) {
      ctx.addIssue({
        code: 'custom',
        path: ['MONGODB_DB'],
        message: 'must start with "zuvo_test_" when NODE_ENV=test (tests never touch real data)',
      });
    }
  });

export type Env = z.output<typeof envSchema>;

export class EnvError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvError';
    this.issues = issues;
  }
}

/** Validates the environment. Throws an EnvError listing every problem (never the values). */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvError(
      result.error.issues.map((issue) => {
        const name = issue.path.join('.') || '(root)';
        const message =
          issue.code === 'invalid_type' && issue.input === undefined
            ? 'is required'
            : issue.message;
        return `${name} ${message}`;
      }),
    );
  }
  return result.data;
}
