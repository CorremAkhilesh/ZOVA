import type { PresenceEvent } from '@zuvo/protocol';
import { create } from 'zustand';

/**
 * Longer than the server's 6 s expiry, which is what normally ends "typing…". This only covers a
 * stop that never arrived because the connection dropped.
 */
export const TYPING_FALLBACK_MS = 8000;

type PresenceEntry = Pick<PresenceEvent, 'online' | 'lastSeenAt'>;

interface LiveStatus {
  /** Chats where someone is typing right now. */
  typing: Record<string, boolean>;
  presence: Record<string, PresenceEntry>;
}

/** Who is typing and online: moment to moment, so kept in memory rather than in Dexie. */
export const useLiveStatus = create<LiveStatus>(() => ({ typing: {}, presence: {} }));

const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function setTyping(chatId: string, typing: boolean): void {
  clearTimeout(typingTimers.get(chatId));
  typingTimers.delete(chatId);
  if (typing) {
    typingTimers.set(
      chatId,
      setTimeout(() => setTyping(chatId, false), TYPING_FALLBACK_MS),
    );
  }
  useLiveStatus.setState((state) => ({ typing: { ...state.typing, [chatId]: typing } }));
}

/** One person changed. */
export function setPresence({ userId, online, lastSeenAt }: PresenceEvent): void {
  useLiveStatus.setState((state) => ({
    presence: { ...state.presence, [userId]: { online, lastSeenAt } },
  }));
}

/** A fresh answer for everyone being watched; anyone not in it is no longer tracked. */
export function replacePresence(users: PresenceEvent[]): void {
  useLiveStatus.setState({
    presence: Object.fromEntries(
      users.map(({ userId, online, lastSeenAt }) => [userId, { online, lastSeenAt }]),
    ),
  });
}

export function resetLiveStatus(): void {
  for (const timer of typingTimers.values()) clearTimeout(timer);
  typingTimers.clear();
  useLiveStatus.setState({ typing: {}, presence: {} });
}
