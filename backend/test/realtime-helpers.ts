import { randomBytes } from 'node:crypto';
import type { ClientToServerEvents, ServerToClientEvents } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { io, type Socket } from 'socket.io-client';
import { vi } from 'vitest';
import { ORIGIN, signIn } from './auth-helpers.ts';

export type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** A valid UUIDv7, as clients generate them. */
export function uuidv7(): string {
  const time = Date.now().toString(16).padStart(12, '0');
  const random = randomBytes(10).toString('hex');
  const variant = ((Number.parseInt(random.slice(3, 4), 16) & 0x3) | 0x8).toString(16);
  return `${time.slice(0, 8)}-${time.slice(8)}-7${random.slice(0, 3)}-${variant}${random.slice(4, 7)}-${random.slice(7, 19)}`;
}

/** Starts the app on a free port and returns its URL. */
export async function listen(app: FastifyInstance): Promise<string> {
  return app.listen({ host: '127.0.0.1', port: 0 });
}

const sockets = new Set<TestSocket>();

export function openSocket(url: string, cookie?: string, origin: string = ORIGIN): TestSocket {
  const socket: TestSocket = io(url, {
    path: '/socket.io',
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    extraHeaders: { origin, ...(cookie ? { cookie } : {}) },
  });
  sockets.add(socket);
  return socket;
}

/** Resolves once connected; rejects with the server's refusal. */
export function connected(socket: TestSocket): Promise<TestSocket> {
  return new Promise((resolve, reject) => {
    if (socket.connected) resolve(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

export const connect = (url: string, cookie?: string) => connected(openSocket(url, cookie));

export function closeAllSockets(): void {
  for (const socket of sockets) socket.disconnect();
  sockets.clear();
}

/** Records every payload of `event` from now on. */
export function record<E extends keyof ServerToClientEvents>(socket: TestSocket, event: E) {
  const payloads: Array<Parameters<ServerToClientEvents[E]>[0]> = [];
  socket.on(event as 'message:new', ((payload: never) => payloads.push(payload)) as never);
  return payloads;
}

export function nextDisconnect(socket: TestSocket): Promise<string> {
  return new Promise((resolve) => socket.once('disconnect', (reason) => resolve(reason)));
}

export const send = (socket: TestSocket, chatId: string, text: string, clientMsgId = uuidv7()) =>
  socket.timeout(30_000).emitWithAck('message:send', { chatId, clientMsgId, text });

export const waitUntil = (check: () => void, timeout = 15_000) =>
  vi.waitFor(check, { timeout, interval: 25 });

/** A signed-in user with a known id and cookie (the real OTP flow). */
export async function signedIn(app: FastifyInstance, email: string) {
  const { cookie, response } = await signIn(app, email);
  const body = response.json() as { user: { id: string }; session: { id: string } };
  return { cookie, id: body.user.id, sessionId: body.session.id, email };
}
