import type { ChatSummary, SyncResponse } from '@zuvo/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@/lib/api-client';
import {
  chatFixture,
  ME_ID,
  messageFixture,
  savedChatFixture,
  syncPage,
} from '@/test/chat-fixtures';
import { applyHistory, applyReset, applySyncPage, readCursor } from './apply';
import { getUserDb, type LocalDb } from './local-db';
import { Outbox } from './outbox';
import { SyncEngine, type SyncStatus } from './sync-engine';

let db: LocalDb;
let syncCalls: Array<string | undefined>;
let answers: Array<SyncResponse | Error>;
let chats: ChatSummary[];
let statuses: SyncStatus[];
let unauthorized: number;

function engine(retryBaseMs = 5) {
  return new SyncEngine({
    db,
    me: ME_ID,
    retryBaseMs,
    onStatus: (status) => statuses.push(status),
    onUnauthorized: () => {
      unauthorized += 1;
    },
    api: {
      sync: async (since) => {
        syncCalls.push(since);
        const answer = answers.shift() ?? syncPage({ cursor: since ?? '0' });
        if (answer instanceof Error) throw answer;
        return answer;
      },
      listAllChats: async () => chats,
      selfChat: async () => savedChatFixture(),
    },
  });
}

const messageTexts = async () =>
  (await db.messages.orderBy('[chatId+order]').toArray()).map((row) => row.text);

async function startAt(cursor: string) {
  await applySyncPage(db, ME_ID, syncPage({ cursor, chats: [chatFixture(), savedChatFixture()] }));
}

beforeEach(async () => {
  db = getUserDb(ME_ID);
  await db.open();
  syncCalls = [];
  answers = [];
  chats = [];
  statuses = [];
  unauthorized = 0;
});

describe('first start', () => {
  it('asks with no cursor, then loads the chat list and saves the cursor', async () => {
    answers = [syncPage({ reset: true, cursor: '7' })];
    chats = [chatFixture(), savedChatFixture()];
    await engine().run();
    expect(syncCalls).toEqual([undefined]);
    expect(await readCursor(db)).toBe('7');
    expect((await db.chats.toArray()).map((chat) => chat.id).sort()).toEqual(['c-saved', 'c1']);
    expect(await db.profiles.get('u-asha')).toMatchObject({ displayName: 'Asha Verma' });
    expect(statuses).toEqual(['syncing', 'idle']);
  });

  it('creates Saved Messages when the list does not include it', async () => {
    answers = [syncPage({ reset: true, cursor: '0' })];
    await engine().run();
    expect((await db.chats.toArray()).map((chat) => chat.type)).toEqual(['self']);
  });

  it('keeps no cursor when the chat list fails, so the next run starts over', async () => {
    answers = [new ApiClientError(0, 'offline'), syncPage({ reset: true, cursor: '7' })];
    const running = engine();
    await running.run();
    expect(await readCursor(db)).toBeUndefined();
    expect(statuses).toEqual(['syncing', 'error']);
    await vi.waitFor(async () => expect(await readCursor(db)).toBe('7'));
    running.stop();
  });
});

describe('catching up', () => {
  it('passes the saved cursor and follows hasMore', async () => {
    await startAt('5');
    answers = [
      syncPage({ cursor: '6', hasMore: true, messages: [messageFixture(1)] }),
      syncPage({ cursor: '7', messages: [messageFixture(2)] }),
    ];
    await engine().run();
    expect(syncCalls).toEqual(['5', '6']);
    expect(await readCursor(db)).toBe('7');
    expect(await messageTexts()).toEqual(['message 1', 'message 2']);
  });

  it('applying the same page twice changes nothing', async () => {
    await startAt('5');
    const page = syncPage({ cursor: '6', messages: [messageFixture(1)] });
    await applySyncPage(db, ME_ID, page);
    await applySyncPage(db, ME_ID, page);
    expect(await db.messages.count()).toBe(1);
    expect(await readCursor(db)).toBe('6');
  });

  it('never moves the cursor backwards', async () => {
    await startAt('9');
    await applySyncPage(db, ME_ID, syncPage({ cursor: '4' }));
    expect(await readCursor(db)).toBe('9');
  });

  it('asks the API about the session on a 401', async () => {
    await startAt('5');
    answers = [new ApiClientError(401, 'gone')];
    await engine().run();
    expect(unauthorized).toBe(1);
  });

  it('a run during a run schedules exactly one more', async () => {
    await startAt('5');
    const running = engine();
    const first = running.run();
    void running.run();
    void running.run();
    await first;
    expect(syncCalls).toHaveLength(2);
  });
});

