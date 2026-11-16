import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Which build this is: inlined by vite.config.ts and shown on Help → About ("Version x.y.z (abc1234)"). */
export interface BuildInfo {
  /** Short commit SHA, or "unknown". */
  commit: string;
  /** ISO 8601 build time. */
  builtAt: string;
}

const SHORT_SHA = /^[0-9a-f]{7}$/;

function fromFile(path: string): BuildInfo | null {
  try {
    const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof data !== 'object' || data === null) return null;
    const { commit, builtAt } = data as Record<string, unknown>;
    if (typeof commit !== 'string' || typeof builtAt !== 'string') return null;
    if (!SHORT_SHA.test(commit) && commit !== 'unknown') return null;
    if (Number.isNaN(Date.parse(builtAt))) return null;
    return { commit, builtAt };
  } catch {
    return null;
  }
}

function fromGit(): string | null {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return SHORT_SHA.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

/**
 * The Docker build passes `ZUVO_BUILD_INFO` (a build-info.json written from `.git/HEAD`; see
 * deploy/docker/web.Dockerfile). Local builds ask git. Neither works: "unknown", never a failed build.
 */
export function readBuildInfo(file: string | undefined, now = new Date()): BuildInfo {
  const info = file ? fromFile(file) : null;
  return info ?? { commit: fromGit() ?? 'unknown', builtAt: now.toISOString() };
}
