import {
  PINNED_MESSAGES_MAX,
  type PinDuration,
  type PinnedMessage,
  pinsResponseSchema,
} from '@zuvo/protocol';
import { create } from 'zustand';
import { groupAbilities } from '@/features/groups/rules';
import type { ChatRow, LocalDb } from '@/features/sync/local-db';
import { apiDelete, apiPut } from '@/lib/api-client';

export const pinsApi = {
  pin: (chatId: string, messageId: string, duration: PinDuration) =>
    apiPut(`/v1/chats/${chatId}/messages/${messageId}/pin`, { duration }, pinsResponseSchema),
  unpin: (chatId: string, messageId: string) =>
    apiDelete(`/v1/chats/${chatId}/messages/${messageId}/pin`, pinsResponseSchema),
};

/** Pins whose time is not up, newest pin first. The server's job removes the rest later. */
export const livePins = (pins: PinnedMessage[] | undefined, now = Date.now()) =>
  (pins ?? []).filter((pin) => Date.parse(pin.expiresAt) > now);

/** Both people in a 1:1 chat; in a group, as its "Pin messages" setting says. */
export function canPin(chat: Pick<ChatRow, 'type' | 'group'>): boolean {
  if (chat.type !== 'group') return true;
  return chat.group ? groupAbilities(chat.group).pin : false;
}

/** Pinning a new message when 3 are pinned replaces the oldest: say so first. */
export const replacesOldest = (pins: PinnedMessage[] | undefined, messageId: string) =>
  livePins(pins).length >= PINNED_MESSAGES_MAX &&
  !livePins(pins).some((pin) => pin.messageId === messageId);

/** The server's answer is the chat's pins now: shown at once, without waiting for sync. */
export async function storePins(db: LocalDb | null, chatId: string, pins: PinnedMessage[]) {
  await db?.chats.update(chatId, { pins });
}

export interface PinRequest {
  chatId: string;
  messageId: string;
}

/** The "Pin for how long?" dialog, opened from a message's menu. */
export const usePinDialog = create<{
  request: PinRequest | null;
  open: (request: PinRequest) => void;
  close: () => void;
}>()((set) => ({
  request: null,
  open: (request) => set({ request }),
  close: () => set({ request: null }),
}));
