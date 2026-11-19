import { BELL, GLASS, PURE, type Recipe, WOOD } from './parts.ts';

/** The original sounds: four message tones, the @mention and the quiet tick. */
export const TONE_RECIPES = {
  // The Zuvo chime: a quick, bright rising major triad on a soft bell.
  chime: {
    seconds: 0.75,
    peak: 0.8,
    notes: [
      { at: 0, frequency: 1318.5, decay: 0.45, partials: BELL },
      { at: 0.075, frequency: 1661.2, decay: 0.45, partials: BELL },
      { at: 0.15, frequency: 1975.5, decay: 0.55, partials: BELL },
    ],
  },
  // Two rising "pops".
  bubble: {
    seconds: 0.4,
    peak: 0.75,
    notes: [
      {
        at: 0,
        frequency: 520,
        glideTo: 1040,
        glideSeconds: 0.07,
        decay: 0.12,
        partials: PURE,
      },
      {
        at: 0.12,
        frequency: 700,
        glideTo: 1400,
        glideSeconds: 0.07,
        decay: 0.14,
        partials: PURE,
      },
    ],
  },
  // Two warm wooden notes, a fifth apart.
  marimba: {
    seconds: 0.55,
    peak: 0.8,
    notes: [
      { at: 0, frequency: 880, decay: 0.3, partials: WOOD },
      { at: 0.11, frequency: 1318.5, decay: 0.35, partials: WOOD },
    ],
  },
  // One clear, shimmering high note.
  glass: {
    seconds: 0.9,
    peak: 0.75,
    notes: [{ at: 0, frequency: 2093, decay: 0.8, partials: GLASS }],
  },
  // @mention: "ding-ding" then up, so it is told apart from a plain message.
  mention: {
    seconds: 0.7,
    peak: 0.8,
    notes: [
      { at: 0, frequency: 1568, decay: 0.18, partials: BELL },
      { at: 0.1, frequency: 1568, decay: 0.18, partials: BELL },
      { at: 0.2, frequency: 2349.3, decay: 0.45, partials: BELL },
    ],
  },
  // A message arrived in the chat on screen: barely there.
  tick: {
    seconds: 0.06,
    peak: 0.4,
    notes: [
      {
        at: 0,
        frequency: 2200,
        decay: 0.03,
        partials: [
          [1, 1],
          [2.3, 0.3],
        ],
      },
    ],
  },
} satisfies Record<string, Recipe>;
