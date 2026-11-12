import { useTranslation } from 'react-i18next';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { OnceIcon } from './OnceIcon';

/** The "1" in the send sheet: off until pressed. Pressed, it also says what it cannot prevent. */
export function ViewOnceToggle(props: {
  pressed: boolean;
  onPressedChange: (on: boolean) => void;
}) {
  const { t } = useTranslation();
  const { pressed, onPressedChange } = props;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tooltip label={t('viewOnce.toggleHint')} side="top">
        <button
          type="button"
          aria-pressed={pressed}
          aria-label={t('viewOnce.toggle')}
          onClick={() => onPressedChange(!pressed)}
          className={cn(
            'flex items-center gap-2 rounded-full border px-2 py-1 text-sm transition-colors',
            pressed ? 'border-brand bg-brand-subtle text-brand-text' : 'text-text-muted',
          )}
        >
          <OnceIcon className="size-6 text-xs" />
          <span aria-hidden>{t('viewOnce.toggle')}</span>
        </button>
      </Tooltip>
      {pressed ? <p className="text-xs text-text-muted">{t('viewOnce.screenshotNote')}</p> : null}
    </div>
  );
}
