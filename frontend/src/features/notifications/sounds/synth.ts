/**
 * The app's own sounds, synthesized from scratch: plain sine partials, a decaying envelope and, for
 * the swoosh, filtered pseudo-random noise. No recording or third-party sample is used, so the
 * files in public/sounds (written by scripts/make-sounds.ts) are entirely our own work.
 * See docs/sounds.md for the license note.
 */

import type { Note, Recipe } from './parts.ts';
import { SOFT_RECIPES } from './soft-recipes.ts';
import { TONE_RECIPES } from './tone-recipes.ts';

export type { Note, Recipe } from './parts.ts';

export const SAMPLE_RATE = 24_000;

const RECIPES: Record<Exclude<SoundName, 'swoosh'>, Recipe> = { ...TONE_RECIPES, ...SOFT_RECIPES };

/** Every sound the app plays: the choices in Settings → Sounds (docs/sounds.md). */
export const SOUND_NAMES = [
  'chime',
  'chime-soft',
  'bubble',
  'marimba',
  'glass',
  'mention',
  'mention-soft',
  'tick',
  'tick-soft',
  'droplet-a',
  'droplet-b',
  'droplet-c',
  'swoosh',
] as const;
export type SoundName = (typeof SOUND_NAMES)[number];

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

/** The older send sound, still a choice: "swoosh", noise through a low-pass filter that opens up, rising and fading. */
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

/** One-pole low-pass: takes the edge off the high partials. */
function lowpass(samples: Float32Array, cornerHz: number): Float32Array {
  const alpha = 1 - Math.exp((-2 * Math.PI * cornerHz) / SAMPLE_RATE);
  let low = 0;
  return samples.map((sample) => {
    low += alpha * (sample - low);
    return low;
  });
}

/** A small room: three short reflections, each quieter, mixed in. */
const REFLECTIONS: [number, number][] = [
  [0.023, 0.5],
  [0.037, 0.32],
  [0.053, 0.2],
];
function withRoom(dry: Float32Array, amount: number): Float32Array {
  const wet = new Float32Array(dry.length);
  for (const [seconds, gain] of REFLECTIONS) {
    const delay = Math.round(seconds * SAMPLE_RATE);
    for (let i = delay; i < dry.length; i++) {
      wet[i] = (wet[i] ?? 0) + (dry[i - delay] ?? 0) * gain;
    }
  }
  return dry.map((sample, i) => sample + (wet[i] ?? 0) * amount);
}

/** A recipe as mono samples in -1…1 at SAMPLE_RATE, faded in and out (never a click). */
export function render(recipe: Recipe): Float32Array {
  let out: Float32Array = new Float32Array(Math.round(recipe.seconds * SAMPLE_RATE));
  for (const note of recipe.notes) addNote(out, note);
  if (recipe.lowpassHz) out = lowpass(out, recipe.lowpassHz);
  if (recipe.room) out = withRoom(out, recipe.room);
  return finish(out, recipe.peak);
}

function finish(out: Float32Array, peak: number): Float32Array {
  // A short fade at the very end: never a click.
  const fade = Math.round(0.01 * SAMPLE_RATE);
  for (let i = 0; i < fade; i++) {
    const index = out.length - 1 - i;
    out[index] = (out[index] ?? 0) * (i / fade);
  }
  return normalize(out, peak);
}

/** One sound as mono samples in -1…1 at SAMPLE_RATE. */
export function synthesize(name: SoundName): Float32Array {
  if (name === 'swoosh') return swoosh();
  return render(RECIPES[name]);
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
