import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import type { SafeFetchOptions } from '../link-preview/types.ts';

/** Signs in as admin in E2E (Admin → Reports). Only ever used against the in-memory database. */
export const E2E_ADMIN_EMAIL = 'e2e.admin@corremadvisory.com';

const PAGE = `<!doctype html><html><head>
<title>E2E article</title>
<meta property="og:title" content="Quarterly results are in">
<meta property="og:description" content="Revenue grew and costs fell.">
<meta property="og:site_name" content="E2E News">
<meta property="og:image" content="/cover.png">
</head><body>Article</body></html>`;

/**
 * A tiny web site on 127.0.0.1 for link previews in E2E. The fetcher is told `preview.test` lives
 * at 127.0.0.1 and may connect there; every other private address stays refused.
 */
export async function startPreviewSite() {
  const cover = await sharp({
    create: { width: 1200, height: 630, channels: 3, background: '#4f46e5' },
  })
    .png()
    .toBuffer();
  const server = createServer((request, response) => {
    if (request.url === '/cover.png') {
      response.writeHead(200, { 'Content-Type': 'image/png' });
      response.end(cover);
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const fetchOptions: SafeFetchOptions = {
    resolve: async (hostname) => {
      if (hostname === 'preview.test') return ['127.0.0.1'];
      throw new Error(`ENOTFOUND ${hostname}`);
    },
    isAllowedAddress: (address) => address === '127.0.0.1',
  };
  return {
    url: (path: string) => `http://preview.test:${port}${path}`,
    fetchOptions,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
