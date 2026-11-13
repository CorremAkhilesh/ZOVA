import { Lock, LockOpen } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useTranslation } from 'react-i18next';
import { useChat } from '@/features/chats/queries';
import type { ChatSummary } from '@/features/chats/types';
import { useLockChat } from '../chat-lock';

const ITEM =
  'flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm outline-none data-[highlighted]:bg-background';

/** "Lock chat" / "Unlock chat" in a chat's menu. Saved Messages stays where it is. */
export function LockMenuEntry({ chat }: { chat: ChatSummary }) {
  const { t } = useTranslation();
  const row = useChat(chat.id);
  const toggle = useLockChat();
  // Not read yet: no entry rather than the wrong one for a moment.
  if (!row || chat.kind === 'saved') return null;
  const locked = row.locked === true;
  const Icon = locked ? LockOpen : Lock;
  return (
    <DropdownMenu.Item className={ITEM} onSelect={() => toggle(chat.id, !locked)}>
      <Icon className="size-4" aria-hidden />
      {t(locked ? 'lock.unlockChat' : 'lock.lockChat')}
    </DropdownMenu.Item>
  );
}
