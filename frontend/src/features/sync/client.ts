import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SessionRevokedReason,
} from '@zuvo/protocol';
import { io, type Socket } from 'socket.io-client';
import { chatsApi } from '@/features/chats/api';
import { mediaApi } from '@/features/media/api';
import { MediaUploader } from '@/features/media/uploader';
import { applyChats, applyReadAck } from './apply';
import { trackAway } from './away';
import { startDeliveryAcks } from './delivery-acks';
import { loadOlderMessages, startReconciling } from './history';
import { resetLiveStatus, setPresence, setTyping } from './live-status';
import { getUserDb, type LocalDb, type MessageRow } from './local-db';
import { type EnqueueMedia, Outbox } from './outbox';
import { messageAfter, socketPlayReports } from './played-reports';
import { presenceSubscriber } from './presence-socket';
import { currentWatchList } from './presence-watch';
import { ACK_TIMEOUT_MS, socketTransport } from './socket-transport';
import { useSyncStore } from './store';
import { SyncEngine } from './sync-engine';
import { openTabChannel, watchLeadership } from './tabs';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Corrects the pill if an event was ever missed: it shows what the socket says right now. */
const STATE_CHECK_MS = 3000;
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
  userId: string;
  sendText(chatId: string, text: string): Promise<void>;
  sendMedia(input: EnqueueMedia): Promise<void>;
  cancelMedia(clientMsgId: string): Promise<void>;
  retry(clientMsgId: string): Promise<void>;
  markRead(chatId: string, seq: number): Promise<void>;
  /** Loads the page before the oldest local message. False once the start of the chat is reached. */
  loadOlder(chatId: string): Promise<boolean>;
  syncNow(): Promise<void>;
  sendTyping(chatId: string, typing: boolean): void;
  /** Replaces who the server tells this tab about. */
  watchPresence(userIds: string[]): void;
  /** I heard this voice note. Remembered here, and told to the server as soon as possible. */
  markPlayed(key: string, chatId: string, messageId: string): Promise<void>;
  messageAfter(key: string): Promise<MessageRow | null>;
  stop(): void;
}

