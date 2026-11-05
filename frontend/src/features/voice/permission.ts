export type MicPermission = 'granted' | 'denied' | 'prompt';
export type BrowserFamily = 'chrome' | 'edge' | 'safari' | 'iphone' | 'firefox' | 'other';

const EXPLAINED_KEY = 'zuvo.mic-explained';

/** Safari could not be asked for a long time, so "don't know" means the prompt may still come. */
export async function readMicPermission(): Promise<MicPermission> {
  try {
    const { state } = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    return state;
  } catch {
    return 'prompt';
  }
}

export function canRecord(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

/** Asked why once. A browser that cannot report the permission would otherwise explain every time. */
export function hasExplainedMic(): boolean {
  try {
    return localStorage.getItem(EXPLAINED_KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberMicExplained(): void {
  try {
    localStorage.setItem(EXPLAINED_KEY, '1');
  } catch {
    // Only means explaining again next time.
  }
}

/** Which steps to show first. All browsers' steps stay one tap away, since this is only a guess. */
export function browserFamily(userAgent: string): BrowserFamily {
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'iphone';
  if (/Edg\//.test(userAgent)) return 'edge';
  if (/Firefox\//.test(userAgent)) return 'firefox';
  if (/Chrome\//.test(userAgent)) return 'chrome';
  if (/Safari\//.test(userAgent)) return 'safari';
  return 'other';
}

/** From getUserMedia's error to what the person is told. */
export function problemFromError(error: unknown): 'blocked' | 'noMic' | 'failed' {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'blocked';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'noMic';
  return 'failed';
}

const CANCEL_DISTANCE_PX = 80;
const LOCK_DISTANCE_PX = 70;

/** What a finger sliding from the mic button means, from how far it has moved. */
export function holdGesture(dx: number, dy: number): 'cancel' | 'lock' | 'hold' {
  if (dx <= -CANCEL_DISTANCE_PX) return 'cancel';
  if (dy <= -LOCK_DISTANCE_PX) return 'lock';
  return 'hold';
}
