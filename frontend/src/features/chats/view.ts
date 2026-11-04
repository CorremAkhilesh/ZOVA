import type { ChatRow, MessageRow } from '@/features/sync/local-db';
import { type ChatMessage, type ChatSummary, ME } from './types';

interface Labels {
  saved: string;
  unknown: string;
}

/** A stored chat as the screens show it. Privacy was already applied by the server. */
export function toChatSummary(row: ChatRow, me: string, labels: Labels): ChatSummary {
  const name = row.type === 'self' ? labels.saved : (row.otherUser?.displayName ?? labels.unknown);
  const { lastMessage } = row;
  return {
    id: row.id,
    name,
    kind: row.type === 'self' ? 'saved' : row.type === 'group' ? 'group' : 'personal',
    username: row.otherUser?.username ?? null,
    avatarSrc: row.otherUser?.avatar?.small,
    deactivated: row.otherUser?.deactivated === true,
    about: row.otherUser?.about ?? null,
    pinned: false,
    muted: false,
    unread: row.unreadCount,
    activityAt: new Date(row.sortAt),
    lastMessage: lastMessage
      ? {
          authorId: lastMessage.senderId === me ? ME : (lastMessage.senderId ?? ''),
          authorName: name,
          text: lastMessage.preview,
          at: new Date(lastMessage.createdAt),
        }
      : null,
  };
}

/** A stored message as a bubble shows it. */
export function toChatMessage(row: MessageRow, me: string, chatName: string): ChatMessage {
  const mine = row.senderId === me;
  return {
    id: row.key,
    chatId: row.chatId,
    clientMsgId: row.clientMsgId,
    authorId: mine ? ME : (row.senderId ?? ''),
    authorName: chatName,
    text: row.text ?? '',
    at: new Date(row.createdAt),
    ...(mine ? { status: row.status } : {}),
  };
}
