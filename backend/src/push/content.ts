import { PUSH_BODY_MAX, type PushPayload, type PushSettings, pushTagFor } from '@zuvo/protocol';
import { describeMessage, type MessageForText, type PushLanguage, stringsFor } from './strings.ts';

const TITLE_MAX = 120;
const BODY_LIMIT = 400;

/** Whitespace collapsed, cut at a whole character with "…". */
export function truncate(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  const characters = Array.from(line);
  return characters.length > max ? `${characters.slice(0, max - 1).join('')}…` : line;
}

export interface MessageContentInput {
  chatId: string;
  chatType: 'direct' | 'group' | 'self';
  groupName: string | null;
  senderName: string;
  /** The newest message in this notification. */
  newest: MessageForText;
  seq: number;
  /** Messages in this notification: the newest one plus "(+N more)". */
  count: number;
  badge: number;
  settings: PushSettings;
  /** This chat is behind my PIN. */
  chatLocked: boolean;
  /** The whole app is behind my PIN. */
  appLock: boolean;
  language: PushLanguage;
  now: Date;
}

/** Locked chats, app lock and "preview off" never show who wrote or what. */
export const hidesDetails = (
  input: Pick<MessageContentInput, 'settings' | 'chatLocked' | 'appLock'>,
) => !input.settings.showPreview || input.chatLocked || input.appLock;

/**
 * The notification for a chat's new messages. Pure. Hidden: "New message", no body, no names.
 * Otherwise 1:1 shows the sender and the text, a group its name and "Riya: text". A quiet-hours
 * exception still sounds: it exists so the person hears that message.
 */
export function buildMessagePayload(input: MessageContentInput): PushPayload {
  const s = stringsFor(input.language);
  const hidden = hidesDetails(input);
  const base = {
    kind: 'message' as const,
    v: 1 as const,
    chatId: input.chatId,
    tag: pushTagFor(input.chatId),
    seq: input.seq,
    count: input.count,
    badge: input.badge,
    hidden,
    silent: !input.settings.sound,
    sentAt: input.now.toISOString(),
  };
  if (hidden) return { ...base, title: s.newMessage, body: '' };

  const more = input.count > 1 ? ` ${s.more(input.count - 1)}` : '';
  const text = truncate(describeMessage(input.newest, input.language), PUSH_BODY_MAX);
  const group = input.chatType === 'group';
  const title = truncate(group ? (input.groupName ?? s.newMessage) : input.senderName, TITLE_MAX);
  const body = group ? `${truncate(input.senderName, 40)}: ${text}${more}` : `${text}${more}`;
  return { ...base, title, body: truncate(body, BODY_LIMIT) };
}

/** POST /v1/me/push/test */
export function buildTestPayload(
  settings: PushSettings,
  language: PushLanguage,
  now: Date,
): PushPayload {
  const s = stringsFor(language);
  return {
    kind: 'test',
    v: 1,
    tag: 'test',
    title: s.testTitle,
    body: s.testBody,
    silent: !settings.sound,
    sentAt: now.toISOString(),
  };
}
