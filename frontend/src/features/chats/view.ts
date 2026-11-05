import type { ChatRow, MessageRow } from '@/features/sync/local-db';
import { tickState } from './ticks';
import { type ChatMessage, type ChatSummary, ME } from './types';

interface Labels {
  saved: string;
  unknown: string;
}

function lastMessageView(
  row: ChatRow,
  me: string,
  name: string,
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
    text: lastMessage.preview,
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
    lastMessage: lastMessageView(row, me, name, unsent),
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
    ...(mine ? { status: tickState(row, chat) } : {}),
  };
}
