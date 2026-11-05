import type { AppSocket } from './client';
import { replacePresence } from './live-status';
import { ACK_TIMEOUT_MS } from './socket-transport';

/** Tells the server who this tab wants to hear about, without repeating itself. */
export function presenceSubscriber(socket: AppSocket, isStopped: () => boolean) {
  let watching: string | null = null;
  return {
    watch(userIds: string[]) {
      const key = userIds.join();
      if (!socket.connected || key === watching) return;
      watching = key;
      void socket
        .timeout(ACK_TIMEOUT_MS)
        .emitWithAck('presence:subscribe', { userIds })
        .then((ack) => {
          if (ack.ok && !isStopped()) replacePresence(ack.data.users);
        })
        .catch(() => undefined);
    },
    /** A new connection watches nobody until it asks. */
    forget() {
      watching = null;
    },
  };
}
