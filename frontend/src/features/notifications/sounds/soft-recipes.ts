import { PURE, type Recipe } from './parts.ts';

/** Harmonic overtones only: rounder than the bell. */
const SOFT: [number, number][] = [
  [1, 1],
  [2, 0.12],
];

/**
 * Softer sounds: the send droplets (C is the default) and gentler versions of the chime, the
 * @mention and the tick, for people who find the originals too bright.
 */
export const SOFT_RECIPES = {
  // One drop: a quick rising sine, a short fade, a little room.
  'droplet-a': {
    seconds: 0.2,
    peak: 0.32,
    lowpassHz: 5000,
    room: 0.35,
    notes: [
      {
        at: 0,
        frequency: 500,
        glideTo: 1300,
        glideSeconds: 0.04,
        decay: 0.12,
        partials: [
          [1, 1],
          [2, 0.04],
        ],
      },
    ],
  },
  // A drop, then a much quieter little one, like an echo.
  'droplet-b': {
    seconds: 0.22,
    peak: 0.32,
    lowpassHz: 5000,
    room: 0.3,
    notes: [
      { at: 0, frequency: 500, glideTo: 1300, glideSeconds: 0.04, decay: 0.11, partials: PURE },
      {
        at: 0.085,
        frequency: 750,
        glideTo: 1600,
        glideSeconds: 0.03,
        decay: 0.07,
        partials: PURE,
        gain: 0.22,
      },
    ],
  },
  // Lower and rounder: the default when I send.
  'droplet-c': {
    seconds: 0.22,
    peak: 0.32,
    lowpassHz: 2200,
    room: 0.3,
    notes: [
      { at: 0, frequency: 330, glideTo: 820, glideSeconds: 0.05, decay: 0.14, partials: PURE },
    ],
  },
  'chime-soft': {
    seconds: 0.75,
    peak: 0.7,
    lowpassHz: 4000,
    room: 0.25,
    notes: [
      { at: 0, frequency: 659.3, decay: 0.5, partials: SOFT },
      { at: 0.08, frequency: 830.6, decay: 0.5, partials: SOFT },
      { at: 0.16, frequency: 987.8, decay: 0.6, partials: SOFT },
    ],
  },
  'mention-soft': {
    seconds: 0.7,
    peak: 0.7,
    lowpassHz: 4000,
    room: 0.25,
    notes: [
      { at: 0, frequency: 1046.5, decay: 0.18, partials: SOFT },
      { at: 0.1, frequency: 1046.5, decay: 0.18, partials: SOFT },
      { at: 0.2, frequency: 1568, decay: 0.45, partials: SOFT },
    ],
  },
  'tick-soft': {
    seconds: 0.06,
    peak: 0.3,
    lowpassHz: 3000,
    notes: [{ at: 0, frequency: 1400, decay: 0.035, partials: PURE }],
  },
} satisfies Record<string, Recipe>;
