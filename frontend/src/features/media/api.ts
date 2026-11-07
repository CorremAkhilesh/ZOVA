import {
  appConfigResponseSchema,
  type CreateUploadBody,
  completeUploadResponseSchema,
  galleryResponseSchema,
  mediaLinkResponseSchema,
  uploadStateSchema,
} from '@zuvo/protocol';
import { z } from 'zod';
import { ApiClientError, apiDelete, apiGet, apiRequest, withQuery } from '@/lib/api-client';

const okSchema = z.object({ ok: z.literal(true) });

/** Slow is fine, for a large file on a bad link. An answer that never comes must not block the rest. */
const CHUNK_DEADLINE_MS = 10 * 60_000;
const COMPLETE_DEADLINE_MS = 30 * 60_000;
const REQUEST_DEADLINE_MS = 2 * 60_000;

/** Gives up on `work` after `ms`, or when `outer` is aborted. It then fails as a network error. */
export async function withDeadline<T>(
  ms: number,
  outer: AbortSignal | undefined,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, ms);
  outer?.addEventListener('abort', abort);
  try {
    return await work(controller.signal);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', abort);
  }
}

export const mediaApi = {
  config: () => apiGet('/v1/config', appConfigResponseSchema),
  create: (body: CreateUploadBody) =>
    withDeadline(REQUEST_DEADLINE_MS, undefined, (signal) =>
      apiRequest('/v1/uploads', uploadStateSchema, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      }),
    ),
  state: (id: string) =>
    withDeadline(REQUEST_DEADLINE_MS, undefined, (signal) =>
      apiRequest(`/v1/uploads/${id}`, uploadStateSchema, { method: 'GET', signal }),
    ),

  /** One chunk. On a wrong offset the server says where it is, and that is returned instead. */
  async sendChunk(id: string, offset: number, chunk: Blob, signal: AbortSignal): Promise<number> {
    try {
      const state = await withDeadline(CHUNK_DEADLINE_MS, signal, (deadline) =>
        apiRequest(`/v1/uploads/${id}`, uploadStateSchema, {
          method: 'PATCH',
          headers: {
            'content-type': 'application/offset+octet-stream',
            'upload-offset': String(offset),
          },
          body: chunk,
          signal: deadline,
        }),
      );
      return state.offset;
    } catch (error) {
      const actual = error instanceof ApiClientError ? error.apiError?.details?.offset : undefined;
      if (error instanceof ApiClientError && error.apiError?.code === 'UPLOAD_OFFSET_MISMATCH') {
        return Number(actual ?? offset);
      }
      throw error;
    }
  },

  setPoster: (id: string, poster: Blob) =>
    withDeadline(REQUEST_DEADLINE_MS, undefined, (signal) =>
      apiRequest(`/v1/uploads/${id}/poster`, okSchema, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: poster,
        signal,
      }),
    ),

  complete: async (id: string) =>
    (
      await withDeadline(COMPLETE_DEADLINE_MS, undefined, (signal) =>
        apiRequest(`/v1/uploads/${id}/complete`, completeUploadResponseSchema, {
          method: 'POST',
          signal,
        }),
      )
    ).media,

  cancel: (id: string) => apiDelete(`/v1/uploads/${id}`, okSchema),

  link: (id: string, download: boolean) =>
    apiGet(
      withQuery(`/v1/media/${id}/link`, { download: download ? 'true' : undefined }),
      mediaLinkResponseSchema,
    ),

  gallery: (chatId: string, tab: 'media' | 'docs' | 'links', before: number | undefined) =>
    apiGet(withQuery(`/v1/chats/${chatId}/media`, { tab, before }), galleryResponseSchema),
};

export type MediaApi = typeof mediaApi;

export const mediaContentUrl = (id: string, variant: 'full' | 'thumb' = 'full') =>
  `/v1/media/${id}/content?variant=${variant}`;
