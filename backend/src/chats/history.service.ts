import type { Message } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { chatModels, oid } from './chats.service.ts';
import { hideQuote, toMessage } from './message-format.ts';
import { requireParticipant, visibleSeqs } from './visibility.ts';

/** What I hid in this chat. A person's own short list, so this stays cheap. */
export async function hiddenIds(app: FastifyInstance, userId: string, chatId: string) {
  const rows = await chatModels(app)
    .MessageHidden.find({ userId: oid(userId), chatId: oid(chatId) })
    .select({ messageId: 1 })
    .lean();
  return rows.map((row) => row.messageId);
}

/** Marks the ones I starred. */
export async function withStars(app: FastifyInstance, userId: string, messages: Message[]) {
  if (messages.length === 0) return messages;
  const stars = await chatModels(app)
    .Star.find({ userId: oid(userId), messageId: { $in: messages.map((item) => oid(item.id)) } })
    .select({ messageId: 1 })
    .lean();
  const starred = new Set(stars.map((star) => star.messageId.toString()));
  return messages.map((message) => ({ ...message, starred: starred.has(message.id) }));
}

/** A page of history, always oldest first. Newest page by default; `after` reads forward. */
export async function getHistory(
  app: FastifyInstance,
  userId: string,
  chatId: string,
  query: { before?: number | undefined; after?: number | undefined; limit: number },
) {
  const member = await requireParticipant(app, chatId, userId);
  const { before, after, limit } = query;
  const allowed = visibleSeqs(member);
  const lowest = Math.max(after ?? 0, allowed.$gt ?? 0);
  const seq = {
    ...(before !== undefined ? { $lt: before } : {}),
    ...(lowest > 0 ? { $gt: lowest } : {}),
    ...(allowed.$lte !== undefined ? { $lte: allowed.$lte } : {}),
  };
  const forward = after !== undefined && before === undefined;
  const docs = await chatModels(app)
    .Message.find({
      chatId: oid(chatId),
      ...(Object.keys(seq).length ? { seq } : {}),
      _id: { $nin: await hiddenIds(app, userId, chatId) },
    })
    .sort({ seq: forward ? 1 : -1 })
    .limit(limit + 1)
    .lean();
  const page = docs.slice(0, limit);
  if (!forward) page.reverse();
  const items = page.map((doc) => hideQuote(toMessage(doc, userId), member));
  return { items: await withStars(app, userId, items), hasMore: docs.length > limit };
}

const GALLERY_TYPES = { media: ['image', 'video'], docs: ['document', 'audio'] } as const;

/** Media and Docs go by type; Links by whether the text has a link (a partial index). */
const galleryFilter = (tab: 'media' | 'docs' | 'links') =>
  tab === 'links' ? { hasLink: true } : { type: { $in: [...GALLERY_TYPES[tab]] } };

/** Newest first: the "Media", "Docs" and "Links" tabs in chat info. Members only. */
export async function chatGallery(
  app: FastifyInstance,
  userId: string,
  chatId: string,
  query: { tab: 'media' | 'docs' | 'links'; before?: number | undefined; limit: number },
) {
  const member = await requireParticipant(app, chatId, userId);
  const seq = {
    ...visibleSeqs(member),
    ...(query.before !== undefined ? { $lt: query.before } : {}),
  };
  const docs = await chatModels(app)
    .Message.find({
      chatId: oid(chatId),
      ...galleryFilter(query.tab),
      deletedForEveryoneAt: null,
      _id: { $nin: await hiddenIds(app, userId, chatId) },
      ...(Object.keys(seq).length ? { seq } : {}),
    })
    .sort({ seq: -1 })
    .limit(query.limit + 1)
    .lean();
  return {
    items: docs.slice(0, query.limit).map((doc) => toMessage(doc, userId)),
    hasMore: docs.length > query.limit,
  };
}
