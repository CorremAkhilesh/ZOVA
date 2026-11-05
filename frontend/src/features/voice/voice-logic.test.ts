import { describe, expect, it } from 'vitest';
import { describeRecording, pickRecordingFormat } from './format';
import { browserFamily, holdGesture, problemFromError } from './permission';
import {
  initialRecorderState,
  isNearLimit,
  type RecorderEvent,
  type RecorderState,
  recorderReducer,
} from './recorder-machine';
import { rmsOf, toWaveform } from './waveform';

const MAX = 900_000;
const reduce = recorderReducer(MAX);
const run = (events: RecorderEvent[], from: RecorderState = initialRecorderState) =>
  events.reduce(reduce, from);
const recording = (locked = true) => run([{ type: 'ask', locked }, { type: 'started' }]);

describe('the recorder', () => {
  it('goes from asking to recording', () => {
    const asking = run([{ type: 'ask', locked: true }]);
    expect(asking.status).toBe('asking');
    expect(run([{ type: 'started' }], asking)).toMatchObject({ status: 'recording', elapsedMs: 0 });
  });

  it('pauses and resumes, and the clock only moves while recording', () => {
    const paused = run([{ type: 'tick', elapsedMs: 2000 }, { type: 'pause' }], recording());
    expect(paused.status).toBe('paused');
    expect(run([{ type: 'tick', elapsedMs: 9000 }], paused).elapsedMs).toBe(2000);
    expect(run([{ type: 'resume' }], paused).status).toBe('recording');
  });

  it('forgets everything on cancel', () => {
    const state = run([{ type: 'tick', elapsedMs: 5000 }, { type: 'cancel' }], recording());
    expect(state).toEqual(initialRecorderState);
  });

  it('locks a held recording, and pausing also locks it', () => {
    const held = recording(false);
    expect(held.locked).toBe(false);
    expect(run([{ type: 'lock' }], held).locked).toBe(true);
    expect(run([{ type: 'pause' }], held).locked).toBe(true);
  });

  it('cannot lock, pause or resume while nothing is recording', () => {
    for (const type of ['lock', 'pause', 'resume'] as const) {
      expect(run([{ type }])).toEqual(initialRecorderState);
    }
  });

  it('stops at the limit and keeps what was said, ready to send', () => {
    const state = run([{ type: 'tick', elapsedMs: MAX + 50 }], recording(false));
    expect(state).toMatchObject({ status: 'atLimit', locked: true, elapsedMs: MAX });
    expect(run([{ type: 'finish', elapsedMs: MAX }], state)).toEqual(initialRecorderState);
  });

  it('warns from 30 seconds before the limit', () => {
    expect(isNearLimit(MAX - 30_001, MAX)).toBe(false);
    expect(isNearLimit(MAX - 30_000, MAX)).toBe(true);
    expect(isNearLimit(870_000, 900_000)).toBe(true);
  });

  it('discards anything under a second, and says so', () => {
    expect(run([{ type: 'finish', elapsedMs: 999 }], recording())).toMatchObject({
      status: 'idle',
      problem: 'tooShort',
    });
    expect(run([{ type: 'finish', elapsedMs: 1000 }], recording()).problem).toBeNull();
  });

  it('reports a refused microphone, and clears it on the next try', () => {
    const blocked = run([
      { type: 'ask', locked: true },
      { type: 'refused', problem: 'blocked' },
    ]);
    expect(blocked).toMatchObject({ status: 'idle', problem: 'blocked' });
    expect(run([{ type: 'ask', locked: true }], blocked).problem).toBeNull();
    expect(run([{ type: 'dismiss' }], blocked).problem).toBeNull();
  });

  it('does not start a second recording over the first', () => {
    const state = recording();
    expect(run([{ type: 'ask', locked: false }], state)).toEqual(state);
  });

  it('ignores a microphone that starts after being cancelled', () => {
    const state = run([{ type: 'ask', locked: false }, { type: 'cancel' }, { type: 'started' }]);
    expect(state.status).toBe('idle');
  });
});

