import type { Message } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import type { Types } from 'mongoose';
import type { ChatMemberDoc, MessageDoc, StoredPoll } from '../db/chat-models.ts';
import { AppError } from '../lib/errors.ts';
import { chatModels } from './chats.service.ts';
import { assertActionable } from './message-actions.service.ts';
import { hideQuote, toMessage } from './message-format.ts';
import {
  announceMessageUpdate,
  logMessageUpdate,
  requireVisibleMessage,
} from './message-updates.ts';

/** A poll this member may see and act on: a live message of type `poll`. */
async function requirePoll(
  app: FastifyInstance,
  userId: string,
  chatId: string,
  messageId: string,
) {
  const { doc, member } = await requireVisibleMessage(app, userId, chatId, messageId);
  assertActionable(doc);
  if (doc.type !== 'poll' || !doc.poll) throw new AppError('BAD_REQUEST', 'This is not a poll.');
  return { doc, member, poll: doc.poll };
}

const view = (doc: MessageDoc, userId: string, member: ChatMemberDoc): { message: Message } => ({
  message: hideQuote(toMessage(doc, userId), member),
});

/** The options chosen: every one a real option, and one at most unless the poll allows several. */
function checkChoice(poll: StoredPoll, optionIds: string[]): string[] {
  const chosen = [...new Set(optionIds)];
  const known = new Set(poll.options.map((option) => option.id));
  if (chosen.some((id) => !known.has(id))) {
    throw new AppError('BAD_REQUEST', 'That is not an option of this poll.');
  }
  if (!poll.multiple && chosen.length > 1) {
    throw new AppError('BAD_REQUEST', 'This poll allows one choice.');
  }
  return chosen;
}

const myChoice = (poll: StoredPoll, voter: Types.ObjectId) =>
  poll.options.filter((option) => option.voterIds.some((id) => id.equals(voter))).map((o) => o.id);

/**
 * Every option without me, then me added to the chosen ones: one atomic update of one document, so
 * two quick votes can never count me twice, whatever order they land in.
 */
function voteUpdate(voter: Types.ObjectId, chosen: string[]) {
  const without = {
    $filter: { input: '$$option.voterIds', as: 'v', cond: { $ne: ['$$v', voter] } },
  };
  return [
    {
      $set: {
        'poll.options': {
          $map: {
            input: '$poll.options',
            as: 'option',
            in: {
              $mergeObjects: [
                '$$option',
                {
                  voterIds: {
                    $cond: [
                      { $in: ['$$option.id', chosen] },
                      { $concatArrays: [without, [voter]] },
                      without,
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    },
  ];
}

const pollClosed = () => new AppError('POLL_CLOSED', 'This poll is closed.');

/** My whole choice, replacing the last one; none takes my vote away. */
export async function votePoll(
  app: FastifyInstance,
  userId: string,
  chatId: string,
  messageId: string,
  optionIds: string[],
) {
  const { doc, member, poll } = await requirePoll(app, userId, chatId, messageId);
  if (poll.closedAt) throw pollClosed();
  const chosen = checkChoice(poll, optionIds);
  const before = myChoice(poll, member.userId);
  // Sent again by a device catching up: nothing changes.
  if (before.length === chosen.length && before.every((id) => chosen.includes(id))) {
    return view(doc, userId, member);
  }
  const { Message } = chatModels(app);
  const pending = await app.mongo.transaction(async (session) => {
    const result = await Message.collection.updateOne(
      { _id: doc._id, 'poll.closedAt': null, deletedForEveryoneAt: null },
      voteUpdate(member.userId, chosen),
      { session },
    );
    if (result.matchedCount === 0) throw pollClosed();
    const updated = await Message.findById(doc._id).session(session).lean();
    if (!updated) throw new AppError('NOT_FOUND', 'Message not found.');
    return logMessageUpdate(app, session, updated);
  });
  announceMessageUpdate(app, pending);
  return view(pending.doc, userId, member);
}

/** Only whoever sent the poll. Closing it again changes nothing. */
export async function closePoll(
  app: FastifyInstance,
  userId: string,
  chatId: string,
  messageId: string,
) {
  const { doc, member, poll } = await requirePoll(app, userId, chatId, messageId);
  if (!doc.senderId?.equals(member.userId)) {
    throw new AppError('FORBIDDEN', 'Only whoever sent the poll can close it.');
  }
  if (poll.closedAt) return view(doc, userId, member);
  const { Message } = chatModels(app);
  const closedAt = new Date();
  const pending = await app.mongo.transaction(async (session) => {
    const result = await Message.updateOne(
      { _id: doc._id, 'poll.closedAt': null },
      { $set: { 'poll.closedAt': closedAt } },
      { session },
    );
    if (result.modifiedCount === 0) return null;
    return logMessageUpdate(app, session, { ...doc, poll: { ...poll, closedAt } });
  });
  if (!pending) {
    const current = await Message.findById(doc._id).lean();
    return view(current ?? doc, userId, member);
  }
  announceMessageUpdate(app, pending);
  return view(pending.doc, userId, member);
}
