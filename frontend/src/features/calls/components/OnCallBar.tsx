import { Phone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCallPeer, useCallState, useCallStatusLine } from '../hooks';
import { useCallStore } from '../store';

/**
 * A call is going on and its screen is folded away: a slim green bar on top of the app, with the
 * person and the time. Tapping it brings the call back.
 */
export function OnCallBar() {
  const { t } = useTranslation();
  const state = useCallState();
  const minimized = useCallStore((store) => store.minimized);
  const { name } = useCallPeer(state.call?.chatId);
  const line = useCallStatusLine(state);
  const live =
    state.phase === 'outgoing' || state.phase === 'connecting' || state.phase === 'active';
  if (!minimized || !live) return null;
  return (
    <button
      type="button"
      onClick={() => useCallStore.getState().setMinimized(false)}
      className="flex h-9 w-full shrink-0 items-center justify-center gap-2 bg-[#15803D] px-4 text-sm font-medium text-white hover:bg-[#166534] focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none focus-visible:ring-inset"
    >
      <Phone className="size-4" aria-hidden />
      <span className="truncate">
        {t('calls.onCall')} · {name} · <span className="tabular-nums">{line}</span>
      </span>
      <span className="sr-only">, {t('calls.returnToCall')}</span>
    </button>
  );
}
