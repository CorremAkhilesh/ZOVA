import type { FastifyInstance } from 'fastify';
import type { MessageDoc } from '../db/chat-models.ts';
import { AppError } from '../lib/errors.ts';
import { chatModels } from './chats.service.ts';
import { requireVisibleMessage } from './message-updates.ts';
import { sendMessage } from './messages.service.ts';

interface ForwardInput {
  forwardId: string;
  messages: Array<{ chatId: string; messageId: string }>;
  chatIds: string[];
  comment?: string | undefined;
}

/** Counted on the message forwarded, and only for new copies, so asking twice does not add up. */
async function forwardOne(
  app: FastifyInstance,
  userId: string,
  forwardId: string,
  source: MessageDoc,
  targets: string[],
): Promise<number> {
  let count = source.forwardCount ?? 0;
  let sent = 0;
  for (const chatId of targets) {
    const { duplicate } = await sendMessage(app, {
      userId,
      chatId,
      clientMsgId: `fwd:${forwardId}:${chatId}:${source._id.toString()}`,
      text: source.text ?? undefined,
      forward: { media: source.media ?? null, type: source.type, count: count + 1 },
    });
    if (duplicate) continue;
    count += 1;
    sent += 1;
  }
  if (sent > 0) {
    await chatModels(app).Message.updateOne({ _id: source._id }, { $inc: { forwardCount: sent } });
  }
  return sent;
}

/**
 * Copies messages to other chats. Only what I can see, only into chats I may write in. Media keeps its
 * one file: nothing is uploaded again, and the file stays until no message refers to it. Each copy has
 * a fixed id, so asking twice sends nothing twice.
 */
export async function forwardMessages(
  app: FastifyInstance,
  userId: string,
  input: ForwardInput,
): Promise<number> {
  const sources: MessageDoc[] = [];
  for (const { chatId, messageId } of input.messages) {
    const { doc } = await requireVisibleMessage(app, userId, chatId, messageId, 'participant');
    if (doc.deletedForEveryoneAt || doc.type === 'system') {
      throw new AppError('BAD_REQUEST', 'This message cannot be forwarded.');
    }
    sources.push(doc);
  }
  sources.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const targets = [...new Set(input.chatIds)];
  let sent = 0;
  for (const source of sources) {
    sent += await forwardOne(app, userId, input.forwardId, source, targets);
  }
  if (input.comment) {
    for (const chatId of targets) {
      await sendMessage(app, {
        userId,
        chatId,
        clientMsgId: `fwd:${input.forwardId}:${chatId}:comment`,
        text: input.comment,
      });
    }
  }
  return sent;
}
