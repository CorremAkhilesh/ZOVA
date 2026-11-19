import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SAMPLE_RATE, SOUND_NAMES, synthesize, toWav } from './synth';

// Tests run from the frontend folder (jsdom has no file: URL for this module).
const publicDir = `${resolve(process.cwd(), 'public/sounds')}/`;

describe('our own sounds', () => {
  it('are short, never clip, and are not silent', () => {
    for (const name of SOUND_NAMES) {
      const samples = synthesize(name);
      const peak = Math.max(...samples.map(Math.abs));
      expect(samples.length / SAMPLE_RATE, name).toBeLessThan(1);
      expect(peak, name).toBeLessThanOrEqual(0.81);
      expect(peak, name).toBeGreaterThan(0.3);
    }
  });

  it('the tick and the swoosh are quieter than the tones', () => {
    const peak = (name: (typeof SOUND_NAMES)[number]) =>
      Math.max(...synthesize(name).map(Math.abs));
    expect(peak('tick')).toBeLessThan(peak('chime'));
    expect(peak('sent')).toBeLessThan(peak('chime'));
  });

  it('public/sounds holds exactly what the code makes (run `pnpm sounds` after a change)', () => {
    for (const name of SOUND_NAMES) {
      const onDisk = new Uint8Array(readFileSync(`${publicDir}${name}.wav`));
      expect(Buffer.from(onDisk).equals(Buffer.from(toWav(synthesize(name)))), name).toBe(true);
    }
  });

  it('writes a valid 16-bit mono WAV header', () => {
    const wav = toWav(new Float32Array([0, 1, -1]));
    const text = (start: number) => String.fromCharCode(...wav.slice(start, start + 4));
    expect(text(0)).toBe('RIFF');
    expect(text(8)).toBe('WAVE');
    expect(new DataView(wav.buffer).getUint16(22, true)).toBe(1);
    expect(new DataView(wav.buffer).getInt16(46, true)).toBe(0x7fff);
  });
});
