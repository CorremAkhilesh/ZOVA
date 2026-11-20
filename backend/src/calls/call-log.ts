import type { CallLogEntry } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { callModels, durationSeconds } from './call-finish.ts';

/** My finished calls, newest first, by cursor (the last id of the previous page). */
export async function listCalls(
  app: FastifyInstance,
  userId: string,
  query: { before?: string | undefined; limit: number },
): Promise<{ items: CallLogEntry[]; nextCursor: string | null }> {
  const me = new Types.ObjectId(userId);
  const docs = await callModels(app)
    .Call.find({
      userIds: me,
      status: 'ended',
      ...(query.before ? { _id: { $lt: new Types.ObjectId(query.before) } } : {}),
    })
    .sort({ _id: -1 })
    .limit(query.limit + 1)
    .lean();
  const page = docs.slice(0, query.limit);
  const items = page.map((doc): CallLogEntry => {
    const outgoing = doc.callerId.equals(me);
    return {
      id: doc._id.toString(),
      chatId: doc.chatId.toString(),
      peerId: (outgoing ? doc.calleeId : doc.callerId).toString(),
      kind: doc.kind,
      direction: outgoing ? 'outgoing' : 'incoming',
      outcome: doc.outcome ?? 'failed',
      startedAt: doc.startedAt.toISOString(),
      durationSeconds: durationSeconds(doc),
    };
  });
  const last = page.at(-1);
  return { items, nextCursor: docs.length > query.limit && last ? last._id.toString() : null };
}
