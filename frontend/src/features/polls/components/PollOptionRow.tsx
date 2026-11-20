import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import type { OptionResult } from '../logic';
import type { PollPerson } from '../use-poll-people';

/** At most this many faces next to an option; the count says the rest. */
export const FACES = 3;

/** Colours for my own (brand) bubble and for everyone else's, so both read well (AA). */
export const POLL_TONES = {
  outgoing: {
    track: 'bg-bubble-outgoing-text/25',
    fill: 'bg-bubble-outgoing-text/70',
    mine: 'bg-bubble-outgoing-text',
    ring: 'ring-bubble-outgoing',
    chosen: 'border-bubble-outgoing-text bg-bubble-outgoing-text text-bubble-outgoing',
  },
  incoming: {
    track: 'bg-text-muted/25',
    fill: 'bg-brand/60',
    mine: 'bg-brand',
    ring: 'ring-bubble-incoming',
    chosen: 'border-brand bg-brand text-brand-foreground',
  },
} as const;

export function PollOptionRow(props: {
  option: OptionResult & { voterIds: string[] };
  name: string;
  multiple: boolean;
  checked: boolean;
  disabled: boolean;
  outgoing: boolean;
  person: (id: string) => PollPerson;
  onChoose: () => void;
}) {
  const { t } = useTranslation();
  const { option, checked } = props;
  const tone = props.outgoing ? POLL_TONES.outgoing : POLL_TONES.incoming;
  const faces = option.voterIds.slice(0, FACES).map(props.person);
  return (
    <label
      className={cn(
        'block cursor-pointer rounded-lg px-1 py-1.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-current',
        props.disabled && 'cursor-default',
      )}
    >
      <span className="flex items-center gap-2.5">
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
          className="peer sr-only"
        />
        {/* The round mark: a ✓ in a filled circle when it is my choice. */}
        <span
          aria-hidden
          data-testid="poll-mark"
          className={cn(
            'grid size-5 shrink-0 place-items-center rounded-full border-2',
            checked ? tone.chosen : 'border-current opacity-80',
          )}
        >
          {checked ? <Check className="size-3.5" strokeWidth={3} /> : null}
        </span>
        <span className={cn('min-w-0 flex-1 break-words', checked && 'font-semibold')}>
          {option.text}
        </span>
        {faces.length > 0 ? (
          <span aria-hidden data-testid="poll-faces" className="flex -space-x-1.5">
            {faces.map((face) => (
              <Avatar
                key={face.id}
                name={face.name}
                src={face.avatar}
                className={cn('size-5 text-[0.55rem] ring-2', tone.ring)}
              />
            ))}
          </span>
        ) : null}
        <span aria-hidden className="min-w-4 text-right text-sm tabular-nums">
          {option.count}
        </span>
      </span>
      {/* A track even at 0 votes; my choice in full colour. */}
      <span
        aria-hidden
        className={cn('mt-1.5 ml-7.5 block h-1.5 overflow-hidden rounded-full', tone.track)}
      >
        <span
          data-testid="poll-bar"
          className={cn(
            'block h-full rounded-full transition-[width]',
            checked ? tone.mine : tone.fill,
          )}
          style={{ width: `${option.percent}%` }}
        />
      </span>
    </label>
  );
}
