import { mediaSessionControls, type Speed, type Track } from './player';

const SEEK_STEP_SECONDS = 10;
/** The app icon, when the sender has no photo (frontend/pwa/assets.ts). */
const FALLBACK_ARTWORK = { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' };
const ACTIONS: MediaSessionAction[] = ['play', 'pause', 'seekbackward', 'seekforward', 'seekto'];

let shown: string | null = null;
let connected = false;

/** Nothing playing: the lock screen's buttons must not keep driving a closed player. */
function disconnectControls(session: MediaSession) {
  if (!connected) return;
  connected = false;
  for (const action of ACTIONS) {
    try {
      session.setActionHandler(action, null);
    } catch {
      // This browser has no such control.
    }
  }
}

function connectControls(session: MediaSession) {
  if (connected) return;
  connected = true;
  // Not every browser knows every action, and asking about an unknown one throws.
  const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
    play: () => mediaSessionControls.play(),
    pause: () => mediaSessionControls.pause(),
    seekbackward: (details) =>
      mediaSessionControls.seekBy(-(details.seekOffset ?? SEEK_STEP_SECONDS)),
    seekforward: (details) => mediaSessionControls.seekBy(details.seekOffset ?? SEEK_STEP_SECONDS),
    seekto: (details) => {
      if (details.seekTime !== undefined) mediaSessionControls.seekTo(details.seekTime);
    },
  };
  for (const [action, handler] of Object.entries(handlers)) {
    try {
      session.setActionHandler(action as MediaSessionAction, handler);
    } catch {
      // This browser has no such control.
    }
  }
}

interface Now {
  track: Track;
  position: number;
  playing: boolean;
  speed: Speed;
}

/** System and lock-screen controls, where the browser has them. Null when nothing is playing. */
export function updateMediaSession(now: Now | null): void {
  const session = globalThis.navigator?.mediaSession;
  if (!session) return;
  if (!now) {
    session.metadata = null;
    session.playbackState = 'none';
    shown = null;
    disconnectControls(session);
    return;
  }
  connectControls(session);
  const { track, position, playing, speed } = now;
  if (shown !== track.key) {
    shown = track.key;
    if (typeof MediaMetadata !== 'undefined') {
      session.metadata = new MediaMetadata({
        title: track.title,
        artist: track.subtitle,
        artwork: track.artwork ? [{ src: track.artwork }] : [FALLBACK_ARTWORK],
      });
    }
  }
  session.playbackState = playing ? 'playing' : 'paused';
  if (track.duration > 0 && position <= track.duration) {
    try {
      session.setPositionState({ duration: track.duration, position, playbackRate: speed });
    } catch {
      // Older browsers refuse some values; the controls still work.
    }
  }
}
