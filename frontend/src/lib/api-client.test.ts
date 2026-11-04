import { healthResponseSchema } from '@zuvo/protocol';
import { describe, expect, it, vi } from 'vitest';
import { HttpResponse, http, server } from '@/test/msw';
import { ApiClientError, apiGet } from './api-client';

describe('apiGet', () => {
  it('returns the validated body on success', async () => {
    const health = await apiGet('/v1/health', healthResponseSchema);
    expect(health.status).toBe('ok');
  });

  it('maps an ApiError response to ApiClientError with the server message', async () => {
    server.use(
      http.get('*/v1/health', () =>
        HttpResponse.json(
          { code: 'RATE_LIMITED', message: 'Too many requests.', requestId: 'req-1' },
          { status: 429 },
        ),
      ),
    );
    const error = await apiGet('/v1/health', healthResponseSchema).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      status: 429,
      message: 'Too many requests.',
      apiError: { code: 'RATE_LIMITED', requestId: 'req-1' },
    });
  });

  it('handles error responses that are not ApiErrors', async () => {
    server.use(http.get('*/v1/health', () => new HttpResponse('Bad gateway', { status: 502 })));
    await expect(apiGet('/v1/health', healthResponseSchema)).rejects.toMatchObject({
      status: 502,
      apiError: undefined,
      message: 'Request failed (502)',
    });
  });

  it('rejects a success response that does not match the schema', async () => {
    server.use(http.get('*/v1/health', () => HttpResponse.json({ status: 'weird' })));
    await expect(apiGet('/v1/health', healthResponseSchema)).rejects.toMatchObject({
      status: 200,
      message: 'Unexpected response from the server.',
    });
  });

  it('reports network failures with status 0', async () => {
    server.use(http.get('*/v1/health', () => HttpResponse.error()));
    const error = await apiGet('/v1/health', healthResponseSchema).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).isNetworkError).toBe(true);
  });

  it('sends cookies and asks for JSON', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    let seen: Request | undefined;
    server.use(
      http.get('*/v1/health', ({ request }) => {
        seen = request;
        return HttpResponse.json({
          status: 'ok',
          version: '1',
          uptime: 0,
          timestamp: new Date().toISOString(),
        });
      }),
    );
    await apiGet('/v1/health', healthResponseSchema);
    expect(seen?.headers.get('accept')).toBe('application/json');
    expect(fetchSpy.mock.calls[0]?.[1]?.credentials).toBe('include');
    fetchSpy.mockRestore();
  });
});
