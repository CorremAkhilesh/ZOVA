import type { CallOutcome, CallView } from '@zuvo/protocol';

/**
 * One device's view of a call, as a pure state machine (no sockets, no WebRTC): the controller feeds
 * it what the server and the connection say, and the screens show what it holds.
 *
 *   idle ─dial→ outgoing ─(answered)→ connecting ─(audio flows)→ active ─→ ended ─dismiss→ idle
 *   idle ─incoming→ incoming ─accept→ connecting …
 *   incoming ─(answered on another device)→ idle
 */
export type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active' | 'ended';

/** Why a call ended, as this device tells it. `elsewhere`: answered on another of my devices. */
export type EndReason = CallOutcome | 'elsewhere' | 'error';

export type Quality = 'good' | 'fair' | 'poor';

export interface CallState {
  phase: CallPhase;
  call: CallView | null;
  direction: 'outgoing' | 'incoming' | null;
  /** Outgoing: a device of theirs shows the call ("Ringing…" rather than "Calling…"). */
  peerRinging: boolean;
  /** Incoming during my quiet hours: shown, not rung. */
  silent: boolean;
  /** The audio path dropped; trying to get it back. */
  reconnecting: boolean;
  /** No direct route in time: trying the relay ("Trying another route…"). */
  rerouting: boolean;
  muted: boolean;
  speaker: boolean;
  /** When audio first flowed (ms), for the timer. */
  connectedAt: number | null;
  endedAt: number | null;
  endReason: EndReason | null;
  quality: Quality | null;
}

export const IDLE: CallState = {
  phase: 'idle',
  call: null,
  direction: null,
  peerRinging: false,
  silent: false,
  reconnecting: false,
  rerouting: false,
  muted: false,
  speaker: false,
  connectedAt: null,
  endedAt: null,
  endReason: null,
  quality: null,
};

export type CallEvent =
  | { type: 'dial'; call: CallView; busy: boolean }
  | { type: 'incoming'; call: CallView; silent: boolean }
  | { type: 'update'; call: CallView }
  | { type: 'accept' }
  | { type: 'connected'; at: number }
  | { type: 'media-lost' }
  | { type: 'rerouting' }
  | { type: 'media-back' }
  | { type: 'end'; reason: EndReason; at: number }
  | { type: 'mute'; muted: boolean }
  | { type: 'speaker'; on: boolean }
  | { type: 'quality'; quality: Quality | null }
  | { type: 'dismiss' };

const LIVE: ReadonlySet<CallPhase> = new Set(['outgoing', 'incoming', 'connecting', 'active']);

/** Whether this device is busy with a call (another one cannot start or ring here). */
export const inCall = (state: CallState) => LIVE.has(state.phase);

function ended(state: CallState, reason: EndReason, at: number): CallState {
  return { ...state, phase: 'ended', endReason: reason, endedAt: at, reconnecting: false };
}

/** The server says something about a call: only the one this device is in counts. */
function onUpdate(state: CallState, call: CallView): CallState {
  if (!state.call || state.call.id !== call.id || state.phase === 'ended') return state;
  const next = { ...state, call };
  if (call.status === 'ended') return ended(next, call.outcome ?? 'failed', Date.now());
  if (call.status === 'active') {
    // Ringing here, but answered on another of my devices: nothing more to do on this one.
    if (state.phase === 'incoming') return IDLE;
    if (state.phase === 'outgoing') return { ...next, phase: 'connecting' };
    return next;
  }
  return { ...next, peerRinging: state.peerRinging || call.ringingAt !== null };
}

export function callReducer(state: CallState, event: CallEvent): CallState {
  switch (event.type) {
    case 'dial':
      if (inCall(state)) return state;
      return {
        ...IDLE,
        phase: event.busy ? 'ended' : 'outgoing',
        call: event.call,
        direction: 'outgoing',
        endReason: event.busy ? 'busy' : null,
        endedAt: event.busy ? Date.now() : null,
      };
    case 'incoming':
      // Already in a call here: the server says "busy" to the caller, so this should not happen.
      if (inCall(state)) return state;
      return {
        ...IDLE,
        phase: 'incoming',
        call: event.call,
        direction: 'incoming',
        silent: event.silent,
      };
    case 'update':
      return onUpdate(state, event.call);
    case 'accept':
      return state.phase === 'incoming' ? { ...state, phase: 'connecting' } : state;
    case 'rerouting':
      return state.phase === 'connecting' ? { ...state, rerouting: true } : state;
    case 'connected':
      if (state.phase === 'connecting') {
        return { ...state, phase: 'active', connectedAt: event.at, rerouting: false };
      }
      return state.phase === 'active' ? { ...state, reconnecting: false } : state;
    case 'media-lost':
      return state.phase === 'active' ? { ...state, reconnecting: true } : state;
    case 'media-back':
      return state.phase === 'active' ? { ...state, reconnecting: false } : state;
    case 'end':
      return inCall(state) ? ended(state, event.reason, event.at) : state;
    case 'mute':
      return { ...state, muted: event.muted };
    case 'speaker':
      return { ...state, speaker: event.on };
    case 'quality':
      return state.phase === 'active' ? { ...state, quality: event.quality } : state;
    case 'dismiss':
      return state.phase === 'ended' ? IDLE : state;
  }
}

/** Whole seconds since audio first flowed (0 before). */
export const elapsedSeconds = (state: CallState, now: number) =>
  state.connectedAt !== null
    ? Math.max(0, Math.floor(((state.endedAt ?? now) - state.connectedAt) / 1000))
    : 0;
