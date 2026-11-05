import {
  type CreateUploadBody,
  completeUploadResponseSchema,
  galleryResponseSchema,
  mediaLinkResponseSchema,
  uploadStateSchema,
} from '@zuvo/protocol';
import { z } from 'zod';
import {
  ApiClientError,
  apiDelete,
  apiGet,
  apiPost,
  apiRequest,
  withQuery,
} from '@/lib/api-client';

const okSchema = z.object({ ok: z.literal(true) });

export const mediaApi = {
  create: (body: CreateUploadBody) => apiPost('/v1/uploads', body, uploadStateSchema),
  state: (id: string) => apiGet(`/v1/uploads/${id}`, uploadStateSchema),

  /** One chunk. On a wrong offset the server says where it is, and that is returned instead. */
  async sendChunk(id: string, offset: number, chunk: Blob, signal: AbortSignal): Promise<number> {
    try {
      const state = await apiRequest(`/v1/uploads/${id}`, uploadStateSchema, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/offset+octet-stream',
          'upload-offset': String(offset),
        },
        body: chunk,
        signal,
      });
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
    apiRequest(`/v1/uploads/${id}/poster`, okSchema, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: poster,
    }),

  complete: async (id: string) =>
    (
      await apiRequest(`/v1/uploads/${id}/complete`, completeUploadResponseSchema, {
        method: 'POST',
      })
    ).media,

  cancel: (id: string) => apiDelete(`/v1/uploads/${id}`, okSchema),

  link: (id: string, download: boolean) =>
    apiGet(
      withQuery(`/v1/media/${id}/link`, { download: download ? 'true' : undefined }),
      mediaLinkResponseSchema,
    ),

  gallery: (chatId: string, tab: 'media' | 'docs', before: number | undefined) =>
    apiGet(withQuery(`/v1/chats/${chatId}/media`, { tab, before }), galleryResponseSchema),
};

export type MediaApi = typeof mediaApi;

export const mediaContentUrl = (id: string, variant: 'full' | 'thumb' = 'full') =>
  `/v1/media/${id}/content?variant=${variant}`;
