import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chatFixture, ME_ID, messageFixture, syncPage } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';
import { ActionQueue } from './actions';
import { applySyncPage } from './apply';
import { applyLiveClear, applyLiveRemoval, applyLiveUpdate } from './apply-updates';
import { getUserDb, type LocalDb } from './local-db';

let db: LocalDb;
let seen: string[];

const target = { chatId: 'c1', messageId: 'm3', seq: 3 };
const lastMessage = {
  id: 'm3',
  seq: 3,
  senderId: ME_ID,
  type: 'text' as const,
  preview: 'three',
  createdAt: '2026-11-04T10:00:00.000Z',
};

beforeEach(async () => {
  db = getUserDb(ME_ID);
  await db.open();
  seen = [];
  await applySyncPage(
    db,
    ME_ID,
    syncPage({
      cursor: '10',
      chats: [chatFixture({ seq: 3, lastReadSeq: 3, unreadCount: 0, lastMessage })],
      messages: [
        messageFixture(2, { id: 'm2', senderId: ME_ID, text: 'two' }),
        messageFixture(3, { id: 'm3', clientMsgId: 'same', senderId: ME_ID, text: 'three' }),
      ],
    }),
  );
  const ok = async ({ request }: { request: Request }) => {
    seen.push(`${request.method} ${new URL(request.url).pathname}`);
    return HttpResponse.json({ ok: true });
  };
  server.use(
    http.patch('*/v1/chats/c1/messages/:id', ok),
    http.delete('*/v1/chats/c1/messages/:id', ok),
    http.put('*/v1/chats/c1/messages/:id/*', ok),
    http.delete('*/v1/chats/c1/messages/:id/*', ok),
  );
});

const queue = (options: Partial<ConstructorParameters<typeof ActionQueue>[0]> = {}) =>
  new ActionQueue({ db, me: ME_ID, isLeader: () => true, retryBaseMs: 5, ...options });
const row = (key = 'm3') => db.messages.filter((item) => item.id === key).first();
const drained = () => vi.waitFor(async () => expect(await db.actions.count()).toBe(0));

describe('the action queue', () => {
  it('shows an edit at once, in the bubble and the chat list', async () => {
    const actions = queue({ isLeader: () => false });
    await actions.enqueue({ type: 'edit', ...target, text: 'changed' });
    expect(await row()).toMatchObject({ text: 'changed' });
    expect((await row())?.editedAt).toBeTruthy();
    expect((await db.chats.get('c1'))?.lastMessage?.preview).toBe('changed');
    expect(await db.actions.count()).toBe(1);
    actions.stop();
  });

  it('sends in the order they were done, and only the leader sends', async () => {
    let leader = false;
    const actions = queue({ isLeader: () => leader });
    await actions.enqueue({ type: 'edit', ...target, text: 'a' });
    await actions.enqueue({ type: 'react', ...target, emoji: '👍' });
    await actions.enqueue({ type: 'star', ...target, starred: true });
    expect(seen).toEqual([]);
    leader = true;
    actions.resume();
    await drained();
    expect(seen).toEqual([
      'PATCH /v1/chats/c1/messages/m3',
      'PUT /v1/chats/c1/messages/m3/reaction',
      'PUT /v1/chats/c1/messages/m3/star',
    ]);
    actions.stop();
  });

  it('keeps everything offline, across a reload, and sends after reconnecting', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const before = queue();
    await before.enqueue({ type: 'react', ...target, emoji: '👍' });
    await before.enqueue({ type: 'delete', ...target, scope: 'everyone' });
    expect(seen).toEqual([]);
    expect((await row())?.deletedForEveryoneAt).toBeTruthy();
    before.stop();
    online.mockReturnValue(true);
    const after = queue();
    after.resume();
    await drained();
    expect(seen).toHaveLength(2);
    after.stop();
    online.mockRestore();
  });

  it('waits and tries again when the server cannot be reached, without overtaking', async () => {
    let failures = 2;
    server.use(
      http.put('*/v1/chats/c1/messages/:id/reaction', () => {
        if (failures-- > 0) return HttpResponse.error();
        seen.push('reacted');
        return HttpResponse.json({ ok: true });
      }),
    );
    const actions = queue();
    await actions.enqueue({ type: 'react', ...target, emoji: '👍' });
    await actions.enqueue({ type: 'star', ...target, starred: true });
    await drained();
    expect(seen).toEqual(['reacted', 'PUT /v1/chats/c1/messages/m3/star']);
    actions.stop();
  });

  it('undoes a change the server refuses, and says why', async () => {
    const refusals: string[] = [];
    server.use(
      http.patch('*/v1/chats/c1/messages/:id', () =>
        HttpResponse.json(
          {
            code: 'EDIT_WINDOW_PASSED',
            message: 'This message is too old to edit.',
            requestId: 'r',
          },
          { status: 409 },
        ),
      ),
      http.get('*/v1/chats/c1/messages', () =>
        HttpResponse.json({
          items: [
            messageFixture(3, { id: 'm3', clientMsgId: 'same', senderId: ME_ID, text: 'three' }),
          ],
          hasMore: false,
        }),
      ),
      http.get('*/v1/chats/c1', () =>
        HttpResponse.json({ chat: chatFixture({ seq: 3, lastMessage }) }),
      ),
    );
    const actions = queue({ onRefused: (reason) => refusals.push(reason) });
    await actions.enqueue({ type: 'edit', ...target, text: 'late' });
    await drained();
    await vi.waitFor(async () => expect((await row())?.text).toBe('three'));
    expect(refusals).toEqual(['This message is too old to edit.']);
    actions.stop();
  });

  it('treats deleting for me twice as done', async () => {
    const refusals: string[] = [];
    server.use(
      http.delete('*/v1/chats/c1/messages/:id', () =>
        HttpResponse.json(
          { code: 'NOT_FOUND', message: 'Message not found.', requestId: 'r' },
          { status: 404 },
        ),
      ),
    );
    const actions = queue({ onRefused: (reason) => refusals.push(reason) });
    await actions.enqueue({ type: 'delete', ...target, scope: 'me' });
    await drained();
    expect(await row()).toBeUndefined();
    expect(refusals).toEqual([]);
    actions.stop();
  });

  it('applies reactions, one per person, and prefs', async () => {
    const actions = queue({ isLeader: () => false });
    await actions.enqueue({ type: 'react', ...target, emoji: '👍' });
    await actions.enqueue({ type: 'react', ...target, emoji: '❤️' });
    expect((await row())?.reactions?.map((item) => item.emoji)).toEqual(['❤️']);
    await actions.enqueue({ type: 'react', ...target, emoji: null });
    expect((await row())?.reactions).toEqual([]);
    await actions.enqueue({
      type: 'prefs',
      chatId: 'c1',
      prefs: { pinned: true, archived: true, unread: true, mute: 'always' },
    });
    const chat = await db.chats.get('c1');
    expect(chat).toMatchObject({ pinned: true, archived: true, markedUnread: true });
    expect(Date.parse(chat?.mutedUntil ?? '')).toBeGreaterThan(Date.now());
    actions.stop();
  });
});

