import { create } from 'zustand';
import { type CallEvent, type CallState, callReducer, IDLE } from './machine';

/** What the screens can ask for. The controller (one per signed-in tab) does the work. */
export interface CallActions {
  dial(chatId: string): Promise<void>;
  accept(): Promise<void>;
  decline(): void;
  hangUp(): void;
  toggleMute(): void;
  toggleSpeaker(): Promise<void>;
  /** Whether this browser can choose where sound comes out. */
  canChooseSpeaker(): boolean;
}

interface CallStore {
  state: CallState;
  actions: CallActions | null;
  /** The call screen is folded away (the "On call" bar shows instead). */
  minimized: boolean;
  send(event: CallEvent): void;
  setMinimized(minimized: boolean): void;
}

export const useCallStore = create<CallStore>((set) => ({
  state: IDLE,
  actions: null,
  minimized: false,
  send: (event) =>
    set((store) => {
      const state = callReducer(store.state, event);
      // A new call always opens full screen.
      const minimized =
        state.phase === 'idle' || state.call?.id !== store.state.call?.id ? false : store.minimized;
      return { state, minimized };
    }),
  setMinimized: (minimized) => set({ minimized }),
}));

export const callState = () => useCallStore.getState().state;

/** The full-screen call is showing (a call going on, not folded into the "On call" bar). */
export const callScreenOpen = () => {
  const { state, minimized } = useCallStore.getState();
  return !minimized && ['outgoing', 'incoming', 'connecting', 'active'].includes(state.phase);
};
