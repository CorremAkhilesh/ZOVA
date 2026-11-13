import { z } from 'zod';
import { type ApiError, apiErrorSchema } from '../common/error.ts';

/** Every client → server event is acknowledged with either data or an ApiError. */
export type AckResponse<Data> = { ok: true; data: Data } | { ok: false; error: ApiError };

export function ackResponseSchema<Data extends z.ZodType>(data: Data) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), data }),
    z.object({ ok: z.literal(false), error: apiErrorSchema }),
  ]);
}
