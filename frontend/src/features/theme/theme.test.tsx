import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { setSystemDark } from '@/test/media';
import { renderApp } from '@/test/render-app';
import {
  applyTheme,
  resolveTheme,
  syncThemeWithDocument,
  THEME_STORAGE_KEY,
  useThemeStore,
} from './theme-store';

afterEach(() => useThemeStore.setState({ mode: 'system' }));

describe('theme store', () => {
  it.each([
    ['light', false, 'light'],
    ['dark', false, 'dark'],
    ['system', false, 'light'],
    ['system', true, 'dark'],
  ] as const)('resolves %s (system dark: %s) to %s', (mode, systemDark, expected) => {
    expect(resolveTheme(mode, systemDark)).toBe(expected);
  });

  it('applies the theme to <html>', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('persists the chosen mode under the key read by public/theme-init.js', () => {
    useThemeStore.getState().setMode('dark');
    expect(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) ?? '{}')).toMatchObject({
      state: { mode: 'dark' },
    });
  });

  it('follows the OS setting in system mode and stops after unsubscribe', () => {
    const stop = syncThemeWithDocument();
    expect(document.documentElement.dataset.theme).toBe('light');
    setSystemDark(true);
    expect(document.documentElement.dataset.theme).toBe('dark');
    useThemeStore.getState().setMode('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    stop();
    useThemeStore.getState().setMode('dark');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

describe('theme switcher in settings', () => {
  it('switches between light, dark and system', async () => {
    const user = userEvent.setup();
    await renderApp('/settings');

    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');

    await user.click(screen.getByRole('radio', { name: 'Light' }));
    expect(document.documentElement.dataset.theme).toBe('light');

    setSystemDark(true);
    await user.click(screen.getByRole('radio', { name: 'System' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
