import { lazy, Suspense, useEffect } from 'react';
import { useGlobalSearch } from '../store';

const GlobalSearch = lazy(() => import('./GlobalSearch'));

/** Ctrl/Cmd+K opens search from anywhere in the app; the dialog's code loads the first time. */
export function SearchHost() {
  const open = useGlobalSearch((state) => state.open);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      const state = useGlobalSearch.getState();
      if (state.open) state.hide();
      else state.show();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <GlobalSearch />
    </Suspense>
  );
}
