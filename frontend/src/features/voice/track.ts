import type { ChatMessage } from '@/features/chats/types';
import { ME } from '@/features/chats/types';
import type { LocalDb, MessageRow } from '@/features/sync/local-db';
import type { Track } from './player';

export interface TrackLabels {
  voice: string;
  /** My own notes. */
  you: string;
  unknown: string;
}

/** Who sent a note: its title on the mini player and the lock screen. */
export interface Sender {
  name: string;
  avatar?: string | undefined;
}

/** What the player needs from a bubble. Null for a file that is not on the server yet. */
export function toTrack(message: ChatMessage, labels: TrackLabels): Track | null {
  const { media } = message;
  if (!media?.id || (media.kind !== 'voice' && media.kind !== 'audio')) return null;
  const voice = media.kind === 'voice';
  const author = message.authorId === ME ? labels.you : message.authorName || labels.unknown;
  return {
    mediaId: media.id,
    key: message.id,
    messageId: message.serverId ?? null,
    chatId: message.chatId,
    kind: media.kind,
    mime: media.mime,
    title: voice ? author : media.name,
    subtitle: voice ? labels.voice : author,
    ...(voice && message.authorId !== ME && message.authorAvatar
      ? { artwork: message.authorAvatar }
      : {}),
    duration: media.duration ?? 0,
    reportPlay: voice && message.authorId !== ME && !message.played,
  };
}

/** The sender of a stored message, from what this device knows: each note says its own. */
export async function senderOf(
  db: LocalDb,
  row: MessageRow,
  me: string,
  labels: TrackLabels,
): Promise<Sender> {
  if (row.senderId === me) return { name: labels.you };
  const chat = await db.chats.get(row.chatId);
  const person =
    chat?.type === 'direct' && chat.otherUser?.id === row.senderId
      ? chat.otherUser
      : row.senderId
        ? await db.profiles.get(row.senderId)
        : undefined;
  return { name: person?.displayName || labels.unknown, avatar: person?.avatar?.small };
}

/** The same from a stored row, for the note after this one, which has no bubble to ask. */
export function rowToTrack(
  row: MessageRow,
  me: string,
  sender: Sender,
  labels: TrackLabels,
): Track | null {
  const { media } = row;
  if (!media?.id || media.kind !== 'voice') return null;
  return {
    mediaId: media.id,
    key: row.key,
    messageId: row.id,
    chatId: row.chatId,
    kind: 'voice',
    mime: media.mime,
    title: sender.name,
    subtitle: labels.voice,
    ...(sender.avatar ? { artwork: sender.avatar } : {}),
    duration: media.duration ?? 0,
    reportPlay: row.senderId !== me && !row.played,
  };
}
