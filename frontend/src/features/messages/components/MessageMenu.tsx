import { useNavigate } from '@tanstack/react-router';
import { REACTIONS_QUICK } from '@zuvo/protocol';
import {
  CheckSquare,
  Copy,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  type LucideIcon,
  MessageCircle,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Star,
  Trash2,
} from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useSession } from '@/features/auth/session';
import { chatsApi } from '@/features/chats/api';
import { EMOJI_GROUPS } from '@/features/chats/emoji-data';
import { useLocalDb } from '@/features/chats/queries';
import { type ChatMessage, type ChatSummary, ME } from '@/features/chats/types';

import { applyChats } from '@/features/sync/apply';
import { useSyncStore } from '@/features/sync/store';
import { isPinned, mayPin, reportMessage, togglePin } from '../menu-actions';
import { canEdit, targetOf, toQuote } from '../rules';
import { type MenuRequest, useMessageUi } from '../store';

const ALL_EMOJI = [...new Set(EMOJI_GROUPS.flatMap((group) => group.emojis))];
const ITEM =
  'flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm outline-none data-[highlighted]:bg-background';
const EMOJI =
  'flex size-9 cursor-default items-center justify-center rounded-full text-xl outline-none data-[highlighted]:bg-background';

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

function ReactionBar(props: {
  mine: string | null;
  onPick: (emoji: string) => void;
  onMore: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between border-b pb-1.5">
      {REACTIONS_QUICK.map((emoji) => (
        <DropdownMenu.Item
          key={emoji}
          aria-label={emoji}
          className={props.mine === emoji ? `${EMOJI} bg-brand-subtle` : EMOJI}
          onSelect={() => props.onPick(emoji)}
        >
          {emoji}
        </DropdownMenu.Item>
      ))}
      <DropdownMenu.Item
        aria-label={t('messages.moreEmoji')}
        className={EMOJI}
        onSelect={(event) => {
          event.preventDefault();
          props.onMore();
        }}
      >
        <Plus className="size-4" aria-hidden />
      </DropdownMenu.Item>
    </div>
  );
}

function EmojiGrid({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <div className="grid h-52 grid-cols-7 content-start gap-0.5 overflow-y-auto">
      {ALL_EMOJI.map((emoji) => (
        <DropdownMenu.Item
          key={emoji}
          aria-label={emoji}
          className={EMOJI}
          onSelect={() => onPick(emoji)}
        >
          {emoji}
        </DropdownMenu.Item>
      ))}
    </div>
  );
}

/** What happens when a menu entry is chosen. */
function useMessageCommands(message: ChatMessage, items: ChatMessage[]) {
  const { t } = useTranslation();
  const session = useSession();
  const db = useLocalDb();
  const navigate = useNavigate();
  const ui = useMessageUi.getState;
  const quote = () => toQuote(message, session?.user.id ?? '', session?.user.displayName ?? '');
  return {
    reply() {
      const original = quote();
      if (original) ui().setReply(message.chatId, original);
    },
    async replyPrivately() {
      try {
        const direct = await chatsApi.createDirect(message.authorId);
        if (db) await applyChats(db, [direct]);
        const original = quote();
        if (original) ui().setReply(direct.id, original);
        await navigate({ to: '/chats/$chatId', params: { chatId: direct.id } });
      } catch {
        toast.error(t('messages.failed'));
      }
    },
    copy() {
      void navigator.clipboard
        .writeText(message.text)
        .then(() => toast.success(t('messages.copied')))
        .catch(() => toast.error(t('messages.copyFailed')));
    },
    edit() {
      ui().setEditing({ ...targetOf(message), text: message.text });
    },
    star() {
      const { client } = useSyncStore.getState();
      for (const item of items) {
        void client?.act({ type: 'star', ...targetOf(item), starred: !message.starred });
      }
    },
  };
}

function Entries({ request, chat }: { request: MenuRequest; chat: ChatSummary }) {
  const { t } = useTranslation();
  const { message, items } = request;
  const set = useMessageUi((state) => state.set);
  const commands = useMessageCommands(message, items);
  const live = !message.deleted;
  const pinned = isPinned(chat, message.serverId);
  return (
    <div className="pt-1.5">
      {live ? (
        <Entry icon={CornerUpLeft} label={t('messages.reply')} onSelect={commands.reply} />
      ) : null}
      {live && chat.kind === 'group' && message.authorId !== ME ? (
        <Entry
          icon={MessageCircle}
          label={t('messages.replyPrivately')}
          onSelect={() => void commands.replyPrivately()}
        />
      ) : null}
      {live ? (
        <Entry
          icon={CornerUpRight}
          label={t('messages.forward')}
          onSelect={() => set({ forwarding: items })}
        />
      ) : null}
      {live && message.text ? (
        <Entry icon={Copy} label={t('messages.copy')} onSelect={commands.copy} />
      ) : null}
      {canEdit(message) ? (
        <Entry icon={Pencil} label={t('messages.edit')} onSelect={commands.edit} />
      ) : null}
      {live ? (
        <Entry
          icon={Star}
          label={t(message.starred ? 'messages.unstar' : 'messages.star')}
          onSelect={commands.star}
        />
      ) : null}
      {live && message.serverId && !message.system && mayPin(chat) ? (
        <Entry
          icon={pinned ? PinOff : Pin}
          label={t(pinned ? 'pins.unpin' : 'pins.pin')}
          onSelect={() => togglePin(chat, message.serverId ?? '', pinned)}
        />
      ) : null}
      <Entry
        icon={CheckSquare}
        label={t('messages.select')}
        onSelect={() => useMessageUi.getState().startSelecting(message.chatId, message)}
      />
      <Entry
        danger
        icon={Trash2}
        label={t('messages.delete')}
        onSelect={() => set({ deleting: items })}
      />
      {message.authorId !== ME && !message.system && message.serverId ? (
        <Entry
          danger
          icon={Flag}
          label={t('report.reportMessage')}
          onSelect={() => reportMessage(chat, message)}
        />
      ) : null}
    </div>
  );
}

/** One menu for the whole chat, opened where the pointer or finger was. */
export function MessageMenu({ chat }: { chat: ChatSummary }) {
  const { t } = useTranslation();
  const me = useSession()?.user.id ?? '';
  const request = useMessageUi((state) => state.menu);
  const set = useMessageUi((state) => state.set);
  const [full, setFull] = useState(false);
  if (!request) return null;
  const { message, x, y } = request;
  const mine = message.reactions?.find((reaction) => reaction.userId === me)?.emoji ?? null;

  const close = () => {
    setFull(false);
    set({ menu: null });
  };
  const react = (emoji: string) => {
    const next = mine === emoji ? null : emoji;
    void useSyncStore.getState().client?.act({ type: 'react', ...targetOf(message), emoji: next });
    close();
  };

  return (
    <DropdownMenu.Root open modal={false} onOpenChange={(open) => (open ? undefined : close())}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          className="pointer-events-none fixed size-px opacity-0"
          style={{ left: x, top: y }}
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          // The trigger is only a place on the screen, so it cannot name the menu.
          aria-labelledby={undefined}
          aria-label={t('messages.actions')}
          collisionPadding={8}
          sideOffset={4}
          onCloseAutoFocus={(event) => event.preventDefault()}
          className="z-[1500] w-64 max-w-[calc(100vw-1.5rem)] rounded-xl border bg-surface p-1.5 shadow-lg"
        >
          {!message.deleted && !full ? (
            <ReactionBar mine={mine} onPick={react} onMore={() => setFull(true)} />
          ) : null}
          {full ? <EmojiGrid onPick={react} /> : <Entries request={request} chat={chat} />}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
