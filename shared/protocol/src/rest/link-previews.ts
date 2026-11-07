import { z } from 'zod';

export const LINK_URL_MAX = 2048;

/**
 * What a message shows about a link. Fetched once by our server for the sender; receivers never
 * contact the site. The image, if any, is served by our API.
 */
export const linkPreviewSchema = z.object({
  /** The page, after redirects. */
  url: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  siteName: z.string(),
  image: z
    .object({
      id: z.string(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .nullable(),
});

/** POST /v1/link-previews — the sender's app asks while the person types. */
export const linkPreviewBodySchema = z.object({
  url: z.url({ protocol: /^https?$/, hostname: z.regexes.domain }).max(LINK_URL_MAX),
});
export const linkPreviewResponseSchema = z.object({
  /** Pass as `linkPreviewId` when sending; good for a day. */
  id: z.string(),
  preview: linkPreviewSchema,
});

/** GET /v1/link-previews/images/:id */
export const linkPreviewImageParamsSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id'),
});

/** The URL of a preview's image, served by our API to signed-in users. */
export const linkPreviewImageUrl = (id: string) => `/v1/link-previews/images/${id}`;

export type LinkPreview = z.infer<typeof linkPreviewSchema>;
