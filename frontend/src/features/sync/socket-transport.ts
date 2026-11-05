import type { SendMessagePayload } from '@zuvo/protocol';
import type { AppSocket } from './client';
import { DisconnectedError, type OutboxTransport } from './outbox';

export const ACK_TIMEOUT_MS = 10_000;

export function socketTransport(socket: AppSocket): OutboxTransport {
  return {
    isConnected: () => socket.connected,
    send(payload: SendMessagePayload) {
      return new Promise((resolve, reject) => {
        const onDisconnect = () => reject(new DisconnectedError());
        socket.once('disconnect', onDisconnect);
        socket
          .timeout(ACK_TIMEOUT_MS)
          .emitWithAck('message:send', payload)
          .then(resolve, (error: unknown) => {
            reject(error);
            // "Connected" but no answer: the connection is wedged, so replace it.
            socket.disconnect().connect();
          })
          .finally(() => socket.off('disconnect', onDisconnect));
      });
    },
  };
}
