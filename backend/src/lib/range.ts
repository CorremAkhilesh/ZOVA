import type { ByteRange } from '../storage/driver.ts';

export type RangeResult =
  | { kind: 'none' }
  | { kind: 'range'; range: ByteRange }
  | { kind: 'unsatisfiable' };

const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/;

/**
 * Parses an HTTP `Range` header for a file of `size` bytes. Supports a single range:
 * `bytes=0-99`, `bytes=100-` and `bytes=-500` (the last 500 bytes). Multiple ranges are ignored
 * and the whole file is served, which RFC 9110 allows.
 */
export function parseRange(header: string | undefined, size: number): RangeResult {
  if (!header) return { kind: 'none' };
  const match = SINGLE_RANGE.exec(header.trim());
  if (!match) return { kind: 'none' };

  const [, startText = '', endText = ''] = match;
  if (startText === '' && endText === '') return { kind: 'unsatisfiable' };
  if (size === 0) return { kind: 'unsatisfiable' };

  if (startText === '') {
    const suffix = Number(endText);
    if (suffix === 0) return { kind: 'unsatisfiable' };
    return { kind: 'range', range: { start: Math.max(0, size - suffix), end: size - 1 } };
  }

  const start = Number(startText);
  const end = endText === '' ? size - 1 : Math.min(Number(endText), size - 1);
  if (start >= size || start > end) return { kind: 'unsatisfiable' };
  return { kind: 'range', range: { start, end } };
}
