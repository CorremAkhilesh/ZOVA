import { z } from 'zod';

/**
 * Pictures are decoded on both sides, so they keep their own limit. A larger one goes as a document.
 * Every other file's limit is set per environment: see GET /v1/config.
 */
export const IMAGE_MAX_BYTES = 100 * 1024 * 1024;
/** The largest single chunk a client may send. */
export const UPLOAD_CHUNK_MAX_BYTES = 8 * 1024 * 1024;
export const POSTER_MAX_BYTES = 5 * 1024 * 1024;
/** Far more than 15 minutes of speech needs, in any format a browser records. */
export const VOICE_MAX_BYTES = 64 * 1024 * 1024;
export const VOICE_MIN_SECONDS = 1;
/** The clock in the browser can run a moment past the limit before the recording stops. */
export const VOICE_DURATION_MARGIN_SECONDS = 2;
export const WAVEFORM_BARS = 64;
export const WAVEFORM_MAX = 100;
export const CAPTION_MAX = 1024;
export const ALBUM_MAX_ITEMS = 30;
export const MEDIA_LINK_TTL_SECONDS = 15 * 60;

/** `voice` is recorded in the app. `audio` is a music or sound file someone attached. */
export const mediaKindSchema = z.enum(['image', 'video', 'document', 'voice', 'audio']);
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
  /** Seconds; videos and voice notes. */
  duration: z.number().nonnegative().nullable(),
  /** Voice notes: how loud each bar of the bubble is, from 0 to WAVEFORM_MAX. */
  waveform: z.array(z.number().int().min(0).max(WAVEFORM_MAX)).nullable().optional(),
  /** A tiny blurred image, inline as a data URL, shown until the thumbnail loads. */
  placeholder: z.string().nullable(),
  hasThumbnail: z.boolean(),
});

/** POST /v1/uploads */
export const createUploadBodySchema = z
  .object({
    kind: mediaKindSchema,
    name: z.string().trim().min(1).max(255),
    mime: z.string().max(127),
    /** Checked against the configured limit by the server. */
    size: z.number().int().positive(),
    /** From the browser, for videos and voice notes: the server does not decode them. */
    width: z.number().int().positive().max(20_000).optional(),
    height: z.number().int().positive().max(20_000).optional(),
    /** A voice note's upper limit is configured: see GET /v1/config. */
    duration: z.number().nonnegative().max(86_400).optional(),
    waveform: z.array(z.number().int().min(0).max(WAVEFORM_MAX)).length(WAVEFORM_BARS).optional(),
  })
  .refine((body) => body.kind === 'voice' || body.waveform === undefined, {
    message: 'Only a voice note has a waveform',
    path: ['waveform'],
  })
  .refine((body) => body.kind !== 'voice' || body.waveform !== undefined, {
    message: 'A voice note needs its waveform',
    path: ['waveform'],
  })
  .refine((body) => body.kind !== 'voice' || (body.duration ?? 0) >= VOICE_MIN_SECONDS, {
    message: 'A voice note lasts at least a second',
    path: ['duration'],
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
