import type { TFunction } from 'i18next';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toPlainText } from '@/features/formatting/parse';
import { type ChatMessage, ME } from '../types';

const MAX_CHARS = 200;

/** What a screen reader hears for a new message, or null for my own and system messages. */
export function announcement(message: ChatMessage | undefined, t: TFunction): string | null {
  if (!message || message.authorId === ME || message.system) return null;
  const name = message.authorName || t('chats.unknownPerson');
  const text = toPlainText(message.text ?? '')
    .trim()
    .slice(0, MAX_CHARS);
  return text
    ? t('conversation.newMessage', { name, text })
    : t('conversation.newMessageNoText', { name });
}

/**
 * A polite live region for the open chat: someone else's new message is read out once it
 * arrives. Messages already there when the chat opens, or loaded from history, are not.
 */
export function NewMessageAnnouncer({ messages }: { messages: ChatMessage[] | undefined }) {
  const { t } = useTranslation();
  const newest = messages?.at(-1);
  const seen = useRef<string | null | undefined>(undefined);
  const [text, setText] = useState('');

  useEffect(() => {
    if (messages === undefined) return;
    const id = newest?.id ?? null;
    if (seen.current === undefined) {
      seen.current = id;
      return;
    }
    if (id === seen.current) return;
    seen.current = id;
    const line = announcement(newest, t);
    if (line) setText(line);
  }, [messages, newest, t]);

  return (
    <p aria-live="polite" aria-atomic="true" className="sr-only">
      {text}
    </p>
  );
}
