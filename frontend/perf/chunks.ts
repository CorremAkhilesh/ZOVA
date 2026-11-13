/**
 * Lists the built JS/CSS chunks by gzip size, marking what index.html loads up front (the entry and
 * its modulepreloads). Run after `vite build`:  node perf/chunks.ts [--top 25] [--json] [--dist <folder>]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const distArg = process.argv.indexOf('--dist');
const dist =
  distArg > 0
    ? `${process.argv[distArg + 1]}/`
    : fileURLToPath(new URL('../dist/', import.meta.url));
const html = readFileSync(`${dist}index.html`, 'utf8');
const upFront = new Set(
  [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g)].map((match) => match[1]),
);
const top = Number(process.argv[process.argv.indexOf('--top') + 1]) || 25;

const chunks = readdirSync(`${dist}assets`)
  .filter((file) => /\.(js|css)$/.test(file))
  .map((file) => {
    const source = readFileSync(`${dist}assets/${file}`);
    return {
      file: `assets/${file}`,
      rawKb: source.length / 1024,
      gzipKb: gzipSync(source, { level: 9 }).length / 1024,
    };
  })
  .sort((a, b) => b.gzipKb - a.gzipKb);

const sum = (list: typeof chunks) => list.reduce((total, chunk) => total + chunk.gzipKb, 0);
const initial = chunks.filter((chunk) => upFront.has(chunk.file));
const summary = {
  chunks: chunks.length,
  totalGzipKb: Number(sum(chunks).toFixed(1)),
  initialGzipKb: Number(sum(initial).toFixed(1)),
  initial: initial.map((chunk) => `${chunk.file} ${chunk.gzipKb.toFixed(1)} KB`),
};

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify({ summary, chunks }, null, 2)}\n`);
} else {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n\nLargest ${top} chunks (gzip):\n`);
  for (const chunk of chunks.slice(0, top)) {
    const mark = upFront.has(chunk.file) ? '*' : ' ';
    process.stdout.write(
      `${mark} ${chunk.gzipKb.toFixed(1).padStart(7)} KB  ${chunk.rawKb.toFixed(1).padStart(8)} KB raw  ${chunk.file}\n`,
    );
  }
  process.stdout.write('\n* = loaded by index.html before the app starts\n');
}
