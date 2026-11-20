import type { CallView } from '@zuvo/protocol';
import { describe, expect, it } from 'vitest';
import {
  type CallEvent,
  type CallState,
  callReducer,
  elapsedSeconds,
  IDLE,
  inCall,
} from './machine';

const call = (overrides: Partial<CallView> = {}): CallView => ({
  id: 'call1',
  chatId: 'chat1',
  kind: 'voice',
  callerId: 'asha',
  calleeId: 'bharat',
  status: 'ringing',
  outcome: null,
  startedAt: '2026-11-20T10:00:00.000Z',
  ringingAt: null,
  answeredAt: null,
  endedAt: null,
  ...overrides,
});

const run = (events: CallEvent[], from: CallState = IDLE) => events.reduce(callReducer, from);
const ended = (outcome: CallView['outcome']) => call({ status: 'ended', outcome });

describe('an outgoing call', () => {
  it('calling → ringing → connecting → active → ended (answered)', () => {
    let state = run([{ type: 'dial', call: call(), busy: false }]);
    expect(state).toMatchObject({ phase: 'outgoing', direction: 'outgoing', peerRinging: false });
    state = callReducer(state, {
      type: 'update',
      call: call({ ringingAt: '2026-11-20T10:00:01.000Z' }),
    });
    expect(state.peerRinging).toBe(true);
    state = callReducer(state, { type: 'update', call: call({ status: 'active' }) });
    expect(state.phase).toBe('connecting');
    state = callReducer(state, { type: 'connected', at: 1000 });
    expect(state).toMatchObject({ phase: 'active', connectedAt: 1000 });
    expect(elapsedSeconds(state, 152_500)).toBe(151);
    state = callReducer(state, { type: 'update', call: ended('answered') });
    expect(state).toMatchObject({ phase: 'ended', endReason: 'answered' });
    expect(callReducer(state, { type: 'dismiss' })).toEqual(IDLE);
  });

  it('busy: over at once, saying so', () => {
    const state = run([{ type: 'dial', call: ended('busy'), busy: true }]);
    expect(state).toMatchObject({ phase: 'ended', endReason: 'busy' });
    expect(inCall(state)).toBe(false);
  });

  it('declined, or nobody answers in time (missed)', () => {
    for (const outcome of ['declined', 'missed'] as const) {
      const state = run([
        { type: 'dial', call: call(), busy: false },
        { type: 'update', call: ended(outcome) },
      ]);
      expect(state).toMatchObject({ phase: 'ended', endReason: outcome });
    }
  });

  it('cannot start a second call while one is going', () => {
    const state = run([{ type: 'dial', call: call(), busy: false }]);
    expect(callReducer(state, { type: 'dial', call: call({ id: 'call2' }), busy: false })).toBe(
      state,
    );
    expect(
      callReducer(state, { type: 'incoming', call: call({ id: 'call3' }), silent: false }),
    ).toBe(state);
  });
});

describe('an incoming call', () => {
  it('rings, is accepted here, connects', () => {
    let state = run([{ type: 'incoming', call: call(), silent: false }]);
    expect(state).toMatchObject({ phase: 'incoming', direction: 'incoming' });
    state = callReducer(state, { type: 'accept' });
    expect(state.phase).toBe('connecting');
    // The server's "answered" (to all my devices) does not end it on the device that answered.
    state = callReducer(state, { type: 'update', call: call({ status: 'active' }) });
    expect(state.phase).toBe('connecting');
    expect(callReducer(state, { type: 'connected', at: 5 }).phase).toBe('active');
  });

  it('multi-device: answered on another of my devices, this one stops ringing', () => {
    const state = run([
      { type: 'incoming', call: call(), silent: false },
      { type: 'update', call: call({ status: 'active' }) },
    ]);
    expect(state).toEqual(IDLE);
  });

  it('declined here, or the caller gives up, or it times out', () => {
    expect(
      run([
        { type: 'incoming', call: call(), silent: false },
        { type: 'end', reason: 'declined', at: 1 },
      ]),
    ).toMatchObject({ phase: 'ended', endReason: 'declined' });
    for (const outcome of ['cancelled', 'missed'] as const) {
      const state = run([
        { type: 'incoming', call: call(), silent: false },
        { type: 'update', call: ended(outcome) },
      ]);
      expect(state).toMatchObject({ phase: 'ended', endReason: outcome });
    }
  });

  it('quiet hours: shown, not rung', () => {
    expect(run([{ type: 'incoming', call: call(), silent: true }]).silent).toBe(true);
  });

  it('ignores news about other calls', () => {
    const state = run([{ type: 'incoming', call: call(), silent: false }]);
    expect(
      callReducer(state, { type: 'update', call: call({ id: 'other', status: 'ended' }) }),
    ).toBe(state);
  });
});

describe('during a call', () => {
  const active = run([
    { type: 'dial', call: call(), busy: false },
    { type: 'update', call: call({ status: 'active' }) },
    { type: 'connected', at: 0 },
  ]);

  it('reconnecting on a network change, and back', () => {
    const lost = callReducer(active, { type: 'media-lost' });
    expect(lost.reconnecting).toBe(true);
    expect(callReducer(lost, { type: 'media-back' }).reconnecting).toBe(false);
    expect(callReducer(lost, { type: 'connected', at: 99 })).toMatchObject({
      reconnecting: false,
      connectedAt: 0,
    });
  });

  it('mute, speaker and the quality indicator', () => {
    let state = callReducer(active, { type: 'mute', muted: true });
    state = callReducer(state, { type: 'speaker', on: true });
    state = callReducer(state, { type: 'quality', quality: 'poor' });
    expect(state).toMatchObject({ muted: true, speaker: true, quality: 'poor' });
  });

  it('dropped for good: ended as failed, and the timer stops', () => {
    const state = callReducer(active, { type: 'end', reason: 'failed', at: 61_000 });
    expect(state).toMatchObject({ phase: 'ended', endReason: 'failed' });
    expect(elapsedSeconds(state, 999_999)).toBe(61);
  });
});
