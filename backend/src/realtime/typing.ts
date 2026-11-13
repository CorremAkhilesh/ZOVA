import { DEFAULT_GROUP_SETTINGS } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { chatModels, oid, requireMember } from '../chats/chats.service.ts';
import { assertAllowed, groupRules } from '../chats/group-permissions.ts';
import { AppError } from '../lib/errors.ts';
import { blockedEitherWay } from '../moderation/blocks.service.ts';
import type { ZuvoSocket } from './server.ts';
import { windowLimit } from './socket-limit.ts';

/** Without a refresh by then, the person has stopped, or vanished without saying so. */
export const TYPING_TTL_MS = 6000;
/** Clients send at most one every 3 s per chat; this leaves room for a few chats, not for abuse. */
const TYPING_LIMIT = { max: 20, windowMs: 10_000 };
/** Short: someone removed from a group must stop hearing about it almost at once. */
const MEMBERS_CACHE_MS = 10_000;

/** Never stored: timers on the instance holding the socket, gone with it. */
export function createTyping(app: FastifyInstance, socket: ZuvoSocket) {
  const { userId } = socket.data;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const others = new Map<string, { ids: string[]; at: number }>();
  const allowed = windowLimit(TYPING_LIMIT.max, TYPING_LIMIT.windowMs);

  async function assertMayType(chatId: string) {
    const member = await requireMember(app, chatId, userId);
    const chat = await chatModels(app).Chat.findById(chatId).select({ group: 1, type: 1 }).lean();
    if (chat?.type !== 'group') return chat?.type ?? null;
    const settings = { ...DEFAULT_GROUP_SETTINGS, ...chat.group?.settings };
    assertAllowed(groupRules.sendMessages(member.role, settings), 'Only admins can send messages.');
    return chat.type;
  }

  /** The other members, so an event can never reach anyone outside the chat. */
  async function otherMembers(chatId: string): Promise<string[]> {
    // Each time: someone removed from a group, or told only admins may speak there, says nothing.
    const type = await assertMayType(chatId);
    const cached = others.get(chatId);
    const ids =
      cached && Date.now() - cached.at < MEMBERS_CACHE_MS
        ? cached.ids
        : (
            await chatModels(app)
              .ChatMember.find({ chatId: oid(chatId), leftAt: null })
              .select({ userId: 1 })
              .lean()
          )
            .map((member) => member.userId.toString())
            .filter((id) => id !== userId);
    others.set(chatId, { ids, at: cached?.at ?? Date.now() });
    // A direct chat with a block either way: typing goes nowhere, and the typist is not told why.
    if (type === 'direct' && (await blockedEitherWay(app, userId, ids)).size > 0) return [];
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
