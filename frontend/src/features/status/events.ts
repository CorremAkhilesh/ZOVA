import type { ClientToServerEvents, ServerToClientEvents } from '@zuvo/protocol';
import type { Socket } from 'socket.io-client';
import type { LocalDb } from '@/features/sync/local-db';
import { refreshStatuses } from './feed';

/**
 * Statuses arrive by asking again: on every connect, and on `status:changed` (someone posted or
 * removed one I may see, or I muted someone on another device). The sync log covers time away.
 */
export function wireStatusEvents(
  socket: Socket<ServerToClientEvents, ClientToServerEvents>,
  db: LocalDb,
) {
  socket.on('connect', () => void refreshStatuses(db));
  socket.on('status:changed', () => void refreshStatuses(db));
}
