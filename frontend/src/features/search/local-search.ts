import type { SearchFilter } from '@zuvo/protocol';
import { findLinks } from '@/features/formatting/links';
import { toPlainText } from '@/features/formatting/parse';
import type { ChatRow, LocalDb, MessageRow } from '@/features/sync/local-db';

/** Lowercase words, as typed. */
export const wordsOf = (q: string) =>
  q.normalize('NFC').toLocaleLowerCase().split(/\s+/u).filter(Boolean).slice(0, 8);

/** Every word somewhere in the text, ignoring case and formatting markers. */
export function matchesAll(text: string | null | undefined, words: string[]): boolean {
  if (!text || words.length === 0) return false;
  const plain = toPlainText(text).normalize('NFC').toLocaleLowerCase();
  return words.every((word) => plain.includes(word));
}

const KIND: Record<SearchFilter, (row: MessageRow) => boolean> = {
  photos: (row) => row.type === 'image',
  videos: (row) => row.type === 'video',
  docs: (row) => row.type === 'document' || row.type === 'audio',
  voice: (row) => row.type === 'voice',
  links: (row) => findLinks(row.text ?? '').some((match) => match.node.kind === 'url'),
};

export interface LocalSearchInput {
  q: string;
  filter?: SearchFilter | undefined;
  chatId?: string | undefined;
  limit?: number;
}

/**
 * Instant results from what this device has: matching messages, newest first. The server's
 * results follow and fill in what was never loaded here.
 */
export async function searchLocalMessages(
  db: LocalDb,
  input: LocalSearchInput,
): Promise<MessageRow[]> {
  const words = wordsOf(input.q);
  if (words.length === 0 && !input.filter) return [];
  const kind = input.filter ? KIND[input.filter] : null;
  const rows = await db.messages
    .filter(
      (row) =>
        row.seq !== null &&
        !row.deletedForEveryoneAt &&
        !row.system &&
        (!input.chatId || row.chatId === input.chatId) &&
        (!kind || kind(row)) &&
        (words.length === 0 || matchesAll(row.text, words)),
    )
    .toArray();
  return rows
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, input.limit ?? 30);
}

/** Chats whose name has every word. */
export function searchLocalChats(chats: ChatRow[], q: string, savedName: string): ChatRow[] {
  const words = wordsOf(q);
  if (words.length === 0) return [];
  return chats.filter((chat) => {
    const name =
      chat.type === 'self' ? savedName : (chat.group?.name ?? chat.otherUser?.displayName ?? '');
    const handle = chat.otherUser?.username ?? '';
    const haystack = `${name} ${handle}`.toLocaleLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** A line of the message around its first match, in plain text. */
export function snippetOf(text: string | null | undefined, q: string, radius = 40): string {
  const plain = toPlainText(text ?? '')
    .replace(/\s+/gu, ' ')
    .trim();
  const word = wordsOf(q)[0] ?? '';
  const at = word ? plain.toLocaleLowerCase().indexOf(word) : -1;
  if (at < 0 || plain.length <= radius * 2) return plain.slice(0, radius * 2);
  const start = Math.max(0, at - radius);
  const end = Math.min(plain.length, at + word.length + radius);
  return `${start > 0 ? '…' : ''}${plain.slice(start, end)}${end < plain.length ? '…' : ''}`;
}
