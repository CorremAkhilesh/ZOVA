import { audioContext } from '@/features/notifications/sound';

/**
 * The app's own call sounds, made with Web Audio at play time (no recordings, nothing copyrighted):
 * - ringtone (a call for me): a rising three-note chime, twice, then a pause;
 * - ringback (I am calling): one soft low tone every three seconds;
 * - the phone vibrates with the ringtone where it can (Android).
 * Silent where the browser does not allow audio yet (no click on the page so far).
 */

type Pattern = { notes: Array<[frequency: number, start: number, length: number]>; every: number };

/** E5, G#5, B5 (a major chord), twice: friendly, clearly a call, not a message. */
const RINGTONE: Pattern = {
  notes: [
    [659.25, 0, 0.18],
    [830.61, 0.2, 0.18],
    [987.77, 0.4, 0.32],
    [659.25, 0.9, 0.18],
    [830.61, 1.1, 0.18],
    [987.77, 1.3, 0.32],
  ],
  every: 3,
};
const RINGBACK: Pattern = { notes: [[425, 0, 1]], every: 3 };
const VIBRATE = [400, 200, 400, 200, 400];

function playOnce(ctx: AudioContext, pattern: Pattern, volume: number) {
  const now = ctx.currentTime + 0.02;
  for (const [frequency, start, length] of pattern.notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    // A soft attack and a bell-like fade: never a harsh beep.
    gain.gain.setValueAtTime(0.0001, now + start);
    gain.gain.exponentialRampToValueAtTime(volume, now + start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + length);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + start);
    osc.stop(now + start + length + 0.05);
  }
}

export type Tone = 'ringtone' | 'ringback';

/** Plays a tone in a loop until the returned function is called. */
export function startTone(tone: Tone, options: { vibrate?: boolean } = {}): () => void {
  const pattern = tone === 'ringtone' ? RINGTONE : RINGBACK;
  const volume = tone === 'ringtone' ? 0.25 : 0.08;
  const ctx = audioContext();
  const vibrate = options.vibrate && typeof navigator.vibrate === 'function';
  const tick = () => {
    if (ctx) {
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
      if (ctx.state === 'running') playOnce(ctx, pattern, volume);
    }
    if (vibrate) navigator.vibrate(VIBRATE);
  };
  tick();
  const timer = setInterval(tick, pattern.every * 1000);
  return () => {
    clearInterval(timer);
    if (vibrate) navigator.vibrate(0);
  };
}
