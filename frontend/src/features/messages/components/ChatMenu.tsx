import { Link, useMatchRoute, useNavigate } from '@tanstack/react-router';
import { type ChatPrefs, PINNED_CHATS_MAX } from '@zuvo/protocol';
import {
  Archive,
  ArchiveRestore,
  Bell,
  BellOff,
  Eraser,
  Eye,
  EyeOff,
  type LucideIcon,
  Pin,
  PinOff,
  Star,
  Trash2,
} from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { WallpaperMenuEntry } from '@/features/appearance/components/WallpaperMenuEntry';
import { useChats } from '@/features/chats/queries';
import type { ChatSummary } from '@/features/chats/types';
import { FolderMenuEntries } from '@/features/folders/components/FolderMenuEntries';
import { LockMenuEntry } from '@/features/lock/components/LockMenuEntry';
import { ModerationEntries } from '@/features/moderation/components/ModerationEntries';
import { useSyncStore } from '@/features/sync/store';
import { useBackClose } from '@/lib/back-stack';
import { type ChatMenuRequest, useMessageUi } from '../store';

const ITEM =
  'flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm outline-none data-[highlighted]:bg-background';
const MUTES = ['8h', '1w', 'always'] as const;

function Entry(props: { icon: LucideIcon; label: string; onSelect: () => void; danger?: boolean }) {
  const Icon = props.icon;
  return (
    <DropdownMenu.Item
      className={props.danger ? `${ITEM} text-danger` : ITEM}
      onSelect={props.onSelect}
    >
      <Icon className="size-4" aria-hidden />
      {props.label}
    </DropdownMenu.Item>
  );
}

function ConfirmDialog(props: {
  title: string;
  confirm: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent title={props.title} className="max-w-sm">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={props.onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={props.onConfirm}>
            {props.confirm}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function useChatCommands() {
  const { t } = useTranslation();
  const rows = useChats();
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();
  const client = useSyncStore((state) => state.client);
  const seqOf = (chat: ChatSummary) => rows?.find((row) => row.id === chat.id)?.seq ?? 0;
  const prefs = (chat: ChatSummary, change: ChatPrefs) =>
    void client?.act({ type: 'prefs', chatId: chat.id, prefs: change });
  const leaveIfOpen = (chat: ChatSummary) => {
    if (matchRoute({ to: '/chats/$chatId', params: { chatId: chat.id } })) {
      void navigate({ to: '/chats' });
    }
  };
  return {
    prefs,
    pin(chat: ChatSummary) {
      const pinned = rows?.filter((row) => row.pinned).length ?? 0;
      if (!chat.pinned && pinned >= PINNED_CHATS_MAX) {
        toast.error(t('messages.pinLimit', { max: PINNED_CHATS_MAX }));
        return;
      }
      prefs(chat, { pinned: !chat.pinned });
    },
    toggleUnread(chat: ChatSummary) {
      const unread = chat.unread > 0 || chat.markedUnread === true;
      if (unread) void client?.markRead(chat.id, seqOf(chat));
      // Open, it would count as read again straight away.
      else leaveIfOpen(chat);
      prefs(chat, { unread: !unread });
    },
    clear(chat: ChatSummary, removeChat: boolean) {
      void client?.act({ type: 'clear', chatId: chat.id, seq: seqOf(chat), removeChat });
      if (removeChat) leaveIfOpen(chat);
    },
  };
}

function Entries(props: {
  chat: ChatSummary;
  commands: ReturnType<typeof useChatCommands>;
  onConfirm: (remove: boolean) => void;
}) {
  const { t } = useTranslation();
  const { chat, commands, onConfirm } = props;
  const isUnread = chat.unread > 0 || chat.markedUnread === true;
  return (
    <>
      <Entry
        icon={chat.pinned ? PinOff : Pin}
        label={t(chat.pinned ? 'messages.unpin' : 'messages.pin')}
        onSelect={() => commands.pin(chat)}
      />
      {chat.muted ? (
        <Entry
          icon={Bell}
          label={t('messages.unmute')}
          onSelect={() => commands.prefs(chat, { mute: 'off' })}
        />
      ) : (
        MUTES.map((mute) => (
          <Entry
            key={mute}
            icon={BellOff}
            label={t(`messages.mute.${mute}`)}
            onSelect={() => commands.prefs(chat, { mute })}
          />
        ))
      )}
      <Entry
        icon={chat.archived ? ArchiveRestore : Archive}
        label={t(chat.archived ? 'messages.unarchive' : 'messages.archive')}
        onSelect={() => commands.prefs(chat, { archived: !chat.archived })}
      />
      <Entry
        icon={isUnread ? Eye : EyeOff}
        label={t(isUnread ? 'messages.markRead' : 'messages.markUnread')}
        onSelect={() => commands.toggleUnread(chat)}
      />
      <FolderMenuEntries chat={chat} />
      <LockMenuEntry chat={chat} />
      <WallpaperMenuEntry chat={chat} />
      <DropdownMenu.Item asChild className={ITEM}>
        <Link to="/starred" search={{ chatId: chat.id }}>
          <Star className="size-4" aria-hidden />
          {t('messages.starredInChat')}
        </Link>
      </DropdownMenu.Item>
      <Entry
        danger
        icon={Eraser}
        label={t('messages.clearChat')}
        onSelect={() => onConfirm(false)}
      />
      {chat.kind === 'personal' ? (
        <Entry
          danger
          icon={Trash2}
          label={t('messages.deleteChat')}
          onSelect={() => onConfirm(true)}
        />
      ) : null}
      <ModerationEntries chat={chat} />
    </>
  );
}

function OpenMenu(props: {
  request: ChatMenuRequest;
  commands: ReturnType<typeof useChatCommands>;
  onConfirm: (remove: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { request, commands, onConfirm, onClose } = props;
  useBackClose(true, onClose);
  return (
    <DropdownMenu.Root open modal={false} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          className="pointer-events-none fixed size-px opacity-0"
          style={{ left: request.x, top: request.y }}
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          // The trigger is only a place on the screen, so it cannot name the menu.
          aria-labelledby={undefined}
          aria-label={t('messages.chatActions', { name: request.chat.name })}
          collisionPadding={8}
          onCloseAutoFocus={(event) => event.preventDefault()}
          className="z-[1500] w-56 rounded-xl border bg-surface p-1.5 shadow-lg"
        >
          <Entries chat={request.chat} commands={commands} onConfirm={onConfirm} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** What can be done to a chat, for me. One menu for the whole list. */
export function ChatMenu() {
  const { t } = useTranslation();
  const request = useMessageUi((state) => state.chatMenu);
  const set = useMessageUi((state) => state.set);
  const commands = useChatCommands();
  const [confirm, setConfirm] = useState<{ chat: ChatSummary; remove: boolean } | null>(null);
  return (
    <>
      {confirm ? (
        <ConfirmDialog
          title={t(confirm.remove ? 'messages.deleteChatTitle' : 'messages.clearChatTitle', {
            name: confirm.chat.name,
          })}
          confirm={t(confirm.remove ? 'messages.deleteChat' : 'messages.clearChat')}
          onConfirm={() => {
            commands.clear(confirm.chat, confirm.remove);
            setConfirm(null);
          }}
          onClose={() => setConfirm(null)}
        />
      ) : null}
      {request ? (
        <OpenMenu
          request={request}
          commands={commands}
          onConfirm={(remove) => setConfirm({ chat: request.chat, remove })}
          onClose={() => set({ chatMenu: null })}
        />
      ) : null}
    </>
  );
}
