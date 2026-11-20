import type { AckResponse } from '@zuvo/protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../test/helpers.ts';
import {
  closeAllSockets,
  connect,
  listen,
  openSocket,
  record,
  signedIn,
  type TestSocket,
} from '../../test/realtime-helpers.ts';
import { getOrCreateDirectChat } from '../chats/chats.service.ts';
import { MAX_SOCKETS_PER_SESSION } from './connection-limits.ts';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let url: string;
const app = () => ctx.app;
let seed = 0;

const pair = async () => {
  seed += 1;
  const alice = await signedIn(app(), `f${seed}a@corremadvisory.com`);
  const bob = await signedIn(app(), `f${seed}b@corremadvisory.com`);
  const { id: chatId } = await getOrCreateDirectChat(app(), alice.id, bob.id);
  return { alice, bob, chatId };
};

beforeAll(async () => {
  ctx = await buildTestApp();
  url = await listen(app());
});
afterEach(() => closeAllSockets());
afterAll(async () => {
  await ctx.cleanup();
});

const settle = (ms = 500) => new Promise((resolve) => setTimeout(resolve, ms));

/** Fires `count` events at once and returns how each was answered. */
async function burst(
  socket: TestSocket,
  count: number,
  emit: (socket: TestSocket, i: number) => Promise<AckResponse<unknown>>,
) {
  const answers = await Promise.all(Array.from({ length: count }, (_, i) => emit(socket, i)));
  return {
    ok: answers.filter((answer) => answer.ok).length,
    limited: answers.filter((answer) => !answer.ok && answer.error.code === 'RATE_LIMITED').length,
  };
}

describe('flooding socket events', () => {
  it('cannot make the server announce online/offline to my contacts without end', async () => {
    const { alice, bob } = await pair();
    const watcher = await connect(url, alice.cookie);
    const events = record(watcher, 'presence:update');
    await watcher.timeout(10_000).emitWithAck('presence:subscribe', { userIds: [bob.id] });
    const flooder = await connect(url, bob.cookie);

    const result = await burst(flooder, 200, (socket, i) =>
      socket.timeout(10_000).emitWithAck('presence:active', { active: i % 2 === 1 }),
    );
    await settle();
    expect(result.limited).toBeGreaterThan(150);
    expect(events.length).toBeLessThanOrEqual(12);
  });

  it('refuses a flood of read and delivered updates before touching the database', async () => {
    const { bob, chatId } = await pair();
    const flooder = await connect(url, bob.cookie);
    const read = await burst(flooder, 400, (socket) =>
      socket.timeout(10_000).emitWithAck('read:update', { chatId, seq: 0 }),
    );
    expect(read.limited).toBeGreaterThan(200);
    const window = await burst(flooder, 100, (socket) =>
      socket.timeout(10_000).emitWithAck('window:state', { visible: true, focused: true }),
    );
    expect(window.limited).toBeGreaterThan(50);
  });

  it('keeps normal use well inside the limits', async () => {
    const { bob, chatId } = await pair();
    const socket = await connect(url, bob.cookie);
    const result = await burst(socket, 10, (s) =>
      s.timeout(10_000).emitWithAck('read:update', { chatId, seq: 0 }),
    );
    expect(result).toEqual({ ok: 10, limited: 0 });
  });
});

describe('connections', () => {
  it(`allows ${MAX_SOCKETS_PER_SESSION} sockets per session, and refuses more`, async () => {
    const { bob } = await pair();
    for (let i = 0; i < MAX_SOCKETS_PER_SESSION; i++) await connect(url, bob.cookie);
    const extra = openSocket(url, bob.cookie);
    const code = await new Promise<string>((resolve) => {
      extra.once('connect_error', (error: Error & { data?: { code?: string } }) =>
        resolve(error.data?.code ?? 'none'),
      );
      extra.once('connect', () => resolve('connected'));
    });
    expect(code).toBe('RATE_LIMITED');
  });
});

describe('handshakes from one address', () => {
  it('are limited per minute, signed in or not', async () => {
    const own = await buildTestApp({}, { SOCKET_HANDSHAKES_PER_MINUTE: '5' });
    try {
      const ownUrl = await listen(own.app);
      const codes: string[] = [];
      for (let i = 0; i < 7; i++) {
        const socket = openSocket(ownUrl);
        codes.push(
          await new Promise<string>((resolve) =>
            socket.once('connect_error', (error: Error & { data?: { code?: string } }) =>
              resolve(error.data?.code ?? 'none'),
            ),
          ),
        );
        socket.close();
      }
      expect(codes).toEqual([
        'UNAUTHENTICATED',
        'UNAUTHENTICATED',
        'UNAUTHENTICATED',
        'UNAUTHENTICATED',
        'UNAUTHENTICATED',
        'RATE_LIMITED',
        'RATE_LIMITED',
      ]);
    } finally {
      await own.cleanup();
    }
  });
});
