import { vi } from 'vitest';

type Listener = (payload: never) => void;

interface Emitted {
  event: string;
  payload: unknown;
}

/** Component tests never open a real socket; they drive this one with `fakeSockets`. */
export interface FakeSocket {
  disconnected: boolean;
  connected: boolean;
  active: boolean;
  emitted: Emitted[];
  /** What the server acks with; default: a successful send or read. */
  respond: (event: string, payload: unknown) => unknown;
  /** The server sends an event, or the connection changes state. */
  receive: (event: string, payload?: unknown) => void;
}

export const fakeSockets: FakeSocket[] = [];

export function lastSocket(): FakeSocket {
  const socket = fakeSockets.at(-1);
  if (!socket) throw new Error('no socket opened');
  return socket;
}

let nextSeq = 1000;

/** Acks like the server would, so tests only override what they care about. */
function defaultResponse(event: string, payload: unknown) {
  if (event === 'message:send') {
    nextSeq += 1;
    return {
      ok: true,
      data: {
        messageId: `m-${nextSeq}`,
        seq: nextSeq,
        createdAt: new Date().toISOString(),
        duplicate: false,
      },
    };
  }
  if (event === 'presence:subscribe') return { ok: true, data: { users: [] } };
  const { chatId, seq } = payload as { chatId: string; seq: number };
  if (event === 'delivered:update') return { ok: true, data: { chatId, lastDeliveredSeq: seq } };
  return { ok: true, data: { chatId, lastReadSeq: seq, unreadCount: 0 } };
}

vi.mock('socket.io-client', () => ({
  io: () => {
    const listeners = new Map<string, Listener[]>();
    const fake = {
      disconnected: false,
      connected: false,
      active: true,
      emitted: [] as Emitted[],
      respond: defaultResponse,
      receive(event: string, payload?: unknown) {
        if (event === 'connect') fake.connected = true;
        if (event === 'disconnect') fake.connected = false;
        for (const listener of listeners.get(event) ?? []) listener(payload as never);
      },
      on(event: string, listener: Listener) {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
        return fake;
      },
      once: (event: string, listener: Listener) => fake.on(event, listener),
      off(event: string, listener: Listener) {
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter((candidate) => candidate !== listener),
        );
        return fake;
      },
      emit(event: string, payload: unknown) {
        fake.emitted.push({ event, payload });
        return fake;
      },
      timeout: () => ({
        emitWithAck: async (event: string, payload: unknown) => {
          fake.emitted.push({ event, payload });
          return fake.respond(event, payload);
        },
      }),
      connect() {
        fake.disconnected = false;
        return fake;
      },
      disconnect() {
        fake.disconnected = true;
        fake.connected = false;
        return fake;
      },
    };
    fakeSockets.push(fake);
    return fake;
  },
}));
