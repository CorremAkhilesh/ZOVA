/**
 * The app's own sounds, synthesized from scratch: plain sine partials, a decaying envelope and, for
 * the swoosh, filtered pseudo-random noise. No recording or third-party sample is used, so the
 * files in public/sounds (written by scripts/make-sounds.ts) are entirely our own work.
 * See docs/sounds.md for the license note.
 */

export const SAMPLE_RATE = 24_000;

/** Every sound the app plays. The four tones are choices for a new message. */
export const SOUND_NAMES = [
  'chime',
  'bubble',
  'marimba',
  'glass',
  'mention',
  'sent',
  'tick',
] as const;
export type SoundName = (typeof SOUND_NAMES)[number];

interface Note {
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

const BELL: [number, number][] = [
  [1, 1],
  [2.76, 0.18],
  [5.4, 0.05],
];
const WOOD: [number, number][] = [
  [1, 1],
  [3.99, 0.3],
  [10.1, 0.04],
];
const GLASS: [number, number][] = [
  [1, 1],
  [1.004, 0.6],
  [2.01, 0.2],
];
const PURE: [number, number][] = [[1, 1]];

const RECIPES: Record<
  Exclude<SoundName, 'sent'>,
  { seconds: number; peak: number; notes: Note[] }
> = {
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
};

/** A note as samples added into `out`. */
function addNote(out: Float32Array, note: Note) {
  const start = Math.round(note.at * SAMPLE_RATE);
  const attack = 0.004 * SAMPLE_RATE;
  // exp(-k t) reaches 1/1000 at `decay` seconds.
  const k = Math.log(1000) / note.decay;
  const phases = note.partials.map(() => 0);
  for (let i = start; i < out.length; i++) {
    const t = (i - start) / SAMPLE_RATE;
    const envelope = Math.min(1, (i - start) / attack) * Math.exp(-k * t);
    if (envelope < 1e-5 && t > note.decay) break;
    const glide =
      note.glideTo && note.glideSeconds
        ? note.frequency + (note.glideTo - note.frequency) * Math.min(1, t / note.glideSeconds)
        : note.frequency;
    let sample = 0;
    note.partials.forEach(([ratio, loud], p) => {
      phases[p] = (phases[p] ?? 0) + (2 * Math.PI * glide * ratio) / SAMPLE_RATE;
      sample += loud * Math.sin(phases[p] ?? 0);
    });
    out[i] = (out[i] ?? 0) + sample * envelope * (note.gain ?? 1);
  }
}

/** Deterministic noise (xorshift), so the generated file never changes between runs. */
function noise(seed: number) {
  let x = seed;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) / 0xffffffff) * 2 - 1;
  };
}

/** The soft "swoosh" when I send: noise through a low-pass filter that opens up, rising and fading. */
function swoosh(): Float32Array {
  const seconds = 0.28;
  const out = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  const next = noise(0x2c1b3c6d);
  let low = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / out.length;
    const cutoff = 600 + 4200 * t;
    const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / SAMPLE_RATE);
    low += alpha * (next() - low);
    const envelope = Math.sin(Math.PI * t) ** 2;
    out[i] = low * envelope;
  }
  return normalize(out, 0.45);
}

function normalize(samples: Float32Array, peak: number): Float32Array {
  let max = 0;
  for (const sample of samples) max = Math.max(max, Math.abs(sample));
  if (max === 0) return samples;
  const scale = peak / max;
  return samples.map((sample) => sample * scale);
}

/** One sound as mono samples in -1…1 at SAMPLE_RATE. */
export function synthesize(name: SoundName): Float32Array {
  if (name === 'sent') return swoosh();
  const recipe = RECIPES[name];
  const out = new Float32Array(Math.round(recipe.seconds * SAMPLE_RATE));
  for (const note of recipe.notes) addNote(out, note);
  // A short fade at the very end: never a click.
  const fade = Math.round(0.01 * SAMPLE_RATE);
  for (let i = 0; i < fade; i++) {
    const index = out.length - 1 - i;
    out[index] = (out[index] ?? 0) * (i / fade);
  }
  return normalize(out, recipe.peak);
}

/** 16-bit PCM mono WAV. */
export function toWav(samples: Float32Array, sampleRate = SAMPLE_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, Math.round(clamped * 0x7fff), true);
  });
  return bytes;
}
