import {
  formatDuration,
  type LastMessage,
  MESSAGE_PREVIEW_MAX,
  type MediaInfo,
  type Message,
} from '@zuvo/protocol';
import type { LastMessageSnapshot, MessageDoc } from '../db/chat-models.ts';

/** Whether this person may know a voice note was played. See `played` in the protocol. */
function playedFor(doc: MessageDoc, viewerId: string): boolean {
  const plays = doc.plays ?? [];
  if (doc.senderId?.toString() === viewerId) return plays.some((play) => play.shared);
  return plays.some((play) => play.userId.toString() === viewerId);
}

/** A message as this person sees it. */
export function toMessage(doc: MessageDoc, viewerId: string): Message {
  const deleted = doc.deletedForEveryoneAt !== null;
  return {
    id: doc._id.toString(),
    chatId: doc.chatId.toString(),
    seq: doc.seq,
    clientMsgId: doc.clientMsgId,
    senderId: doc.senderId?.toString() ?? null,
    type: doc.type,
    text: deleted ? null : doc.text,
    media: deleted ? null : (doc.media ?? null),
    albumId: doc.albumId ?? null,
    played: playedFor(doc, viewerId),
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

/** For the chat list. Clients add the icon and the words "Photo" or "Video", in their language. */
export function toMediaPreview(media: MediaInfo, caption: string | undefined): string {
  if (media.kind === 'voice') return formatDuration(media.duration ?? 0);
  if (media.kind === 'document' || media.kind === 'audio')
    return toPreview(caption ? `${media.name} · ${caption}` : media.name);
  return toPreview(caption ?? '');
}
