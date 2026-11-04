import type { SessionRevokedReason } from '@zuvo/protocol';

/** Largest delay setTimeout supports (~24.8 days); longer waits are re-armed. */
const MAX_TIMEOUT = 2_147_483_647;

interface ClosableSocket {
  emit(event: 'session:revoked', payload: { reason: SessionRevokedReason }): unknown;
  disconnect(close: true): unknown;
  once(event: 'disconnect', listener: () => void): unknown;
}

/** Says why, then closes: the client then knows not to reconnect. */
export function closeSocket(socket: ClosableSocket, reason: SessionRevokedReason): void {
  socket.emit('session:revoked', { reason });
  socket.disconnect(true);
}

/** Disconnects the socket exactly when its session expires. Sessions are never extended. */
export function armSessionExpiry(
  socket: ClosableSocket,
  expiresAt: Date,
  now: () => number = Date.now,
): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    const remaining = expiresAt.getTime() - now();
    if (remaining <= 0) {
      closeSocket(socket, 'expired');
      return;
    }
    timer = setTimeout(arm, Math.min(remaining, MAX_TIMEOUT));
    timer.unref?.();
  };
  arm();
  socket.once('disconnect', () => clearTimeout(timer));
}
