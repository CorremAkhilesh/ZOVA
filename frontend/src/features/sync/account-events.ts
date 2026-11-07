import type { ChatSettings, ClientToServerEvents, ServerToClientEvents } from '@zuvo/protocol';
import type { Socket } from 'socket.io-client';

/**
 * Something about my account changed on another device (settings, blocks), or the socket came back
 * and may have missed such a change. Not chats or messages: the sync log carries those.
 */
export type AccountChange =
  | { kind: 'settings'; settings: ChatSettings }
  | { kind: 'blocks' }
  | { kind: 'reconnected' };

export function wireAccountEvents(
  socket: Socket<ServerToClientEvents, ClientToServerEvents>,
  onChange: (change: AccountChange) => void,
) {
  socket.on('connect', () => onChange({ kind: 'reconnected' }));
  socket.on('settings:updated', ({ settings }) => onChange({ kind: 'settings', settings }));
  socket.on('blocks:changed', () => onChange({ kind: 'blocks' }));
}
