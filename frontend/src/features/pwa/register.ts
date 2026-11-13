import { registerSW } from 'virtual:pwa-register';
import { createUpdatePrompt, type ServiceWorkerUpdater } from './update-prompt';

/** Registers the service worker (production builds only; a no-op in dev). */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  let updateSW: ServiceWorkerUpdater = async () => {};
  const showPrompt = createUpdatePrompt((reload) => updateSW(reload));
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh: showPrompt,
    onRegisterError: (error: unknown) => console.error('Service worker registration failed', error),
  });
}
