import { randomBytes } from 'node:crypto';
import type { ClientToServerEvents, ServerToClientEvents } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { headers } from './auth-helpers.ts';
import { connect, signedIn, type TestSocket } from './realtime-helpers.ts';

export type Person = Awaited<ReturnType<typeof signedIn>>;

/** Calls as two (or more) apps use them: people, their devices, a 1:1 chat, and the call events. */
export function callClient(app: () => FastifyInstance, url: () => string) {
  const person = (name = 'person') =>
    signedIn(app(), `${name}-${randomBytes(4).toString('hex')}@corremadvisory.com`);
  /** Another device of the same person: a new session. */
  const otherDevice = (who: Person) => signedIn(app(), who.email);
  const device = (who: Person) => connect(url(), who.cookie);

  const request = (
    who: Person | null,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    payload?: object,
  ) =>
    app().inject({
      method,
      url: path,
      headers: headers(who?.cookie),
      ...(payload ? { payload } : {}),
    });

  async function direct(from: Person, to: Person): Promise<string> {
    const response = await request(from, 'POST', '/v1/chats/direct', { userId: to.id });
    if (response.statusCode !== 200) throw new Error(`direct chat failed: ${response.body}`);
    return (response.json() as { chat: { id: string } }).chat.id;
  }

  type Events = ClientToServerEvents;
  const emit = <E extends keyof Events>(
    socket: TestSocket,
    event: E,
    payload: Parameters<Events[E]>[0],
  ) =>
    (socket.timeout(15_000).emitWithAck as (e: E, p: unknown) => Promise<unknown>)(
      event,
      payload,
    ) as Promise<Parameters<Parameters<Events[E]>[1]>[0]>;

  /** The next `event` on this socket (matching `test`), or a failure after a while. */
  function next<E extends keyof ServerToClientEvents>(
    socket: TestSocket,
    event: E,
    test: (payload: Parameters<ServerToClientEvents[E]>[0]) => boolean = () => true,
    timeout = 10_000,
  ): Promise<Parameters<ServerToClientEvents[E]>[0]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off(event as 'call:update', listener as never);
        reject(new Error(`no ${event} within ${timeout} ms`));
      }, timeout);
      const listener = (payload: Parameters<ServerToClientEvents[E]>[0]) => {
        if (!test(payload)) return;
        clearTimeout(timer);
        socket.off(event as 'call:update', listener as never);
        resolve(payload);
      };
      socket.on(event as 'call:update', listener as never);
    });
  }

  /** A call from `caller` that `callee` answers: returns its id. */
  async function connectedCall(caller: TestSocket, callee: TestSocket, chatId: string) {
    const incoming = next(callee, 'call:incoming');
    const started = await emit(caller, 'call:start', { chatId, kind: 'voice' });
    if (!started.ok) throw new Error(`call:start failed: ${started.error.code}`);
    const callId = started.data.call.id;
    await incoming;
    const accepted = await emit(callee, 'call:accept', { callId });
    if (!accepted.ok) throw new Error(`call:accept failed: ${accepted.error.code}`);
    return callId;
  }

  return { person, otherDevice, device, request, direct, emit, next, connectedCall };
}
