import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FULL_SHA = /^[0-9a-f]{40}$/;
const REF = /^ref: (refs\/[\w./-]+)$/;

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return null;
  }
}

/**
 * The commit `<gitDir>/HEAD` points at, read from the files alone (no `git` binary): a detached SHA (what
 * `correm-deploy` checks out), or a branch ref resolved through its loose file or `packed-refs`.
 * Null when it cannot be read. Kept free of other imports: the Docker "meta" stage runs it on its own.
 */
export function readGitCommit(gitDir: string): string | null {
  const head = readText(join(gitDir, 'HEAD'));
  if (!head) return null;
  if (FULL_SHA.test(head)) return head;
  const ref = REF.exec(head)?.[1];
  if (!ref || ref.includes('..')) return null;
  const loose = readText(join(gitDir, ref));
  if (loose && FULL_SHA.test(loose)) return loose;
  const packed = readText(join(gitDir, 'packed-refs'));
  const sha = packed
    ?.split('\n')
    .find((line) => line.endsWith(` ${ref}`))
    ?.split(' ')[0];
  return sha && FULL_SHA.test(sha) ? sha : null;
}
