import type { FastifyInstance } from 'fastify';
import type { ChatMemberDoc } from '../db/chat-models.ts';
import { AppError } from '../lib/errors.ts';
import { chatModels, oid } from './chats.service.ts';

/** A member now or before: someone who left keeps the history they were there for. */
export async function requireParticipant(
  app: FastifyInstance,
  chatId: string,
  userId: string,
): Promise<ChatMemberDoc> {
  const member = await chatModels(app)
    .ChatMember.findOne({ chatId: oid(chatId), userId: oid(userId) })
    .lean();
  if (!member) throw new AppError('NOT_FOUND', 'Chat not found.');
  return member;
}

/** The positions this member may see: after they joined, and up to when they left. */
export function visibleSeqs(member: Pick<ChatMemberDoc, 'joinSeq' | 'leftSeq' | 'clearedSeq'>) {
  const floor = Math.max(member.joinSeq ?? 0, member.clearedSeq ?? 0);
  return {
    ...(floor ? { $gt: floor } : {}),
    ...(typeof member.leftSeq === 'number' ? { $lte: member.leftSeq } : {}),
  };
}

export function canSeeSeq(
  member: Pick<ChatMemberDoc, 'joinSeq' | 'leftSeq' | 'leftAt' | 'clearedSeq'>,
  seq: number,
) {
  if (member.leftAt && typeof member.leftSeq !== 'number') return false;
  return (
    seq > Math.max(member.joinSeq ?? 0, member.clearedSeq ?? 0) &&
    (typeof member.leftSeq !== 'number' || seq <= member.leftSeq)
  );
}

/**
 * A disappearing message whose time is up is gone at once for every reader, even before the sweep
 * (every 30 s) deletes it. For a query: missing or null (not disappearing), or still in the future.
 */
export const notExpired = (now: Date = new Date()) => ({ $not: { $lte: now } });

export const isExpiredDoc = (doc: { expiresAt?: Date | null }, now: Date = new Date()) =>
  doc.expiresAt != null && doc.expiresAt.getTime() <= now.getTime();
