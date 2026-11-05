import type { FastifyInstance } from 'fastify';
import { chatModels, oid, requireMember } from '../chats/chats.service.ts';
import { AppError } from '../lib/errors.ts';
import type { ZuvoSocket } from './server.ts';
import { windowLimit } from './socket-limit.ts';

/** Without a refresh by then, the person has stopped, or vanished without saying so. */
export const TYPING_TTL_MS = 6000;
/** Clients send at most one every 3 s per chat; this leaves room for a few chats, not for abuse. */
const TYPING_LIMIT = { max: 20, windowMs: 10_000 };
const MEMBERS_CACHE_MS = 60_000;

/** Never stored: timers on the instance holding the socket, gone with it. */
export function createTyping(app: FastifyInstance, socket: ZuvoSocket) {
  const { userId } = socket.data;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const others = new Map<string, { ids: string[]; at: number }>();
  const allowed = windowLimit(TYPING_LIMIT.max, TYPING_LIMIT.windowMs);

  /** The other members, so an event can never reach anyone outside the chat. */
  async function otherMembers(chatId: string): Promise<string[]> {
    const cached = others.get(chatId);
    if (cached && Date.now() - cached.at < MEMBERS_CACHE_MS) return cached.ids;
    await requireMember(app, chatId, userId);
    const members = await chatModels(app)
      .ChatMember.find({ chatId: oid(chatId), leftAt: null })
      .select({ userId: 1 })
      .lean();
    const ids = members.map((member) => member.userId.toString()).filter((id) => id !== userId);
    others.set(chatId, { ids, at: Date.now() });
    return ids;
  }

  function tell(ids: string[], chatId: string, typing: boolean) {
    for (const id of ids) {
      app.realtime.emitToUser(id, 'typing:update', { chatId, userId, typing });
    }
  }

  function finish(chatId: string) {
    const timer = timers.get(chatId);
    if (!timer) return;
    clearTimeout(timer);
    timers.delete(chatId);
    tell(others.get(chatId)?.ids ?? [], chatId, false);
  }

  return {
    async start(chatId: string) {
      if (!allowed()) throw new AppError('RATE_LIMITED', 'Too many typing updates.');
      const ids = await otherMembers(chatId);
      clearTimeout(timers.get(chatId));
      const timer = setTimeout(() => finish(chatId), TYPING_TTL_MS);
      timer.unref();
      timers.set(chatId, timer);
      tell(ids, chatId, true);
    },
    stop: finish,
    /** The socket went away: whatever it was typing has stopped. */
    stopAll() {
      for (const chatId of [...timers.keys()]) finish(chatId);
    },
  };
}
