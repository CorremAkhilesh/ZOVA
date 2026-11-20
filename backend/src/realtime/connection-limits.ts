import { isIP } from 'node:net';
import type { FastifyInstance } from 'fastify';
import type { ZuvoServer, ZuvoSocket } from './server.ts';

/** Tabs and windows of one sign-in that may be connected at once. */
export const MAX_SOCKETS_PER_SESSION = 10;

/** Same trust as Fastify's `trustProxy: ['loopback', 'uniquelocal']`: the host Nginx in front. */
const TRUSTED_PROXY =
  /^(127\.|::1$|::ffff:127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::ffff:(10|192\.168)\.|f[cd])/i;

/** The client's address: Nginx's X-Forwarded-For (it overwrites it) when it comes through Nginx. */
export function clientAddress(socket: Pick<ZuvoSocket, 'handshake'>): string {
  const peer = socket.handshake.address;
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  const last = (Array.isArray(forwarded) ? forwarded.join(',') : (forwarded ?? ''))
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1);
  return TRUSTED_PROXY.test(peer) && last && isIP(last) ? last : peer;
}

/** Before the session lookup, so a flood of handshakes costs no database work. */
export async function handshakeAllowed(app: FastifyInstance, socket: ZuvoSocket): Promise<boolean> {
  const key = `zuvo:rate:socket-ip:${clientAddress(socket)}`;
  return (await app.counterStore.increment(key, 60)) <= app.env.SOCKET_HANDSHAKES_PER_MINUTE;
}

/** Counts this session's sockets on every API instance (through the adapter). */
export async function sessionHasRoom(io: ZuvoServer, room: string): Promise<boolean> {
  const sockets = await io.in(room).fetchSockets();
  return sockets.length < MAX_SOCKETS_PER_SESSION;
}
