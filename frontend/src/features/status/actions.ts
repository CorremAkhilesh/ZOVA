import type { PublicProfile, Status, StatusReply } from '@zuvo/protocol';
import { chatsApi } from '@/features/chats/api';
import { applyChats } from '@/features/sync/apply';
import { useSyncStore } from '@/features/sync/store';
import { ignoreClosed, patchFeed, refreshStatuses, statusApi } from './feed';

const dbOf = () => useSyncStore.getState().client?.db ?? null;

/** The copy of a status that a reply carries into the chat. */
export function toStatusReply(status: Status): StatusReply {
  const media = status.media;
  return {
    statusId: status.id,
    ownerId: status.userId,
    kind: status.kind,
    text: status.text,
    style: status.style,
    mediaId: media?.hasThumbnail ? media.id : null,
    hasThumbnail: media?.hasThumbnail === true,
    expiresAt: status.expiresAt,
  };
}

/** Seen: shown as seen here at once, then told to the server (once per status). */
const told = new Set<string>();
export function markViewed(status: Status): void {
  const db = dbOf();
  if (status.viewed || told.has(status.id)) return;
  told.add(status.id);
  if (db) {
    void patchFeed(db, (feed) => ({
      ...feed,
      people: feed.people.map((person) => ({
        ...person,
        statuses: person.statuses.map((item) =>
          item.id === status.id ? { ...item, viewed: true } : item,
        ),
      })),
      // Signed out with the viewer open: the database is closed and there is nothing to keep.
    })).catch(ignoreClosed);
  }
  void statusApi.view(status.id).catch(() => told.delete(status.id));
}

/**
 * A reply goes to the owner in our 1:1 chat (made if needed), with a copy of the status above it,
 * through the outbox like any message: it waits while offline.
 */
export async function replyToStatus(owner: PublicProfile, status: Status, text: string) {
  const client = useSyncStore.getState().client;
  if (!client) throw new Error('Not connected');
  const chat = await chatsApi.createDirect(owner.id);
  await applyChats(client.db, [chat]);
  await client.sendText(chat.id, text, null, { statusReply: toStatusReply(status) });
  return chat.id;
}

/** A quick reaction: kept on the view (the owner sees it in "Viewed by") and sent as a reply. */
export async function reactToStatus(owner: PublicProfile, status: Status, emoji: string) {
  await statusApi.view(status.id, emoji);
  return replyToStatus(owner, status, emoji);
}

/** Mine only: gone for everyone. Out of my list at once; if the server refuses, it comes back. */
export async function deleteMyStatus(status: Status) {
  const db = dbOf();
  if (db)
    await patchFeed(db, (feed) => ({ ...feed, mine: feed.mine.filter((s) => s.id !== status.id) }));
  try {
    await statusApi.remove(status.id);
  } finally {
    if (db) void refreshStatuses(db);
  }
}

/** Muted people move to "Muted" in my list; nobody else knows. */
export async function setMuted(userId: string, muted: boolean) {
  const db = dbOf();
  if (db) {
    await patchFeed(db, (feed) => ({
      ...feed,
      people: feed.people.map((person) =>
        person.user.id === userId ? { ...person, muted } : person,
      ),
    }));
  }
  await statusApi.mute(userId, muted);
}
