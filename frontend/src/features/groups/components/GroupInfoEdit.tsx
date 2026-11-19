import { useMutation } from '@tanstack/react-query';
import type { GroupInfo, GroupSettings } from '@zuvo/protocol';
import { Check, Pencil } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { authErrorMessage } from '@/features/auth/errors';
import { useLocalDb } from '@/features/chats/queries';
import { applyChats } from '@/features/sync/apply';
import { groupsApi } from '../api';

/** Saves the answer straight away, so this screen and the chat list change at once. */
export function useChange(chatId: string) {
  const { t } = useTranslation();
  const db = useLocalDb();
  return useMutation({
    mutationFn: (work: () => ReturnType<typeof groupsApi.leave>) => work(),
    onSuccess: async (chat) => {
      if (db) await applyChats(db, [chat]);
    },
    onError: (error) => toast.error(authErrorMessage(error, t)),
    mutationKey: ['group-change', chatId],
  });
}

export function EditableText(props: {
  value: string;
  placeholder: string;
  label: string;
  maxLength: number;
  canEdit: boolean;
  onSave: (value: string) => void;
  required?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const { value, placeholder, label, maxLength, canEdit, onSave, required, className } = props;
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null) {
    return (
      <div className="flex items-center justify-center gap-1">
        <p className={className}>{value || placeholder}</p>
        {canEdit ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('groups.edit', { what: label })}
            onClick={() => setDraft(value)}
          >
            <Pencil className="size-3.5" />
          </Button>
        ) : null}
      </div>
    );
  }
  const save = () => {
    const next = draft.trim();
    setDraft(null);
    if (next !== value && (next || !required)) onSave(next);
  };
  return (
    <form
      className="flex w-full items-center gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <input
        aria-label={label}
        value={draft}
        maxLength={maxLength}
        onChange={(event) => setDraft(event.target.value)}
        // biome-ignore lint/a11y/noAutofocus: the person just asked to edit this
        autoFocus
        className="min-w-0 flex-1 rounded-lg border bg-surface px-2 py-1 text-sm"
      />
      <Button type="submit" variant="ghost" size="icon-sm" aria-label={t('groups.save')}>
        <Check className="size-4" />
      </Button>
    </form>
  );
}

const SETTING_KEYS = [
  'editInfo',
  'sendMessages',
  'addMembers',
  'pinMessages',
  'disappearing',
] as const;

export function GroupSettingsSection(props: { chatId: string; group: GroupInfo }) {
  const { t } = useTranslation();
  const { chatId, group } = props;
  const change = useChange(chatId);
  return (
    <section aria-label={t('groups.settingsTitle')} className="space-y-2 px-4 py-3">
      <h3 className="text-sm font-semibold">{t('groups.settingsTitle')}</h3>
      {SETTING_KEYS.map((key) => (
        <label key={key} className="flex items-center justify-between gap-2 text-sm">
          {key === 'disappearing' ? t('disappearing.title') : t(`groups.settings.${key}`)}
          <select
            value={group.settings[key]}
            onChange={(event) => {
              // Read now: a controlled select goes back to its old value until the answer arrives.
              const value = event.target.value as GroupSettings[typeof key];
              change.mutate(() => groupsApi.updateSettings(chatId, { [key]: value }));
            }}
            className="rounded-lg border bg-surface px-2 py-1 text-sm"
          >
            <option value="all">{t('groups.settings.all')}</option>
            <option value="admins">{t('groups.settings.admins')}</option>
          </select>
        </label>
      ))}
      <label className="flex items-center justify-between gap-2 text-sm">
        {t('groups.settings.mentionEveryone')}
        <select
          value={group.settings.mentionEveryone}
          onChange={(event) => {
            const value = event.target.value as GroupSettings['mentionEveryone'];
            change.mutate(() => groupsApi.updateSettings(chatId, { mentionEveryone: value }));
          }}
          className="rounded-lg border bg-surface px-2 py-1 text-sm"
        >
          <option value="admins">{t('groups.settings.admins')}</option>
          <option value="off">{t('groups.settings.nobody')}</option>
        </select>
      </label>
    </section>
  );
}
