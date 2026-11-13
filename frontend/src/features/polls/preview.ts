import type { ReplyQuote } from '@zuvo/protocol';
import { i18n } from '@/lib/i18n';

/** "📊 Poll: Lunch?" in the reader's language. The server sends only the question. */
export const pollPreview = (question: string) => i18n.t('polls.preview', { question });

/** What a reply quote shows: a poll's question gets the same label as the chat list. */
export const quoteText = (quote: Pick<ReplyQuote, 'type' | 'text'>) =>
  quote.type === 'poll' ? pollPreview(quote.text) : quote.text;
