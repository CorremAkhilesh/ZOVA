import type { AckResponse, SendMessageAck, SendMessagePayload } from '@zuvo/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatFixture, ME_ID } from '@/test/chat-fixtures';
import { applyChats } from './apply';
import { getUserDb, type LocalDb } from './local-db';
import { DisconnectedError, Outbox } from './outbox';

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
const refuse = (code: 'FORBIDDEN' | 'RATE_LIMITED' | 'INTERNAL_ERROR' | 'SESSION_EXPIRED') =>
  ({
    ok: false,
    error: { code, message: code, requestId: 'r', details: { retryAfterSeconds: 2 } },
  }) as const;

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

describe('failures', () => {
  it('marks a message Not sent after repeated failures, and later ones still go', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    let calls = 0;
    respond = async () => {
      calls += 1;
      return calls <= 3 ? refuse('INTERNAL_ERROR') : accept();
    };
    const box = outbox();
    await box.enqueue('c1', 'first');
    await box.enqueue('c1', 'second');
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(calls).toBe(4);
    expect((await rows()).map((row) => [row.text, row.status])).toEqual([
      ['second', 'sent'],
      ['first', 'failed'],
    ]);
  });

  it('does not overtake while retrying', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    let calls = 0;
    respond = async () => {
      calls += 1;
      return calls === 1 ? refuse('INTERNAL_ERROR') : accept();
    };
    const box = outbox();
    await box.enqueue('c1', 'first');
    await box.enqueue('c1', 'second');
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(sent.map((payload) => payload.text)).toEqual(['first', 'first', 'second']);
  });

  it('fails at once on an error that retrying cannot fix', async () => {
    respond = async () => refuse('FORBIDDEN');
    await outbox().enqueue('c1', 'hello');
    await vi.waitFor(async () => expect((await rows())[0]?.status).toBe('failed'));
    expect(sent).toHaveLength(1);
  });

  it('retries on request with the same id', async () => {
    respond = async () => refuse('FORBIDDEN');
    const box = outbox();
    const id = await box.enqueue('c1', 'hello');
    await vi.waitFor(async () => expect((await rows())[0]?.status).toBe('failed'));

    respond = accept;
    await box.retry(id);
    await vi.waitFor(async () => expect((await rows())[0]?.status).toBe('sent'));
    expect(sent.map((payload) => payload.clientMsgId)).toEqual([id, id]);
  });

  it('waits out a rate limit without counting it as a failure', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    let calls = 0;
    respond = async () => {
      calls += 1;
      return calls === 1 ? refuse('RATE_LIMITED') : accept();
    };
    await outbox().enqueue('c1', 'hello');
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1100);
    await settle();
    expect(sent).toHaveLength(2);
    expect((await rows())[0]?.status).toBe('sent');
  });

  it('does not count a dropped connection as a failure', async () => {
    respond = async () => {
      connected = false;
      throw new DisconnectedError();
    };
    const box = outbox();
    await box.enqueue('c1', 'hello');
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await vi.waitFor(async () => {
      const [row] = await db.outbox.toArray();
      expect(row).toMatchObject({ attempts: 0, state: 'pending' });
    });

    connected = true;
    respond = accept;
    box.resume();
    await vi.waitFor(async () => expect(await db.outbox.count()).toBe(0));
  });

  it('stops without failing the message when the session has ended', async () => {
    respond = async () => refuse('SESSION_EXPIRED');
    await outbox().enqueue('c1', 'hello');
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toHaveLength(1);
    expect((await rows())[0]?.status).toBe('pending');
  });

  it('sends nothing after stop', async () => {
    connected = false;
    const box = outbox();
    await box.enqueue('c1', 'hello');
    box.stop();
    connected = true;
    await box.flush();
    expect(sent).toEqual([]);
  });

  it('reports problems, and never with message text', async () => {
    const problems: string[] = [];
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const box = new Outbox({
      db,
      me: ME_ID,
      onProblem: (problem) => problems.push(problem),
      transport: { isConnected: () => true, send: async () => refuse('FORBIDDEN') },
    });
    await box.enqueue('c1', 'a secret');
    await vi.waitFor(() => expect(problems).toEqual(['message:send refused: FORBIDDEN']));
    expect(JSON.stringify([problems, logged.mock.calls])).not.toContain('a secret');
    logged.mockRestore();
  });

  it('reports a storage failure and tries again instead of stopping for good', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const problems: string[] = [];
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const box = new Outbox({
      db,
      me: ME_ID,
      onProblem: (problem) => problems.push(problem),
      transport: {
        isConnected: () => true,
        send: (payload) => {
          sent.push(payload);
          return accept();
        },
      },
    });
    connected = false;
    await db.outbox.add({
      clientMsgId: '0190a000-0000-7000-8000-000000000003',
      chatId: 'c1',
      text: 'hello',
      attempts: 0,
      state: 'pending',
    });
    const where = vi.spyOn(db.outbox, 'where').mockImplementationOnce(() => {
      throw new Error('storage broke');
    });
    await box.flush();
    expect(problems).toEqual(['outbox stopped: Error']);
    where.mockRestore();
    await vi.advanceTimersByTimeAsync(5100);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    logged.mockRestore();
  });

  it('gives up within three tries by default', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const box = new Outbox({
      db,
      me: ME_ID,
      retryBaseMs: 1,
      transport: {
        isConnected: () => true,
        send: async (payload) => {
          sent.push(payload);
          throw new Error('operation has timed out');
        },
      },
    });
    await box.enqueue('c1', 'hello');
    await vi.waitFor(async () => expect((await rows())[0]?.status).toBe('failed'));
    expect(sent).toHaveLength(3);
    logged.mockRestore();
  });

  it('stays awake if its retry timer fires a moment before the wait is over', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    let calls = 0;
    respond = async () => {
      calls += 1;
      return calls === 1 ? refuse('INTERNAL_ERROR') : accept();
    };
    await outbox().enqueue('c1', 'hello');
    await vi.waitFor(async () => {
      expect((await db.outbox.toArray())[0]?.attempts).toBe(1);
    });
    await vi.advanceTimersByTimeAsync(100);
    // The clock has not moved, so the wait is not over: another timer must be set.
    await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThan(0));
    clock.mockRestore();
    await vi.advanceTimersByTimeAsync(200);
    await vi.waitFor(() => expect(sent).toHaveLength(2));
  });
});
