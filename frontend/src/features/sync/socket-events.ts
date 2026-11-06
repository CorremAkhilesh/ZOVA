import type { ClientToServerEvents, ServerToClientEvents } from '@zuvo/protocol';
import type { Socket } from 'socket.io-client';
import { applyLastReaction } from './apply-updates';
import { startDeliveryAcks } from './delivery-acks';
import type { LocalDb } from './local-db';
import { ACK_TIMEOUT_MS } from './socket-transport';
import type { SyncEngine } from './sync-engine';

/** What the server tells this device about messages and chats, handed to the sync engine. */
export function wireSyncEvents(
  socket: Socket<ServerToClientEvents, ClientToServerEvents>,
  engine: SyncEngine,
  db: LocalDb,
) {
  socket.on('message:new', ({ message, cursor }) => void engine.onMessage(message, cursor));
  socket.on('message:played', ({ message, cursor }) => void engine.onMessage(message, cursor));
  socket.on('message:updated', ({ message, cursor }) => void engine.onUpdate(message, cursor));
  socket.on('message:removed', ({ chatId, seq, cursor }) => {
    void engine.onRemoved(chatId, seq, cursor);
  });
  socket.on('chat:cleared', ({ cursor, ...change }) => void engine.onCleared(change, cursor));
  socket.on('reaction:preview', ({ chatId, lastReaction }) => {
    void applyLastReaction(db, chatId, lastReaction).catch(() => undefined);
  });
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
  socket.on('read:update', ({ chatId, lastReadSeq, cursor }) => {
    void engine.onChatChange(chatId, { lastReadSeq }, cursor);
  });
}

export function socketDeliveryAcks(
  socket: Socket<ServerToClientEvents, ClientToServerEvents>,
  db: LocalDb,
  me: string,
) {
  return startDeliveryAcks({
    db,
    me,
    isConnected: () => socket.connected,
    send: async (chatId, seq) => {
      const ack = await socket
        .timeout(ACK_TIMEOUT_MS)
        .emitWithAck('delivered:update', { chatId, seq })
        .catch(() => null);
      return ack?.ok === true;
    },
  });
}
