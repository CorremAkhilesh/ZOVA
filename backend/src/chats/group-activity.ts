import type { FastifyInstance } from 'fastify';
import { chatModels, oid } from './chats.service.ts';

/** How often a busy group rewrites every member's row. */
export const ACTIVITY_WRITE_MS = 1000;

const waiting = new Map<string, { at: Date; timer: ReturnType<typeof setTimeout> }>();

/**
 * Moves a group up its members' chat lists, at most once a second. Up to 256 rows with several indexes
 * is the most expensive part of a message, and writing them per message made sends collide with each
 * other. It only decides list order on the server: live events carry the exact time, and if this is
 * lost in a restart, the next message puts it right.
 */
export function noteGroupActivity(app: FastifyInstance, chatId: string, at: Date): void {
  const pending = waiting.get(chatId);
  if (pending) {
    pending.at = at;
    return;
  }
  const entry = {
    at,
    timer: setTimeout(() => {
      waiting.delete(chatId);
      chatModels(app)
        .ChatMember.updateMany(
          { chatId: oid(chatId), leftAt: null },
          { $max: { lastActivityAt: entry.at } },
        )
        .catch((error: unknown) => app.log.warn({ err: error }, 'could not update group activity'));
    }, ACTIVITY_WRITE_MS),
  };
  entry.timer.unref();
  waiting.set(chatId, entry);
}
