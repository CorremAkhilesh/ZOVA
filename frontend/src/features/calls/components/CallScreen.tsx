import { ChevronDown, Mic, MicOff, Phone, PhoneOff, Signal, Volume2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChatAvatar } from '@/features/chats/components/ChatAvatar';
import { cn } from '@/lib/utils';
import { useCallPeer, useCallState, useCallStatusLine } from '../hooks';
import type { CallState, Quality } from '../machine';
import { useCallStore } from '../store';

function RoundButton(props: {
  label: string;
  onClick: () => void;
  className: string;
  children: ReactNode;
  pressed?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-pressed={props.pressed}
      // biome-ignore lint/a11y/noAutofocus: the one thing to do on a ringing screen is to answer.
      autoFocus={props.autoFocus}
      className="flex w-20 flex-col items-center gap-2 text-sm text-white focus-visible:outline-none"
    >
      <span
        className={cn(
          'grid size-16 place-items-center rounded-full transition-transform active:scale-95 [button:focus-visible_&]:ring-4 [button:focus-visible_&]:ring-white/70',
          props.className,
        )}
      >
        {props.children}
      </span>
      {props.label}
    </button>
  );
}

const QUALITY_BARS: Record<Quality, string> = {
  good: 'text-[#86EFAC]',
  fair: 'text-[#FCD34D]',
  poor: 'text-[#FCA5A5]',
};

function QualityBadge({ quality }: { quality: Quality | null }) {
  const { t } = useTranslation();
  if (!quality) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs text-white">
      <Signal className={cn('size-3.5', QUALITY_BARS[quality])} aria-hidden />
      {t(`calls.quality.${quality}`)}
    </span>
  );
}

const TOGGLED = 'bg-white text-[#1E1B4B]';
const UNTOGGLED = 'bg-white/15 hover:bg-white/25';

/** Ringing for me: Decline and Accept (Accept has the focus). */
function IncomingControls() {
  const { t } = useTranslation();
  const actions = useCallStore((store) => store.actions);
  return (
    <div className="flex justify-center gap-16 px-6 pb-6">
      <RoundButton
        label={t('calls.decline')}
        onClick={() => actions?.decline()}
        className="bg-[#DC2626] hover:bg-[#B91C1C]"
      >
        <PhoneOff className="size-7" aria-hidden />
      </RoundButton>
      <RoundButton
        label={t('calls.accept')}
        onClick={() => void actions?.accept()}
        className="bg-[#15803D] hover:bg-[#166534]"
        autoFocus
      >
        <Phone className="size-7" aria-hidden />
      </RoundButton>
    </div>
  );
}

/** Calling or talking: Mute, Speaker (where the browser can switch output) and End. */
function LiveControls({ state }: { state: CallState }) {
  const { t } = useTranslation();
  const actions = useCallStore((store) => store.actions);
  return (
    <div className="flex justify-center gap-6 px-6 pb-6">
      <RoundButton
        label={state.muted ? t('calls.unmute') : t('calls.mute')}
        onClick={() => actions?.toggleMute()}
        pressed={state.muted}
        className={state.muted ? TOGGLED : UNTOGGLED}
      >
        {state.muted ? (
          <MicOff className="size-7" aria-hidden />
        ) : (
          <Mic className="size-7" aria-hidden />
        )}
      </RoundButton>
      {actions?.canChooseSpeaker() ? (
        <RoundButton
          label={t('calls.speaker')}
          onClick={() => void actions.toggleSpeaker()}
          pressed={state.speaker}
          className={state.speaker ? TOGGLED : UNTOGGLED}
        >
          <Volume2 className="size-7" aria-hidden />
        </RoundButton>
      ) : null}
      <RoundButton
        label={t('calls.end')}
        onClick={() => actions?.hangUp()}
        className="bg-[#DC2626] hover:bg-[#B91C1C]"
      >
        <PhoneOff className="size-7" aria-hidden />
      </RoundButton>
    </div>
  );
}

/**
 * The call, full screen, over everything: who, how it is going, and the buttons. Ringing for me:
 * Accept and Decline. In a call: Mute, Speaker (where the browser can switch), End, and a button to
 * go back to the app while the call goes on (the "On call" bar brings it back).
 */
export function CallScreen() {
  const { t } = useTranslation();
  const state = useCallState();
  const minimized = useCallStore((store) => store.minimized);
  const { chat, name } = useCallPeer(state.call?.chatId);
  const line = useCallStatusLine(state);
  if (state.phase === 'idle' || minimized || !state.call) return null;
  const live =
    state.phase === 'outgoing' || state.phase === 'connecting' || state.phase === 'active';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="call-name"
      aria-describedby="call-status"
      className="fixed inset-0 z-[1650] flex flex-col bg-gradient-to-b from-[#312E81] via-[#1E1B4B] to-[#0F0D2E] pt-[env(safe-area-inset-top)] pb-[max(env(safe-area-inset-bottom),1.5rem)] text-white"
    >
      <div className="flex h-14 items-center px-2">
        {state.phase === 'connecting' || state.phase === 'active' ? (
          <button
            type="button"
            onClick={() => useCallStore.getState().setMinimized(true)}
            className="grid size-11 place-items-center rounded-full hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
          >
            <ChevronDown className="size-6" aria-hidden />
            <span className="sr-only">{t('calls.minimize')}</span>
          </button>
        ) : null}
        <span className="flex-1 text-center text-sm text-white/80">{t('calls.call')}</span>
        <span className="size-11" aria-hidden />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <span
          className={cn(
            'rounded-full p-1.5',
            state.phase === 'incoming' && !state.silent && 'animate-pulse bg-white/10',
          )}
        >
          {chat ? (
            <ChatAvatar chat={chat} className="size-28 text-4xl" />
          ) : (
            <span className="grid size-28 place-items-center rounded-full bg-white/15 text-4xl">
              {name.slice(0, 1)}
            </span>
          )}
        </span>
        <h2 id="call-name" className="max-w-full truncate text-2xl font-semibold">
          {name}
        </h2>
        <p id="call-status" aria-live="polite" className="text-base text-white/85 tabular-nums">
          {line}
        </p>
        {state.phase === 'incoming' && state.silent ? (
          <p className="text-sm text-white/70">{t('calls.silent')}</p>
        ) : null}
        {state.phase === 'active' ? <QualityBadge quality={state.quality} /> : null}
      </div>

      {state.phase === 'incoming' ? <IncomingControls /> : null}
      {live ? <LiveControls state={state} /> : null}
    </div>
  );
}
