import { mediaSessionControls, type Speed, type Track } from './player';

const SEEK_STEP_SECONDS = 10;

let shown: string | null = null;
let connected = false;

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
    return;
  }
  connectControls(session);
  const { track, position, playing, speed } = now;
  if (shown !== track.key) {
    shown = track.key;
    if (typeof MediaMetadata !== 'undefined') {
      session.metadata = new MediaMetadata({ title: track.title, artist: track.subtitle });
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
