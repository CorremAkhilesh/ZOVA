import { toast } from 'sonner';
import { i18n } from '@/lib/i18n';

/** vite-plugin-pwa's updater: `true` activates the waiting worker and reloads once it controls. */
export type ServiceWorkerUpdater = (reloadPage?: boolean) => Promise<void>;

interface PromptDeps {
  notify: typeof toast;
  translate: (key: string) => string;
}

export const UPDATE_TOAST_ID = 'pwa-update';

/**
 * Returns the `onNeedRefresh` handler: a persistent "New version available — Reload" toast.
 * The page only reloads when the user clicks Reload (never on its own, so nobody loses a
 * half-typed message), and at most once.
 */
export function createUpdatePrompt(
  update: ServiceWorkerUpdater,
  deps: PromptDeps = { notify: toast, translate: (key) => i18n.t(key) },
) {
  let applying = false;
  const apply = () => {
    if (applying) return;
    applying = true;
    void update(true);
  };

  return () => {
    deps.notify(deps.translate('pwa.updateAvailable'), {
      id: UPDATE_TOAST_ID,
      duration: Number.POSITIVE_INFINITY,
      action: { label: deps.translate('pwa.reload'), onClick: apply },
    });
  };
}
