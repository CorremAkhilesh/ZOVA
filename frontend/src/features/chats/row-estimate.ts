import { albumGridHeight, MEDIA_BOX_WIDTH_PX, mediaBoxRatio } from '@/features/media/media-box';
import type { ChatMessage } from './types';

/** A one-line text bubble with its gap. */
export const ROW_ESTIMATE_PX = 52;
const DATE_ESTIMATE_PX = 44;
/** Padding, time row and gap around a picture. */
const MEDIA_CHROME_PX = 36;
const CAPTION_PX = 22;

/**
 * How tall a row will be before it is measured. Pictures know their size up front (see
 * media-box.ts), so a chat ending in one is laid out near its real height from the start.
 */
export function estimateRowPx(row: {
  message: ChatMessage;
  album: ChatMessage[] | null;
  date: Date | null;
}): number {
  const { message, album } = row;
  const date = row.date ? DATE_ESTIMATE_PX : 0;
  const kind = message.media?.kind;
  const visual = !message.viewOnce && !message.deleted && (kind === 'image' || kind === 'video');
  if (!visual) return ROW_ESTIMATE_PX + date;
  const picture = album
    ? albumGridHeight(album.length)
    : MEDIA_BOX_WIDTH_PX / mediaBoxRatio(message.media);
  const caption = (album ? album.some((item) => item.text) : message.text) ? CAPTION_PX : 0;
  return Math.round(picture + MEDIA_CHROME_PX + caption + date);
}
