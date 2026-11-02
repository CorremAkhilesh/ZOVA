import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateTokensCss } from '../src/css.ts';

const target = fileURLToPath(new URL('../src/tokens.css', import.meta.url));

writeFileSync(target, generateTokensCss());
process.stdout.write(`Wrote ${target}\n`);
