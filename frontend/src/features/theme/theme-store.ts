import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/** localStorage key — also read by the inline script in index.html to avoid a theme flash. */
export const THEME_STORAGE_KEY = 'zuvo-theme';

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      mode: 'system',
      setMode: (mode) => set({ mode }),
    }),
    {
      name: THEME_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ mode: state.mode }),
    },
  ),
);

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): ResolvedTheme {
  if (mode === 'system') return systemPrefersDark ? 'dark' : 'light';
  return mode;
}

export function applyTheme(theme: ResolvedTheme, root: HTMLElement = document.documentElement) {
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

/**
 * Keeps <html data-theme> in sync with the store and, in system mode, with the OS setting.
 * Returns an unsubscribe function.
 */
export function syncThemeWithDocument(): () => void {
  const media = window.matchMedia(DARK_QUERY);
  const update = () => applyTheme(resolveTheme(useThemeStore.getState().mode, media.matches));
  update();
  const unsubscribe = useThemeStore.subscribe(update);
  media.addEventListener('change', update);
  return () => {
    unsubscribe();
    media.removeEventListener('change', update);
  };
}
