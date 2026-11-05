import { z } from 'zod';

/** GET /v1/config: settings the server decides and the app has to follow. */
export const appConfigResponseSchema = z.object({
  media: z.object({
    /** The largest file a person can send. From MEDIA_MAX_FILE_MB. */
    maxFileBytes: z.number().int().positive(),
  }),
});

export type AppConfig = z.infer<typeof appConfigResponseSchema>;
