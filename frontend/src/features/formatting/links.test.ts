import { describe, expect, it } from 'vitest';
import { findLinks, trimUrl } from './links';
import { show } from './test-utils';

describe('URLs', () => {
  it.each([
    ['https://example.com', '<url https://example.com>https://example.com</url>'],
    ['http://a.com/path?q=1#x', '<url http://a.com/path?q=1#x>http://a.com/path?q=1#x</url>'],
    ['see https://a.com.', 'see <url https://a.com>https://a.com</url>.'],
    ['really? https://a.com/x?!', 'really? <url https://a.com/x>https://a.com/x</url>?!'],
    ['https://a.com, then', '<url https://a.com>https://a.com</url>, then'],
    ['(https://a.com)', '(<url https://a.com>https://a.com</url>)'],
    [
      'https://en.wikipedia.org/wiki/Foo_(bar)',
      '<url https://en.wikipedia.org/wiki/Foo_(bar)>https://en.wikipedia.org/wiki/Foo_(bar)</url>',
    ],
    [
      '(see https://en.wikipedia.org/wiki/Foo_(bar)).',
      '(see <url https://en.wikipedia.org/wiki/Foo_(bar)>https://en.wikipedia.org/wiki/Foo_(bar)</url>).',
    ],
    ['www.example.com', '<url https://www.example.com>www.example.com</url>'],
    ['go to www.a.co.in/x.', 'go to <url https://www.a.co.in/x>www.a.co.in/x</url>.'],
    ['HTTPS://A.COM', '<url HTTPS://A.COM>HTTPS://A.COM</url>'],
    ['http://localhost:5191/x', '<url http://localhost:5191/x>http://localhost:5191/x</url>'],
    ['*www.a.com*', '<b><url https://www.a.com>www.a.com</url></b>'],
    ['https://a.com/foo_bar_baz', '<url https://a.com/foo_bar_baz>https://a.com/foo_bar_baz</url>'],
    ['https://a.com/*x*', '<url https://a.com/*x>https://a.com/*x</url>*'],
    ['[x](https://a.com)', '[x](<url https://a.com>https://a.com</url>)'],
    ['https://नमस्ते.भारत', '<url https://नमस्ते.भारत>https://नमस्ते.भारत</url>'],
  ])('%s', (input, expected) => {
    expect(show(input)).toBe(expected);
  });

  it.each([
    'http://',
    'https://.com',
    'www.',
    'www.example',
    'example.com',
    'xhttps://a.com',
    'ftp://a.com',
    'javascript:alert(1)',
    'data:text/html,<b>x</b>',
    'file:///etc/passwd',
  ])('%s is not linked', (input) => {
    expect(show(input)).toBe(input);
  });

  it('stops at quotes and angle brackets', () => {
    expect(show('http://a.com/"><script>')).toBe(
      '<url http://a.com/>http://a.com/</url>"><script>',
    );
  });

  it('trims trailing punctuation and unbalanced brackets', () => {
    expect(trimUrl('a.com/x).')).toBe('a.com/x');
    expect(trimUrl('a.com/(x)')).toBe('a.com/(x)');
    expect(trimUrl('a.com/x]')).toBe('a.com/x');
    expect(trimUrl('...')).toBe('');
  });
});

describe('emails', () => {
  it.each([
    [
      'mail me@corremadvisory.com',
      'mail <email mailto:me@corremadvisory.com>me@corremadvisory.com</email>',
    ],
    [
      'a.b+c@sub.example.co.in.',
      '<email mailto:a.b+c@sub.example.co.in>a.b+c@sub.example.co.in</email>.',
    ],
    ['(x@y.io)', '(<email mailto:x@y.io>x@y.io</email>)'],
  ])('%s', (input, expected) => {
    expect(show(input)).toBe(expected);
  });

  it.each(['a@b', '@user', 'user@', 'a@b.c', 'a@-b.com', 'a@@b.com', 'नमस्तेa@b.com'])(
    '%s is not linked',
    (input) => {
      expect(show(input)).toBe(input);
    },
  );
});

describe('phone numbers', () => {
  it.each([
    ['+91 98765 43210', '<phone tel:+919876543210>+91 98765 43210</phone>'],
    ['call +1 (555) 123-4567.', 'call <phone tel:+15551234567>+1 (555) 123-4567</phone>.'],
    ['9876543210', '<phone tel:9876543210>9876543210</phone>'],
    ['(555) 123-4567', '<phone tel:5551234567>(555) 123-4567</phone>'],
    ['+4930123456', '<phone tel:+4930123456>+4930123456</phone>'],
    ['ph: 98765-43210, ok', 'ph: <phone tel:9876543210>98765-43210</phone>, ok'],
  ])('%s', (input, expected) => {
    expect(show(input)).toBe(expected);
  });

  it.each([
    '2024-01-05',
    '05-01-2024',
    'on 2024-01-05 10:30',
    '2024-01-05 1030',
    '10:30',
    'version 1.2.3',
    '12345678',
    'abc9876543210',
    '9876543210abc',
    'order #9876543210',
    '1234567890.5',
    '+1234567',
    '(555 123-4567',
    '3.14159265358979',
    '1234567890123456',
  ])('%s is not linked', (input) => {
    expect(findLinks(input).filter((l) => l.node.kind === 'phone')).toEqual([]);
  });
});

describe('overlaps', () => {
  it('prefers the email over a www link inside it', () => {
    expect(show('me@www.a.com')).toBe('<email mailto:me@www.a.com>me@www.a.com</email>');
  });

  it('does not link phone digits inside a URL', () => {
    expect(show('https://a.com/9876543210')).toBe(
      '<url https://a.com/9876543210>https://a.com/9876543210</url>',
    );
  });

  it('only ever produces http(s), mailto and tel hrefs', () => {
    const text = 'javascript:alert(1) https://a.com x@y.io +91 98765 43210 www.b.org vbscript:x';
    for (const link of findLinks(text)) {
      expect(link.node.href).toMatch(/^(https?:\/\/|mailto:|tel:)/);
    }
    expect(findLinks(text)).toHaveLength(4);
  });
});
