import type { PublicProfile } from '@zuvo/protocol';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

interface PeopleResultsProps {
  listId: string;
  optionId: (index: number) => string;
  options: PublicProfile[];
  active: number;
  heading: string;
  state: 'loading' | 'error' | 'ready';
  hasQuery: boolean;
  onActivate: (index: number) => void;
  onChoose: (person: PublicProfile) => void;
}

/** The picker's result list. Focus stays in the search box (aria-activedescendant). */
export function PeopleResults(props: PeopleResultsProps) {
  const { t } = useTranslation();
  const { options, active } = props;

  if (props.state === 'loading' && options.length === 0) {
    return (
      <p className="flex items-center gap-2 p-3 text-sm text-text-muted">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {t('people.searching')}
      </p>
    );
  }
  if (props.state === 'error') {
    return (
      <p role="alert" className="p-3 text-sm text-danger">
        {t('people.failed')}
      </p>
    );
  }
  if (options.length === 0) {
    return (
      <p className="p-3 text-sm text-text-muted">
        {props.hasQuery ? t('people.noResults') : t('people.empty')}
      </p>
    );
  }

  return (
    <>
      <p className="px-3 pb-1 text-xs font-semibold tracking-wide text-text-muted uppercase">
        {props.heading}
      </p>
      <div id={props.listId} role="listbox" aria-label={props.heading} className="space-y-0.5">
        {options.map((person, index) => (
          // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard is handled by the combobox input
          <div
            key={person.id}
            id={props.optionId(index)}
            role="option"
            tabIndex={-1}
            aria-selected={index === active}
            onMouseEnter={() => props.onActivate(index)}
            onClick={() => props.onChoose(person)}
            className={cn(
              'flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2',
              index === active && 'bg-brand-subtle',
            )}
          >
            <Avatar name={person.displayName} src={person.avatar?.small} className="size-10" />
            <span className="min-w-0">
              <span className="block truncate font-medium">{person.displayName}</span>
              <span className="block truncate text-sm text-text-muted">
                {person.username ? `@${person.username}` : (person.about ?? '')}
              </span>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
