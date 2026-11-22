import { describe, expect, it } from 'vitest';
import { CHAT_BACKGROUND, wallpaperStyle } from './wallpaper-style';

describe('the chat background behind a pattern', () => {
  it('is a soft grey in the light theme, so white and tinted bubbles both stand out', () => {
    const style = wallpaperStyle({ kind: 'pattern', id: 'zuvo' }, 'light', 0);
    expect(style.backgroundColor).toBe(CHAT_BACKGROUND.light);
    expect(CHAT_BACKGROUND.light).not.toBe('#FFFFFF');
    expect(String(style.backgroundImage)).toContain('data:image/svg+xml');
  });

  it('is the page background in the dark theme', () => {
    const style = wallpaperStyle({ kind: 'pattern', id: 'none' }, 'dark', 0);
    expect(style).toMatchObject({
      backgroundColor: 'var(--color-background)',
      backgroundImage: 'none',
    });
  });
});
