import { type LastMessage, MESSAGE_PREVIEW_MAX, type Message } from '@zuvo/protocol';
import type { LastMessageSnapshot, MessageDoc } from '../db/chat-models.ts';

export function toMessage(doc: MessageDoc): Message {
  const deleted = doc.deletedForEveryoneAt !== null;
  return {
    id: doc._id.toString(),
    chatId: doc.chatId.toString(),
    seq: doc.seq,
    clientMsgId: doc.clientMsgId,
    senderId: doc.senderId?.toString() ?? null,
    type: doc.type,
    text: deleted ? null : doc.text,
    replyToId: doc.replyToId?.toString() ?? null,
    editedAt: doc.editedAt?.toISOString() ?? null,
    deletedForEveryoneAt: doc.deletedForEveryoneAt?.toISOString() ?? null,
    createdAt: doc.createdAt.toISOString(),
  };
}

export function toLastMessage(snapshot: LastMessageSnapshot): LastMessage {
  return {
    id: snapshot.id.toString(),
    seq: snapshot.seq,
    senderId: snapshot.senderId?.toString() ?? null,
    type: snapshot.type,
    preview: snapshot.preview,
    createdAt: snapshot.createdAt.toISOString(),
  };
}

/** One line for the chat list: whitespace collapsed, cut at a whole character. */
export function toPreview(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  const characters = Array.from(line);
  return characters.length > MESSAGE_PREVIEW_MAX
    ? `${characters.slice(0, MESSAGE_PREVIEW_MAX).join('')}…`
    : line;
}
