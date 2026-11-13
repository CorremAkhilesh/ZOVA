import type { MessageReaction } from './actions-reactions';
import { nextReactions } from './actions-reactions';
import type { QueuedAction } from './actions-types';
import { clearUpTo, removeAt } from './local-changes';
import type { ChatRow, LocalDb } from './local-db';

const rowAt = (db: LocalDb, chatId: string, seq: number) =>
  db.messages.where('[chatId+order]').equals([chatId, seq]).first();

async function patchRow(
  db: LocalDb,
  chatId: string,
  seq: number,
  patch: (row: NonNullable<Awaited<ReturnType<typeof rowAt>>>) => object,
) {
  const row = await rowAt(db, chatId, seq);
  if (row) await db.messages.put({ ...row, ...patch(row) });
}

async function patchPreview(
  db: LocalDb,
  chatId: string,
  seq: number,
  patch: Partial<NonNullable<ChatRow['lastMessage']>>,
) {
  const chat = await db.chats.get(chatId);
  if (chat?.lastMessage?.seq !== seq) return;
  await db.chats.put({ ...chat, lastMessage: { ...chat.lastMessage, ...patch } });
}

const MUTE_MS = { '8h': 8 * 3_600_000, '1w': 7 * 86_400_000 } as const;

function muteUntil(mute: 'off' | '8h' | '1w' | 'always'): string | null {
  if (mute === 'off') return null;
  if (mute === 'always') return '9999-12-31T00:00:00.000Z';
  return new Date(Date.now() + MUTE_MS[mute]).toISOString();
}

async function applyPrefs(db: LocalDb, action: Extract<QueuedAction, { type: 'prefs' }>) {
  const { pinned, mute, archived, unread } = action.prefs;
  const change: Partial<ChatRow> = {
    ...(pinned !== undefined ? { pinned } : {}),
    ...(archived !== undefined ? { archived } : {}),
    ...(unread !== undefined ? { markedUnread: unread } : {}),
    ...(mute !== undefined ? { mutedUntil: muteUntil(mute) } : {}),
  };
  await db.chats.update(action.chatId, change);
}

async function deleteLocally(db: LocalDb, action: Extract<QueuedAction, { type: 'delete' }>) {
  const { chatId, seq, scope, asAdmin } = action;
  if (scope === 'me') {
    await removeAt(db, chatId, seq);
    return;
  }
  await patchRow(db, chatId, seq, () => ({
    text: null,
    media: null,
    replyTo: null,
    reactions: [] as MessageReaction[],
    starred: false,
    deletedByAdmin: asAdmin === true,
    deletedForEveryoneAt: new Date().toISOString(),
  }));
  await patchPreview(db, chatId, seq, { preview: '', deleted: true });
}

/** Shown at once, on or offline. What the server says next settles it either way. */
export async function applyLocally(db: LocalDb, me: string, action: QueuedAction) {
  switch (action.type) {
    case 'edit':
      await patchRow(db, action.chatId, action.seq, () => ({
        text: action.text,
        editedAt: new Date().toISOString(),
      }));
      await patchPreview(db, action.chatId, action.seq, { preview: action.text });
      return;
    case 'delete':
      await deleteLocally(db, action);
      return;
    case 'react':
      await patchRow(db, action.chatId, action.seq, (row) => ({
        reactions: nextReactions(row.reactions ?? [], me, action.emoji),
      }));
      return;
    case 'star':
      await patchRow(db, action.chatId, action.seq, () => ({ starred: action.starred }));
      return;
    case 'prefs':
      await applyPrefs(db, action);
      return;
    case 'clear':
      await clearUpTo(db, action);
      return;
    case 'forward':
      return;
  }
}
