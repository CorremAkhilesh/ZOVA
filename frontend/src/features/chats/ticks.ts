import type { ChatRow, MessageRow } from '@/features/sync/local-db';
import type { DeliveryStatus } from './types';

type Progress = Pick<ChatRow, 'type' | 'peerDeliveredSeq' | 'peerReadSeq'>;

/**
 * pending → sent → delivered → read, or failed. Worked out from the other person's positions in the
 * chat, so one receipt updates every message before it. Saved Messages has nobody to deliver to.
 */
export function tickState(
  message: Pick<MessageRow, 'status' | 'seq'>,
  chat: Progress,
): DeliveryStatus {
  if (message.status !== 'sent') return message.status;
  if (message.seq === null) return 'pending';
  if (chat.type === 'self') return 'sent';
  if (chat.peerReadSeq !== null && chat.peerReadSeq >= message.seq) return 'read';
  if (chat.peerDeliveredSeq >= message.seq) return 'delivered';
  return 'sent';
}
