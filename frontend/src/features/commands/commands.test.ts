import { afterEach, describe, expect, it, vi } from 'vitest';
import { commandQuery, findCommands } from './find-commands';
import { fuzzyScore, matchScore } from './fuzzy';
import { formatKeys, isApplePlatform } from './platform';
import {
  loadRecentCommands,
  RECENT_COMMANDS_KEY,
  RECENT_COMMANDS_MAX,
  recordRecentCommand,
} from './recent';
import { COMMANDS, type Command } from './registry';

const rank = (query: string, texts: string[]) =>
  texts
    .map((text) => ({ text, score: fuzzyScore(query, text) }))
    .filter((entry) => entry.score !== null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .map((entry) => entry.text);

describe('fuzzyScore', () => {
  it('matches characters in order, ignoring case and spaces in the query', () => {
    expect(fuzzyScore('TT', 'Toggle theme')).not.toBeNull();
    expect(fuzzyScore('tog th', 'Toggle theme')).not.toBeNull();
    expect(fuzzyScore('', 'anything')).toBe(0);
  });

  it('rejects characters out of order, missing, or scattered mid-word', () => {
    expect(fuzzyScore('eht', 'Toggle theme')).toBeNull();
    expect(fuzzyScore('dark', 'Toggle theme')).toBeNull();
    expect(fuzzyScore('toggle theme!', 'Toggle theme')).toBeNull();
    // d…a…r…k all inside words, never together: noise, not a match.
    expect(fuzzyScore('dark', 'oddly paired work')).toBeNull();
  });

  it('ranks a prefix above a word start above a mid-word run', () => {
    expect(rank('set', ['Reset all', 'Go to Settings', 'Settings'])).toEqual([
      'Settings',
      'Go to Settings',
      'Reset all',
    ]);
  });

  it('prefers word starts and contiguous runs, then shorter texts', () => {
    expect(fuzzyScore('gs', 'Go to Settings')).toBeGreaterThan(fuzzyScore('gs', 'Bugs') ?? 0);
    expect(fuzzyScore('ta', 'tab')).toBeGreaterThan(fuzzyScore('ta', 'tea') ?? 0);
    expect(fuzzyScore('chat', 'New chat')).toBeGreaterThan(fuzzyScore('chat', 'New chat now') ?? 0);
  });

  it('works with Hindi labels', () => {
    expect(fuzzyScore('थीम', 'थीम बदलें')).not.toBeNull();
    expect(fuzzyScore('बदल', 'थीम बदलें')).not.toBeNull();
    expect(rank('भाषा', ['थीम बदलें', 'भाषा बदलें'])).toEqual(['भाषा बदलें']);
  });
});

describe('matchScore', () => {
  it('also matches English keywords, a little below the label', () => {
    expect(matchScore('dark', 'थीम बदलें', ['theme', 'dark mode'])).not.toBeNull();
    const label = matchScore('theme', 'theme', []) ?? 0;
    expect(matchScore('theme', 'other', ['theme'])).toBeLessThan(label);
    expect(matchScore('zzz', 'Toggle theme', ['dark mode'])).toBeNull();
  });
});

describe('findCommands', () => {
  const label = (command: Command) => command.id.replace(/-/g, ' ');

  it('finds commands by name or keyword, best first', () => {
    expect(findCommands(COMMANDS, 'dark', label).map((c) => c.id)).toEqual(['toggle-theme']);
    expect(
      findCommands(COMMANDS, 'new', label)
        .map((c) => c.id)
        .slice(0, 2),
    ).toEqual(['new-chat', 'new-group']);
  });

  it('lists recent commands first when nothing is typed, then the rest', () => {
    const ids = findCommands(COMMANDS, ' ', label, ['shortcuts', 'gone', 'go-starred']).map(
      (c) => c.id,
    );
    expect(ids.slice(0, 3)).toEqual(['shortcuts', 'go-starred', 'new-chat']);
    expect(ids).toHaveLength(COMMANDS.length);
  });

  it('reads command mode from a leading ">"', () => {
    expect(commandQuery('> theme ')).toBe('theme');
    expect(commandQuery('  >')).toBe('');
    expect(commandQuery('theme')).toBeNull();
  });
});

describe('recent commands', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps the most recent first, once each, at most five', () => {
    for (const id of ['a', 'b', 'c', 'a', 'd', 'e', 'f']) recordRecentCommand(id);
    expect(loadRecentCommands()).toEqual(['f', 'e', 'd', 'a', 'c']);
    expect(loadRecentCommands()).toHaveLength(RECENT_COMMANDS_MAX);
  });

  it('ignores broken stored data', () => {
    localStorage.setItem(RECENT_COMMANDS_KEY, '{oops');
    expect(loadRecentCommands()).toEqual([]);
    localStorage.setItem(RECENT_COMMANDS_KEY, JSON.stringify(['a', 3, null]));
    expect(loadRecentCommands()).toEqual(['a']);
  });

  it('works without storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(loadRecentCommands()).toEqual([]);
    expect(recordRecentCommand('a')).toEqual(['a']);
  });
});

describe('platform keys', () => {
  it('shows ⌘ on Apple devices and Ctrl elsewhere', () => {
    expect(isApplePlatform({ userAgentData: { platform: 'macOS' } })).toBe(true);
    expect(isApplePlatform({ platform: 'iPhone' })).toBe(true);
    expect(isApplePlatform({ platform: 'Win32' })).toBe(false);
    expect(isApplePlatform(undefined)).toBe(false);
    expect(formatKeys('Mod+K', true)).toBe('⌘+K');
    expect(formatKeys('Mod+Shift+Enter', false)).toBe('Ctrl+Shift+Enter');
  });
});