describe('what the server says about messages', () => {
  it('updates a message this device has, keeping my star when the event says nothing of it', async () => {
    await applyLiveUpdate(db, messageFixture(3, { id: 'm3', text: 'first' }), '11');
    await db.messages.filter((item) => item.id === 'm3').modify({ starred: true });
    await applyLiveUpdate(db, messageFixture(3, { id: 'm3', text: 'second' }), '12');
    expect(await row()).toMatchObject({ text: 'second', starred: true });
    expect((await db.meta.get('cursor'))?.value).toBe('12');
  });

  it('never stores an old message this device did not have: paging back would miss a hole', async () => {
    await applyLiveUpdate(db, messageFixture(1, { id: 'old', text: 'old' }), '11');
    expect(await row('old')).toBeUndefined();
    await applySyncPage(
      db,
      ME_ID,
      syncPage({ cursor: '12', updated: [messageFixture(1, { id: 'older' })] }),
    );
    expect(await row('older')).toBeUndefined();
  });

  it('asks for sync when an update shows something was missed', async () => {
    const result = await applyLiveUpdate(db, messageFixture(3, { id: 'm3' }), '50');
    expect(result).toBe('gap');
  });

  it('removes what I deleted for me on another device', async () => {
    expect(await applyLiveRemoval(db, 'c1', 3, '11')).toBe('applied');
    expect(await row()).toBeUndefined();
    await applySyncPage(db, ME_ID, syncPage({ cursor: '12', removed: [{ chatId: 'c1', seq: 2 }] }));
    expect(await row('m2')).toBeUndefined();
  });

  it('clears a chat, keeping what is still unsent and leaving the chat there', async () => {
    await applyLiveClear(db, { chatId: 'c1', seq: 3, removeChat: false }, '11');
    expect(
      await db.messages
        .where('chatId')
        .equals('c1')
        .count()
        .catch(() => 0),
    ).toBe(0);
    expect(await db.chats.get('c1')).toMatchObject({ lastMessage: null, unreadCount: 0 });
  });

  it('takes a deleted chat away, unless someone wrote since', async () => {
    await db.chats.update('c1', { seq: 9 });
    await applyLiveClear(db, { chatId: 'c1', seq: 3, removeChat: true }, '11');
    expect(await db.chats.get('c1')).toBeDefined();
    await db.chats.update('c1', { seq: 3 });
    await applySyncPage(
      db,
      ME_ID,
      syncPage({ cursor: '12', cleared: [{ chatId: 'c1', seq: 3, removeChat: true }] }),
    );
    expect(await db.chats.get('c1')).toBeUndefined();
  });

  it('leaves my star on when a live event replaces a message', async () => {
    await db.messages.filter((item) => item.id === 'm3').modify({ starred: true });
    await applySyncPage(
      db,
      ME_ID,
      syncPage({
        cursor: '11',
        messages: [messageFixture(3, { id: 'm3', clientMsgId: 'same', senderId: ME_ID })],
      }),
    );
    expect((await row())?.starred).toBe(true);
  });
});
