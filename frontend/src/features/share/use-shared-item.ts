import { useCallback, useEffect, useState } from 'react';
import { indexedDbShareStore, type SharedItem } from '@/sw/share/store';

export type SharedState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'ready'; item: SharedItem };

/**
 * What was shared to the app: the item the service worker stored (by id, else the newest one, for
 * a share that waited behind sign-in). `discard` deletes it, after sending or cancelling.
 */
export function useSharedItem(id: string | undefined) {
  const [state, setState] = useState<SharedState>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    const store = indexedDbShareStore();
    (id ? store.get(id) : store.latest())
      .then((item) => {
        if (live) setState(item ? { status: 'ready', item } : { status: 'missing' });
      })
      .catch(() => {
        if (live) setState({ status: 'missing' });
      });
    return () => {
      live = false;
    };
  }, [id]);
  const discard = useCallback(async () => {
    if (state.status === 'ready')
      await indexedDbShareStore()
        .remove(state.item.id)
        .catch(() => {});
  }, [state]);
  return { state, discard };
}

/** The shared text and link together, as one message or caption. */
export function sharedText(item: Pick<SharedItem, 'title' | 'text' | 'url'>): string {
  const parts = [item.text, item.url].filter(Boolean);
  // A title alone (some apps send only a page title) is better than nothing.
  if (parts.length === 0 && item.title) parts.push(item.title);
  // Apps often put the link inside the text too: once is enough.
  if (item.url && item.text.includes(item.url)) return item.text;
  return parts.join('\n');
}
