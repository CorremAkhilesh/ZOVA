import type { Draft } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../lib/errors.ts';
import { draftView } from './chat-summary.ts';
import { chatModels } from './chats.service.ts';
import { logUpdates } from './updates.ts';
import { requireParticipant } from './visibility.ts';

/** Drafts are saved as people type (the app waits a moment); this is plenty for that. */
export const DRAFT_LIMIT = { max: 120, windowSeconds: 60 };
/** A device whose clock runs ahead may not hold everyone else's drafts back for long. */
const FUTURE_SLACK_MS = 60_000;

async function assertDraftLimit(app: FastifyInstance, userId: string) {
  const key = `zuvo:rate:draft:${userId}`;
  if ((await app.counterStore.increment(key, DRAFT_LIMIT.windowSeconds)) > DRAFT_LIMIT.max) {
    throw new AppError('RATE_LIMITED', 'Too many draft updates.');
  }
}

/**
 * My unsent text (and reply) in a chat, for my other devices. Last write wins: kept only when newer
 * than what the server has, decided by MongoDB itself so two devices racing cannot both win.
 */
export async function saveDraft(app: FastifyInstance, userId: string, chatId: string, body: Draft) {
  await assertDraftLimit(app, userId);
  const member = await requireParticipant(app, chatId, userId);
  const updatedAt = new Date(Math.min(Date.parse(body.updatedAt), Date.now() + FUTURE_SLACK_MS));
  const models = chatModels(app);
  const stored = { text: body.text, replyTo: body.replyTo, updatedAt };
  const applied = await app.mongo.transaction(async (session) => {
    const result = await models.ChatMember.updateOne(
      {
        _id: member._id,
        $or: [
          { draft: null },
          { draft: { $exists: false } },
          { 'draft.updatedAt': { $lt: updatedAt } },
        ],
      },
      { $set: { draft: stored } },
      { session },
    );
    if (result.modifiedCount === 0) return false;
    // In the log, so a device that was away gets it with the chat.
    await logUpdates(
      models,
      session,
      [member.userId],
      { kind: 'chat', chatId: member.chatId },
      new Date(),
    );
    return true;
  });
  const now = await models.ChatMember.findById(member._id).select({ draft: 1 }).lean();
  const draft = now ? draftView(now) : null;
  if (applied) app.realtime.emitToUser(userId, 'draft:updated', { chatId, draft });
  return { draft, applied };
}
