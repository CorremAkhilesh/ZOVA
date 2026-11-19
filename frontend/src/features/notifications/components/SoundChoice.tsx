import { brand } from '@zuvo/config';
import { Play } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { playSound, unlockAudio } from '../sound';
import type { SoundName } from '../sounds/synth';

/** A sound's name in the language of the app ("off" is "Off"). */
export function useSoundLabel() {
  const { t } = useTranslation();
  return (name: string) => t(`notifications.sounds.names.${name}`, { brand: brand.name });
}

/**
 * One kind of sound (new message, mention, sent, chat on screen): pick one, each with a play button.
 * The choice shows at once; the saved setting catches up (and wins if the save is refused).
 */
export function SoundChoice<T extends string>(props: {
  legend: string;
  options: readonly T[];
  value: T;
  volume: number;
  disabled: boolean;
  onPick: (value: T) => void;
}) {
  const label = useSoundLabel();
  const { t } = useTranslation();
  const name = useId();
  const [picked, setPicked] = useState(props.value);
  useEffect(() => setPicked(props.value), [props.value]);
  const preview = (sound: T) => {
    if (sound === 'off') return;
    const id = sound as unknown as SoundName;
    unlockAudio([id]);
    playSound(id, Math.max(props.volume, 20));
  };
  return (
    <fieldset disabled={props.disabled} className={cn('space-y-2', props.disabled && 'opacity-60')}>
      <legend className="mb-2 font-medium">{props.legend}</legend>
      {props.options.map((option) => (
        <div key={option} className="flex items-center gap-3 rounded-xl border px-3 py-2">
          <label className="flex flex-1 cursor-pointer items-center gap-3">
            <input
              type="radio"
              name={name}
              value={option}
              checked={picked === option}
              onChange={() => {
                setPicked(option);
                props.onPick(option);
                preview(option);
              }}
              className="size-4 accent-brand"
            />
            <span>{label(option)}</span>
          </label>
          {option === 'off' ? null : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t('notifications.sounds.preview', { tone: label(option) })}
              onClick={() => preview(option)}
            >
              <Play className="size-4" aria-hidden />
            </Button>
          )}
        </div>
      ))}
    </fieldset>
  );
}
