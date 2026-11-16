import type {
  Appearance,
  ChatSettings,
  ClientToServerEvents,
  PushSettings,
  QuietHours,
  ScheduledFailure,
  ServerToClientEvents,
} from '@zuvo/protocol';
import type { Socket } from 'socket.io-client';

/**
 * Something about my account changed on another device (settings, blocks, folders), or the socket came back
 * and may have missed such a change. Not chats or messages: the sync log carries those.
 */
export type AccountChange =
  | { kind: 'settings'; settings: ChatSettings }
  | { kind: 'blocks' }
  | { kind: 'folders' }
  | { kind: 'lock' }
  | { kind: 'appearance'; appearance: Appearance }
  | { kind: 'quietHours'; quietHours: QuietHours }
  | { kind: 'push'; settings: PushSettings }
  | { kind: 'scheduled'; chatId: string; failed: { id: string; reason: ScheduledFailure } | null }
  | { kind: 'reconnected' };

export function wireAccountEvents(
  socket: Socket<ServerToClientEvents, ClientToServerEvents>,
  onChange: (change: AccountChange) => void,
) {
  socket.on('connect', () => onChange({ kind: 'reconnected' }));
  socket.on('settings:updated', ({ settings }) => onChange({ kind: 'settings', settings }));
  socket.on('blocks:changed', () => onChange({ kind: 'blocks' }));
  socket.on('folders:updated', () => onChange({ kind: 'folders' }));
  socket.on('scheduled:updated', ({ chatId, failed }) =>
    onChange({ kind: 'scheduled', chatId, failed }),
  );
  socket.on('lock:updated', () => onChange({ kind: 'lock' }));
  socket.on('appearance:updated', ({ appearance }) => onChange({ kind: 'appearance', appearance }));
  socket.on('quiet-hours:updated', ({ quietHours }) =>
    onChange({ kind: 'quietHours', quietHours }),
  );
  socket.on('push:updated', ({ settings }) => onChange({ kind: 'push', settings }));
}
