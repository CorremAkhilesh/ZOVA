import { useEffect } from 'react';

/** Less than this between the window and what is visible is a browser bar, not a keyboard. */
const KEYBOARD_MIN_PX = 120;

/**
 * Where only part of the window is visible (an on-screen keyboard), the app's height in px, else
 * null. Chrome on Android already shrinks the page (`interactive-widget=resizes-content` in
 * index.html), so the two match there; iOS Safari keeps the page and only shrinks the visual viewport.
 */
export function visibleAppHeight(windowHeight: number, viewportHeight: number): number | null {
  return windowHeight - viewportHeight > KEYBOARD_MIN_PX ? Math.round(viewportHeight) : null;
}

/**
 * Keeps the composer above the on-screen keyboard on every phone: while a keyboard covers part of
 * the window, `--app-height` is the visible height (the root layout uses it instead of 100dvh).
 */
export function useKeyboardHeight(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const update = () => {
      const height = visibleAppHeight(window.innerHeight, viewport.height);
      if (height === null) root.style.removeProperty('--app-height');
      else root.style.setProperty('--app-height', `${height}px`);
    };
    update();
    viewport.addEventListener('resize', update);
    return () => {
      viewport.removeEventListener('resize', update);
      root.style.removeProperty('--app-height');
    };
  }, []);
}
