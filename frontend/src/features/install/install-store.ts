import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { type BeforeInstallPromptEvent, isIosSafari, isStandalone } from './detect';

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

interface InstallState {
  /** Saved `beforeinstallprompt` event (Chrome/Edge/Android), or null. */
  promptEvent: BeforeInstallPromptEvent | null;
  installed: boolean;
  /** The user closed the install banner (remembered on this device). */
  bannerDismissed: boolean;
  iosSheetOpen: boolean;
  capture: (event: BeforeInstallPromptEvent) => void;
  markInstalled: () => void;
  dismissBanner: () => void;
  setIosSheetOpen: (open: boolean) => void;
  promptInstall: () => Promise<InstallOutcome>;
}

export const useInstallStore = create<InstallState>()(
  persist(
    (set, get) => ({
      promptEvent: null,
      installed: false,
      bannerDismissed: false,
      iosSheetOpen: false,
      capture: (promptEvent) => set({ promptEvent }),
      markInstalled: () => set({ installed: true, promptEvent: null }),
      dismissBanner: () => set({ bannerDismissed: true }),
      setIosSheetOpen: (iosSheetOpen) => set({ iosSheetOpen }),
      promptInstall: async () => {
        const { promptEvent } = get();
        if (!promptEvent) return 'unavailable';
        await promptEvent.prompt();
        const { outcome } = await promptEvent.userChoice;
        // A prompt event can only be used once.
        set({ promptEvent: null, ...(outcome === 'accepted' ? { installed: true } : {}) });
        return outcome;
      },
    }),
    {
      name: 'zuvo-install',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ bannerDismissed: state.bannerDismissed }),
    },
  ),
);

/** Captures the browser's install events. Returns an unsubscribe function. */
export function listenForInstallEvents(win: Window = window): () => void {
  const onPrompt = (event: Event) => {
    event.preventDefault(); // keep it for our own button instead of the mini-infobar
    useInstallStore.getState().capture(event as BeforeInstallPromptEvent);
  };
  const onInstalled = () => useInstallStore.getState().markInstalled();
  win.addEventListener('beforeinstallprompt', onPrompt);
  win.addEventListener('appinstalled', onInstalled);
  return () => {
    win.removeEventListener('beforeinstallprompt', onPrompt);
    win.removeEventListener('appinstalled', onInstalled);
  };
}

export interface InstallAvailability {
  /** How installing works here, or null when it isn't possible / already done. */
  method: 'prompt' | 'ios' | null;
  showBanner: boolean;
}

export function useInstallAvailability(): InstallAvailability {
  const promptEvent = useInstallStore((state) => state.promptEvent);
  const installed = useInstallStore((state) => state.installed);
  const dismissed = useInstallStore((state) => state.bannerDismissed);

  if (installed || isStandalone()) return { method: null, showBanner: false };
  const method = promptEvent ? 'prompt' : isIosSafari() ? 'ios' : null;
  return { method, showBanner: method !== null && !dismissed };
}
