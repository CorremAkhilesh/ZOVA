import { myProfileResponseSchema } from '@zuvo/protocol';
import { describe, expect, it } from 'vitest';
import { recentPeople } from '@/features/people/recent-people';
import { outputSize } from '@/features/profile/crop-image';
import { HttpResponse, http, profileFixture, server } from '@/test/msw';
import { ApiClientError, apiUpload, withQuery } from './api-client';

describe('withQuery', () => {
  it('adds only non-empty parameters', () => {
    expect(withQuery('/v1/users/search', { q: 'a b', cursor: undefined, limit: 20 })).toBe(
      '/v1/users/search?q=a+b&limit=20',
    );
    expect(withQuery('/v1/x', { q: '' })).toBe('/v1/x');
  });
});

describe('apiUpload', () => {
  it('sends the file as multipart and validates the response', async () => {
    let contentType = '';
    server.use(
      http.post('*/v1/me/avatar', async ({ request }) => {
        contentType = request.headers.get('content-type') ?? '';
        return HttpResponse.json({ profile: profileFixture() });
      }),
    );
    const result = await apiUpload(
      '/v1/me/avatar',
      new Blob(['jpeg'], { type: 'image/jpeg' }),
      myProfileResponseSchema,
    );
    expect(result.profile.username).toBe('kiran');
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
  });

  it('turns API errors into ApiClientError with the server code', async () => {
    server.use(
      http.post('*/v1/me/avatar', () =>
        HttpResponse.json(
          { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Use a JPEG', requestId: 'r' },
          { status: 415 },
        ),
      ),
    );
    const error = await apiUpload('/v1/me/avatar', new Blob(['x']), myProfileResponseSchema).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).apiError?.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect((error as ApiClientError).status).toBe(415);
  });

  it('rejects responses that do not match the contract', async () => {
    server.use(http.post('*/v1/me/avatar', () => HttpResponse.json({ nope: true })));
    await expect(
      apiUpload('/v1/me/avatar', new Blob(['x']), myProfileResponseSchema),
    ).rejects.toThrow('Unexpected response');
  });
});

describe('outputSize', () => {
  it('downscales big crops to 1024 px and never returns 0', () => {
    expect(outputSize({ x: 0, y: 0, width: 3000, height: 3000 })).toBe(1024);
    expect(outputSize({ x: 0, y: 0, width: 300.4, height: 300.4 })).toBe(300);
    expect(outputSize({ x: 0, y: 0, width: 0, height: 0 })).toBe(1);
  });
});

describe('recentPeople', () => {
  it('keeps the five most recent, newest first, without duplicates', () => {
    localStorage.clear();
    for (const n of [1, 2, 3, 4, 5, 6, 2]) {
      recentPeople.add({
        id: `u${n}`,
        displayName: `P${n}`,
        username: null,
        about: null,
        avatar: null,
        deactivated: false,
      });
    }
    expect(recentPeople.load().map((p) => p.id)).toEqual(['u2', 'u6', 'u5', 'u4', 'u3']);
    localStorage.setItem('zuvo-recent-people', '{broken');
    expect(recentPeople.load()).toEqual([]);
    localStorage.clear();
  });
});
