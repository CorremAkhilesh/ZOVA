import { lazy, Suspense } from 'react';
import { useInstallStore } from './install-store';

const IosInstallSheet = lazy(() => import('./IosInstallSheet'));

/**
 * The iOS "Add to Home Screen" sheet, loaded the first time it is asked for: the dialog code stays
 * out of the main bundle, and most people never see it.
 */
export function IosInstallSheetHost() {
  const open = useInstallStore((state) => state.iosSheetOpen);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <IosInstallSheet />
    </Suspense>
  );
}
