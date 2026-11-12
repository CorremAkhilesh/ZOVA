import { lazy, Suspense, useEffect } from 'react';
import { useShortcutsHelp } from '@/features/commands/shortcuts-store';
import { useGlobalSearch } from '../store';

const GlobalSearch = lazy(() => import('./GlobalSearch'));
const ShortcutsDialog = lazy(() => import('@/features/commands/components/ShortcutsDialog'));

/** Ctrl/Cmd+K and Ctrl/Cmd+/ (some layouts need Shift for "/"). */
function shortcutOf(event: KeyboardEvent): 'search' | 'shortcuts' | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  if (event.key === '/' || event.code === 'Slash') return 'shortcuts';
  if (!event.shiftKey && event.key.toLowerCase() === 'k') return 'search';
  return null;
}

/**
 * Ctrl/Cmd+K opens search and commands from anywhere in the app, Ctrl/Cmd+/ the keyboard
 * shortcuts. Each dialog's code loads the first time it opens.
 */
export function SearchHost() {
  const open = useGlobalSearch((state) => state.open);
  const shortcutsOpen = useShortcutsHelp((state) => state.open);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = shortcutOf(event);
      if (!shortcut) return;
      event.preventDefault();
      if (shortcut === 'shortcuts') {
        useGlobalSearch.getState().hide();
        useShortcutsHelp.getState().toggle();
        return;
      }
      const state = useGlobalSearch.getState();
      if (state.open) state.hide();
      else {
        useShortcutsHelp.getState().hide();
        state.show();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  return (
    <>
      {open ? (
        <Suspense fallback={null}>
          <GlobalSearch />
        </Suspense>
      ) : null}
      {shortcutsOpen ? (
        <Suspense fallback={null}>
          <ShortcutsDialog />
        </Suspense>
      ) : null}
    </>
  );
}
