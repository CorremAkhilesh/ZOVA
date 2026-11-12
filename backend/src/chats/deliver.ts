import type { Message } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import type { ChatDoc, LastMessageSnapshot } from '../db/chat-models.ts';
import { hideQuote, toLastMessage } from './message-format.ts';

export interface DeliveredMember {
  userId: string;
  lastReadSeq: number;
  lastDeliveredSeq: number;
  sharedReadSeq: number;
  joinSeq?: number | undefined;
  clearedSeq?: number | undefined;
  cursor: string;
  /** This message brought the chat back from this member's archive. */
  unarchived: boolean;
  /** This message mentions them: their unread mentions now. */
  mentionSeqs?: number[] | undefined;
}

/** Tells every member's devices: the message, and the chat as that member now sees it. */
export function deliver(
  app: FastifyInstance,
  message: Message,
  chat: Pick<ChatDoc, 'type'> & { lastMessage: LastMessageSnapshot },
  members: DeliveredMember[],
) {
  for (const member of members) {
    const { userId, lastReadSeq, cursor } = member;
    const peer = chat.type === 'direct' ? members.find((m) => m.userId !== userId) : undefined;
    app.realtime.emitToUser(userId, 'message:new', {
      message: hideQuote(message, member),
      cursor,
    });
    app.realtime.emitToUser(userId, 'chat:updated', {
      chatId: message.chatId,
      type: chat.type,
      seq: message.seq,
      lastMessage: toLastMessage(chat.lastMessage),
      lastReadSeq,
      unreadCount: Math.max(0, message.seq - lastReadSeq),
      lastActivityAt: message.createdAt,
      ...(member.unarchived ? { archived: false } : {}),
      ...(member.mentionSeqs ? { mentionSeqs: member.mentionSeqs } : {}),
      ...(peer
        ? {
            peerDeliveredSeq: peer.lastDeliveredSeq,
            peerReadSeq: peer.sharedReadSeq,
          }
        : {}),
      cursor,
    });
  }
}
