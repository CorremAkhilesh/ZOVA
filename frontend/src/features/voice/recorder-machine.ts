import { VOICE_MIN_SECONDS } from '@zuvo/protocol';

/** How long before the limit the bar warns. */
export const WARN_BEFORE_MS = 30_000;

export type RecorderStatus =
  | 'idle'
  /** Waiting for the browser's permission prompt and the microphone to start. */
  | 'asking'
  | 'recording'
  | 'paused'
  /** At the limit: nothing more is captured, and what was said is kept to send or delete. */
  | 'atLimit';

export type RecorderProblem = 'blocked' | 'noMic' | 'unsupported' | 'failed' | 'tooShort';

export interface RecorderState {
  status: RecorderStatus;
  /** False while a finger is holding the button; true for a click, or once slid up to lock. */
  locked: boolean;
  elapsedMs: number;
  /** The last thing that stopped a recording, shown until the next attempt. */
  problem: RecorderProblem | null;
}

export type RecorderEvent =
  | { type: 'ask'; locked: boolean }
  | { type: 'started' }
  | { type: 'refused'; problem: Exclude<RecorderProblem, 'tooShort'> }
  | { type: 'lock' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'tick'; elapsedMs: number }
  | { type: 'cancel' }
  | { type: 'finish'; elapsedMs: number }
  | { type: 'dismiss' };

export const initialRecorderState: RecorderState = {
  status: 'idle',
  locked: false,
  elapsedMs: 0,
  problem: null,
};

export const isLongEnough = (elapsedMs: number) => elapsedMs >= VOICE_MIN_SECONDS * 1000;

const isCapturing = (status: RecorderStatus) => status === 'recording' || status === 'paused';
export const isActive = (status: RecorderStatus) => isCapturing(status) || status === 'atLimit';

/** Whether the bar should warn that the limit is close. */
export const isNearLimit = (elapsedMs: number, maxMs: number) =>
  elapsedMs >= maxMs - WARN_BEFORE_MS;

type Rule<Type extends RecorderEvent['type']> = (
  state: RecorderState,
  event: Extract<RecorderEvent, { type: Type }>,
  maxMs: number,
) => RecorderState;

const RULES: { [Type in RecorderEvent['type']]: Rule<Type> } = {
  ask: (state, event) =>
    state.status === 'idle'
      ? { ...initialRecorderState, status: 'asking', locked: event.locked }
      : state,
  started: (state) =>
    state.status === 'asking' ? { ...state, status: 'recording', elapsedMs: 0 } : state,
  refused: (_state, event) => ({ ...initialRecorderState, problem: event.problem }),
  lock: (state) => (isCapturing(state.status) ? { ...state, locked: true } : state),
  pause: (state) =>
    state.status === 'recording' ? { ...state, status: 'paused', locked: true } : state,
  resume: (state) => (state.status === 'paused' ? { ...state, status: 'recording' } : state),
  tick: (state, event, maxMs) => {
    if (state.status !== 'recording') return state;
    return event.elapsedMs >= maxMs
      ? { ...state, status: 'atLimit', locked: true, elapsedMs: maxMs }
      : { ...state, elapsedMs: event.elapsedMs };
  },
  cancel: () => initialRecorderState,
  finish: (state, event) => {
    if (!isActive(state.status)) return state;
    return { ...initialRecorderState, problem: isLongEnough(event.elapsedMs) ? null : 'tooShort' };
  },
  dismiss: (state) => ({ ...state, problem: null }),
};

/** Every state a recording can be in, with no timers or browser in it, so all of it can be tested. */
export function recorderReducer(maxMs: number) {
  return (state: RecorderState, event: RecorderEvent): RecorderState =>
    (RULES[event.type] as Rule<RecorderEvent['type']>)(state, event as never, maxMs);
}
