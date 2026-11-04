import type { AckResponse, SendMessageAck, SendMessagePayload } from '@zuvo/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatFixture, ME_ID, messageFixture, syncPage } from '@/test/chat-fixtures';
import { applyChats, applyLiveMessage, applySyncPage } from './apply';
import { getUserDb, type LocalDb } from './local-db';
import { Outbox } from './outbox';

let db: LocalDb;
let seq: number;
let sent: SendMessagePayload[];
let connected: boolean;
let leader: boolean;
let respond: (payload: SendMessagePayload) => Promise<AckResponse<SendMessageAck>>;

const accept = async (): Promise<AckResponse<SendMessageAck>> => {
  seq += 1;
  return {
    ok: true,
    data: {
      messageId: `m${seq}`,
      seq,
      createdAt: '2026-11-04T10:30:00.000Z',
      duplicate: false,
    },
  };
};
function outbox() {
  return new Outbox({
    db,
    me: ME_ID,
    isLeader: () => leader,
    maxAttempts: 3,
    retryBaseMs: 100,
    transport: {
      isConnected: () => connected,
      send: (payload) => {
        sent.push(payload);
        return respond(payload);
      },
    },
  });
}

const rows = () => db.messages.orderBy('[chatId+order]').toArray();
const settle = async () => {
  await vi.advanceTimersByTimeAsync(0);
  await vi.waitFor(async () => {
    const pending = await db.outbox.where('state').equals('pending').count();
    expect(pending).toBe(0);
  });
};

beforeEach(async () => {
  db = getUserDb(ME_ID);
  await db.open();
  await applyChats(db, [chatFixture()]);
  seq = 0;
  sent = [];
  connected = true;
  leader = true;
  respond = accept;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sending', () => {
  it('writes locally first with a clock, then replaces it with the server message', async () => {
    connected = false;
    const box = outbox();
    const id = await box.enqueue('c1', 'hello');

    const [before] = await rows();
    expect(before).toMatchObject({ status: 'pending', seq: null, id: null, clientMsgId: id });
    expect((await db.chats.get('c1'))?.lastMessage?.preview).toBe('hello');
    expect(sent).toEqual([]);

    connected = true;
    box.resume();
    await vi.waitFor(async () => expect((await rows())[0]?.status).toBe('sent'));
    const [after] = await rows();
    expect(after).toMatchObject({ id: 'm1', seq: 1, order: 1, key: before?.key });
    expect(await db.outbox.count()).toBe(0);
  });

  it('uses UUIDv7 ids', async () => {
    const id = await outbox().enqueue('c1', 'hello');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('resends everything in order after reconnecting', async () => {
    connected = false;
    const box = outbox();
    for (const text of ['one', 'two', 'three']) await box.enqueue('c1', text);
    connected = true;
    box.resume();
    await vi.waitFor(() => expect(sent).toHaveLength(3));
    expect(sent.map((payload) => payload.text)).toEqual(['one', 'two', 'three']);
    await vi.waitFor(async () => expect(await db.outbox.count()).toBe(0));
    expect((await rows()).map((row) => row.seq)).toEqual([1, 2, 3]);
  });

  it('sends one at a time, so a slow ack cannot be overtaken', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    respond = async () => {
      await gate;
      return accept();
    };
    const box = outbox();
    await box.enqueue('c1', 'one');
    await box.enqueue('c1', 'two');
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    release();
    await vi.waitFor(() => expect(sent).toHaveLength(2));
  });

  it('does nothing in a tab that is not the leader', async () => {
    leader = false;
    const box = outbox();
    await box.enqueue('c1', 'hello');
    await box.flush();
    expect(sent).toEqual([]);
    expect(await db.outbox.count()).toBe(1);

    leader = true;
    box.resume();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
  });
});

describe('no duplicates', () => {
  it('resends with the same clientMsgId after a lost ack', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    respond = async () => {
      respond = accept;
      throw new Error('operation has timed out');
    };
    await outbox().enqueue('c1', 'hello');
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(150);
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]?.clientMsgId).toBe(sent[0]?.clientMsgId);
    await settle();
    expect(await rows()).toHaveLength(1);
  });

  it('keeps one row when the message:new echo arrives before the ack', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    respond = async () => {
      await gate;
      return accept();
    };
    await applySyncPage(db, ME_ID, syncPage({ cursor: '0' }));
    const box = outbox();
    const id = await box.enqueue('c1', 'hello');
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    const echo = messageFixture(1, { senderId: ME_ID, clientMsgId: id, text: 'hello' });
    expect(await applyLiveMessage(db, ME_ID, echo, '1')).toBe('applied');
    release();
    await vi.waitFor(async () => expect(await db.outbox.count()).toBe(0));
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: 'm1', seq: 1, status: 'sent' });
  });

  it('never sends again once sync has shown the server has it', async () => {
    connected = false;
    const box = outbox();
    const id = await box.enqueue('c1', 'hello');
    const copy = messageFixture(1, { senderId: ME_ID, clientMsgId: id, text: 'hello' });
    await applySyncPage(db, ME_ID, syncPage({ cursor: '1', messages: [copy] }));

    connected = true;
    await box.flush();
    expect(sent).toEqual([]);
    expect(await rows()).toHaveLength(1);
  });
});
