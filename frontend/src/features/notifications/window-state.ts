import type { ClientToServerEvents, Message, ServerToClientEvents } from '@zuvo/protocol';
import type { Socket } from 'socket.io-client';

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export const currentWindowState = () => ({
  visible: document.visibilityState === 'visible',
  focused: document.hasFocus(),
});

/**
 * Tells the server whether this tab is visible and focused: a device with no such tab gets Web Push
 * instead. Sent after every (re)connect and on every change.
 */
export function trackWindowState(socket: AppSocket) {
  let last = '';
  const send = (force: boolean) => {
    if (!socket.connected) return;
    const state = currentWindowState();
    const key = `${state.visible}:${state.focused}`;
    if (!force && key === last) return;
    last = key;
    socket.emit('window:state', state, () => undefined);
  };
  const onChange = () => send(false);
  const onConnect = () => send(true);
  socket.on('connect', onConnect);
  document.addEventListener('visibilitychange', onChange);
  window.addEventListener('focus', onChange);
  window.addEventListener('blur', onChange);
  return {
    stop() {
      socket.off('connect', onConnect);
      document.removeEventListener('visibilitychange', onChange);
      window.removeEventListener('focus', onChange);
      window.removeEventListener('blur', onChange);
    },
  };
}

type IncomingListener = (message: Message, me: string) => void;
const incomingListeners = new Set<IncomingListener>();

/** In-app alerts listen here for every new message this tab hears about. */
export function onIncomingMessage(listener: IncomingListener): () => void {
  incomingListeners.add(listener);
  return () => incomingListeners.delete(listener);
}

/** What the sync client wires for notifications: window state, and new messages for alerts. */
export function wireNotifications(socket: AppSocket, me: string) {
  const windowState = trackWindowState(socket);
  const onNew = ({ message }: { message: Message }) => {
    for (const listener of incomingListeners) listener(message, me);
  };
  socket.on('message:new', onNew);
  return {
    stop() {
      windowState.stop();
      socket.off('message:new', onNew);
    },
  };
}
