/**
 * Fails when the main (entry) bundle exceeds the gzip budget. Run after `vite build`.
 *   pnpm --filter @zuvo/frontend size
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

export const MAIN_BUNDLE_BUDGET_KB = 200;

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const html = readFileSync(`${dist}index.html`, 'utf8');
const entry = /<script type="module"[^>]*src="\/([^"]+)"/.exec(html)?.[1];
if (!entry) {
  process.stderr.write(
    'Could not find the entry script in dist/index.html — run `vite build` first.\n',
  );
  process.exit(1);
}

const source = readFileSync(`${dist}${entry}`);
const gzipKb = gzipSync(source, { level: 9 }).length / 1024;
const line = `Main bundle ${entry}: ${(source.length / 1024).toFixed(1)} KB raw, ${gzipKb.toFixed(1)} KB gzip (budget ${MAIN_BUNDLE_BUDGET_KB} KB)`;

if (gzipKb > MAIN_BUNDLE_BUDGET_KB) {
  process.stderr.write(`✖ ${line}\n`);
  process.exit(1);
}
process.stdout.write(`✔ ${line}\n`);
