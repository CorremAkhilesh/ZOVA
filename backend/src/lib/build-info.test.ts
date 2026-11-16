import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findGitDir, loadBuildInfo } from './build-info.ts';
import { readGitCommit } from './git-commit.ts';

const SHA = '489eed108a70c7c1c4839ac1701448f323fdc5c0';
let root: string;
let git: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'zuvo-build-info-'));
  git = join(root, '.git');
  mkdirSync(join(git, 'refs', 'heads'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const write = (path: string, text: string) => writeFileSync(join(root, path), text);

describe('readGitCommit', () => {
  it('reads a detached HEAD (what correm-deploy checks out)', () => {
    write('.git/HEAD', `${SHA}\n`);
    expect(readGitCommit(git)).toBe(SHA);
  });

  it('follows a branch to its loose ref, then to packed-refs', () => {
    write('.git/HEAD', 'ref: refs/heads/dev\n');
    write('.git/packed-refs', `# pack-refs with: peeled\n${SHA} refs/heads/dev\n`);
    expect(readGitCommit(git)).toBe(SHA);
    write('.git/refs/heads/dev', `${'a'.repeat(40)}\n`);
    expect(readGitCommit(git)).toBe('a'.repeat(40));
  });

  it('gives null for a missing folder, garbage, or a ref that leaves .git', () => {
    expect(readGitCommit(join(root, 'nope'))).toBeNull();
    write('.git/HEAD', 'not a sha');
    expect(readGitCommit(git)).toBeNull();
    write('.git/HEAD', 'ref: refs/../../etc/passwd');
    expect(readGitCommit(git)).toBeNull();
    write('.git/HEAD', 'ref: refs/heads/gone');
    expect(readGitCommit(git)).toBeNull();
  });
});

describe('loadBuildInfo', () => {
  const file = () => join(root, 'build-info.json');

  it('uses the image build-info.json first', () => {
    write('build-info.json', '{"commit":"489eed1","builtAt":"2026-11-16T07:00:00.000Z"}');
    write('.git/HEAD', 'a'.repeat(40));
    expect(loadBuildInfo({ file: file(), gitDir: git })).toEqual({
      commit: '489eed1',
      builtAt: '2026-11-16T07:00:00.000Z',
    });
  });

  it('falls back to .git in local dev, with no build time', () => {
    write('.git/HEAD', SHA);
    expect(loadBuildInfo({ file: file(), gitDir: git })).toEqual({
      commit: '489eed1',
      builtAt: null,
    });
  });

  it('says "unknown" instead of throwing when nothing can be read', () => {
    expect(loadBuildInfo({ file: file(), gitDir: null })).toEqual({
      commit: 'unknown',
      builtAt: null,
    });
    write('build-info.json', '{ broken');
    expect(loadBuildInfo({ file: file(), gitDir: git }).commit).toBe('unknown');
    write('build-info.json', '{"commit":"<script>","builtAt":"x"}');
    expect(loadBuildInfo({ file: file(), gitDir: null }).commit).toBe('unknown');
  });

  it('finds .git above the working directory (pnpm dev runs in backend/)', () => {
    write('.git/HEAD', SHA);
    mkdirSync(join(root, 'backend', 'src'), { recursive: true });
    expect(findGitDir(join(root, 'backend', 'src'))).toBe(git);
  });
});
