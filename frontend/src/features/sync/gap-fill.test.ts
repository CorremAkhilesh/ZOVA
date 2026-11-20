import type { Message } from '@zuvo/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  chatFixture,
  ME_ID,
  messageFixture,
  savedChatFixture,
  syncPage,
} from '@/test/chat-fixtures';
import { applySyncPage } from './apply';
import { fillGaps, fillRecentGaps, findHoles, resetGapMemory } from './gap-fill';
import { getUserDb, type LocalDb } from './local-db';

let db: LocalDb;
let calls: Array<[number, number]>;
/** The server's copy of chat c1: positions it has for me (others are hidden, expired...). */
let onServer: Message[];

const api = {
  range: async (_chatId: string, after: number, before: number) => {
    calls.push([after, before]);
    const inside = onServer.filter((message) => message.seq > after && message.seq < before);
    // Newest first, at most 2 per page (small, to test paging), returned oldest first.
    const page = inside.slice(-2);
    return { items: page, hasMore: inside.length > page.length };
  },
};

const seqs = async () =>
  (await db.messages.where('chatId').equals('c1').toArray()).map((row) => row.seq).sort();

async function device(stored: number[], latest: number) {
  await applySyncPage(
    db,
    ME_ID,
    syncPage({
      cursor: '9',
      chats: [chatFixture({ seq: latest }), savedChatFixture()],
      messages: onServer.filter((message) => stored.includes(message.seq)),
    }),
  );
}

beforeEach(async () => {
  db = getUserDb(ME_ID);
  await db.open();
  resetGapMemory();
  calls = [];
  onServer = [1, 2, 3, 4, 5, 6, 7, 8].map((seq) => messageFixture(seq));
});

describe('finding holes', () => {
  it('above the newest stored, and between stored ones; nothing for an empty chat', () => {
    expect(findHoles([1, 2, 3], 3, new Set())).toEqual([]);
    expect(findHoles([1, 2], 3, new Set())).toEqual([{ after: 2, before: 4 }]);
    expect(findHoles([1, 4, 5], 7, new Set())).toEqual([
      { after: 1, before: 4 },
      { after: 5, before: 8 },
    ]);
    expect(findHoles([], 9, new Set())).toEqual([]);
  });

  it('skips positions known to be absent (deleted for me, expired)', () => {
    expect(findHoles([1, 2], 4, new Set([3, 4]))).toEqual([]);
    expect(findHoles([1, 5], 5, new Set([2]))).toEqual([{ after: 2, before: 5 }]);
  });
});

describe('filling holes', () => {
  it('the chat list knows of message 3, this device does not: fetched and stored', async () => {
    await device([1, 2], 3);
    expect(await fillGaps(db, ME_ID, 'c1', { api })).toBe(1);
    expect(calls).toEqual([[2, 4]]);
    expect(await seqs()).toEqual([1, 2, 3]);
  });

  it('a hole in the middle, larger than a page: fetched page by page', async () => {
    await device([1, 2, 8], 8);
    await fillGaps(db, ME_ID, 'c1', { api });
    expect(calls).toEqual([
      [2, 8],
      [2, 6],
      [2, 4],
    ]);
    expect(await seqs()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('what the server does not have for me is asked once, then never again', async () => {
    onServer = onServer.filter((message) => message.seq !== 3);
    await device([1, 2, 4], 4);
    await fillGaps(db, ME_ID, 'c1', { api });
    await fillGaps(db, ME_ID, 'c1', { api, force: true });
    expect(calls).toEqual([[2, 4]]);
  });

  it('nothing missing: no request at all; the same chat is not rechecked at once', async () => {
    onServer = onServer.slice(0, 3);
    await device([1, 2, 3], 3);
    expect(await fillGaps(db, ME_ID, 'c1', { api })).toBe(0);
    await db.chats.update('c1', { seq: 4 });
    onServer.push(messageFixture(4));
    // seq moved: checked again straight away.
    expect(await fillGaps(db, ME_ID, 'c1', { api })).toBe(1);
    expect(await fillGaps(db, ME_ID, 'c1', { api })).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it('recent chats are checked on focus and after a sync', async () => {
    await device([1], 2);
    expect(await fillRecentGaps(db, ME_ID, api)).toBe(1);
    expect(await seqs()).toEqual([1, 2]);
  });
});
