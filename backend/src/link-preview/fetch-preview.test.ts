import { afterEach, describe, expect, it } from 'vitest';
import { absoluteHttpUrl, buildPreview, cleanText, fetchPreview } from './fetch-preview.ts';
import { extractPageMeta } from './html-meta.ts';
import { localOptions, startServer, type TestServer } from './test-server.ts';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const preview = (html: string, url = 'https://www.example.com/a/page') =>
  buildPreview(extractPageMeta(html), url);

describe('buildPreview', () => {
  it('prefers Open Graph tags', () => {
    expect(
      preview(`<head>
        <meta property="og:title" content="OG Title">
        <meta name="twitter:title" content="Twitter Title">
        <meta property="og:description" content="OG description">
        <meta property="og:site_name" content="Example News">
        <meta property="og:image" content="https://cdn.example.com/a.jpg">
        <meta property="og:url" content="https://example.com/canonical">
        <title>Doc title</title></head>`),
    ).toEqual({
      ok: true,
      url: 'https://www.example.com/a/page',
      title: 'OG Title',
      description: 'OG description',
      siteName: 'Example News',
      imageUrl: 'https://cdn.example.com/a.jpg',
      canonicalUrl: 'https://example.com/canonical',
    });
  });

  it('falls back to Twitter tags, then <title> / meta description and the host name', () => {
    expect(
      preview(`<meta name="twitter:title" content="TW"><meta name="twitter:image" content="t.png">
        <meta name="twitter:description" content="TW desc">`),
    ).toMatchObject({
      title: 'TW',
      description: 'TW desc',
      siteName: 'example.com',
      imageUrl: 'https://www.example.com/a/t.png',
      canonicalUrl: null,
    });
    expect(
      preview('<title> Plain\n  title </title><meta name="description" content="Meta desc">'),
    ).toMatchObject({ title: 'Plain title', description: 'Meta desc', imageUrl: null });
  });

  it('skips empty Open Graph values', () => {
    expect(preview('<meta property="og:title" content="  "><title>Real</title>')).toMatchObject({
      title: 'Real',
    });
  });

  it('decodes entities and resolves relative images against the final URL', () => {
    expect(
      preview(`<meta property="og:title" content="Rock &amp; Roll &#39;24 &#x27;live&#x27; &quot;now&quot;">
        <meta property="og:image" content="../img/a.png?x=1&amp;y=2">`),
    ).toMatchObject({
      title: `Rock & Roll '24 'live' "now"`,
      imageUrl: 'https://www.example.com/img/a.png?x=1&y=2',
    });
    expect(
      preview('<title>x</title><meta property="og:image" content="//cdn.test/i.png">'),
    ).toMatchObject({ imageUrl: 'https://cdn.test/i.png' });
  });

  it('drops non-http images and canonical URLs', () => {
    for (const image of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'file:///x.png']) {
      const result = preview(
        `<title>x</title><meta property="og:image" content="${image}"><meta property="og:url" content="${image}">`,
      );
      expect(result).toMatchObject({ imageUrl: null, canonicalUrl: null });
    }
  });

  it('returns plain text only, even when tags hide in the metadata', () => {
    const result = preview(`<head>
      <meta property="og:title" content="<b>Bold</b> &lt;i&gt;title&lt;/i&gt;">
      <meta property="og:description" content="&lt;script&gt;alert(1)&lt;/script&gt;Safe <img src=x onerror=alert(1)> text">
      <script>var og = '<meta property="og:description" content="from script">';</script>
      </head>`);
    expect(result).toMatchObject({ title: 'Bold title', description: 'alert(1) Safe text' });
    if (result.ok) expect(`${result.title}${result.description}`).not.toMatch(/[<>]/);
  });

  it('caps lengths without splitting characters', () => {
    const result = preview(`<meta property="og:title" content="${'😀'.repeat(250)}">
      <meta property="og:description" content="${'d'.repeat(400)}">
      <meta property="og:site_name" content="${'s'.repeat(150)}">`);
    if (!result.ok) throw new Error('expected a preview');
    expect(Array.from(result.title ?? '')).toHaveLength(200);
    expect(result.title?.endsWith('😀…')).toBe(true);
    expect(Array.from(result.description ?? '')).toHaveLength(300);
    expect(Array.from(result.siteName)).toHaveLength(100);
  });

  it("returns 'empty' when there is no title and no description", () => {
    expect(
      preview('<html><head><meta property="og:image" content="/a.png"></head></html>'),
    ).toMatchObject({ ok: false, reason: 'empty' });
    expect(preview('<title>   </title>')).toMatchObject({ ok: false, reason: 'empty' });
  });
});

