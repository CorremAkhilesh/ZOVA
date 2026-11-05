import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ME_ID, messageFixture } from '@/test/chat-fixtures';
import { applyHistory } from './apply';
import { getUserDb, type LocalDb, PENDING_ORDER_BASE } from './local-db';
import { createPlayReports, messageAfter } from './played-reports';

let db: LocalDb;
const OTHER = 'u-other';
const stored = (seq: number, overrides = {}) =>
  messageFixture(seq, { senderId: OTHER, clientMsgId: null, ...overrides });

beforeEach(async () => {
  db = getUserDb(ME_ID);
  await db.open();
});

describe('reporting a play', () => {
  it('clears the dot at once and tells the server', async () => {
    await applyHistory(db, ME_ID, [stored(1, { id: 'm1', type: 'voice' })]);
    const send = vi.fn(async () => 'done' as const);
    await createPlayReports(db, send).record('m1', 'c1', 'm1');
    expect((await db.messages.get('m1'))?.played).toBe(true);
    expect(send).toHaveBeenCalledWith({ chatId: 'c1', messageId: 'm1' });
    expect(await db.meta.get('unreported-plays')).toBeUndefined();
  });

  it('keeps a play heard offline, and sends it on the next connection', async () => {
    await applyHistory(db, ME_ID, [stored(1, { id: 'm1', type: 'voice' })]);
    const send = vi.fn(async () => null);
    const reports = createPlayReports(db, send);
    await reports.record('m1', 'c1', 'm1');
    expect((await db.messages.get('m1'))?.played).toBe(true);
    expect(await db.meta.get('unreported-plays')).toBeDefined();

    send.mockResolvedValue('done' as never);
    await reports.flush();
    expect(await db.meta.get('unreported-plays')).toBeUndefined();
  });

  it('survives a reload: a new client sends what the old one could not', async () => {
    await applyHistory(db, ME_ID, [stored(1, { id: 'm1', type: 'voice' })]);
    await createPlayReports(db, async () => null).record('m1', 'c1', 'm1');
    const send = vi.fn(async () => 'done' as const);
    await createPlayReports(db, send).flush();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('asks only once for the same note', async () => {
    await applyHistory(db, ME_ID, [stored(1, { id: 'm1', type: 'voice' })]);
    const reports = createPlayReports(db, async () => null);
    await reports.record('m1', 'c1', 'm1');
    await reports.record('m1', 'c1', 'm1');
    const value = (await db.meta.get('unreported-plays'))?.value ?? '[]';
    expect(JSON.parse(value)).toHaveLength(1);
  });
});

describe('the message after a voice note', () => {
  it('is the next one in that chat', async () => {
    await applyHistory(db, ME_ID, [stored(1, { id: 'm1' }), stored(2, { id: 'm2' })]);
    expect((await messageAfter(db, 'm1'))?.id).toBe('m2');
    expect(await messageAfter(db, 'm2')).toBeNull();
  });

  it('does not count something not yet sent', async () => {
    await applyHistory(db, ME_ID, [stored(1, { id: 'm1' })]);
    await db.messages.put({
      ...stored(9, { id: null as never }),
      key: 'pending',
      id: null,
      seq: null,
      order: PENDING_ORDER_BASE + 1,
      status: 'pending',
    });
    expect(await messageAfter(db, 'm1')).toBeNull();
  });

  it('is nothing for a message this device does not have', async () => {
    expect(await messageAfter(db, 'nope')).toBeNull();
  });
});
