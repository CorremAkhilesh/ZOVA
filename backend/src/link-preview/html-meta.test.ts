import { describe, expect, it } from 'vitest';
import { decodeHtml, sniffMetaCharset } from './charset.ts';
import { decodeEntities } from './entities.ts';
import { extractPageMeta, MAX_SCAN_CHARS, readAttributes } from './html-meta.ts';

describe('readAttributes', () => {
  it('reads double, single and unquoted values in any order', () => {
    const html = ` content='Hello "world"' property="og:title" data-x=plain flag>rest`;
    const { attributes, end } = readAttributes(html, 0);
    expect(Object.fromEntries(attributes)).toEqual({
      content: 'Hello "world"',
      property: 'og:title',
      'data-x': 'plain',
      flag: '',
    });
    expect(html.slice(end)).toBe('rest');
  });

  it('handles self-closing tags, odd spacing and upper-case names', () => {
    const { attributes } = readAttributes(` NAME = "description"\n CONTENT=x />`, 0);
    expect(Object.fromEntries(attributes)).toEqual({ name: 'description', content: 'x' });
  });

  it('keeps the first of duplicate attributes and survives an unclosed quote', () => {
    expect(readAttributes(` a="1" a="2">`, 0).attributes.get('a')).toBe('1');
    const { attributes, end } = readAttributes(` content="never closed`, 0);
    expect(attributes.get('content')).toBe('never closed');
    expect(end).toBe(22);
  });

  it('allows ">" inside quoted values', () => {
    const { attributes } = readAttributes(` content="a > b" name=x>`, 0);
    expect(attributes.get('content')).toBe('a > b');
    expect(attributes.get('name')).toBe('x');
  });

  it('skips a nameless value', () => {
    const { attributes } = readAttributes(` ="x" name=y>`, 0);
    expect(Object.fromEntries(attributes)).toEqual({ name: 'y' });
  });
});

describe('extractPageMeta', () => {
  it('collects meta by property, name and itemprop, and the first title', () => {
    const page = extractPageMeta(`<!doctype html><HTML><head>
      <META property="OG:Title" content="OG title">
      <meta content="Desc" name="description"/>
      <meta itemprop=image content=/i.png>
      <meta property="og:title" content="second ignored">
      <title>Doc &amp; title</title><title>other</title>
      </head><body><meta property="og:image" content="body.png"></body>`);
    expect(page.title).toBe('Doc &amp; title');
    expect(Object.fromEntries(page.meta)).toEqual({
      'og:title': 'OG title',
      description: 'Desc',
      image: '/i.png',
    });
  });

  it('ignores tags inside comments, scripts and styles', () => {
    const page = extractPageMeta(`<head>
      <!-- <meta property="og:title" content="commented"> -->
      <script>document.write('<meta property="og:title" content="scripted"><title>x</title>')</script>
      <style>/* <meta name="description" content="styled"> */</style>
      <meta property="og:title" content="real">
      </head>`);
    expect(Object.fromEntries(page.meta)).toEqual({ 'og:title': 'real' });
    expect(page.title).toBeNull();
  });

  it('handles truncated documents and stray "<" characters', () => {
    expect(extractPageMeta('<head><title>Unclosed').title).toBe('Unclosed');
    expect(extractPageMeta('a < b <3 <!-- open').meta.size).toBe(0);
    expect(extractPageMeta('<script>never closed <meta name=a content=b>').meta.size).toBe(0);
  });

  it('only scans the first 512 K characters', () => {
    const page = extractPageMeta(
      `<head>${' '.repeat(MAX_SCAN_CHARS)}<meta property="og:title" content="late"></head>`,
    );
    expect(page.meta.size).toBe(0);
  });

  it('stays fast on pathological input', () => {
    const started = Date.now();
    extractPageMeta(`<meta ${'a='.repeat(200_000)}`);
    extractPageMeta('<'.repeat(400_000));
    extractPageMeta(`<meta content="${'x'.repeat(400_000)}`);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe('decodeEntities', () => {
  it('decodes named, decimal and hex references', () => {
    expect(decodeEntities('Tom &amp; Jerry&#39;s &#x27;show&#X27; &quot;x&quot; &lt;b&gt;')).toBe(
      `Tom & Jerry's 'show' "x" <b>`,
    );
    expect(decodeEntities('&hellip;&nbsp;&rupee;&eacute;&#128512;')).toBe('…\u00a0₹é😀');
  });

  it('decodes once (no double decoding) and leaves unknown names', () => {
    expect(decodeEntities('&amp;lt;')).toBe('&lt;');
    expect(decodeEntities('&bogus; &constructor; & alone')).toBe('&bogus; &constructor; & alone');
  });

  it('replaces invalid code points', () => {
    expect(decodeEntities('&#0;&#xD800;&#x110000;')).toBe('\ufffd\ufffd\ufffd');
  });
});

describe('charset', () => {
  const cafe1252 = Buffer.from([0x43, 0x61, 0x66, 0xe9, 0x20, 0x80]); // "Café €" in windows-1252

  it('uses the Content-Type charset first', () => {
    expect(decodeHtml(cafe1252, 'windows-1252')).toBe('Café €');
    expect(decodeHtml(cafe1252, 'iso-8859-1')).toBe('Café €');
  });

  it('falls back to <meta charset> and http-equiv, then UTF-8', () => {
    const withMeta = Buffer.concat([Buffer.from('<meta charset="ISO-8859-1">'), cafe1252]);
    expect(decodeHtml(withMeta, null)).toContain('Café €');
    const httpEquiv = Buffer.from(
      '<meta http-equiv="Content-Type" content="text/html; charset=windows-1252">',
    );
    expect(sniffMetaCharset(httpEquiv)).toBe('windows-1252');
    expect(decodeHtml(Buffer.from('Café'), null)).toBe('Café');
  });

  it('ignores unknown labels and honours a byte-order mark', () => {
    expect(decodeHtml(Buffer.from('Café'), 'x-made-up')).toBe('Café');
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Hi')]);
    expect(decodeHtml(bom, 'windows-1252')).toBe('Hi');
    expect(decodeHtml(Buffer.from([0xff, 0xfe, 0x48, 0x00]), null)).toBe('H');
  });
});
