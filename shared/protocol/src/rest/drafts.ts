import { z } from 'zod';
import { draftSchema } from './chats.ts';

/**
 * PUT /v1/chats/:id/draft — my unsent text (and reply) here, for my other devices. Empty text and no
 * reply clears it. Kept only when `updatedAt` is newer than what the server has (last write wins).
 */
export const putDraftBodySchema = draftSchema;
export const draftResponseSchema = z.object({
  /** What the server keeps now: mine if it was newer, else the newer one it already had. */
  draft: draftSchema.nullable(),
  applied: z.boolean(),
});

export type Draft = z.infer<typeof draftSchema>;
