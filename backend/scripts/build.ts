/**
 * Production build: bundles the backend and the @zuvo/* workspace packages (shipped as TypeScript
 * source) into dist/. Third-party dependencies stay external and are installed in the image.
 */
import { readFileSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  dependencies?: Record<string, string>;
};
const external = Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith('@zuvo/'));

rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });

const result = await build({
  entryPoints: [
    'src/main.ts',
    'src/worker.ts',
    'src/scripts/mail-test.ts',
    'src/scripts/sync-indexes.ts',
    // Emergency: node dist/scripts/admin-role.js --email <email> --role <admin|user>
    'src/scripts/admin-role.ts',
  ],
  outbase: 'src',
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  external,
  metafile: true,
  logLevel: 'warning',
});

const outputs = Object.entries(result.metafile.outputs).filter(([file]) => file.endsWith('.js'));
for (const [file, { bytes }] of outputs) {
  process.stdout.write(`${file}  ${(bytes / 1024).toFixed(1)} KiB\n`);
}