describe('choosing a format', () => {
  const browser =
    (...types: string[]) =>
    (mime: string) =>
      types.includes(mime);

  it('prefers AAC, which every browser can play', () => {
    expect(
      pickRecordingFormat(browser('audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2')),
    ).toBe('audio/mp4;codecs=mp4a.40.2');
  });

  it('uses Opus in WebM, then Ogg, where there is no AAC', () => {
    expect(pickRecordingFormat(browser('audio/webm;codecs=opus', 'audio/ogg;codecs=opus'))).toBe(
      'audio/webm;codecs=opus',
    );
    expect(pickRecordingFormat(browser('audio/ogg;codecs=opus'))).toBe('audio/ogg;codecs=opus');
  });

  it('takes plain MP4 only as the last choice, since it may hold Opus', () => {
    expect(pickRecordingFormat(browser('audio/mp4', 'audio/webm;codecs=opus'))).toBe(
      'audio/webm;codecs=opus',
    );
    expect(pickRecordingFormat(browser('audio/mp4'))).toBe('audio/mp4');
  });

  it('says so when nothing can be recorded', () => {
    expect(pickRecordingFormat(browser())).toBeNull();
  });

  it('names the file from what was recorded, without the codec', () => {
    expect(describeRecording('audio/webm;codecs=opus')).toEqual({
      mime: 'audio/webm',
      name: 'voice-note.webm',
    });
    expect(describeRecording('audio/mp4; codecs="mp4a.40.2"')).toEqual({
      mime: 'audio/mp4',
      name: 'voice-note.m4a',
    });
    expect(describeRecording('audio/ogg').name).toBe('voice-note.ogg');
  });
});

describe('the waveform', () => {
  it('always has the same number of bars, whatever the length', () => {
    expect(toWaveform([0.5])).toHaveLength(64);
    expect(toWaveform(Array.from({ length: 9000 }, () => 0.5))).toHaveLength(64);
    expect(toWaveform([])).toHaveLength(64);
  });

  it('scales so that the loudest bar is at the top', () => {
    const bars = toWaveform([0.1, 0.2, 0.05, 0.2], 4);
    expect(bars).toEqual([71, 100, 50, 100]);
  });

  it('keeps quiet speech visible next to one loud moment', () => {
    const bars = toWaveform([0.02, 0.02, 0.5, 0.02], 4);
    expect(bars[0]).toBeGreaterThan(15);
  });

  it('keeps a short loud word in a long quiet note', () => {
    const levels = Array.from({ length: 6400 }, () => 0.01);
    levels[3200] = 0.9;
    expect(Math.max(...toWaveform(levels))).toBe(100);
  });

  it('stays flat for silence, with no division by zero', () => {
    expect(toWaveform([0, 0, 0], 3)).toEqual([0, 0, 0]);
    expect(toWaveform([], 2)).toEqual([0, 0]);
  });

  it('only holds whole numbers from 0 to 100, as the server requires', () => {
    for (const bar of toWaveform([0.123, 0.456, 0.789, 0.001], 64)) {
      expect(Number.isInteger(bar)).toBe(true);
      expect(bar).toBeGreaterThanOrEqual(0);
      expect(bar).toBeLessThanOrEqual(100);
    }
  });

  it('measures how loud samples are', () => {
    expect(rmsOf([])).toBe(0);
    expect(rmsOf(new Float32Array([0, 0]))).toBe(0);
    expect(rmsOf([0.5, -0.5])).toBeCloseTo(0.5);
  });
});

describe('sliding a held mic button', () => {
  it('cancels to the left and locks upwards', () => {
    expect(holdGesture(-80, 0)).toBe('cancel');
    expect(holdGesture(0, -70)).toBe('lock');
  });

  it('does nothing for small movements', () => {
    expect(holdGesture(-79, -69)).toBe('hold');
    expect(holdGesture(50, 50)).toBe('hold');
  });
});

describe('microphone problems', () => {
  const named = (name: string) => Object.assign(new Error('x'), { name });

  it('tells a blocked microphone from a missing one', () => {
    expect(problemFromError(named('NotAllowedError'))).toBe('blocked');
    expect(problemFromError(named('SecurityError'))).toBe('blocked');
    expect(problemFromError(named('NotFoundError'))).toBe('noMic');
    expect(problemFromError(named('NotReadableError'))).toBe('failed');
    expect(problemFromError('odd')).toBe('failed');
  });

  it('recognises browsers for the first steps to show', () => {
    expect(browserFamily('Mozilla/5.0 (iPhone) Version/18 Safari/604')).toBe('iphone');
    expect(browserFamily('Chrome/130 Safari/537 Edg/130')).toBe('edge');
    expect(browserFamily('Mozilla/5.0 Gecko Firefox/130')).toBe('firefox');
    expect(browserFamily('Mozilla/5.0 Chrome/130 Safari/537')).toBe('chrome');
    expect(browserFamily('Mozilla/5.0 Version/18 Safari/605')).toBe('safari');
    expect(browserFamily('Something else')).toBe('other');
  });
});
