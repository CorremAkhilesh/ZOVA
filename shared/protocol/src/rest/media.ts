import { z } from 'zod';

export const MEDIA_MAX_BYTES = 100 * 1024 * 1024;
/** The largest single chunk a client may send. */
export const UPLOAD_CHUNK_MAX_BYTES = 8 * 1024 * 1024;
export const POSTER_MAX_BYTES = 5 * 1024 * 1024;
export const CAPTION_MAX = 1024;
export const ALBUM_MAX_ITEMS = 30;
export const MEDIA_LINK_TTL_SECONDS = 15 * 60;

export const mediaKindSchema = z.enum(['image', 'video', 'document']);
export const mediaStatusSchema = z.enum(['pending', 'ready', 'failed']);

/** What a message says about its file. Keys and hashes stay on the server. */
export const mediaInfoSchema = z.object({
  id: z.string(),
  kind: mediaKindSchema,
  mime: z.string(),
  size: z.number().int().positive(),
  name: z.string(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  /** Seconds; videos only. */
  duration: z.number().nonnegative().nullable(),
  /** A tiny blurred image, inline as a data URL, shown until the thumbnail loads. */
  placeholder: z.string().nullable(),
  hasThumbnail: z.boolean(),
});

/** POST /v1/uploads */
export const createUploadBodySchema = z.object({
  kind: mediaKindSchema,
  name: z.string().trim().min(1).max(255),
  mime: z.string().max(127),
  size: z.number().int().positive().max(MEDIA_MAX_BYTES),
  /** From the browser, for videos: the server does not decode them. */
  width: z.number().int().positive().max(20_000).optional(),
  height: z.number().int().positive().max(20_000).optional(),
  duration: z.number().nonnegative().max(86_400).optional(),
});
export const uploadParamsSchema = z.object({ id: z.string().regex(/^[0-9a-f]{24}$/) });
/** POST /v1/uploads · GET /v1/uploads/:id · PATCH /v1/uploads/:id */
export const uploadStateSchema = z.object({
  uploadId: z.string(),
  /** How many bytes the server has: the next chunk starts here. */
  offset: z.number().int().nonnegative(),
  size: z.number().int().positive(),
  status: mediaStatusSchema,
});
/** POST /v1/uploads/:id/complete */
export const completeUploadResponseSchema = z.object({ media: mediaInfoSchema });

/** GET /v1/media/:id/link */
export const mediaLinkQuerySchema = z.object({
  download: z.coerce.boolean().optional(),
});
export const mediaLinkResponseSchema = z.object({
  url: z.string(),
  expiresAt: z.iso.datetime(),
});

export type MediaKind = z.infer<typeof mediaKindSchema>;
export type MediaInfo = z.infer<typeof mediaInfoSchema>;
export type CreateUploadBody = z.infer<typeof createUploadBodySchema>;
