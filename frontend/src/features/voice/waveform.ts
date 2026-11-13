import { WAVEFORM_BARS, WAVEFORM_MAX } from '@zuvo/protocol';

/** How loud a slice of samples is, from 0 to 1. */
export function rmsOf(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0;
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * The levels heard while recording, as a fixed number of bars with the loudest at the top. Each bar
 * keeps the peak of its slice, so a short word in a long note still shows. Silence stays flat.
 */
export function toWaveform(levels: readonly number[], bars = WAVEFORM_BARS): number[] {
  const peaks = Array.from({ length: bars }, (_unused, bar) => {
    if (levels.length === 0) return 0;
    const start = Math.floor((bar * levels.length) / bars);
    const end = Math.max(start + 1, Math.floor(((bar + 1) * levels.length) / bars));
    return Math.max(...levels.slice(start, end));
  });
  const loudest = Math.max(...peaks);
  if (loudest <= 0) return peaks.map(() => 0);
  // Ears are not linear: on a straight scale, one loud moment flattens all the speech around it.
  return peaks.map((peak) => Math.round(Math.sqrt(peak / loudest) * WAVEFORM_MAX));
}
