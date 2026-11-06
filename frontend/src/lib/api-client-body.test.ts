import { okResponseSchema } from '@zuvo/protocol';
import { describe, expect, it } from 'vitest';
import { HttpResponse, http, server } from '@/test/msw';
import { apiPost, apiPut } from './api-client';

describe('a request with nothing to send', () => {
  it('does not claim to be JSON: the server refuses an empty JSON body', async () => {
    const seen: Array<{ type: string | null; body: string }> = [];
    server.use(
      http.all('*/v1/empty', async ({ request }) => {
        seen.push({ type: request.headers.get('content-type'), body: await request.text() });
        return HttpResponse.json({ ok: true });
      }),
    );
    await apiPut('/v1/empty', undefined, okResponseSchema);
    await apiPost('/v1/empty', undefined, okResponseSchema);
    expect(seen).toEqual([
      { type: null, body: '' },
      { type: null, body: '' },
    ]);
  });

  it('a request with a body still says it is JSON', async () => {
    let type: string | null = null;
    server.use(
      http.put('*/v1/full', ({ request }) => {
        type = request.headers.get('content-type');
        return HttpResponse.json({ ok: true });
      }),
    );
    await apiPut('/v1/full', { a: 1 }, okResponseSchema);
    expect(type).toBe('application/json');
  });
});