/** Everything that talks to the server for one signed-in user. One per tab. */
export function startSyncClient(options: SyncClientOptions): SyncClient {
  const { userId, onSessionEnded, onSessionDoubt } = options;
  const db = getUserDb(userId);
  let stopped = false;
  // A stopped client's socket must not overwrite the state of the one that replaced it.
  const setStore: typeof useSyncStore.setState = (partial) => {
    if (!stopped) useSyncStore.setState(partial as never);
  };
  const socket: AppSocket = io({
    path: '/socket.io',
    withCredentials: true,
    autoConnect: navigator.onLine,
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
    onProblem: (lastProblem) => setStore({ lastProblem }),
    onMediaQueued: () => void uploader.run(),
  });
  const uploader = new MediaUploader({
    db,
    me: userId,
    api: mediaApi,
    outbox,
    isOnline: () => navigator.onLine,
  });

  const reconciling = startReconciling(db, userId, () => {
    outbox.resume();
    void uploader.run();
  });

  const deliveryAcks = startDeliveryAcks({
    db,
    me: userId,
    isConnected: () => socket.connected,
    send: async (chatId, seq) => {
      const ack = await socket
        .timeout(ACK_TIMEOUT_MS)
        .emitWithAck('delivered:update', { chatId, seq })
        .catch(() => null);
      return ack?.ok === true;
    },
  });

  const presence = presenceSubscriber(socket, () => stopped);
  const plays = socketPlayReports(db, socket);

  const awayTracker = trackAway((active) => {
    if (socket.connected) socket.emit('presence:active', { active }, () => undefined);
  });

  const channel = openTabChannel((message) => {
    if (message === 'outbox-changed') {
      outbox.resume();
      void uploader.run();
    } else onSessionDoubt();
  });
  const leadership = watchLeadership(`zuvo-outbox-${userId}`, () => {
    isLeader = true;
    setStore({ isLeader });
    outbox.resume();
    void uploader.run();
  });

  const reconnectLater = (delay: number) => {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      if (!ended && navigator.onLine) socket.connect();
    }, delay);
  };

  socket.on('connect', () => {
    failedAttempts = 0;
    setStore({ socket: 'connected', lastHandshakeError: null });
    void engine.run();
    outbox.resume();
    void uploader.run();
    deliveryAcks.resume();
    presence.watch(currentWatchList());
    void plays.flush().catch(() => undefined);
    // A new connection starts out active; it may still be hidden.
    awayTracker.reconnected();
    // Names and photos change without a new message, so the log says nothing about them.
    void chatsApi
      .recentChats()
      .then((chats) => applyChats(db, chats))
      .catch(() => undefined);
  });
  socket.on('disconnect', (reason) => {
    setStore({ socket: 'connecting' });
    presence.forget();
    if (!stopped) resetLiveStatus();
    // The client only reconnects by itself after a network loss; a server restart looks like this.
    if (reason === 'io server disconnect') reconnectLater(RECONNECT_AFTER_REFUSAL_MS);
  });
  socket.on('connect_error', (error) => {
    failedAttempts += 1;
    const refused = error as (Error & { data?: { code?: string } }) | undefined;
    const lastHandshakeError = refused?.data?.code ?? refused?.message ?? 'unknown error';
    console.error(`[socket] connection failed: ${lastHandshakeError}`);
    setStore(
      failedAttempts >= UNREACHABLE_AFTER
        ? { socket: 'unreachable', lastHandshakeError }
        : { socket: 'connecting', lastHandshakeError },
    );
    onSessionDoubt();
    // A refused handshake does not retry by itself; a network failure does.
    if (!socket.active) reconnectLater(RECONNECT_AFTER_REFUSAL_MS);
  });
  socket.on('session:revoked', ({ reason }) => {
    ended = true;
    onSessionEnded(reason);
  });
  socket.on('message:new', ({ message, cursor }) => void engine.onMessage(message, cursor));
  socket.on('chat:updated', ({ chatId, cursor, type: _type, unreadCount: _count, ...change }) => {
    void engine.onChatChange(chatId, change, cursor);
  });
  socket.on('receipt:update', ({ chatId, lastDeliveredSeq, lastReadSeq, cursor }) => {
    void engine.onChatChange(
      chatId,
      { peerDeliveredSeq: lastDeliveredSeq, peerReadSeq: lastReadSeq },
      cursor,
    );
  });
  socket.on('typing:update', ({ chatId, userId: who, typing }) => setTyping(chatId, who, typing));
  socket.on('presence:update', setPresence);
  socket.on('presence:resubscribe', () => {
    presence.forget();
    presence.watch(currentWatchList());
  });
  socket.on('message:played', ({ message, cursor }) => void engine.onMessage(message, cursor));
  socket.on('read:update', ({ chatId, lastReadSeq, cursor }) => {
    void engine.onChatChange(chatId, { lastReadSeq }, cursor);
  });

  const onOnline = () => {
    if (ended) return;
    socket.connect();
    void uploader.run();
  };
  const onOffline = () => {
    socket.disconnect();
    setStore({ socket: 'connecting' });
  };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  const stateCheck = setInterval(() => {
    const said = useSyncStore.getState().socket;
    if (socket.connected !== (said === 'connected')) {
      setStore({ socket: socket.connected ? 'connected' : 'connecting' });
    }
  }, STATE_CHECK_MS);

  // History and sync use REST: they do not need to wait for the socket.
  void engine.run();

  return {
    db,
    userId,
    async sendText(chatId, text) {
      await outbox.enqueue(chatId, text);
      channel.post('outbox-changed');
    },
    async sendMedia(input) {
      await outbox.enqueueMedia(input);
      channel.post('outbox-changed');
    },
    async cancelMedia(clientMsgId) {
      uploader.cancel(clientMsgId);
      const uploadId = await outbox.cancel(clientMsgId);
      if (uploadId) await mediaApi.cancel(uploadId).catch(() => undefined);
    },
    async retry(clientMsgId) {
      await outbox.retry(clientMsgId);
      void uploader.run();
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
    loadOlder(chatId) {
      return loadOlderMessages(db, userId, chatId);
    },
    syncNow: () => engine.run(),
    sendTyping(chatId, typing) {
      if (!socket.connected) return;
      socket.emit(typing ? 'typing:start' : 'typing:stop', { chatId }, () => undefined);
    },
    watchPresence: presence.watch,
    markPlayed: plays.record,
    messageAfter: (key) => messageAfter(db, key),
    stop() {
      setStore({ socket: 'connecting', isLeader: false });
      stopped = true;
      ended = true;
      clearInterval(stateCheck);
      awayTracker.stop();
      deliveryAcks.stop();
      uploader.stop();
      reconciling.stop();
      resetLiveStatus();
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
