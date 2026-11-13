import { describe, expect, it } from 'vitest';
import { hasLink, linkKey, linksIn, normalizeUrl } from './link-text.ts';

describe('links in a message', () => {
  it.each([
    ['see https://example.com/a.', ['https://example.com/a']],
    ['(https://example.com/x)', ['https://example.com/x']],
    [
      'https://en.wikipedia.org/wiki/Mumbai_(city)!',
      ['https://en.wikipedia.org/wiki/Mumbai_(city)'],
    ],
    [
      'www.example.com, then http://b.example/?q=1',
      ['https://www.example.com/', 'http://b.example/?q=1'],
    ],
    ['a https://example.com/#part link', ['https://example.com/']],
    [
      'यह देखें https://example.in/समाचार',
      ['https://example.in/%E0%A4%B8%E0%A4%AE%E0%A4%BE%E0%A4%9A%E0%A4%BE%E0%A4%B0'],
    ],
  ])('%s', (text, expected) => {
    expect(linksIn(text)).toEqual(expected);
  });

  it('ignores what is not a web link', () => {
    for (const text of [
      'ftp://example.com',
      'javascript:alert(1)',
      'mail me@example.com',
      '',
      null,
    ]) {
      expect(hasLink(text)).toBe(false);
    }
    expect(linksIn('https://user:pass@example.com/')).toEqual([]);
  });

  it('normalises one spelling per page, with a stable key', () => {
    expect(normalizeUrl('HTTPS://Example.COM')).toBe('https://example.com/');
    expect(normalizeUrl('data:text/html,hi')).toBeNull();
    expect(linkKey('https://example.com/')).toBe(linkKey('https://example.com/'));
    expect(linkKey('https://example.com/')).toMatch(/^[a-f\d]{64}$/);
  });
});
