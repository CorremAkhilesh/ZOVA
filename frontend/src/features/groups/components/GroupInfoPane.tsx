import { useMutation } from '@tanstack/react-query';
import {
  AVATAR_MIME_TYPES,
  GROUP_DESCRIPTION_MAX,
  GROUP_NAME_MAX,
  type GroupInfo,
  type GroupSettings,
} from '@zuvo/protocol';
import { Camera, Check, LogOut, Pencil } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { authErrorMessage } from '@/features/auth/errors';
import { useSession } from '@/features/auth/session';
import { ChatAvatar } from '@/features/chats/components/ChatAvatar';
import { useLocalDb } from '@/features/chats/queries';
import type { ChatSummary } from '@/features/chats/types';
import { ChatGallery } from '@/features/media/components/ChatGallery';
import { applyChats } from '@/features/sync/apply';
import type { ChatRow } from '@/features/sync/local-db';
import { groupsApi } from '../api';
import { useGroupMembers } from '../queries';
import { groupAbilities } from '../rules';
import { GroupInviteSection } from './GroupInviteSection';
import { GroupMembersSection } from './GroupMembersSection';

/** Saves the answer straight away, so this screen and the chat list change at once. */
function useChange(chatId: string) {
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

function EditableText(props: {
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

const SETTING_KEYS = ['editInfo', 'sendMessages', 'addMembers', 'pinMessages'] as const;

function GroupSettingsSection(props: { chatId: string; group: GroupInfo }) {
  const { t } = useTranslation();
  const { chatId, group } = props;
  const change = useChange(chatId);
  return (
    <section aria-label={t('groups.settingsTitle')} className="space-y-2 px-4 py-3">
      <h3 className="text-sm font-semibold">{t('groups.settingsTitle')}</h3>
      {SETTING_KEYS.map((key) => (
        <label key={key} className="flex items-center justify-between gap-2 text-sm">
          {t(`groups.settings.${key}`)}
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

function ExitGroup({ chatId }: { chatId: string }) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  const change = useChange(chatId);
  return (
    <div className="px-4 py-3">
      <Button variant="danger-outline" className="w-full" onClick={() => setAsking(true)}>
        <LogOut className="size-4" aria-hidden />
        {t('groups.exit')}
      </Button>
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title={t('groups.exitTitle')}
        description={t('groups.exitBody')}
        confirmLabel={t('groups.exit')}
        danger
        pending={change.isPending}
        onConfirm={() =>
          change.mutate(() => groupsApi.leave(chatId), { onSettled: () => setAsking(false) })
        }
      />
    </div>
  );
}

/** Everything about a group, offering only what this person may do. */
export function GroupInfoBody(props: {
  row: ChatRow;
  chat: ChatSummary;
  onOpenMedia: (mediaId: string) => void;
}) {
  const { t } = useTranslation();
  const { row, chat, onOpenMedia } = props;
  const group = row.group as GroupInfo;
  const abilities = groupAbilities(group);
  const me = useSession()?.user.id ?? '';
  const members = useGroupMembers(row);
  const change = useChange(row.id);
  return (
    <div className="min-h-0 flex-1 divide-y overflow-y-auto">
      <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
        <div className="relative">
          <ChatAvatar chat={chat} className="size-24 text-2xl" />
          {abilities.editInfo ? (
            <label className="absolute right-0 bottom-0 flex size-8 cursor-pointer items-center justify-center rounded-full bg-brand text-brand-foreground">
              <Camera className="size-4" aria-hidden />
              <span className="sr-only">{t('groups.changePhoto')}</span>
              <input
                type="file"
                accept={AVATAR_MIME_TYPES.join(',')}
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) change.mutate(() => groupsApi.setPhoto(row.id, file));
                }}
              />
            </label>
          ) : null}
        </div>
        <EditableText
          value={group.name}
          placeholder=""
          label={t('groups.name')}
          maxLength={GROUP_NAME_MAX}
          canEdit={abilities.editInfo}
          required
          className="text-lg font-semibold"
          onSave={(name) => change.mutate(() => groupsApi.update(row.id, { name }))}
        />
        <EditableText
          value={group.description}
          placeholder={abilities.editInfo ? t('groups.addDescription') : ''}
          label={t('groups.description')}
          maxLength={GROUP_DESCRIPTION_MAX}
          canEdit={abilities.editInfo}
          className="text-sm text-text-muted"
          onSave={(description) => change.mutate(() => groupsApi.update(row.id, { description }))}
        />
      </div>
      {group.active ? (
        <GroupMembersSection chatId={row.id} group={group} members={members} me={me} />
      ) : null}
      {abilities.manage ? <GroupInviteSection chatId={row.id} /> : null}
      {abilities.manage ? <GroupSettingsSection chatId={row.id} group={group} /> : null}
      <div className="flex h-72 flex-col">
        <ChatGallery chatId={row.id} onOpen={onOpenMedia} />
      </div>
      {group.active ? <ExitGroup chatId={row.id} /> : null}
    </div>
  );
}
