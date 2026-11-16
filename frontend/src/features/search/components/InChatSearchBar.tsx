import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { type KeyboardEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useChats } from '@/features/chats/queries';
import { useMessageUi } from '@/features/messages/store';
import { useInChatSearch } from '../in-chat-store';
import { useMessageSearch } from '../use-message-search';

/**
 * The header's search: matches are marked in the bubbles; up goes to older matches, down to
 * newer ones, loading older history first when a match is not on this device yet.
 */
export function InChatSearchBar({ chatId }: { chatId: string }) {
  const { t } = useTranslation();
  const openFor = useInChatSearch((state) => state.chatId);
  const { setTerm, close } = useInChatSearch.getState();
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const chats = useChats();
  const search = useMessageSearch({ q: openFor === chatId ? q : '', chatId }, chats);
  const hits = search.hits;
  const current = hits[index];

  // Leaving the chat ends its search.
  useEffect(() => () => useInChatSearch.getState().close(), []);
  useEffect(() => {
    setTerm(search.q);
    setIndex(0);
  }, [search.q, setTerm]);
  useEffect(() => {
    if (current) useMessageUi.getState().set({ jump: { chatId, seq: current.seq } });
  }, [chatId, current]);
  // Near the oldest loaded match: ask the server for more.
  useEffect(() => {
    if (index >= hits.length - 2 && search.hasMore && !search.loadingMore) search.loadMore();
  }, [hits.length, index, search]);

  if (openFor !== chatId) return null;
  const older = () => setIndex((value) => Math.min(value + 1, Math.max(0, hits.length - 1)));
  const newer = () => setIndex((value) => Math.max(0, value - 1));
  /** Results start at the newest match, so "next" (Enter, ↑) goes further back in the chat. */
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      // Handled: the chat info pane and the chat itself stay open.
      event.preventDefault();
      close();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) newer();
      else older();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      if (event.key === 'ArrowUp') older();
      else newer();
    }
  }

  const status = !search.q
    ? ''
    : search.loading && hits.length === 0
      ? t('search.searching')
      : hits.length === 0
        ? t('search.noMatches')
        : t('search.position', { current: index + 1, total: hits.length });
  return (
    <search className="glass flex items-center gap-2 border-b px-3 py-2">
      <Search className="size-4 text-text-muted" aria-hidden />
      <input
        // biome-ignore lint/a11y/noAutofocus: opened by pressing the search button
        autoFocus
        type="search"
        aria-label={t('search.inChat')}
        placeholder={t('search.inChat')}
        value={q}
        onChange={(event) => setQ(event.target.value)}
        onKeyDown={onKeyDown}
        className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none"
      />
      <span role="status" className="shrink-0 text-xs text-text-muted tabular-nums">
        {status}
      </span>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('search.older')}
        disabled={index >= hits.length - 1}
        onClick={older}
      >
        <ChevronUp className="size-4" aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('search.newer')}
        disabled={index === 0}
        onClick={newer}
      >
        <ChevronDown className="size-4" aria-hidden />
      </Button>
      <Button variant="ghost" size="icon" aria-label={t('search.close')} onClick={close}>
        <X className="size-4" aria-hidden />
      </Button>
    </search>
  );
}
