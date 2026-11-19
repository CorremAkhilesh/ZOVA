import {
  MENTION_TONES,
  MESSAGE_TONES,
  type PushSettings,
  SENT_TONES,
  TICK_TONES,
  type UpdatePushSettings,
} from '@zuvo/protocol';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch } from '@/features/quiet-hours/components/Switch';
import { SettingsSection } from '@/features/settings/SettingsPage';
import { cn } from '@/lib/utils';
import { SoundChoice } from './SoundChoice';

/** The slider saves this long after it stops moving: one request, not one per step. */
const VOLUME_SAVE_MS = 400;

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
      <Switch
        label={t('notifications.sounds.soundMessages')}
        hint={t('notifications.sounds.soundMessagesHint')}
        checked={settings.soundMessages}
        disabled={off}
        onChange={(soundMessages) => onSave({ soundMessages })}
      />
      <SoundChoice
        legend={t('notifications.sounds.tone')}
        options={MESSAGE_TONES}
        value={settings.tone}
        volume={settings.soundVolume}
        disabled={off || !settings.soundMessages}
        onPick={(tone) => onSave({ tone })}
      />
      <Switch
        label={t('notifications.sounds.soundMentions')}
        hint={t('notifications.sounds.soundMentionsHint')}
        checked={settings.soundMentions}
        disabled={off}
        onChange={(soundMentions) => onSave({ soundMentions })}
      />
      <SoundChoice
        legend={t('notifications.sounds.mentionTone')}
        options={MENTION_TONES}
        value={settings.mentionTone}
        volume={settings.soundVolume}
        disabled={off || !settings.soundMentions}
        onPick={(mentionTone) => onSave({ mentionTone })}
      />
      <SoundChoice
        legend={t('notifications.sounds.sentTone')}
        options={SENT_TONES}
        value={settings.sentTone}
        volume={settings.soundVolume}
        disabled={off}
        onPick={(sentTone) => onSave({ sentTone })}
      />
      <Switch
        label={t('notifications.sounds.soundOpenChat')}
        hint={t('notifications.sounds.soundOpenChatHint')}
        checked={settings.soundOpenChat}
        disabled={off}
        onChange={(soundOpenChat) => onSave({ soundOpenChat })}
      />
      <SoundChoice
        legend={t('notifications.sounds.tickTone')}
        options={TICK_TONES}
        value={settings.tickTone}
        volume={settings.soundVolume}
        disabled={off || !settings.soundOpenChat}
        onPick={(tickTone) => onSave({ tickTone })}
      />
    </SettingsSection>
  );
}
