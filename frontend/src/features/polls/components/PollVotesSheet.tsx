import type { Poll } from '@zuvo/protocol';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, FULL_SCREEN_ON_PHONE } from '@/components/ui/dialog';
import { pollResults } from '../logic';
import { usePollPeople } from '../use-poll-people';

/** Voters shown per option before "Show all". */
export const SHOWN = 5;

function votedTime(iso: string | undefined, language: string): string {
  if (!iso) return '';
  const at = new Date(iso);
  const today = new Date().toDateString() === at.toDateString();
  return new Intl.DateTimeFormat(language, {
    ...(today ? {} : { day: 'numeric', month: 'short' }),
    hour: 'numeric',
    minute: '2-digit',
  }).format(at);
}

function OptionVotes(props: {
  text: string;
  voterIds: string[];
  votedAt: Record<string, string>;
  mine: boolean;
  person: ReturnType<typeof usePollPeople>;
}) {
  const { t, i18n } = useTranslation();
  const [all, setAll] = useState(false);
  // Newest vote first, like the chat shows the newest message last.
  const ordered = [...props.voterIds].sort(
    (a, b) => Date.parse(props.votedAt[b] ?? '') - Date.parse(props.votedAt[a] ?? '') || 0,
  );
  const shown = all ? ordered : ordered.slice(0, SHOWN);
  return (
    <section className="border-b py-3 last:border-b-0">
      <h3 className="flex items-center gap-2 font-semibold">
        <span className="min-w-0 flex-1 break-words">{props.text}</span>
        {props.mine ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-text">
            <Check className="size-3.5" aria-hidden />
            {t('polls.yourVote')}
          </span>
        ) : null}
        <span className="text-sm font-normal text-text-muted tabular-nums">
          {t('polls.votes', { count: props.voterIds.length })}
        </span>
      </h3>
      {props.voterIds.length === 0 ? (
        <p className="mt-1 text-sm text-text-muted">{t('polls.noVotes')}</p>
      ) : (
        <ul className="mt-1" aria-label={t('polls.votersFor', { text: props.text })}>
          {shown.map((id) => {
            const person = props.person(id);
            return (
              <li key={id} className="flex items-center gap-3 py-1.5">
                <Avatar name={person.name} src={person.avatar} className="size-9 text-xs" />
                <span className="min-w-0 flex-1 truncate font-medium">{person.name}</span>
                <time
                  dateTime={props.votedAt[id]}
                  className="shrink-0 text-xs text-text-muted tabular-nums"
                >
                  {votedTime(props.votedAt[id], i18n.language)}
                </time>
              </li>
            );
          })}
        </ul>
      )}
      {!all && ordered.length > SHOWN ? (
        <Button variant="ghost" size="sm" className="mt-1" onClick={() => setAll(true)}>
          {t('polls.showAll', { count: ordered.length })}
        </Button>
      ) : null}
    </section>
  );
}

/** "View votes": the question, then each option with its count and who voted, and when. */
export default function PollVotesSheet(props: {
  chatId: string;
  poll: Poll;
  me: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const person = usePollPeople(props.chatId);
  const { voters } = pollResults(props.poll);
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent
        title={props.poll.question}
        description={t('polls.voters', { count: voters })}
        className={`max-w-md ${FULL_SCREEN_ON_PHONE}`}
      >
        <div className="-mx-1 max-h-[65vh] overflow-y-auto px-1">
          {props.poll.options.map((option) => (
            <OptionVotes
              key={option.id}
              text={option.text}
              voterIds={option.voterIds}
              votedAt={props.poll.votedAt ?? {}}
              mine={option.voterIds.includes(props.me)}
              person={person}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
