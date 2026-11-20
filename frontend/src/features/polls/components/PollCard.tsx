import { BarChart3, Lock } from 'lucide-react';
import { lazy, type ReactNode, Suspense, type SyntheticEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/ui/dialog';
import { useChat } from '@/features/chats/queries';
import { type ChatMessage, ME } from '@/features/chats/types';
import { useMessageUi } from '@/features/messages/store';
import { cn } from '@/lib/utils';
import { myChoice, nextChoice, pollResults } from '../logic';
import { usePollActions } from '../use-poll-actions';
import { usePollPeople } from '../use-poll-people';
import { PollOptionRow } from './PollOptionRow';

const PollVotesSheet = lazy(() => import('./PollVotesSheet'));

const LINK = 'rounded text-xs font-semibold underline-offset-2 hover:underline disabled:opacity-50';

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

/** Its sender, or an admin of the group, may close a poll. */
function useMayClose(message: ChatMessage): boolean {
  const chat = useChat(message.chatId);
  const role = chat?.group?.myRole;
  return message.authorId === ME || role === 'admin' || role === 'owner';
}

/**
 * A poll in its bubble: a round mark per option (✓ for mine), who voted (up to three faces) and how
 * many, a bar with a visible track even at 0, and "View votes" for the full list. Votes work offline:
 * they wait in the outbox and go when the connection is back.
 */
export function PollCard({ message }: { message: ChatMessage }) {
  const { t } = useTranslation();
  const name = useId();
  const selecting = useMessageUi((state) => state.selecting !== null);
  const { me, vote, close, closing } = usePollActions(message);
  const person = usePollPeople(message.chatId);
  const mayClose = useMayClose(message);
  const [viewing, setViewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const poll = message.poll;
  if (!poll) return null;
  const closed = poll.closedAt !== null;
  const chosen = myChoice(poll, me);
  const results = pollResults(poll);
  const disabled = closed || !message.serverId || selecting;
  const outgoing = message.authorId === ME;

  return (
    // Taps on the poll are votes, not the bubble's own clicks (except while selecting messages).
    // biome-ignore lint/a11y/noStaticElementInteractions: only stops clicks reaching the bubble
    // biome-ignore lint/a11y/useKeyWithClickEvents: the inputs inside handle their own keys
    <div
      className="w-72 max-w-full pb-4"
      onClick={(event) => (selecting ? null : event.stopPropagation())}
    >
      <fieldset>
        <legend className="mb-1 flex items-start gap-1.5 font-semibold">
          <BarChart3 className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="break-words">{poll.question}</span>
        </legend>
        <p className="mb-1 flex items-center gap-1 text-xs opacity-90">
          {closed ? <Lock className="size-3" aria-hidden /> : null}
          {closed ? t('polls.closed') : t(poll.multiple ? 'polls.pickSeveral' : 'polls.pickOne')}
        </p>
        {results.options.map((option, index) => (
          <PollOptionRow
            key={option.id}
            option={{ ...option, voterIds: poll.options[index]?.voterIds ?? [] }}
            name={name}
            multiple={poll.multiple}
            checked={chosen.includes(option.id)}
            disabled={disabled}
            outgoing={outgoing}
            person={person}
            onChoose={() => void vote((current) => nextChoice(current, me, option.id))}
          />
        ))}
      </fieldset>
      <div
        className={cn(
          'mt-2 border-t pt-2',
          outgoing ? 'border-bubble-outgoing-text/25' : 'border-border',
        )}
      >
        <button
          type="button"
          className="w-full rounded py-1 text-center text-sm font-semibold hover:underline"
          onClick={() => setViewing(true)}
        >
          {t('polls.viewVotes')}
          <span className="sr-only">, {t('polls.voters', { count: results.voters })}</span>
        </button>
        <p className="text-center text-xs opacity-90">
          {t('polls.voters', { count: results.voters })}
        </p>
      </div>
      <div className="mt-1 flex justify-center gap-4">
        {chosen.length > 0 && !disabled ? (
          <button type="button" className={LINK} onClick={() => void vote(() => [])}>
            {t('polls.removeVote')}
          </button>
        ) : null}
        {mayClose && !closed && message.serverId ? (
          <button
            type="button"
            className={LINK}
            disabled={closing}
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
        {viewing ? (
          <Suspense fallback={null}>
            <PollVotesSheet
              chatId={message.chatId}
              poll={poll}
              me={me}
              onClose={() => setViewing(false)}
            />
          </Suspense>
        ) : null}
      </Island>
    </div>
  );
}
