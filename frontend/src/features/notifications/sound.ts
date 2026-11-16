/** A short two-note chime made with Web Audio: no sound file to download. */
const NOTES = [
  { frequency: 880, at: 0 },
  { frequency: 1320, at: 0.09 },
];
const NOTE_SECONDS = 0.12;
const VOLUME = 0.08;

type AudioContextClass = new () => AudioContext;
let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (context) return context;
  const Ctor = (globalThis as { AudioContext?: AudioContextClass }).AudioContext;
  if (!Ctor) return null;
  context = new Ctor();
  return context;
}

/** Plays the chime. Silent (never throws) where audio is unavailable or not yet allowed. */
export function playChime(): void {
  try {
    const ctx = audioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    for (const note of NOTES) {
      const start = ctx.currentTime + note.at;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = note.frequency;
      gain.gain.setValueAtTime(VOLUME, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + NOTE_SECONDS);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + NOTE_SECONDS);
    }
  } catch {
    // Autoplay rules or no audio device: the toast still shows.
  }
}
