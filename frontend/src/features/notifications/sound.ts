import type { SoundName } from './sounds/synth';

/**
 * Plays the app's own sounds (public/sounds, see sounds/synth.ts) with Web Audio. Browsers only
 * allow audio after the person has interacted with the page, so the first click or key press
 * unlocks it and loads every sound, ready to play at once. Silent (never throws) where audio is
 * unavailable or not yet allowed.
 */

type AudioContextClass = new () => AudioContext;

const ALL: SoundName[] = ['chime', 'bubble', 'marimba', 'glass', 'mention', 'sent', 'tick'];
export const soundUrl = (name: SoundName) => `/sounds/${name}.wav`;

let context: AudioContext | null = null;
const buffers = new Map<SoundName, AudioBuffer>();
const loading = new Map<SoundName, Promise<AudioBuffer | null>>();

function audioContext(): AudioContext | null {
  if (context) return context;
  const Ctor =
    (globalThis as { AudioContext?: AudioContextClass }).AudioContext ??
    (globalThis as { webkitAudioContext?: AudioContextClass }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    return null;
  }
  return context;
}

function load(name: SoundName): Promise<AudioBuffer | null> {
  const ready = buffers.get(name);
  if (ready) return Promise.resolve(ready);
  const pending = loading.get(name);
  if (pending) return pending;
  const ctx = audioContext();
  if (!ctx) return Promise.resolve(null);
  const promise = fetch(soundUrl(name))
    .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(response.status)))
    .then((data) => ctx.decodeAudioData(data))
    .then((buffer) => {
      buffers.set(name, buffer);
      return buffer;
    })
    .catch(() => {
      loading.delete(name);
      return null;
    });
  loading.set(name, promise);
  return promise;
}

/** Called on the first user gesture: audio is allowed from now on, and every sound is loaded. */
export function unlockAudio(): void {
  const ctx = audioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  for (const name of ALL) void load(name);
}

/** Unlocks audio on the first click, tap or key press. Returns a cleanup. */
export function installAudioUnlock(target: Window = window): () => void {
  const events = ['pointerdown', 'keydown', 'touchend'] as const;
  const unlock = () => {
    unlockAudio();
    for (const event of events) target.removeEventListener(event, unlock, true);
  };
  for (const event of events) target.addEventListener(event, unlock, true);
  return () => {
    for (const event of events) target.removeEventListener(event, unlock, true);
  };
}

/** Plays a sound at `volume` (0–100). Loads it first if it is not ready yet. */
export function playSound(name: SoundName, volume: number): void {
  try {
    const ctx = audioContext();
    if (!ctx || volume <= 0) return;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    void load(name).then((buffer) => {
      if (!buffer) return;
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = buffer;
      // Perceived loudness is roughly logarithmic: square the slider.
      gain.gain.value = (Math.min(100, volume) / 100) ** 2;
      source.connect(gain).connect(ctx.destination);
      source.start();
    });
  } catch {
    // Autoplay rules or no audio device: the toast still shows.
  }
}

/** Tests: forget the context and every loaded sound. */
export function resetAudioForTests() {
  context = null;
  buffers.clear();
  loading.clear();
}
