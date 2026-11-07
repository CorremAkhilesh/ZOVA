import { linkPreviewResponseSchema } from '@zuvo/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { findLinks } from '@/features/formatting/links';
import type { AttachedPreview } from '@/features/sync/outbox';
import { apiPost } from '@/lib/api-client';

/** Waits for a pause in typing, so a half-typed address is never looked up. */
export const PREVIEW_DELAY_MS = 600;

export const linkPreviewApi = {
  lookup: (url: string) => apiPost('/v1/link-previews', { url }, linkPreviewResponseSchema),
};

/** The first web link in the text, as the server will see it, or null. */
export function firstWebLink(text: string): string | null {
  for (const match of findLinks(text)) {
    if (match.node.kind === 'url' && /^https?:\/\//i.test(match.node.href)) return match.node.href;
  }
  return null;
}

/**
 * The preview for the first link in the composer: asked for after a pause, dropped when the link
 * changes, and never asked for again once the person removed it. Offline or refused: no preview.
 */
export function useLinkPreviewDraft(text: string, enabled: boolean) {
  const url = enabled ? firstWebLink(text) : null;
  const [state, setState] = useState<{ url: string; attached: AttachedPreview | null } | null>(
    null,
  );
  const removed = useRef(new Set<string>());

  useEffect(() => {
    if (!url || removed.current.has(url)) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setState({ url, attached: null });
      linkPreviewApi
        .lookup(url)
        .then((found) => !cancelled && setState({ url, attached: found }))
        .catch(() => !cancelled && setState(null));
    }, PREVIEW_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [url]);

  const current = state && state.url === url && !removed.current.has(url) ? state : null;
  const remove = useCallback(() => {
    if (url) removed.current.add(url);
    setState(null);
  }, [url]);
  /** What goes with the message being sent, after which the composer starts afresh. */
  const take = useCallback(() => {
    const attached = current?.attached ?? null;
    setState(null);
    removed.current.clear();
    return attached;
  }, [current]);

  return {
    preview: current?.attached?.preview ?? null,
    loading: current !== null && current.attached === null,
    remove,
    take,
  };
}
