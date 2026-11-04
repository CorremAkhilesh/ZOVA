import { beforeEach, describe, expect, it } from 'vitest';
import {
  chatFixture,
  ME_ID,
  messageFixture,
  personFixture,
  savedChatFixture,
  syncPage,
} from '@/test/chat-fixtures';
import { applyChats, applyHistory, applySyncPage, mergeChat, toChatRow } from './apply';
import { getUserDb, type LocalDb } from './local-db';

let db: LocalDb;

async function startAt(cursor: string) {
  await applySyncPage(db, ME_ID, syncPage({ cursor, chats: [chatFixture(), savedChatFixture()] }));
}

beforeEach(async () => {
  db = getUserDb(ME_ID);
  await db.open();
});

describe('merging', () => {
  const base = toChatRow(
    chatFixture({ seq: 5, lastReadSeq: 3, unreadCount: 2, lastMessage: null }),
  );
  const last = {
    id: 'm',
    seq: 4,
    senderId: 'u',
    type: 'text' as const,
    preview: 'old',
    createdAt: '2026-11-04T09:00:00.000Z',
  };

  it('old news cannot undo newer state', () => {
    const merged = mergeChat(base, {
      seq: 4,
      lastReadSeq: 1,
      lastMessage: last,
      lastActivityAt: '2026-01-01T00:00:00.000Z',
    });
    expect(merged).toMatchObject({ seq: 5, lastReadSeq: 3, unreadCount: 2, lastMessage: null });
    expect(merged.lastActivityAt).toBe(base.lastActivityAt);
    expect(merged.sortAt).toBe(base.sortAt);
  });

  it('newer news applies and moves the chat up the list', () => {
    const merged = mergeChat(base, {
      seq: 6,
      lastReadSeq: 3,
      lastMessage: { ...last, seq: 6, preview: 'new' },
      lastActivityAt: '2026-12-01T00:00:00.000Z',
    });
    expect(merged).toMatchObject({ seq: 6, unreadCount: 3 });
    expect(merged.lastMessage?.preview).toBe('new');
    expect(merged.sortAt).toBeGreaterThan(base.sortAt);
  });

  it('refreshes names and photos from a list that knows nothing newer', async () => {
    await startAt('5');
    await applyChats(db, [chatFixture({ otherUser: personFixture({ displayName: 'Asha V' }) })]);
    expect((await db.chats.get('c1'))?.otherUser?.displayName).toBe('Asha V');
  });
});

describe('keys', () => {
  it('two senders using the same clientMsgId stay separate messages', async () => {
    await startAt('5');
    const id = '0190a000-0000-7000-8000-000000000000';
    await applyHistory(db, ME_ID, [
      messageFixture(1, { senderId: 'u-a', clientMsgId: id, id: 'a' }),
      messageFixture(2, { senderId: 'u-b', clientMsgId: id, id: 'b' }),
    ]);
    expect(await db.messages.count()).toBe(2);
  });

  it('a message with no clientMsgId uses its server id', async () => {
    await startAt('5');
    await applyHistory(db, ME_ID, [messageFixture(1, { clientMsgId: null, senderId: null })]);
    expect((await db.messages.toArray())[0]?.key).toBe('m1');
  });
});
