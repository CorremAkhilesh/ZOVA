import { createAdapter } from '@socket.io/redis-adapter';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SessionRevokedReason,
} from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import { Server, type Socket } from 'socket.io';
import { type AuthSessionRecord, trackActivity } from '../auth/session.ts';
import type { Env } from '../config/env.ts';
import { loadUser } from '../users/user-record.ts';
import { registerHandlers } from './handlers.ts';
import { armSessionExpiry } from './session-guard.ts';

export interface SocketData {
  userId: string;
  session: AuthSessionRecord;
}

type NoEvents = Record<string, never>;
export type ZuvoServer = Server<ClientToServerEvents, ServerToClientEvents, NoEvents, SocketData>;
export type ZuvoSocket = Socket<ClientToServerEvents, ServerToClientEvents, NoEvents, SocketData>;

export const userRoom = (userId: string) => `user:${userId}`;
export const sessionRoom = (sessionId: string) => `session:${sessionId}`;

export interface Realtime {
  io: ZuvoServer;
  /** To all of a user's devices, on every API instance. */
  emitToUser<E extends keyof ServerToClientEvents>(
    userId: string,
    event: E,
    ...payload: Parameters<ServerToClientEvents[E]>
  ): void;
  /** Says why, then closes that session's sockets on every instance. */
  revokeSession(sessionId: string, reason: SessionRevokedReason): void;
  /** The same for all of a user's sessions. */
  revokeUser(userId: string, reason: SessionRevokedReason): void;
}

declare module 'fastify' {
  interface FastifyInstance {
    realtime: Realtime;
  }
}

interface RealtimeOptions {
  env: Env;
  /** Connection the adapter duplicates; default: the app's Redis. Null means one instance only. */
  adapterRedis?: Redis | null;
  /** Channel prefix for the adapter, so test runs sharing a Redis stay apart. */
  adapterKey?: string;
}

function authError(code: 'UNAUTHENTICATED' | 'SESSION_EXPIRED' | 'ACCOUNT_DEACTIVATED') {
  return Object.assign(new Error(code), { data: { code } });
}

/** Who is connecting: the same session cookie and rules as REST, checked on the handshake. */
async function authenticate(app: FastifyInstance, socket: ZuvoSocket): Promise<void> {
  const headers = new Headers();
  const cookie = socket.request.headers.cookie;
  if (!cookie) throw authError('UNAUTHENTICATED');
  headers.set('cookie', cookie);
  const result = await app.auth.api.getSession({ headers });
  if (!result) throw authError('SESSION_EXPIRED');
  const session = result.session as AuthSessionRecord;
  if (new Date(session.expiresAt).getTime() <= Date.now()) throw authError('SESSION_EXPIRED');
  const user = await loadUser(app, result.user.id);
  if (!user) throw authError('SESSION_EXPIRED');
  if (user.status === 'deactivated') throw authError('ACCOUNT_DEACTIVATED');
  socket.data.userId = user._id.toString();
  socket.data.session = { ...session, expiresAt: new Date(session.expiresAt) };
}

async function setupRealtime(app: FastifyInstance, options: RealtimeOptions) {
  const { env } = options;
  const origins = new Set([env.APP_URL, ...env.CORS_ORIGINS]);
  const io: ZuvoServer = new Server(app.server, {
    path: '/socket.io',
    // A message is at most 4096 characters (16 KB of UTF-8) plus a small envelope.
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 25_000,
    pingTimeout: 20_000,
    // Catch-up is the job of /v1/sync, not of replaying packets.
    serveClient: false,
    cors: { origin: [...origins], credentials: true },
    // Browsers send Origin: refuse other sites (cross-site WebSocket hijacking).
    allowRequest: (request, callback) => {
      const { origin } = request.headers;
      const allowed = origin === undefined || origins.has(origin);
      if (!allowed) app.log.warn({ origin }, 'socket refused: origin not allowed');
      callback(null, allowed);
    },
  });

  // A real client only: tests may inject a small stub as the app's Redis.
  const appRedis = app.redis instanceof Redis ? app.redis : null;
  const base = options.adapterRedis === undefined ? appRedis : options.adapterRedis;
  const adapterClients = base ? [base.duplicate(), base.duplicate()] : [];
  const [pub, sub] = adapterClients;
  if (pub && sub) {
    for (const client of adapterClients) {
      client.on('error', (error) => app.log.error({ err: error }, 'socket adapter redis error'));
    }
    io.adapter(createAdapter(pub, sub, { key: options.adapterKey ?? 'zuvo:socket.io' }));
  } else {
    app.log.warn('no Redis: realtime events reach this API instance only');
  }

  io.use((socket, next) => {
    authenticate(app, socket).then(
      () => next(),
      (error: unknown) => {
        if (error instanceof Error && 'data' in error) {
          app.log.warn({ code: error.message }, 'socket handshake refused');
          next(error);
        } else {
          app.log.error({ err: error }, 'socket authentication failed');
          next(authError('SESSION_EXPIRED'));
        }
      },
    );
  });

  io.on('connection', (socket) => {
    const { userId, session } = socket.data;
    app.log.info({ userId, socketId: socket.id }, 'socket connected');
    socket.on('disconnect', (reason) => {
      app.log.info({ userId, socketId: socket.id, reason }, 'socket disconnected');
    });
    void socket.join([userRoom(userId), sessionRoom(session.id)]);
    armSessionExpiry(socket, session.expiresAt);
    registerHandlers(app, socket);
    void trackActivity(app, session).catch((error: unknown) =>
      app.log.warn({ err: error }, 'could not record session activity'),
    );
  });

  const revoke = (room: string, reason: SessionRevokedReason) => {
    io.to(room).emit('session:revoked', { reason });
    io.in(room).disconnectSockets(true);
  };

  app.decorate('realtime', {
    io,
    emitToUser(userId, event, ...payload) {
      (io.to(userRoom(userId)).emit as (name: string, ...args: unknown[]) => boolean)(
        event,
        ...payload,
      );
    },
    revokeSession: (sessionId, reason) => revoke(sessionRoom(sessionId), reason),
    revokeUser: (userId, reason) => revoke(userRoom(userId), reason),
  } satisfies Realtime);

  // Close our sockets first, so the HTTP server can finish closing.
  app.addHook('preClose', async () => {
    io.local.disconnectSockets(true);
  });
  app.addHook('onClose', async () => {
    io.engine?.close();
    await Promise.all(adapterClients.map((client) => client.quit().catch(() => undefined)));
  });
}

export const realtimePlugin = fp(setupRealtime, {
  name: 'realtime',
  fastify: '5.x',
  dependencies: ['auth', 'redis'],
});
