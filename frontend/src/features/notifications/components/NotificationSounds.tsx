import { brand } from '@zuvo/config';
import {
  MESSAGE_TONES,
  type MessageTone,
  type PushSettings,
  type UpdatePushSettings,
} from '@zuvo/protocol';
import { Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Switch } from '@/features/quiet-hours/components/Switch';
import { SettingsSection } from '@/features/settings/SettingsPage';
import { cn } from '@/lib/utils';
import { playSound, unlockAudio } from '../sound';

/** The slider saves this long after it stops moving: one request, not one per step. */
const VOLUME_SAVE_MS = 400;

const KINDS = ['soundMessages', 'soundMentions', 'soundSent', 'soundOpenChat'] as const;

function Volume({
  value,
  disabled,
  onSave,
}: {
  value: number;
  disabled: boolean;
  onSave: (volume: number) => void;
}) {
  const { t } = useTranslation();
  const [volume, setVolume] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => setVolume(value), [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const change = (next: number) => {
    setVolume(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onSave(next), VOLUME_SAVE_MS);
  };
  return (
    <label className={cn('block', disabled && 'opacity-60')}>
      <span className="flex items-center justify-between font-medium">
        {t('notifications.sounds.volume')}
        <span className="text-sm text-text-muted tabular-nums">{volume}%</span>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={volume}
        disabled={disabled}
        onChange={(event) => change(Number(event.target.value))}
        className="mt-2 w-full accent-brand"
      />
    </label>
  );
}

function Tones({
  settings,
  disabled,
  onPick,
}: {
  settings: PushSettings;
  disabled: boolean;
  onPick: (tone: MessageTone) => void;
}) {
  const { t } = useTranslation();
  const preview = (tone: MessageTone) => {
    unlockAudio();
    playSound(tone, Math.max(settings.soundVolume, 20));
  };
  return (
    <fieldset disabled={disabled} className={cn('space-y-2', disabled && 'opacity-60')}>
      <legend className="mb-2 font-medium">{t('notifications.sounds.tone')}</legend>
      {MESSAGE_TONES.map((tone) => (
        <div key={tone} className="flex items-center gap-3 rounded-xl border px-3 py-2">
          <label className="flex flex-1 cursor-pointer items-center gap-3">
            <input
              type="radio"
              name="message-tone"
              value={tone}
              checked={settings.tone === tone}
              onChange={() => {
                onPick(tone);
                preview(tone);
              }}
              className="size-4 accent-brand"
            />
            <span>{t(`notifications.sounds.tones.${tone}`, { brand: brand.name })}</span>
          </label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t('notifications.sounds.preview', {
              tone: t(`notifications.sounds.tones.${tone}`, { brand: brand.name }),
            })}
            onClick={() => preview(tone)}
          >
            <Play className="size-4" aria-hidden />
          </Button>
        </div>
      ))}
    </fieldset>
  );
}

/** Settings → Notifications → Sounds: on/off, volume, the message tone, and each kind on its own. */
export function NotificationSounds({
  settings,
  onSave,
}: {
  settings: PushSettings;
  onSave: (changes: UpdatePushSettings) => void;
}) {
  const { t } = useTranslation();
  const off = !settings.sound;
  return (
    <SettingsSection title={t('notifications.sounds.title')}>
      <Switch
        label={t('notifications.settings.sound')}
        hint={t('notifications.settings.soundHint')}
        checked={settings.sound}
        onChange={(sound) => onSave({ sound })}
      />
      <Volume
        value={settings.soundVolume}
        disabled={off}
        onSave={(soundVolume) => onSave({ soundVolume })}
      />
      <Tones settings={settings} disabled={off} onPick={(tone) => onSave({ tone })} />
      {KINDS.map((kind) => (
        <Switch
          key={kind}
          label={t(`notifications.sounds.${kind}`)}
          hint={t(`notifications.sounds.${kind}Hint`)}
          checked={settings[kind]}
          disabled={off}
          onChange={(on) => onSave({ [kind]: on })}
        />
      ))}
    </SettingsSection>
  );
}
