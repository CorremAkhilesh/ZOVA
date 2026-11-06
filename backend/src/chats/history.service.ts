import type { FastifyInstance } from 'fastify';
import { chatModels, oid } from './chats.service.ts';
import { toMessage } from './message-format.ts';
import { requireParticipant, visibleSeqs } from './visibility.ts';

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
    .Message.find({ chatId: oid(chatId), ...(Object.keys(seq).length ? { seq } : {}) })
    .sort({ seq: forward ? 1 : -1 })
    .limit(limit + 1)
    .lean();
  const page = docs.slice(0, limit);
  if (!forward) page.reverse();
  return { items: page.map((doc) => toMessage(doc, userId)), hasMore: docs.length > limit };
}

const GALLERY_TYPES = { media: ['image', 'video'], docs: ['document', 'audio'] } as const;

/** Newest first: the "Media" and "Docs" tabs in chat info. Members only. */
export async function chatGallery(
  app: FastifyInstance,
  userId: string,
  chatId: string,
  query: { tab: 'media' | 'docs'; before?: number | undefined; limit: number },
) {
  const member = await requireParticipant(app, chatId, userId);
  const seq = {
    ...visibleSeqs(member),
    ...(query.before !== undefined ? { $lt: query.before } : {}),
  };
  const docs = await chatModels(app)
    .Message.find({
      chatId: oid(chatId),
      type: { $in: [...GALLERY_TYPES[query.tab]] },
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
