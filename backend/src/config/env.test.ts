import { isAbsolute } from 'node:path';
import { describe, expect, it } from 'vitest';
import { testEnvSource } from '../../test/helpers.ts';
import { EnvError, loadEnv } from './env.ts';

function issuesFor(overrides: Record<string, string | undefined>): string[] {
  try {
    loadEnv(testEnvSource(overrides));
  } catch (error) {
    if (error instanceof EnvError) return error.issues;
    throw error;
  }
  return [];
}

describe('loadEnv', () => {
  it('parses and normalizes a valid environment', () => {
    const env = loadEnv(
      testEnvSource({
        CORS_ORIGINS: 'http://localhost:5173, https://app.example.com',
        ALLOWED_EMAIL_DOMAINS: ' CorremAdvisory.com ,correm.in',
      }),
    );
    expect(env.PORT).toBe(4000);
    expect(env.SMTP_PORT).toBe(465);
    expect(env.SMTP_SECURE).toBe(true);
    expect(env.REDIS_URL).toBeUndefined();
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173', 'https://app.example.com']);
    expect(env.ALLOWED_EMAIL_DOMAINS).toEqual(['corremadvisory.com', 'correm.in']);
    expect(isAbsolute(env.MEDIA_STORAGE_PATH)).toBe(true);
  });

  it('defaults the allowed email domains to the organization domain', () => {
    expect(loadEnv(testEnvSource({ ALLOWED_EMAIL_DOMAINS: '' })).ALLOWED_EMAIL_DOMAINS).toEqual([
      'corremadvisory.com',
    ]);
  });

  it('requires MAIL_FROM to equal SMTP_USER', () => {
    expect(issuesFor({ MAIL_FROM: 'no-reply@corremadvisory.com' })).toEqual([
      expect.stringMatching(/^MAIL_FROM must equal SMTP_USER/),
    ]);
  });

  it('compares MAIL_FROM and SMTP_USER case-insensitively', () => {
    expect(issuesFor({ MAIL_FROM: 'Nova@CorremAdvisory.com' })).toEqual([]);
  });

  it('reports every missing variable by name', () => {
    const issues = issuesFor({ MONGODB_URI: undefined, SMTP_PASS: undefined });
    expect(issues).toContain('MONGODB_URI is required');
    expect(issues).toContain('SMTP_PASS is required');
  });

  it('never includes secret values in the error message', () => {
    try {
      loadEnv(testEnvSource({ MONGODB_URI: 'postgres://user:hunter2@host', PORT: 'abc' }));
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain('hunter2');
    }
  });

  it.each([
    ['MONGODB_URI', 'http://cluster.example.com'],
    ['REDIS_URL', 'http://localhost:6379'],
    ['PORT', '70000'],
    ['SMTP_SECURE', 'maybe'],
    ['APP_URL', 'not a url'],
    ['CORS_ORIGINS', ' , '],
    ['LOG_LEVEL', 'verbose'],
  ])('rejects an invalid %s', (name, value) => {
    expect(issuesFor({ [name]: value }).some((issue) => issue.startsWith(name))).toBe(true);
  });

  it('accepts redis:// and rediss:// URLs', () => {
    expect(issuesFor({ REDIS_URL: 'redis://localhost:6379' })).toEqual([]);
    expect(issuesFor({ REDIS_URL: 'rediss://default:pw@redis.example.com:6380' })).toEqual([]);
  });

  it('requires REDIS_URL in production', () => {
    expect(issuesFor({ NODE_ENV: 'production', REDIS_URL: '' })).toContain(
      'REDIS_URL is required in production',
    );
  });

  it('requires ADMIN_EMAILS in production (staging too) and lowercases it', () => {
    expect(
      issuesFor({ NODE_ENV: 'production', REDIS_URL: 'redis://r:6379', ADMIN_EMAILS: '' }),
    ).toContain('ADMIN_EMAILS is required in production');
    expect(
      loadEnv(testEnvSource({ ADMIN_EMAILS: 'NovaAdmin@corremadvisory.com' })).ADMIN_EMAILS,
    ).toEqual(['novaadmin@corremadvisory.com']);
  });

  it.each(['zuvo_dev', 'zuvo_prod'])('refuses to run tests against %s', (db) => {
    expect(issuesFor({ MONGODB_DB: db }).some((issue) => issue.startsWith('MONGODB_DB'))).toBe(
      true,
    );
  });
});
