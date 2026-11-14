import type { MediaInfo } from '@zuvo/protocol';

/** A photo or video bubble's width (`w-72`); its height follows from the picture's shape. */
export const MEDIA_BOX_WIDTH_PX = 288;
/** Keeps a bubble to a sensible size whatever the picture's shape. */
const MAX_BOX_PX = 320;
const WIDEST = 2.2;
const TALLEST = 0.6;
/** Until the size is known (older messages, a video the browser could not measure). */
const UNKNOWN = 4 / 3;

type Size = Pick<MediaInfo, 'width' | 'height'> | null | undefined;

/** Width over height of the box a picture gets, known before a single byte of it loads. */
export function mediaBoxRatio(media: Size): number {
  const { width, height } = media ?? {};
  const ratio = width && height ? width / height : UNKNOWN;
  return Math.min(WIDEST, Math.max(TALLEST, ratio));
}

/**
 * The box is its final size from the first paint, so nothing below it moves when the picture
 * arrives, and a chat opened at its end stays there.
 */
export function mediaBoxStyle(media: Size) {
  return { aspectRatio: String(mediaBoxRatio(media)), maxWidth: MAX_BOX_PX };
}

/** How tall an album's grid is: one, two, three or four-plus items in a `w-72` grid. */
export function albumGridHeight(items: number): number {
  return items === 2 ? MEDIA_BOX_WIDTH_PX / 2 : MEDIA_BOX_WIDTH_PX;
}
