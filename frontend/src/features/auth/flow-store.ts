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
  codeSent: (email: string, resendAfterSeconds: number) => void;
  setPendingEmail: (email: string) => void;
  setSignedOutReason: (reason: SignedOutReason) => void;
}

/** Sign-in flow state. Session storage: survives a reload of the tab, not a new tab. */
export const useAuthFlow = create<AuthFlowState>()(
  persist(
    (set) => ({
      pendingEmail: '',
      resendAvailableAt: 0,
      signedOutReason: null,
      codeSent: (email, resendAfterSeconds) =>
        set({ pendingEmail: email, resendAvailableAt: Date.now() + resendAfterSeconds * 1000 }),
      setPendingEmail: (pendingEmail) => set({ pendingEmail }),
      setSignedOutReason: (signedOutReason) => set({ signedOutReason }),
    }),
    { name: 'zuvo-auth-flow', storage: createJSONStorage(() => sessionStorage) },
  ),
);
