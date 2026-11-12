import { DEFAULT_GROUP_SETTINGS, type DisappearTimer } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import type { ClientSession, Types } from 'mongoose';
import { AppError } from '../lib/errors.ts';
import { chatModels, requireMember } from './chats.service.ts';
import { appendSystemMessage, deliverSystemMessage, namesOf } from './group-core.ts';
import { assertAllowed, groupRules } from './group-permissions.ts';

/**
 * Sets the chat's timer, with a "turned on disappearing messages" notice, inside the caller's
 * transaction. Only messages sent from now on get it; earlier ones keep whatever they had.
 */
export function appendTimerNotice(
  app: FastifyInstance,
  session: ClientSession,
  chatId: Types.ObjectId,
  actor: { id: string; name: string },
  timer: DisappearTimer,
) {
  return appendSystemMessage(
    app,
    session,
    chatId,
    { kind: 'disappearing_changed', actor, targets: [], value: timer },
    {
      apply: async () => {
        await chatModels(app).Chat.updateOne(
          { _id: chatId },
          timer === 'off' ? { $unset: { disappearing: 1 } } : { $set: { disappearing: timer } },
          { session },
        );
      },
    },
  );
}

/**
 * PUT /v1/chats/:id/disappearing. Either person in a 1:1 chat (and in Saved Messages, its owner);
 * in a group, as its "Disappearing messages" setting says. The same timer again changes nothing.
 */
export async function setDisappearing(
  app: FastifyInstance,
  userId: string,
  chatId: string,
  timer: DisappearTimer,
): Promise<{ timer: DisappearTimer }> {
  const member = await requireMember(app, chatId, userId);
  const chat = await chatModels(app).Chat.findById(chatId).lean();
  if (!chat) throw new AppError('NOT_FOUND', 'Chat not found.');
  if (chat.type === 'group') {
    const settings = { ...DEFAULT_GROUP_SETTINGS, ...chat.group?.settings };
    assertAllowed(
      groupRules.disappearing(member.role, settings),
      'Only admins can change disappearing messages in this group.',
    );
  }
  if ((chat.disappearing ?? 'off') === timer) return { timer };
  const actor = (await namesOf(app, [userId]))(userId);
  const stored = await app.mongo.transaction((session) =>
    appendTimerNotice(app, session, chat._id, actor, timer),
  );
  deliverSystemMessage(app, stored);
  return { timer };
}
