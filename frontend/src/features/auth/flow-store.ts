import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type SignedOutReason = 'expired' | 'signed-out' | null;

interface AuthFlowState {
  /** Email the code was sent to (OTP step). */
  pendingEmail: string;
  /** Epoch ms when "Resend code" becomes available. */
  resendAvailableAt: number;
  /** Why the user landed on the welcome screen, shown once. */
  signedOutReason: SignedOutReason;
  /** The last sign-out could not delete everything yet (another tab held it). */
  wipeIncomplete: boolean;
  codeSent: (email: string, resendAfterSeconds: number) => void;
  setPendingEmail: (email: string) => void;
  setSignedOutReason: (reason: SignedOutReason) => void;
  setWipeIncomplete: (wipeIncomplete: boolean) => void;
}

/** Sign-in flow state. Session storage: survives a reload of the tab, not a new tab. */
export const useAuthFlow = create<AuthFlowState>()(
  persist(
    (set) => ({
      pendingEmail: '',
      resendAvailableAt: 0,
      signedOutReason: null,
      wipeIncomplete: false,
      codeSent: (email, resendAfterSeconds) =>
        set({ pendingEmail: email, resendAvailableAt: Date.now() + resendAfterSeconds * 1000 }),
      setPendingEmail: (pendingEmail) => set({ pendingEmail }),
      setSignedOutReason: (signedOutReason) => set({ signedOutReason }),
      setWipeIncomplete: (wipeIncomplete) => set({ wipeIncomplete }),
    }),
    { name: 'zuvo-auth-flow', storage: createJSONStorage(() => sessionStorage) },
  ),
);
