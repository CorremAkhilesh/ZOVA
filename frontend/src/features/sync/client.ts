import type {
  ClientToServerEvents,
  SendMessagePayload,
  ServerToClientEvents,
  SessionRevokedReason,
} from '@zuvo/protocol';
import Dexie from 'dexie';
import { io, type Socket } from 'socket.io-client';
import { chatsApi } from '@/features/chats/api';
import { applyChats, applyHistory, applyReadAck } from './apply';
import { getUserDb, type LocalDb, PENDING_ORDER_BASE } from './local-db';
import { DisconnectedError, Outbox, type OutboxTransport } from './outbox';
import { useSyncStore } from './store';
import { SyncEngine } from './sync-engine';
import { openTabChannel, watchLeadership } from './tabs';

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const ACK_TIMEOUT_MS = 15_000;
const RECONNECT_AFTER_REFUSAL_MS = 5000;
/** Connection attempts that fail before the pill says the server cannot be reached. */
const UNREACHABLE_AFTER = 2;

export interface SyncClientOptions {
  userId: string;
  /** The server pushed `session:revoked`. */
  onSessionEnded: (reason: SessionRevokedReason) => void;
  /** The handshake was refused or a request got 401: ask the API whether the session still exists. */
  onSessionDoubt: () => void;
}

export interface SyncClient {
  db: LocalDb;
  sendText(chatId: string, text: string): Promise<void>;
  retry(clientMsgId: string): Promise<void>;
  markRead(chatId: string, seq: number): Promise<void>;
  /** Loads the page before the oldest local message. False once the start of the chat is reached. */
  loadOlder(chatId: string): Promise<boolean>;
  syncNow(): Promise<void>;
  stop(): void;
}

function socketTransport(socket: AppSocket): OutboxTransport {
  return {
    isConnected: () => socket.connected,
    send(payload: SendMessagePayload) {
      return new Promise((resolve, reject) => {
        const onDisconnect = () => reject(new DisconnectedError());
        socket.once('disconnect', onDisconnect);
        socket
          .timeout(ACK_TIMEOUT_MS)
          .emitWithAck('message:send', payload)
          .then(resolve, reject)
          .finally(() => socket.off('disconnect', onDisconnect));
      });
    },
  };
}

/** Everything that talks to the server for one signed-in user. One per tab. */
export function startSyncClient(options: SyncClientOptions): SyncClient {
  const { userId, onSessionEnded, onSessionDoubt } = options;
  const db = getUserDb(userId);
  const setStore = useSyncStore.setState;
  const socket: AppSocket = io({
    path: '/socket.io',
    withCredentials: true,
    autoConnect: navigator.onLine,
    // Exponential backoff with jitter, so a restart does not bring everyone back at once.
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30_000,
    randomizationFactor: 0.5,
  });

  let ended = false;
  let isLeader = false;
  let failedAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  const engine = new SyncEngine({
    db,
    me: userId,
    api: chatsApi,
    onStatus: (sync) => setStore({ sync }),
    onUnauthorized: onSessionDoubt,
  });
  const outbox = new Outbox({
    db,
    me: userId,
    transport: socketTransport(socket),
    isLeader: () => isLeader,
  });

  const channel = openTabChannel((message) => {
    if (message === 'outbox-changed') outbox.resume();
    else onSessionDoubt();
  });
  const leadership = watchLeadership(`zuvo-outbox-${userId}`, () => {
    isLeader = true;
    outbox.resume();
  });

  const reconnectLater = (delay: number) => {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      if (!ended && navigator.onLine) socket.connect();
    }, delay);
  };

  socket.on('connect', () => {
    failedAttempts = 0;
    setStore({ socket: 'connected' });
    void engine.run();
    outbox.resume();
    // Names and photos change without a new message, so the log says nothing about them.
    void chatsApi
      .recentChats()
      .then((chats) => applyChats(db, chats))
      .catch(() => undefined);
  });
  socket.on('disconnect', (reason) => {
    setStore({ socket: 'connecting' });
    // The client only reconnects by itself after a network loss; a server restart looks like this.
    if (reason === 'io server disconnect') reconnectLater(RECONNECT_AFTER_REFUSAL_MS);
  });
  socket.on('connect_error', () => {
    failedAttempts += 1;
    if (failedAttempts >= UNREACHABLE_AFTER) setStore({ socket: 'unreachable' });
    onSessionDoubt();
    // A refused handshake does not retry by itself; a network failure does.
    if (!socket.active) reconnectLater(RECONNECT_AFTER_REFUSAL_MS);
  });
  socket.on('session:revoked', ({ reason }) => {
    ended = true;
    onSessionEnded(reason);
  });
  socket.on('message:new', ({ message, cursor }) => void engine.onMessage(message, cursor));
  socket.on('chat:updated', ({ chatId, cursor, seq, lastMessage, lastReadSeq, lastActivityAt }) => {
    void engine.onChatChange(chatId, { seq, lastMessage, lastReadSeq, lastActivityAt }, cursor);
  });
  socket.on('read:update', ({ chatId, lastReadSeq, cursor }) => {
    void engine.onChatChange(chatId, { lastReadSeq }, cursor);
  });

  // The browser knows first, and some environments leave a dead socket open for a long time.
  const onOnline = () => {
    if (!ended) socket.connect();
  };
  const onOffline = () => {
    socket.disconnect();
    setStore({ socket: 'connecting' });
  };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  // History and sync use REST: they do not need to wait for the socket.
  void engine.run();

  return {
    db,
    async sendText(chatId, text) {
      await outbox.enqueue(chatId, text);
      channel.post('outbox-changed');
    },
    async retry(clientMsgId) {
      await outbox.retry(clientMsgId);
      channel.post('outbox-changed');
    },
    async markRead(chatId, seq) {
      if (!socket.connected) return;
      const ack = await socket
        .timeout(ACK_TIMEOUT_MS)
        .emitWithAck('read:update', { chatId, seq })
        .catch(() => null);
      if (ack?.ok) await applyReadAck(db, chatId, ack.data.lastReadSeq);
    },
    async loadOlder(chatId) {
      const oldest = await db.messages
        .where('[chatId+order]')
        .between([chatId, Dexie.minKey], [chatId, PENDING_ORDER_BASE], true, false)
        .first();
      if (oldest?.seq === 1) return false;
      const page = await chatsApi.history(chatId, oldest?.seq ?? undefined);
      await applyHistory(db, userId, page.items);
      return page.hasMore;
    },
    syncNow: () => engine.run(),
    stop() {
      ended = true;
      clearTimeout(reconnectTimer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      engine.stop();
      outbox.stop();
      leadership.stop();
      channel.close();
      socket.disconnect();
    },
  };
}
