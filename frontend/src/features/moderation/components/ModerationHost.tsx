import { lazy, Suspense } from 'react';
import { useModeration } from '../store';

const ModerationDialogs = lazy(() => import('./ModerationDialogs'));

/** Mounted once in the app shell; the dialogs' code loads the first time one opens. */
export function ModerationHost() {
  const open = useModeration((state) => state.report !== null || state.confirmBlock !== null);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <ModerationDialogs />
    </Suspense>
  );
}
