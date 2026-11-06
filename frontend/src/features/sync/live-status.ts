import type { PresenceEvent } from '@zuvo/protocol';
import { create } from 'zustand';

/**
 * Longer than the server's 6 s expiry, which is what normally ends "typing…". This only covers a
 * stop that never arrived because the connection dropped.
 */
export const TYPING_FALLBACK_MS = 8000;

type PresenceEntry = Pick<PresenceEvent, 'online' | 'lastSeenAt'>;

interface LiveStatus {
  /** Who is typing right now, per chat. */
  typing: Record<string, string[]>;
  presence: Record<string, PresenceEntry>;
}

/** Who is typing and online: moment to moment, so kept in memory rather than in Dexie. */
export const useLiveStatus = create<LiveStatus>(() => ({ typing: {}, presence: {} }));

const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function setTyping(chatId: string, userId: string, typing: boolean): void {
  const key = `${chatId}:${userId}`;
  clearTimeout(typingTimers.get(key));
  typingTimers.delete(key);
  if (typing) {
    typingTimers.set(
      key,
      setTimeout(() => setTyping(chatId, userId, false), TYPING_FALLBACK_MS),
    );
  }
  useLiveStatus.setState((state) => {
    const others = (state.typing[chatId] ?? []).filter((id) => id !== userId);
    return { typing: { ...state.typing, [chatId]: typing ? [...others, userId] : others } };
  });
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
