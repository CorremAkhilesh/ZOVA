import { describe, expect, it } from 'vitest';
import { mediaMaxBytes, uploadLimit, wouldOverfill } from './limits.ts';

const MB = 1024 * 1024;

describe('file size limits', () => {
  it('turns the setting into bytes', () => {
    expect(mediaMaxBytes({ MEDIA_MAX_FILE_MB: 1024 })).toBe(1024 * MB);
  });

  it('holds pictures to their own limit, unless the setting is lower', () => {
    expect(uploadLimit({ MEDIA_MAX_FILE_MB: 1024 }, 'video')).toBe(1024 * MB);
    expect(uploadLimit({ MEDIA_MAX_FILE_MB: 1024 }, 'document')).toBe(1024 * MB);
    expect(uploadLimit({ MEDIA_MAX_FILE_MB: 1024 }, 'image')).toBe(100 * MB);
    expect(uploadLimit({ MEDIA_MAX_FILE_MB: 10 }, 'image')).toBe(10 * MB);
  });
});

describe('the disk check', () => {
  const space = { total: 1000, free: 200 };

  it('allows a file that takes the disk to exactly 90%', () => {
    expect(wouldOverfill(space, 100)).toBe(false);
  });

  it('refuses one byte more', () => {
    expect(wouldOverfill(space, 101)).toBe(true);
  });

  it('refuses even an empty request on a disk already past 90%', () => {
    expect(wouldOverfill({ total: 1000, free: 50 }, 0)).toBe(true);
  });
});
