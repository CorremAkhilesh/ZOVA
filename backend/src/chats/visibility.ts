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
export function visibleSeqs(member: Pick<ChatMemberDoc, 'joinSeq' | 'leftSeq'>) {
  return {
    ...(member.joinSeq ? { $gt: member.joinSeq } : {}),
    ...(typeof member.leftSeq === 'number' ? { $lte: member.leftSeq } : {}),
  };
}

export function canSeeSeq(
  member: Pick<ChatMemberDoc, 'joinSeq' | 'leftSeq' | 'leftAt'>,
  seq: number,
) {
  if (member.leftAt && typeof member.leftSeq !== 'number') return false;
  return (
    seq > (member.joinSeq ?? 0) && (typeof member.leftSeq !== 'number' || seq <= member.leftSeq)
  );
}
