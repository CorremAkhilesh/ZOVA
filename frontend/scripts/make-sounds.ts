/**
 * Writes the app's sounds to public/sounds/<name>.wav from our own synthesis code
 * (src/features/notifications/sounds/synth.ts). Run after changing a recipe:
 *   pnpm --filter @zuvo/frontend sounds
 * A unit test fails when the files and the code disagree.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SOUND_NAMES, synthesize, toWav } from '../src/features/notifications/sounds/synth.ts';

const dir = fileURLToPath(new URL('../public/sounds/', import.meta.url));
mkdirSync(dir, { recursive: true });
for (const name of SOUND_NAMES) {
  const bytes = toWav(synthesize(name));
  writeFileSync(`${dir}${name}.wav`, bytes);
  process.stdout.write(`${name}.wav ${bytes.length} bytes\n`);
}
