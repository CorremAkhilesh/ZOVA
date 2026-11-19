/** The building blocks of a sound: notes, overtone sets, and a recipe (see synth.ts). */

export interface Note {
  /** Start, in seconds. */
  at: number;
  frequency: number;
  /** Seconds for the sound to fall to about 1/1000. */
  decay: number;
  /** Overtones: [frequency ratio, loudness]. */
  partials: [number, number][];
  gain?: number;
  /** Pitch slides from `frequency` to this over `glideSeconds`. */
  glideTo?: number;
  glideSeconds?: number;
}

export const BELL: [number, number][] = [
  [1, 1],
  [2.76, 0.18],
  [5.4, 0.05],
];
export const WOOD: [number, number][] = [
  [1, 1],
  [3.99, 0.3],
  [10.1, 0.04],
];
export const GLASS: [number, number][] = [
  [1, 1],
  [1.004, 0.6],
  [2.01, 0.2],
];
export const PURE: [number, number][] = [[1, 1]];

/** A sound: notes over a length, scaled to a peak; optionally rounder (low-pass) and in a small room. */
export interface Recipe {
  seconds: number;
  peak: number;
  notes: Note[];
  /** Low-pass corner in Hz: softer, rounder. */
  lowpassHz?: number;
  /** 0–1: a few short, quiet reflections, like a small room. */
  room?: number;
}
