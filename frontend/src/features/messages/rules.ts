import { DELETE_WINDOW_HOURS, EDIT_WINDOW_MINUTES, type ReplyQuote } from '@zuvo/protocol';
import { type ChatMessage, type ChatSummary, ME } from '@/features/chats/types';
import type { QueuedAction } from '@/features/sync/actions-types';

const isGroupAdmin = (chat: Pick<ChatSummary, 'group'>) =>
  chat.group?.active === true && (chat.group.myRole === 'owner' || chat.group.myRole === 'admin');

/** What to offer. The server decides again on every request: this only keeps the screen honest. */
export function canEdit(message: ChatMessage, now = Date.now()): boolean {
  if (message.authorId !== ME || !message.serverId || message.deleted) return false;
  if (message.media?.kind === 'voice' || message.system || message.poll) return false;
  return now - message.at.getTime() <= EDIT_WINDOW_MINUTES * 60_000;
}

export function canDeleteForEveryone(
  message: ChatMessage,
  chat: Pick<ChatSummary, 'group'>,
  now = Date.now(),
): boolean {
  if (!message.serverId || message.deleted || message.system) return false;
  if (isGroupAdmin(chat)) return true;
  if (message.authorId !== ME) return false;
  return now - message.at.getTime() <= DELETE_WINDOW_HOURS * 3_600_000;
}

/** Whether deleting this one says "by an admin" on it. */
export const deletesAsAdmin = (message: ChatMessage, chat: Pick<ChatSummary, 'group'>) =>
  message.authorId !== ME && isGroupAdmin(chat);

/** Only a message the server has, that still has something on it. */
export const canAct = (message: ChatMessage) =>
  Boolean(message.serverId && typeof message.seq === 'number') && !message.system;

export function toQuote(message: ChatMessage, me: string, myName: string): ReplyQuote | undefined {
  if (!message.serverId || typeof message.seq !== 'number') return undefined;
  const mine = message.authorId === ME;
  return {
    id: message.serverId,
    chatId: message.chatId,
    seq: message.seq,
    senderId: mine ? me : message.authorId,
    senderName: mine ? myName : message.authorName,
    type: message.poll ? 'poll' : (message.media?.kind ?? 'text'),
    text:
      message.poll?.question ?? (message.media ? message.text || message.media.name : message.text),
    // A view-once quote never shows the picture.
    mediaId: message.media?.hasThumbnail && !message.viewOnce ? message.media.id : null,
    hasThumbnail: message.media?.hasThumbnail === true && !message.viewOnce,
    deleted: false,
  };
}

/** A message's place, for acting on it. */
export function targetOf(message: ChatMessage) {
  return { chatId: message.chatId, messageId: message.serverId ?? '', seq: message.seq ?? 0 };
}

/** Oldest first. One line with sender and time for each, so it still reads well when pasted. */
export function copyLines(messages: ChatMessage[], youLabel: string, locale: string): string {
  const stamp = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });
  return [...messages]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .filter((message) => message.text)
    .map((message) => {
      const who = message.authorId === ME ? youLabel : message.authorName;
      return `[${stamp.format(message.at)}] ${who}: ${message.text}`;
    })
    .join('\n');
}

export function forwardAction(
  messages: ChatMessage[],
  chatIds: string[],
  comment: string,
  forwardId: string,
): QueuedAction {
  return {
    type: 'forward',
    forwardId,
    messages: messages.map((message) => ({
      chatId: message.chatId,
      messageId: message.serverId ?? '',
    })),
    chatIds,
    ...(comment.trim() ? { comment } : {}),
  };
}

export interface ReactionGroup {
  emoji: string;
  userIds: string[];
}

/** The pills under a bubble: most used first, then the earliest. */
export function groupReactions(reactions: NonNullable<ChatMessage['reactions']>): ReactionGroup[] {
  const groups = new Map<string, string[]>();
  for (const { emoji, userId } of reactions) {
    groups.set(emoji, [...(groups.get(emoji) ?? []), userId]);
  }
  return [...groups]
    .map(([emoji, userIds]) => ({ emoji, userIds }))
    .sort((a, b) => b.userIds.length - a.userIds.length);
}
