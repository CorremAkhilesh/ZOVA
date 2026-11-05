import type { ChatRow, MessageRow } from '@/features/sync/local-db';
import { tickState } from './ticks';
import { type ChatMessage, type ChatSummary, ME } from './types';

interface Labels {
  saved: string;
  unknown: string;
  photo?: string;
  video?: string;
}

/** "📷 Photo", "🎥 Video", "📄 report.pdf", with the caption if there is one. */
export function previewText(
  last: { type: string; preview: string },
  labels: Pick<Labels, 'photo' | 'video'>,
): string {
  if (last.type === 'image') return `📷 ${last.preview || labels.photo}`;
  if (last.type === 'video') return `🎥 ${last.preview || labels.video}`;
  if (last.type === 'document') return `📄 ${last.preview}`;
  return last.preview;
}

function lastMessageView(
  row: ChatRow,
  me: string,
  name: string,
  labels: Labels,
  unsent: 'pending' | 'failed' | undefined,
): ChatSummary['lastMessage'] {
  const { lastMessage } = row;
  if (!lastMessage) return null;
  const mine = lastMessage.senderId === me;
  // A preview ahead of the chat's position is still waiting for the server.
  const status = unsent ?? (lastMessage.seq > row.seq ? 'pending' : 'sent');
  return {
    authorId: mine ? ME : (lastMessage.senderId ?? ''),
    authorName: name,
    text: previewText(lastMessage, labels),
    at: new Date(lastMessage.createdAt),
    ...(mine ? { status: tickState({ status, seq: lastMessage.seq }, row) } : {}),
  };
}

/** A stored chat as the screens show it. Privacy was already applied by the server. */
export function toChatSummary(
  row: ChatRow,
  me: string,
  labels: Labels,
  unsent?: 'pending' | 'failed',
): ChatSummary {
  const { otherUser } = row;
  const name = row.type === 'self' ? labels.saved : (otherUser?.displayName ?? labels.unknown);
  return {
    id: row.id,
    name,
    kind: row.type === 'self' ? 'saved' : row.type === 'group' ? 'group' : 'personal',
    otherUserId: otherUser?.id,
    username: otherUser?.username ?? null,
    avatarSrc: otherUser?.avatar?.small,
    deactivated: otherUser?.deactivated === true,
    about: otherUser?.about ?? null,
    pinned: false,
    muted: false,
    unread: row.unreadCount,
    activityAt: new Date(row.sortAt),
    lastMessage: lastMessageView(row, me, name, labels, unsent),
  };
}

/** A stored message as a bubble shows it. */
export function toChatMessage(
  row: MessageRow,
  me: string,
  chatName: string,
  chat: ChatRow,
): ChatMessage {
  const mine = row.senderId === me;
  return {
    id: row.key,
    chatId: row.chatId,
    clientMsgId: row.clientMsgId,
    authorId: mine ? ME : (row.senderId ?? ''),
    authorName: chatName,
    text: row.text ?? '',
    at: new Date(row.createdAt),
    media: row.media ?? null,
    albumId: row.albumId ?? null,
    uploadedBytes: row.uploadedBytes,
    heldInTab: row.heldInTab,
    failReason: row.failReason,
    ...(mine ? { status: tickState(row, chat) } : {}),
  };
}
