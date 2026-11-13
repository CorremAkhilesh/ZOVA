import type { AppLanguage } from '@zuvo/protocol';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { sessionSnapshot } from '@/features/auth/session';
import { i18n } from '@/lib/i18n';

/**
 * The app's language lives on the server (profile `language`), so every device and every email
 * and notification use the same one. A choice made here is applied at once and kept as
 * "pending" until the server has it, so a choice made offline is not undone by the server's
 * older value.
 */
interface PendingLanguage {
  pending: { userId: string; language: AppLanguage } | null;
  setPending: (pending: PendingLanguage['pending']) => void;
}

export const usePendingLanguage = create<PendingLanguage>()(
  persist(
    (set) => ({
      pending: null,
      setPending: (pending) => set({ pending }),
    }),
    {
      name: 'zuvo-language-pending',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ pending: state.pending }),
    },
  ),
);

/** What i18next shows now, as one of the app's languages. */
export function shownLanguage(): AppLanguage {
  return i18n.resolvedLanguage === 'hi' ? 'hi' : 'en';
}

/** Settings → Language and the command palette: switch now, save to the server soon after. */
export async function chooseLanguage(language: AppLanguage) {
  await i18n.changeLanguage(language);
  const userId = sessionSnapshot.load()?.user.id;
  if (userId) usePendingLanguage.getState().setPending({ userId, language });
}

export type LanguageStep =
  | { kind: 'none' }
  | { kind: 'apply'; language: AppLanguage }
  | { kind: 'save'; language: AppLanguage };

/**
 * What to do once the session (and its saved language) is known:
 * - a choice made on this device that the server does not have yet: save it;
 * - a brand-new account (still naming itself): it takes this device's language;
 * - otherwise the server's language wins, also on a device that never chose one.
 */
export function nextLanguageStep(
  account: { userId: string; saved: AppLanguage; needsProfile: boolean },
  shown: AppLanguage,
  pending: PendingLanguage['pending'],
): LanguageStep {
  const { saved } = account;
  const mine = pending?.userId === account.userId ? pending.language : null;
  if (mine) return mine === saved ? { kind: 'none' } : { kind: 'save', language: mine };
  if (saved === shown) return { kind: 'none' };
  if (account.needsProfile) return { kind: 'save', language: shown };
  return { kind: 'apply', language: saved };
}
