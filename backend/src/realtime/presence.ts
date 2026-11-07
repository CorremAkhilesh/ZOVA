import type { PresenceEvent } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { chatModels, oid, pairKeyOf } from '../chats/chats.service.ts';
import { blockedEitherWay } from '../moderation/blocks.service.ts';
import { privacyOf, type UserDoc, usersModel } from '../users/user-record.ts';
import type { PresenceStore } from './presence-store.ts';
import { userRoom, type ZuvoServer, type ZuvoSocket } from './server.ts';

export const PRESENCE_TTL_MS = 45_000;
const HEARTBEAT_MS = 15_000;
const SWEEP_MS = 15_000;
/** A flapping connection writes last seen at most this often. */
const LAST_SEEN_WRITE_MS = 30_000;

const watchRoom = (userId: string) => `presence:${userId}`;
/** Sockets of people hiding their own last seen, who therefore see nobody else's either. */
const HIDDEN_ROOM = 'presence:hidden';

const hidden = (userId: string): PresenceEvent => ({ userId, online: false, lastSeenAt: null });

export interface Presence {
  connected(socket: ZuvoSocket): Promise<void>;
  /** The tab went away (`false`), or came back. */
  setActive(socket: ZuvoSocket, active: boolean): Promise<void>;
  disconnected(socket: ZuvoSocket): Promise<void>;
  /** Replaces what this socket watches, and answers with what it may see. */
  subscribe(socket: ZuvoSocket, userIds: string[]): Promise<PresenceEvent[]>;
  privacyChanged(userId: string, hideLastSeen: boolean): void;
  /** One of them blocked or unblocked the other: neither hears about the other from now on. */
  blockChanged(userId: string, otherId: string): void;
  stop(): void;
}

export function createPresence(
  app: FastifyInstance,
  io: ZuvoServer,
  store: PresenceStore,
): Presence {
  const activeSockets = new Map<string, string>();
  const lastSeenWrites = new Map<string, number>();

  const saveLastSeen = async (userId: string, at: Date) => {
    const previous = lastSeenWrites.get(userId) ?? 0;
    if (at.getTime() - previous < LAST_SEEN_WRITE_MS) return;
    lastSeenWrites.set(userId, at.getTime());
    await usersModel(app).updateOne({ _id: oid(userId) }, { $set: { lastSeenAt: at } });
  };

  const announce = async (userId: string, online: boolean, at: Date) => {
    const user = (await usersModel(app).findById(userId).select({ privacy: 1 }).lean()) as UserDoc;
    if (!user || privacyOf(user).lastSeen === 'nobody') return;
    io.to(watchRoom(userId))
      .except(HIDDEN_ROOM)
      .emit('presence:update', {
        userId,
        online,
        lastSeenAt: online ? null : at.toISOString(),
      });
  };

  const wentOffline = async (userId: string) => {
    const at = new Date();
    await saveLastSeen(userId, at);
    await announce(userId, false, at);
  };

  const quietly = (work: Promise<unknown>, what: string) =>
    void work.catch((error: unknown) => app.log.warn({ err: error }, `presence: ${what} failed`));

  const heartbeat = setInterval(() => {
    const entries = [...activeSockets].map(([socketId, userId]): [string, string] => [
      userId,
      socketId,
    ]);
    quietly(store.heartbeat(entries), 'heartbeat');
  }, HEARTBEAT_MS);
  heartbeat.unref();

  // Sockets of a crashed instance stop being refreshed; some other instance notices.
  const sweep = setInterval(() => {
    quietly(
      store.sweep().then((users) => Promise.all(users.map(wentOffline))),
      'sweep',
    );
  }, SWEEP_MS);
  sweep.unref();

  const add = async (socket: ZuvoSocket) => {
    const { userId } = socket.data;
    activeSockets.set(socket.id, userId);
    if (await store.add(userId, socket.id)) await announce(userId, true, new Date());
  };
  const remove = async (socket: ZuvoSocket) => {
    const { userId } = socket.data;
    activeSockets.delete(socket.id);
    if (await store.remove(userId, socket.id)) await wentOffline(userId);
  };

  return {
    async connected(socket) {
      if (socket.data.hideLastSeen) await socket.join(HIDDEN_ROOM);
      await add(socket);
    },
    setActive: (socket, active) => (active ? add(socket) : remove(socket)),
    disconnected: remove,

    async subscribe(socket, requested) {
      const viewerId = socket.data.userId;
      const userIds = [...new Set(requested)].filter((id) => id !== viewerId);
      const docs = (await usersModel(app)
        .find({ _id: { $in: [...userIds, viewerId].map(oid) } })
        .select({ privacy: 1, status: 1, lastSeenAt: 1 })
        .lean()) as UserDoc[];
      const byId = new Map(docs.map((doc) => [doc._id.toString(), doc]));
      const viewer = byId.get(viewerId);
      const canLook = viewer && privacyOf(viewer).lastSeen !== 'nobody';

      // Only people I share a chat with, and who allow it.
      const shared = canLook
        ? await chatModels(app)
            .Chat.find({
              type: 'direct',
              pairKey: { $in: userIds.map((id) => pairKeyOf(id, viewerId)) },
            })
            .select({ pairKey: 1 })
            .lean()
        : [];
      const pairKeys = new Set(shared.map((chat) => chat.pairKey));
      const blocked = canLook ? await blockedEitherWay(app, viewerId, userIds) : new Set();
      const visible = userIds.filter((id) => {
        const doc = byId.get(id);
        return (
          doc &&
          doc.status !== 'deactivated' &&
          privacyOf(doc).lastSeen !== 'nobody' &&
          pairKeys.has(pairKeyOf(id, viewerId)) &&
          !blocked.has(id)
        );
      });

      const keep = new Set(visible.map(watchRoom));
      for (const room of socket.rooms) {
        if (room.startsWith('presence:') && room !== HIDDEN_ROOM && !keep.has(room)) {
          await socket.leave(room);
        }
      }
      await socket.join([...keep]);

      const online = await store.online(visible);
      const allowed = new Set(visible);
      return userIds.map((userId) =>
        allowed.has(userId)
          ? {
              userId,
              online: online.has(userId),
              lastSeenAt: online.has(userId)
                ? null
                : (byId.get(userId)?.lastSeenAt?.toISOString() ?? null),
            }
          : hidden(userId),
      );
    },

    privacyChanged(userId, hideLastSeen) {
      const mine = io.in(userRoom(userId));
      // Enforced from this moment, even for a client that never asks again.
      if (hideLastSeen) mine.socketsJoin(HIDDEN_ROOM);
      else mine.socketsLeave(HIDDEN_ROOM);
      io.to(watchRoom(userId)).emit('presence:resubscribe', {});
      io.to(userRoom(userId)).emit('presence:resubscribe', {});
    },

    blockChanged(userId, otherId) {
      // Enforced at once, even for a client that never asks again. An unblock lets them back in
      // only through a new subscribe, which checks everything again.
      io.in(userRoom(userId)).socketsLeave(watchRoom(otherId));
      io.in(userRoom(otherId)).socketsLeave(watchRoom(userId));
      io.to(userRoom(userId)).emit('presence:resubscribe', {});
      io.to(userRoom(otherId)).emit('presence:resubscribe', {});
    },

    stop() {
      clearInterval(heartbeat);
      clearInterval(sweep);
    },
  };
}
