import { z } from 'zod';
import { isoDateTimeSchema } from '../common/id.ts';

/** How long new messages in a chat last. Off: they stay. */
export const disappearTimerSchema = z.enum(['off', '24h', '7d', '90d']);
export const DISAPPEAR_MS: Record<Exclude<DisappearTimer, 'off'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};
/** When a message sent now with this timer goes; null when it stays. */
export function expiryFor(timer: DisappearTimer | undefined, sentAt: Date): Date | null {
  return !timer || timer === 'off' ? null : new Date(sentAt.getTime() + DISAPPEAR_MS[timer]);
}

/** PUT /v1/chats/:id/disappearing */
export const setDisappearingBodySchema = z.object({ timer: disappearTimerSchema });
export const disappearingResponseSchema = z.object({ timer: disappearTimerSchema });

/** A view-once photo or video is deleted this long after it was sent, even if never opened. */
export const VIEW_ONCE_TTL_DAYS = 14;

/**
 * POST /v1/chats/:id/messages/:messageId/view-once: the one link to a view-once file, for someone
 * who has not opened it yet. Opening counts at once; a second call is `410 VIEW_ONCE_OPENED`.
 */
export const viewOnceOpenResponseSchema = z.object({
  url: z.string(),
  expiresAt: isoDateTimeSchema,
});

/** messages:expired (server → client): these messages' time ran out; remove them. */
export const messagesExpiredEventSchema = z.object({
  chatId: z.string(),
  seqs: z.array(z.number().int().positive()),
});

export type DisappearTimer = z.infer<typeof disappearTimerSchema>;