describe('cleanText / absoluteHttpUrl', () => {
  it('removes control characters and collapses whitespace', () => {
    expect(cleanText('a\u0000b\u202ec\u2028d\t\te', 50)).toBe('a b c d e');
    expect(cleanText(null, 10)).toBeNull();
  });

  it('rejects URLs with credentials or over the length limit', () => {
    expect(absoluteHttpUrl('https://u:p@cdn.test/a.png', 'https://a.test/')).toBeNull();
    expect(absoluteHttpUrl(`https://cdn.test/${'a'.repeat(2100)}`, 'https://a.test/')).toBeNull();
    expect(absoluteHttpUrl('http://[bad', 'https://a.test/')).toBeNull();
  });
});

describe('fetchPreview', () => {
  /** Path → [body, Content-Type] (an empty type sends no Content-Type header). */
  const pages: Record<string, [string | Buffer, string]> = {
    '/article': [
      `<html><head><meta property="og:title" content="Article"><meta property="og:image" content="/cover.jpg"></head></html>`,
      'text/html; charset=utf-8',
    ],
    '/latin1': [
      Buffer.concat([
        Buffer.from('<title>Caf'),
        Buffer.from([0xe9, 0x20, 0x96, 0x20, 0x80]),
        Buffer.from('</title>'),
      ]),
      'text/html; charset=windows-1252',
    ],
    '/xhtml': ['<title>X</title>', 'application/xhtml+xml'],
    '/json': ['{"title":"x"}', 'application/json'],
    '/no-type': ['<title>x</title>', ''],
    '/empty': ['<html><body>Nothing</body></html>', 'text/html'],
  };

  async function site() {
    server = await startServer((request, response) => {
      const url = request.url ?? '/';
      if (url === '/moved') return response.writeHead(301, { Location: '/article' }).end();
      const page = pages[url];
      if (!page) return response.writeHead(404).end();
      response.writeHead(200, page[1] ? { 'Content-Type': page[1] } : {});
      response.end(page[0]);
    });
    return server;
  }

  it('fetches, follows redirects and resolves the image against the final URL', async () => {
    const s = await site();
    const result = await fetchPreview(s.url('/moved'), localOptions());
    expect(result).toEqual({
      ok: true,
      url: s.url('/article'),
      title: 'Article',
      description: null,
      siteName: 'site.test',
      imageUrl: s.url('/cover.jpg'),
      canonicalUrl: null,
    });
  });

  it('decodes a windows-1252 page', async () => {
    const s = await site();
    expect(await fetchPreview(s.url('/latin1'), localOptions())).toMatchObject({
      title: 'Café – €',
    });
  });

  it('accepts XHTML', async () => {
    const s = await site();
    expect(await fetchPreview(s.url('/xhtml'), localOptions())).toMatchObject({ title: 'X' });
  });

  it.each(['/json', '/no-type'])("refuses %s as 'not_html'", async (path) => {
    const s = await site();
    expect(await fetchPreview(s.url(path), localOptions())).toMatchObject({
      ok: false,
      reason: 'not_html',
    });
  });

  it('passes fetch failures through', async () => {
    const s = await site();
    expect(await fetchPreview(s.url('/missing'), localOptions())).toMatchObject({
      ok: false,
      reason: 'http_error',
      status: 404,
    });
    expect(await fetchPreview(`http://127.0.0.1:${s.port}/article`)).toMatchObject({
      reason: 'blocked',
    });
    expect(await fetchPreview(s.url('/empty'), localOptions())).toMatchObject({ reason: 'empty' });
  });
});