describe('live events', () => {
  it('applies the next number and moves the cursor', async () => {
    await startAt('5');
    await engine().onMessage(messageFixture(1), '6');
    expect(await readCursor(db)).toBe('6');
    expect(await messageTexts()).toEqual(['message 1']);
    expect(syncCalls).toEqual([]);
  });

  it('skips what it already has', async () => {
    await startAt('5');
    const running = engine();
    await running.onMessage(messageFixture(1), '6');
    await running.onMessage(messageFixture(1), '6');
    await running.onMessage(messageFixture(9), '3');
    expect(await messageTexts()).toEqual(['message 1']);
    expect(syncCalls).toEqual([]);
  });

  it('a skipped number triggers sync, and what it returns fills the hole', async () => {
    await startAt('5');
    answers = [syncPage({ cursor: '8', messages: [1, 2, 3].map((n) => messageFixture(n)) })];
    const running = engine();
    await running.onMessage(messageFixture(3), '8');
    await vi.waitFor(async () => expect(await readCursor(db)).toBe('8'));
    expect(syncCalls).toEqual(['5']);
    expect(await messageTexts()).toEqual(['message 1', 'message 2', 'message 3']);
  });

  it('applies events one at a time, in arrival order', async () => {
    await startAt('5');
    const running = engine();
    await Promise.all(
      [1, 2, 3, 4, 5].map((n) => running.onMessage(messageFixture(n), String(5 + n))),
    );
    expect(await readCursor(db)).toBe('10');
    expect(syncCalls).toEqual([]);
  });

  it('a message in an unknown chat goes through sync, which brings the chat', async () => {
    await startAt('5');
    const unknown = messageFixture(1, { chatId: 'c-new' });
    answers = [
      syncPage({ cursor: '6', chats: [chatFixture({ id: 'c-new' })], messages: [unknown] }),
    ];
    await engine().onMessage(unknown, '6');
    await vi.waitFor(async () => expect(await db.chats.get('c-new')).toBeDefined());
    expect((await db.messages.toArray()).map((row) => row.chatId)).toEqual(['c-new']);
  });

  it('chat:updated with the same number as message:new still applies', async () => {
    await startAt('5');
    const running = engine();
    await running.onMessage(messageFixture(1), '6');
    await running.onChatChange('c1', { seq: 1, lastReadSeq: 0, lastMessage: null }, '6');
    expect(await db.chats.get('c1')).toMatchObject({ seq: 1, unreadCount: 1 });
    expect(await readCursor(db)).toBe('6');
  });

  it('read:update from another device clears the badge', async () => {
    await applySyncPage(
      db,
      ME_ID,
      syncPage({ cursor: '5', chats: [chatFixture({ seq: 4, unreadCount: 4 })] }),
    );
    await engine().onChatChange('c1', { lastReadSeq: 4 }, '6');
    expect(await db.chats.get('c1')).toMatchObject({ lastReadSeq: 4, unreadCount: 0 });
  });

  it('ignores events after stop', async () => {
    await startAt('5');
    const running = engine();
    running.stop();
    await running.onMessage(messageFixture(1), '6');
    expect(await db.messages.count()).toBe(0);
  });
});

describe('reset', () => {
  it('reloads the chat list, drops confirmed messages and keeps what is unsent', async () => {
    await startAt('5');
    await applyHistory(db, ME_ID, [messageFixture(1)]);
    const box = new Outbox({
      db,
      me: ME_ID,
      transport: { isConnected: () => false, send: () => Promise.reject(new Error('no')) },
    });
    await box.enqueue('c1', 'still unsent');
    answers = [syncPage({ reset: true, cursor: '50' })];
    chats = [chatFixture({ id: 'c2' }), savedChatFixture()];
    await engine().run();

    expect(await readCursor(db)).toBe('50');
    expect((await db.chats.toArray()).map((chat) => chat.id).sort()).toEqual(['c-saved', 'c2']);
    expect(await messageTexts()).toEqual(['still unsent']);
    expect(await db.outbox.count()).toBe(1);
  });

  it('can move the cursor back: the old one was from the future', async () => {
    await startAt('500');
    await applyReset(db, [], '3');
    expect(await readCursor(db)).toBe('3');
  });
});
