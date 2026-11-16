import { lazy, type ReactNode, Suspense, useState } from 'react';
import { usePromoReady } from './ready';

const PromoBar = lazy(() => import('./PromoBar'));

interface ChatListPromoInput {
  /** Chat rows are on screen. */
  rowsShown: boolean;
  /** "Get notified" may be offered: a chat with someone exists. */
  pushAllowed: boolean;
  /** Searching or in Archived: no promo. */
  hidden: boolean;
}

/**
 * The chat list's promo bar ("Get notified" / "Install the app"): `bar` goes in the list pane
 * (positioned over its bottom), `spacer` at the end of the scrolling list, so the last row can be
 * scrolled clear of the bar. Adding the spacer only grows the list's end: nothing on screen moves.
 */
export function useChatListPromo({ rowsShown, pushAllowed, hidden }: ChatListPromoInput): {
  bar: ReactNode;
  spacer: ReactNode;
} {
  const ready = usePromoReady(rowsShown);
  const [shown, setShown] = useState(false);
  if (!ready || hidden) return { bar: null, spacer: null };
  return {
    bar: (
      <Suspense fallback={null}>
        <PromoBar pushAllowed={pushAllowed} onShownChange={setShown} />
      </Suspense>
    ),
    spacer: shown ? <div aria-hidden className="h-16" data-testid="promo-spacer" /> : null,
  };
}
