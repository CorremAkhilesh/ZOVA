import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { readGitCommit } from './git-commit.ts';

/** Which build is running: shown by GET /v1/health so a deploy can be checked against its commit. */
export interface BuildInfo {
  /** Short commit SHA (7 characters), or "unknown". */
  commit: string;
  /** When the image was built (ISO 8601); null outside a Docker build. */
  builtAt: string | null;
}

export const UNKNOWN_COMMIT = 'unknown';

const buildInfoFileSchema = z.object({
  commit: z.union([z.string().regex(/^[0-9a-f]{7}$/), z.literal(UNKNOWN_COMMIT)]),
  builtAt: z.iso.datetime(),
});

function fromFile(file: string): BuildInfo | null {
  try {
    const parsed = buildInfoFileSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The nearest `.git` folder at or above `from`, or null. */
export function findGitDir(from: string): string | null {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git', 'HEAD'))) return join(dir, '.git');
    if (dirname(dir) === dir) return null;
  }
}

/**
 * Production images carry `build-info.json` (written by `scripts/build-info.ts` in the Docker build).
 * Local dev reads the commit from `.git`. Anything missing or malformed gives "unknown": never throws.
 */
export function loadBuildInfo(options: { file: string; gitDir: string | null }): BuildInfo {
  const file = fromFile(options.file);
  if (file) return file;
  const sha = options.gitDir ? readGitCommit(options.gitDir) : null;
  return { commit: sha ? sha.slice(0, 7) : UNKNOWN_COMMIT, builtAt: null };
}

let cached: BuildInfo | undefined;

/** This process's build, read once (from the working directory: `/app` in the image). */
export function getBuildInfo(): BuildInfo {
  cached ??= loadBuildInfo({
    file: join(process.cwd(), 'build-info.json'),
    gitDir: process.env.NODE_ENV === 'production' ? null : findGitDir(process.cwd()),
  });
  return cached;
}
