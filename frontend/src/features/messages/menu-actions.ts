import type { PublicProfile } from '@zuvo/protocol';
import { toast } from 'sonner';
import type { ChatMessage, ChatSummary } from '@/features/chats/types';
import { groupAbilities } from '@/features/groups/rules';
import { useModeration } from '@/features/moderation/store';
import { livePins, pinsApi, storePins, usePinDialog } from '@/features/pins/pins';
import { useSyncStore } from '@/features/sync/store';
import { i18n } from '@/lib/i18n';

/** Both people in a 1:1 chat; in a group, as its "Pin messages" setting says. */
export const mayPin = (chat: ChatSummary) =>
  chat.kind !== 'group' || (chat.group ? groupAbilities(chat.group).pin : false);

export const isPinned = (chat: ChatSummary, messageId: string | null | undefined) =>
  Boolean(messageId) && livePins(chat.pins).some((pin) => pin.messageId === messageId);

/** Pinning asks for how long; unpinning happens at once. */
export function togglePin(chat: ChatSummary, messageId: string, pinned: boolean) {
  if (!pinned) {
    usePinDialog.getState().open({ chatId: chat.id, messageId });
    return;
  }
  const db = useSyncStore.getState().client?.db ?? null;
  void pinsApi
    .unpin(chat.id, messageId)
    .then(({ pins }) => storePins(db, chat.id, pins))
    .catch(() => toast.error(i18n.t('pins.failed')));
}

/** Report this message (and the sender's latest ones) about the person who sent it. */
export function reportMessage(chat: ChatSummary, message: ChatMessage) {
  const person: PublicProfile = {
    id: message.authorId,
    displayName: message.authorName,
    username: null,
    about: null,
    avatar: null,
    deactivated: false,
  };
  useModeration.getState().openReport({
    target: { kind: 'message', chatId: chat.id, messageIds: [message.serverId ?? ''] },
    person,
  });
}
