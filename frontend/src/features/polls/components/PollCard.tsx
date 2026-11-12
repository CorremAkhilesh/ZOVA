import { BarChart3, Lock } from 'lucide-react';
import { lazy, type ReactNode, Suspense, type SyntheticEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/ui/dialog';
import { type ChatMessage, ME } from '@/features/chats/types';
import { useMessageUi } from '@/features/messages/store';
import { useOnlineStatus } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { myChoice, nextChoice, type OptionResult, pollResults } from '../logic';
import { usePollActions } from '../use-poll-actions';

const PollVotersDialog = lazy(() => import('./PollVotersDialog'));

const LINK = 'rounded text-xs font-semibold underline-offset-2 hover:underline disabled:opacity-50';

function OptionRow(props: {
  option: OptionResult;
  name: string;
  multiple: boolean;
  checked: boolean;
  disabled: boolean;
  outgoing: boolean;
  onChoose: () => void;
  onVoters: () => void;
}) {
  const { t } = useTranslation();
  const { option, checked } = props;
  return (
    <div className="py-1">
      <div className="flex items-center gap-2">
        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
          <input
            type={props.multiple ? 'checkbox' : 'radio'}
            name={props.name}
            checked={checked}
            disabled={props.disabled}
            aria-label={t('polls.optionLabel', {
              text: option.text,
              count: option.count,
              percent: option.percent,
            })}
            onChange={props.onChoose}
            // A radio already chosen fires no change: tapping it again removes the vote.
            onClick={() => (checked && !props.multiple ? props.onChoose() : undefined)}
            className="size-4 shrink-0 accent-brand"
          />
          <span className="min-w-0 flex-1 break-words">{option.text}</span>
        </label>
        <button
          type="button"
          className={cn(LINK, 'tabular-nums')}
          disabled={option.count === 0}
          aria-label={t('polls.seeVoters', { text: option.text, count: option.count })}
          onClick={props.onVoters}
        >
          {option.count}
        </button>
      </div>
      <div
        aria-hidden
        className={cn(
          'mt-1 h-1.5 overflow-hidden rounded-full',
          props.outgoing ? 'bg-black/15' : 'bg-border',
        )}
      >
        <div
          data-testid="poll-bar"
          className={cn(
            'h-full rounded-full transition-[width]',
            props.outgoing ? 'bg-bubble-outgoing-text' : 'bg-brand',
          )}
          style={{ width: `${option.percent}%` }}
        />
      </div>
    </div>
  );
}

const stop = (event: SyntheticEvent) => event.stopPropagation();

/** Dialogs opened from the bubble: their taps are theirs, not the bubble's (portals keep the tree). */
function Island({ children }: { children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: only stops events reaching the bubble
    // biome-ignore lint/a11y/useKeyWithClickEvents: keys stay with the dialog (and its Escape)
    <div className="contents" onClick={stop} onTouchStart={stop} onContextMenu={stop}>
      {children}
    </div>
  );
}

/** A poll in its bubble: live results, my choice, and voting right there. */
export function PollCard({ message }: { message: ChatMessage }) {
  const { t } = useTranslation();
  const name = useId();
  const online = useOnlineStatus();
  const selecting = useMessageUi((state) => state.selecting !== null);
  const { me, vote, close, closing } = usePollActions(message);
  const [voters, setVoters] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const poll = message.poll;
  if (!poll) return null;
  const mine = message.authorId === ME;
  const closed = poll.closedAt !== null;
  const chosen = myChoice(poll, me);
  const results = pollResults(poll);
  const disabled = closed || !online || !message.serverId || selecting;
  const votersOf = poll.options.find((option) => option.id === voters);

  return (
    // Taps on the poll are votes, not the bubble's own clicks (except while selecting messages).
    // biome-ignore lint/a11y/noStaticElementInteractions: only stops clicks reaching the bubble
    // biome-ignore lint/a11y/useKeyWithClickEvents: the inputs inside handle their own keys
    <div
      className="min-w-60 pb-4"
      onClick={(event) => (selecting ? null : event.stopPropagation())}
    >
      <fieldset>
        <legend className="mb-1 flex items-start gap-1.5 font-semibold">
          <BarChart3 className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="break-words">{poll.question}</span>
        </legend>
        <p className="mb-1 flex items-center gap-1 text-xs opacity-80">
          {closed ? <Lock className="size-3" aria-hidden /> : null}
          {closed ? t('polls.closed') : t(poll.multiple ? 'polls.pickSeveral' : 'polls.pickOne')}
          {' · '}
          {t('polls.voters', { count: results.voters })}
        </p>
        {results.options.map((option) => (
          <OptionRow
            key={option.id}
            option={option}
            name={name}
            multiple={poll.multiple}
            checked={chosen.includes(option.id)}
            disabled={disabled}
            outgoing={mine}
            onChoose={() => void vote((current) => nextChoice(current, me, option.id))}
            onVoters={() => setVoters(option.id)}
          />
        ))}
      </fieldset>
      {!online && !closed ? (
        <p role="status" className="mt-1 text-xs opacity-80">
          {t('polls.offline')}
        </p>
      ) : null}
      <div className="mt-1 flex gap-3">
        {chosen.length > 0 && !disabled ? (
          <button type="button" className={LINK} onClick={() => void vote(() => [])}>
            {t('polls.removeVote')}
          </button>
        ) : null}
        {mine && !closed && message.serverId ? (
          <button
            type="button"
            className={LINK}
            disabled={!online || closing}
            onClick={() => setConfirming(true)}
          >
            {t('polls.close')}
          </button>
        ) : null}
      </div>
      <Island>
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={t('polls.closeTitle')}
          description={t('polls.closeHint')}
          confirmLabel={t('polls.close')}
          pending={closing}
          onConfirm={() => {
            setConfirming(false);
            void close();
          }}
        />
        {votersOf ? (
          <Suspense fallback={null}>
            <PollVotersDialog
              chatId={message.chatId}
              option={votersOf}
              onClose={() => setVoters(null)}
            />
          </Suspense>
        ) : null}
      </Island>
    </div>
  );
}
