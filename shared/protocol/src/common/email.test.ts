import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALLOWED_EMAIL_DOMAINS,
  emailDomainNotAllowedMessage,
  emailSchema,
  isAllowedEmail,
  normalizeEmail,
  parseAllowedDomains,
} from './email.ts';

const ORG = ['corremadvisory.com'];

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Akhilesh@CorremAdvisory.COM \t')).toBe('akhilesh@corremadvisory.com');
  });
});

describe('isAllowedEmail', () => {
  it.each([
    'user@corremadvisory.com',
    'first.last@corremadvisory.com',
    'first+tag@corremadvisory.com',
    'u_1-x@corremadvisory.com',
  ])('allows %s', (email) => {
    expect(isAllowedEmail(email, ORG)).toBe(true);
  });

  it.each(['USER@CORREMADVISORY.COM', 'User@CorremAdvisory.com'])(
    'allows uppercase %s',
    (email) => {
      expect(isAllowedEmail(email, ORG)).toBe(true);
    },
  );

  it('allows surrounding whitespace, which is trimmed', () => {
    expect(isAllowedEmail('  user@corremadvisory.com  ', ORG)).toBe(true);
  });

  it.each([
    ['suffix attack', 'user@corremadvisory.com.evil.com'],
    ['prefix attack', 'user@evilcorremadvisory.com'],
    ['subdomain', 'user@sub.corremadvisory.com'],
    ['other domain', 'user@gmail.com'],
    ['space in local part', 'us er@corremadvisory.com'],
    ['space before @', 'user @corremadvisory.com'],
    ['space in domain', 'user@correm advisory.com'],
    ['multiple @', 'user@evil.com@corremadvisory.com'],
    ['double @', 'user@@corremadvisory.com'],
    ['missing local part', '@corremadvisory.com'],
    ['missing domain', 'user@'],
    ['no @', 'corremadvisory.com'],
    ['empty string', ''],
    ['whitespace only', '   '],
    ['leading dot', '.user@corremadvisory.com'],
    ['consecutive dots', 'us..er@corremadvisory.com'],
    ['trailing dot in domain', 'user@corremadvisory.com.'],
    ['too long', `${'a'.repeat(250)}@corremadvisory.com`],
  ])('rejects %s: %s', (_case, email) => {
    expect(isAllowedEmail(email, ORG)).toBe(false);
  });

  it('supports multiple allowed domains', () => {
    const domains = ['corremadvisory.com', 'correm.in'];
    expect(isAllowedEmail('a@corremadvisory.com', domains)).toBe(true);
    expect(isAllowedEmail('b@correm.in', domains)).toBe(true);
    expect(isAllowedEmail('c@sub.correm.in', domains)).toBe(false);
    expect(isAllowedEmail('d@example.com', domains)).toBe(false);
  });

  it('normalizes the allowed domains too', () => {
    expect(isAllowedEmail('user@corremadvisory.com', [' CorremAdvisory.com '])).toBe(true);
  });

  it('rejects everything when no domains are allowed', () => {
    expect(isAllowedEmail('user@corremadvisory.com', [])).toBe(false);
  });
});

describe('parseAllowedDomains', () => {
  it('splits, trims, lowercases and drops empty entries', () => {
    expect(parseAllowedDomains(' CorremAdvisory.com , correm.in,, ')).toEqual([
      'corremadvisory.com',
      'correm.in',
    ]);
  });

  it.each([undefined, '', ' , '])('falls back to the default for %j', (value) => {
    expect(parseAllowedDomains(value)).toEqual([...DEFAULT_ALLOWED_EMAIL_DOMAINS]);
  });

  it('defaults to the organization domain', () => {
    expect(DEFAULT_ALLOWED_EMAIL_DOMAINS).toEqual(['corremadvisory.com']);
  });
});

describe('emailDomainNotAllowedMessage', () => {
  it('matches the agreed wording', () => {
    expect(emailDomainNotAllowedMessage(ORG)).toBe(
      'Only @corremadvisory.com email addresses can use Zuvo',
    );
  });
});

describe('emailSchema', () => {
  it('outputs the normalized email', () => {
    expect(emailSchema.parse(' User@CorremAdvisory.com ')).toBe('user@corremadvisory.com');
  });

  it('rejects an invalid format', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
  });
});
