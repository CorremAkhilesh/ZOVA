import type { ChatMessage } from '@/features/chats/types';
import { ME } from '@/features/chats/types';
import type { MessageRow } from '@/features/sync/local-db';
import type { Track } from './player';

/** What the player needs from a bubble. Null for a file that is not on the server yet. */
export function toTrack(message: ChatMessage, labels: { voice: string }): Track | null {
  const { media } = message;
  if (!media?.id || (media.kind !== 'voice' && media.kind !== 'audio')) return null;
  const voice = media.kind === 'voice';
  return {
    mediaId: media.id,
    key: message.id,
    messageId: message.serverId ?? null,
    chatId: message.chatId,
    kind: media.kind,
    mime: media.mime,
    title: voice ? message.authorName : media.name,
    subtitle: voice ? labels.voice : message.authorName,
    duration: media.duration ?? 0,
    reportPlay: voice && message.authorId !== ME && !message.played,
  };
}

/** The same from a stored row, for the note after this one, which has no bubble to ask. */
export function rowToTrack(row: MessageRow, me: string, previous: Track): Track | null {
  const { media } = row;
  if (!media?.id || media.kind !== 'voice') return null;
  return {
    mediaId: media.id,
    key: row.key,
    messageId: row.id,
    chatId: row.chatId,
    kind: 'voice',
    mime: media.mime,
    // One person's chat so far. A group will need the sender's own name here.
    title: previous.title,
    subtitle: previous.subtitle,
    duration: media.duration ?? 0,
    reportPlay: row.senderId !== me && !row.played,
  };
}
