import {
  AVATAR_MIME_TYPES,
  GROUP_DESCRIPTION_MAX,
  GROUP_NAME_MAX,
  type GroupInfo,
} from '@zuvo/protocol';
import { ArrowLeft, Camera, LogOut } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { useSession } from '@/features/auth/session';
import { ChatAvatar } from '@/features/chats/components/ChatAvatar';
import type { ChatSummary } from '@/features/chats/types';
import { DisappearingRow } from '@/features/disappearing/DisappearingRow';
import { ChatGallery } from '@/features/media/components/ChatGallery';
import type { ChatRow } from '@/features/sync/local-db';
import { groupsApi } from '../api';
import { useGroupMembers } from '../queries';
import { groupAbilities } from '../rules';
import { EditableText, GroupSettingsSection, useChange } from './GroupInfoEdit';
import {
  InfoActions,
  InfoCard,
  InfoRow,
  InfoShortcuts,
  MediaSummary,
  ReportGroupRow,
} from './GroupInfoParts';
import { GroupInviteSection } from './GroupInviteSection';
import { GroupMembersSection } from './GroupMembersSection';

function ExitGroup({ chatId }: { chatId: string }) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  const change = useChange(chatId);
  return (
    <>
      <InfoRow icon={LogOut} label={t('groups.exit')} danger onClick={() => setAsking(true)} />
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
    </>
  );
}

/** The full "Media, links and docs", with a way back. */
function GalleryView(props: {
  chatId: string;
  onBack: () => void;
  onOpenMedia: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 py-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('conversation.back')}
          onClick={props.onBack}
        >
          <ArrowLeft className="size-5" aria-hidden />
        </Button>
        <h3 className="font-semibold">{t('info.mediaLinksDocs')}</h3>
      </div>
      <ChatGallery chatId={props.chatId} onOpen={props.onOpenMedia} />
    </div>
  );
}

/**
 * Everything about a group, offering only what this person may do: photo and name, "Group · N
 * members", Add and Search, the description, media, starred and mute, disappearing messages, the
 * members, invite link and settings (admins), then Exit and Report in red.
 */
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
  const [adding, setAdding] = useState(false);
  const [gallery, setGallery] = useState(false);
  if (gallery) {
    return (
      <GalleryView chatId={row.id} onBack={() => setGallery(false)} onOpenMedia={onOpenMedia} />
    );
  }
  return (
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-background">
      <InfoCard className="flex flex-col items-center gap-2 px-4 pt-6 pb-4 text-center">
        <div className="relative">
          <ChatAvatar chat={chat} className="size-32 text-3xl md:size-40" />
          {abilities.editInfo ? (
            <label className="absolute right-1 bottom-1 flex size-10 cursor-pointer items-center justify-center rounded-full bg-brand text-brand-foreground shadow">
              <Camera className="size-5" aria-hidden />
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
          className="text-xl font-semibold"
          onSave={(name) => change.mutate(() => groupsApi.update(row.id, { name }))}
        />
        <p className="text-sm text-text-muted">
          {t('info.groupMembers', { count: group.memberCount })}
        </p>
        {group.active ? (
          <div className="pt-2">
            <InfoActions
              chatId={row.id}
              canAdd={abilities.addMembers}
              onAdd={() => setAdding(true)}
            />
          </div>
        ) : null}
      </InfoCard>
      <InfoCard className="px-5 py-3">
        <EditableText
          value={group.description}
          placeholder={abilities.editInfo ? t('groups.addDescription') : t('info.noDescription')}
          label={t('groups.description')}
          maxLength={GROUP_DESCRIPTION_MAX}
          canEdit={abilities.editInfo}
          className="text-sm text-text-muted"
          onSave={(description) => change.mutate(() => groupsApi.update(row.id, { description }))}
        />
      </InfoCard>
      <MediaSummary
        chatId={row.id}
        onOpenGallery={() => setGallery(true)}
        onOpenMedia={onOpenMedia}
      />
      <InfoShortcuts chatId={row.id} muted={chat.muted} />
      {group.active ? (
        <InfoCard>
          <DisappearingRow chat={row} />
        </InfoCard>
      ) : null}
      {group.active ? (
        <InfoCard>
          <GroupMembersSection
            chatId={row.id}
            group={group}
            members={members}
            me={me}
            adding={adding}
            onAdding={setAdding}
          />
        </InfoCard>
      ) : null}
      {abilities.manage ? (
        <InfoCard>
          <GroupInviteSection chatId={row.id} />
        </InfoCard>
      ) : null}
      {abilities.manage ? (
        <InfoCard>
          <GroupSettingsSection chatId={row.id} group={group} />
        </InfoCard>
      ) : null}
      <InfoCard className="mb-6">
        {group.active ? <ExitGroup chatId={row.id} /> : null}
        <ReportGroupRow chatId={row.id} name={group.name} />
      </InfoCard>
    </div>
  );
}
