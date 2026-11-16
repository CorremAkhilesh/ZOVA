import type { Message } from '@zuvo/protocol';
import type { ChatRow } from '@/features/sync/local-db';

/** A small in-app toast for a message in another chat. `body` null: "New message" only. */
export interface InAppAlert {
  chatId: string;
  title: string;
  body: string | null;
}

export interface AlertContext {
  me: string;
  /** The stored chat, if this device has it yet. */
  chat: ChatRow | undefined;
  /** The sender's name, when known. */
  senderName: string | null;
  /** The chat on screen right now, if any. */
  openChatId: string | null;
  /** This tab is visible and focused. Otherwise the server sends a push instead. */
  windowActive: boolean;
  /** The app lock is up: nothing about any chat shows. */
  appLocked: boolean;
  /** My "Show message preview" setting. */
  showPreview: boolean;
  /** Quiet hours allow this message (see quiet-hours/quiet.ts `shouldAlert`). */
  quietAllows: (message: { chatId: string; mentionsMe: boolean }) => boolean;
  /** The message as one line ("📷 Photo", the text…). */
  preview: (message: Message) => string;
  newMessage: string;
  now?: number;
}

export const mentionsMe = (message: Message, me: string) =>
  message.mentionsEveryone === true || (message.mentions ?? []).some((m) => m.userId === me);

const isMuted = (chat: ChatRow | undefined, now: number) =>
  Boolean(chat?.mutedUntil && Date.parse(chat.mutedUntil) > now);

function titleFor(chat: ChatRow | undefined, senderName: string | null, fallback: string) {
  if (chat?.type === 'group') {
    const group = chat.group?.name;
    return senderName && group ? `${senderName} · ${group}` : (group ?? senderName ?? fallback);
  }
  return chat?.otherUser?.displayName ?? senderName ?? fallback;
}

/**
 * Whether a new message shows a toast while the app is open, and what it says:
 * - only while this tab is visible and focused, and never for the chat already on screen
 * - never for my own messages (from my other devices), system messages or deleted ones
 * - muted chats: only when I am @mentioned; quiet hours: only what they let through
 * - locked chats and the app lock: "New message", no sender and no text; preview off: no text
 */
export function inAppAlert(message: Message, ctx: AlertContext): InAppAlert | null {
  const now = ctx.now ?? Date.now();
  if (!ctx.windowActive || message.chatId === ctx.openChatId) return null;
  if (message.senderId === null || message.senderId === ctx.me) return null;
  if (message.system || message.deletedForEveryoneAt) return null;
  if (ctx.chat?.type === 'self') return null;
  const mentioned = mentionsMe(message, ctx.me);
  if (isMuted(ctx.chat, now) && !mentioned) return null;
  if (!ctx.quietAllows({ chatId: message.chatId, mentionsMe: mentioned })) return null;
  if (ctx.appLocked || ctx.chat?.locked) {
    return { chatId: message.chatId, title: ctx.newMessage, body: null };
  }
  const title = titleFor(ctx.chat, ctx.senderName, ctx.newMessage);
  if (!ctx.showPreview) return { chatId: message.chatId, title, body: null };
  return { chatId: message.chatId, title, body: ctx.preview(message) || null };
}
