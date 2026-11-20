/**
 * Fails when a file of the first load exceeds the gzip budget. Run after `vite build`.
 *   pnpm --filter @zuvo/frontend size
 *
 * The first load is the entry script and everything index.html preloads with it. Since Step 20
 * the build groups it into a few files (bundling/chunks.ts: vendor, the app's own code, a tiny
 * entry), so each of them must stay within the budget, not only the entry.
 */
import { readdirSync, readFileSync } from 'node:fs';
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

/**
 * The signed-out screens (sign-in, code, name, Help, "This wasn't me") must not pull in the app
 * shell's `first-screen` file: a shared module (the logo) once made the sign-in page load 62 KB
 * gzip of chat-list code it never ran (audit M10). Follows static imports from their chunks.
 */
const PUBLIC_CHUNK = /^(routes|verify|welcome\.name|help(\.[a-z-]+)?|security\.not-me)-[\w-]+\.js$/;
const assets = readdirSync(`${dist}assets`);
const importsOf = (file: string) =>
  [
    ...readFileSync(`${dist}assets/${file}`, 'utf8').matchAll(
      /(?:from|import)\s*"\.\/([^"]+\.js)"/g,
    ),
  ].map((match) => match[1] ?? '');
const reached = new Set<string>();
const queue = assets.filter((file) => PUBLIC_CHUNK.test(file));
for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
  if (reached.has(file)) continue;
  reached.add(file);
  queue.push(...importsOf(file));
}
const leaked = [...reached].filter((file) => file.startsWith('first-screen-'));
/**
 * Syntax highlighting (highlight.js, ~50 KB gzip) loads only when a code block is on screen: its
 * own file, imported by the lazy `highlight` module alone. It once shared a file with icons, so
 * opening any chat, Starred or an admin screen loaded it (audit L22).
 */
const highlighters = assets.filter((file) => file.startsWith('highlighter-'));
const eagerHighlight = assets.filter(
  (file) =>
    !file.startsWith('highlight-') &&
    importsOf(file).some((target) => target.startsWith('highlighter-')),
);
if (highlighters.length !== 1 || eagerHighlight.length > 0) {
  failed = true;
  process.stderr.write(
    `✖ highlight.js must be its own lazy file (found ${highlighters.length}; also imported by ${eagerHighlight.join(', ') || 'none'})\n`,
  );
} else {
  process.stdout.write('✔ highlight.js loads only with a code block\n');
}
if (reached.size === 0) {
  failed = true;
  process.stderr.write('✖ found none of the signed-out screens’ files in dist/assets\n');
} else if (leaked.length > 0) {
  failed = true;
  process.stderr.write(`✖ the signed-out screens load ${leaked.join(', ')} (the app shell)\n`);
} else {
  process.stdout.write(`✔ the signed-out screens (${reached.size} files) skip the app shell\n`);
}
if (failed) process.exit(1);
