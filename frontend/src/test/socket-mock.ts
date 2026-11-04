import { vi } from 'vitest';

type Listener = (payload: never) => void;

/** Component tests never open a real socket; they drive this one with `fakeSockets`. */
export const fakeSockets: Array<{
  disconnected: boolean;
  receive: (event: string, payload?: unknown) => void;
}> = [];

vi.mock('socket.io-client', () => ({
  io: () => {
    const listeners = new Map<string, Listener[]>();
    const fake = {
      disconnected: false,
      receive(event: string, payload?: unknown) {
        for (const listener of listeners.get(event) ?? []) listener(payload as never);
      },
      on(event: string, listener: Listener) {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
        return fake;
      },
      disconnect() {
        fake.disconnected = true;
        return fake;
      },
    };
    fakeSockets.push(fake);
    return fake;
  },
}));
