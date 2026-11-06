import type { LastReaction, PublicProfile, SystemEvent } from '@zuvo/protocol';
import type { ChatRow, MessageRow } from '@/features/sync/local-db';
import { tickState } from './ticks';
import { type ChatMessage, type ChatSummary, ME } from './types';

interface Labels {
  saved: string;
  unknown: string;
  photo?: string;
  video?: string;
  voice?: string;
  deleted?: string;
  system?: (event: SystemEvent) => string;
  reacted?: (reaction: LastReaction) => string;
}

export type KnownPeople = ReadonlyMap<string, PublicProfile>;

/** "📷 Photo", "🎥 Video", "📄 report.pdf", with the caption if there is one. */
export function previewText(
  last: { type: string; preview: string },
  labels: Pick<Labels, 'photo' | 'video' | 'voice'>,
): string {
  if (last.type === 'image') return `📷 ${last.preview || labels.photo}`;
  if (last.type === 'video') return `🎥 ${last.preview || labels.video}`;
  if (last.type === 'document') return `📄 ${last.preview}`;
  if (last.type === 'voice') return `🎤 ${labels.voice} (${last.preview})`;
  if (last.type === 'audio') return `🎵 ${last.preview}`;
  return last.preview;
}

function lastMessageView(
  row: ChatRow,
  me: string,
  name: string,
  labels: Labels,
  unsent: 'pending' | 'failed' | undefined,
  people: KnownPeople | undefined,
): ChatSummary['lastMessage'] {
  const { lastMessage } = row;
  if (!lastMessage) return null;
  if (lastMessage.system) {
    return {
      authorId: '',
      authorName: '',
      text: labels.system?.(lastMessage.system) ?? '',
      at: new Date(lastMessage.createdAt),
      isSystem: true,
    };
  }
  const mine = lastMessage.senderId === me;
  const person = row.type === 'group' ? people?.get(lastMessage.senderId ?? '') : undefined;
  // A preview ahead of the chat's position is still waiting for the server.
  const status = unsent ?? (lastMessage.seq > row.seq ? 'pending' : 'sent');
  return {
    authorId: mine ? ME : (lastMessage.senderId ?? ''),
    authorName: person?.displayName ?? name,
    text: lastMessage.deleted ? (labels.deleted ?? '') : previewText(lastMessage, labels),
    at: new Date(lastMessage.createdAt),
    ...(mine ? { status: tickState({ status, seq: lastMessage.seq }, row) } : {}),
  };
}

/** Only until something newer happens in the chat. */
function reactionLine(row: ChatRow, labels: Labels) {
  const { lastReaction, lastMessage } = row;
  if (!lastReaction || !labels.reacted) return undefined;
  const newer = !lastMessage || Date.parse(lastReaction.at) > Date.parse(lastMessage.createdAt);
  return newer ? labels.reacted(lastReaction) : undefined;
}

/** A stored chat as the screens show it. Privacy was already applied by the server. */
export function toChatSummary(
  row: ChatRow,
  me: string,
  labels: Labels,
  unsent?: 'pending' | 'failed',
  people?: KnownPeople,
): ChatSummary {
  const { otherUser, group } = row;
  const name =
    row.type === 'self' ? labels.saved : (group?.name ?? otherUser?.displayName ?? labels.unknown);
  return {
    id: row.id,
    name,
    kind: row.type === 'self' ? 'saved' : row.type === 'group' ? 'group' : 'personal',
    otherUserId: otherUser?.id,
    username: otherUser?.username ?? null,
    avatarSrc: group ? (group.photo?.small ?? undefined) : otherUser?.avatar?.small,
    group: group ?? null,
    memberCount: group?.memberCount ?? 0,
    deactivated: otherUser?.deactivated === true,
    about: otherUser?.about ?? null,
    pinned: row.pinned === true,
    muted: Boolean(row.mutedUntil && Date.parse(row.mutedUntil) > Date.now()),
    archived: row.archived === true,
    markedUnread: row.markedUnread === true,
    reactionLine: reactionLine(row, labels),
    unread: row.unreadCount,
    activityAt: new Date(row.sortAt),
    lastMessage: lastMessageView(row, me, name, labels, unsent, people),
  };
}

/** A stored message as a bubble shows it. */
export function toChatMessage(
  row: MessageRow,
  me: string,
  chatName: string,
  chat: ChatRow,
  people?: KnownPeople,
  unknown = '',
): ChatMessage {
  const mine = row.senderId === me;
  const person = chat.type === 'group' ? people?.get(row.senderId ?? '') : undefined;
  return {
    id: row.key,
    chatId: row.chatId,
    clientMsgId: row.clientMsgId,
    authorId: mine ? ME : (row.senderId ?? ''),
    authorName: chat.type === 'group' ? (person?.displayName ?? unknown) : chatName,
    authorAvatar: person?.avatar?.small,
    system: row.system ?? null,
    text: row.text ?? '',
    at: new Date(row.createdAt),
    media: row.media ?? null,
    // What is left of an album after a delete is a tombstone of its own.
    albumId: row.deletedForEveryoneAt ? null : (row.albumId ?? null),
    serverId: row.id,
    seq: row.seq,
    replyTo: row.replyTo ?? null,
    forwarded: row.forwarded === true,
    forwardCount: row.forwardCount ?? 0,
    reactions: row.reactions ?? [],
    starred: row.starred === true,
    edited: Boolean(row.editedAt),
    deleted: Boolean(row.deletedForEveryoneAt),
    deletedByAdmin: row.deletedByAdmin === true,
    played: row.played === true,
    uploadedBytes: row.uploadedBytes,
    heldInTab: row.heldInTab,
    failReason: row.failReason,
    ...(mine ? { status: tickState(row, chat) } : {}),
  };
}
