import { ACCENT_NAMES, type AccentName, accents } from '@zuvo/ui-tokens';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/** Six swatches; one is picked. Arrow keys move between them like any radio group. */
export function AccentPicker(props: { value: AccentName; onChange: (accent: AccentName) => void }) {
  const { t } = useTranslation();
  const move = (from: AccentName, by: number) => {
    const index = (ACCENT_NAMES.indexOf(from) + by + ACCENT_NAMES.length) % ACCENT_NAMES.length;
    const next = ACCENT_NAMES[index] as AccentName;
    props.onChange(next);
    document.getElementById(`accent-${next}`)?.focus();
  };
  return (
    <div role="radiogroup" aria-label={t('appearance.accent')} className="flex flex-wrap gap-3">
      {ACCENT_NAMES.map((name) => {
        const selected = name === props.value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: swatches styled as buttons
          <button
            key={name}
            id={`accent-${name}`}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={t(`appearance.accents.${name}`)}
            title={t(`appearance.accents.${name}`)}
            tabIndex={selected ? 0 : -1}
            onClick={() => props.onChange(name)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault();
                move(name, 1);
              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault();
                move(name, -1);
              }
            }}
            className={cn(
              'flex size-10 items-center justify-center rounded-full ring-offset-2 ring-offset-surface transition-shadow',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text',
              selected && 'ring-2 ring-text',
            )}
            style={{ backgroundColor: accents[name].swatch }}
          >
            {selected ? <Check className="size-5 text-white" aria-hidden /> : null}
          </button>
        );
      })}
    </div>
  );
}
