/**
 * Fails when a file of the first load exceeds the gzip budget. Run after `vite build`.
 *   pnpm --filter @zuvo/frontend size
 *
 * The first load is the entry script and everything index.html preloads with it. Since Step 20
 * the build groups it into a few files (bundling/chunks.ts: vendor, the app's own code, a tiny
 * entry), so each of them must stay within the budget, not only the entry.
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
const preloads = [...html.matchAll(/<link rel="modulepreload"[^>]*href="\/([^"]+\.js)"/g)].map(
  (match) => match[1] ?? '',
);

let failed = false;
let totalKb = 0;
for (const file of [entry, ...preloads]) {
  const source = readFileSync(`${dist}${file}`);
  const gzipKb = gzipSync(source, { level: 9 }).length / 1024;
  totalKb += gzipKb;
  const line = `${file}: ${(source.length / 1024).toFixed(1)} KB raw, ${gzipKb.toFixed(1)} KB gzip`;
  if (gzipKb > MAIN_BUNDLE_BUDGET_KB) {
    failed = true;
    process.stderr.write(`✖ ${line} (budget ${MAIN_BUNDLE_BUDGET_KB} KB per file)\n`);
  } else {
    process.stdout.write(`✔ ${line}\n`);
  }
}
process.stdout.write(
  `First load: ${1 + preloads.length} JS files, ${totalKb.toFixed(1)} KB gzip (budget ${MAIN_BUNDLE_BUDGET_KB} KB per file)\n`,
);
if (failed) process.exit(1);
