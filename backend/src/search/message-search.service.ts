import type { MessageSearchHit, SearchFilter } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { chatModels } from '../chats/chats.service.ts';
import { withStars } from '../chats/history.service.ts';
import { hideQuote, toMessage } from '../chats/message-format.ts';
import { requireParticipant, visibleSeqs } from '../chats/visibility.ts';
import type { ChatMemberDoc } from '../db/chat-models.ts';
import { AppError } from '../lib/errors.ts';
import { blockedByMe } from '../moderation/blocks.service.ts';
import { searchTitles } from './search-titles.ts';

/** Per person: generous for typing, not for scraping. */
export const SEARCH_LIMIT = { max: 60, windowSeconds: 60 };
const MAX_WORDS = 8;

const KIND: Record<SearchFilter, Record<string, unknown>> = {
  photos: { type: 'image' },
  videos: { type: 'video' },
  docs: { type: { $in: ['document', 'audio'] } },
  voice: { type: 'voice' },
  links: { hasLink: true },
};

/**
 * What was typed, for `$text`: each word quoted, so every word must be there (MongoDB ANDs
 * phrases). Quotes and a leading "-" (negation) are taken out of the words themselves.
 */
export function textSearchOf(q: string): string | null {
  const words = q
    .normalize('NFC')
    .split(/\s+/u)
    .map((word) => word.replace(/["\\]/gu, '').replace(/^-+/u, ''))
    .filter(Boolean)
    .slice(0, MAX_WORDS);
  return words.length ? words.map((word) => `"${word}"`).join(' ') : null;
}

type Member = Pick<ChatMemberDoc, 'chatId' | 'joinSeq' | 'leftSeq' | 'leftAt' | 'clearedSeq'>;

/** Where I may look: every chat I am or was in, each only within the part I may see. */
export function scopeClauses(members: Member[]) {
  const open: Types.ObjectId[] = [];
  const ranged: Array<Record<string, unknown>> = [];
  for (const member of members) {
    // Removed from a group before anything was kept for me: nothing to see there.
    if (member.leftAt && typeof member.leftSeq !== 'number') continue;
    const seq = visibleSeqs(member);
    if (Object.keys(seq).length === 0) open.push(member.chatId);
    else ranged.push({ chatId: member.chatId, seq });
  }
  return [...(open.length ? [{ chatId: { $in: open } }] : []), ...ranged];
}

async function assertSearchLimit(app: FastifyInstance, userId: string) {
  const key = `zuvo:rate:search:${userId}`;
  if ((await app.counterStore.increment(key, SEARCH_LIMIT.windowSeconds)) > SEARCH_LIMIT.max) {
    throw new AppError('RATE_LIMITED', 'You are searching too fast. Try again in a minute.', {
      retryAfterSeconds: Math.max(1, await app.counterStore.ttl(key)),
    });
  }
}

export interface SearchInput {
  q: string;
  filter?: SearchFilter | undefined;
  chatId?: string | undefined;
  cursor?: string | undefined;
  limit: number;
}

/** The query itself, exported so its plan can be tested. Null: nowhere to look. */
export async function buildSearchQuery(app: FastifyInstance, userId: string, input: SearchInput) {
  const { ChatMember, MessageHidden } = chatModels(app);
  const me = new Types.ObjectId(userId);
  const members: Member[] = input.chatId
    ? [await requireParticipant(app, input.chatId, userId)]
    : // Chats I locked never show up in global search: not their messages, not a snippet.
      (
        await ChatMember.find({ userId: me })
          .select({ chatId: 1, joinSeq: 1, leftSeq: 1, leftAt: 1, clearedSeq: 1, locked: 1 })
          .lean()
      ).filter((member) => member.locked !== true);
  const kind = input.filter ? KIND[input.filter] : { type: { $ne: 'system' } };
  // Each clause carries the kind of message too, so each can use its own index.
  const clauses = scopeClauses(members).map((clause) => ({ ...clause, ...kind }));
  if (clauses.length === 0) return null;
  const hidden = await MessageHidden.find({
    userId: me,
    ...(input.chatId ? { chatId: new Types.ObjectId(input.chatId) } : {}),
  })
    .select({ messageId: 1 })
    .lean();
  const blocked = await blockedByMe(app, userId);
  const text = textSearchOf(input.q);
  const ids = {
    ...(hidden.length ? { $nin: hidden.map((row) => row.messageId) } : {}),
    ...(input.cursor ? { $lt: new Types.ObjectId(input.cursor) } : {}),
  };
  return {
    ...(text ? { $text: { $search: text } } : {}),
    $or: clauses,
    deletedForEveryoneAt: null,
    ...(Object.keys(ids).length ? { _id: ids } : {}),
    // Messages from people I blocked stay out of my results.
    ...(blocked.length ? { senderId: { $nin: blocked } } : {}),
  };
}

/** Message search for one person, newest first, with every visibility rule applied. */
export async function searchMessages(app: FastifyInstance, userId: string, input: SearchInput) {
  await assertSearchLimit(app, userId);
  const filter = await buildSearchQuery(app, userId, input);
  if (!filter) return { items: [], nextCursor: null };
  const { Message, ChatMember } = chatModels(app);
  const docs = await Message.find(filter)
    .sort({ _id: -1 })
    .limit(input.limit + 1)
    .lean()
    .catch((error: unknown) => {
      // A fresh database whose text index is still being built (production syncs it at deploy).
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 27) {
        throw new AppError('SERVICE_UNAVAILABLE', 'Search is getting ready. Try again shortly.');
      }
      throw error;
    });
  const page = docs.slice(0, input.limit);
  const chatIds = [...new Set(page.map((doc) => doc.chatId.toString()))];
  const members = await ChatMember.find({
    userId: new Types.ObjectId(userId),
    chatId: { $in: chatIds.map((id) => new Types.ObjectId(id)) },
  }).lean();
  const memberOf = new Map(members.map((member) => [member.chatId.toString(), member]));
  const titles = await searchTitles(app, userId, page);
  const messages = await withStars(
    app,
    userId,
    page.flatMap((doc) => {
      const member = memberOf.get(doc.chatId.toString());
      return member ? [hideQuote(toMessage(doc, userId), member)] : [];
    }),
  );
  const items: MessageSearchHit[] = messages.map((message) => ({
    message,
    chat: titles.chat(message.chatId),
    senderName: message.senderId ? titles.person(message.senderId) : null,
  }));
  const last = page.at(-1);
  return { items, nextCursor: docs.length > input.limit && last ? last._id.toString() : null };
}
