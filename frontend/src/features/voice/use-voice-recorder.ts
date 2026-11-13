import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { describeRecording, pickRecordingFormat } from './format';
import { canRecord, problemFromError } from './permission';
import { initialRecorderState, isActive, isLongEnough, recorderReducer } from './recorder-machine';
import { rmsOf, toWaveform } from './waveform';

const LEVEL_EVERY_MS = 100;
const LIVE_BARS = 32;
/** MediaRecorder hands over what it has this often, so a crash loses little. */
const CHUNK_MS = 1000;

export interface VoiceRecording {
  blob: Blob;
  mime: string;
  name: string;
  duration: number;
  waveform: number[];
}

/** The browser parts, so tests can stand in for them. */
export interface RecorderDevices {
  supported: () => boolean;
  isTypeSupported: (mime: string) => boolean;
  getStream: () => Promise<MediaStream>;
  createRecorder: (stream: MediaStream, mime: string) => MediaRecorder;
  /** Reads how loud the microphone is right now, from 0 to 1. */
  listen: (stream: MediaStream) => { level: () => number; close: () => void };
}

function listenWithWebAudio(stream: MediaStream) {
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  return {
    level() {
      analyser.getFloatTimeDomainData(samples);
      return rmsOf(samples);
    },
    close: () => void context.close().catch(() => undefined),
  };
}

export const browserDevices: RecorderDevices = {
  supported: canRecord,
  isTypeSupported: (mime) => MediaRecorder.isTypeSupported(mime),
  getStream: () => navigator.mediaDevices.getUserMedia({ audio: true }),
  createRecorder: (stream, mimeType) => new MediaRecorder(stream, { mimeType }),
  listen: listenWithWebAudio,
};

interface Session {
  stream: MediaStream;
  recorder: MediaRecorder;
  meter: ReturnType<RecorderDevices['listen']>;
  mime: string;
  chunks: Blob[];
  levels: number[];
  /** Time recorded before the current stretch. Pausing stops the clock. */
  bankedMs: number;
  startedAt: number | null;
  timer: ReturnType<typeof setInterval>;
}

const elapsed = (current: Session) =>
  current.bankedMs + (current.startedAt === null ? 0 : performance.now() - current.startedAt);

const stopTracks = (stream: MediaStream) => {
  for (const track of stream.getTracks()) track.stop();
};

function openSession(
  devices: RecorderDevices,
  stream: MediaStream,
  mime: string,
  onLevel: () => void,
): Session {
  const recorder = devices.createRecorder(stream, mime);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  return {
    stream,
    recorder,
    meter: devices.listen(stream),
    mime,
    chunks,
    levels: [],
    bankedMs: 0,
    startedAt: performance.now(),
    timer: setInterval(onLevel, LEVEL_EVERY_MS),
  };
}

interface Options {
  maxSeconds: number;
  onRecorded: (recording: VoiceRecording) => void;
  devices?: RecorderDevices;
}

/** One voice note at a time: the microphone, the clock and the levels, all let go of at the end. */
export function useVoiceRecorder({ maxSeconds, onRecorded, devices = browserDevices }: Options) {
  const maxMs = maxSeconds * 1000;
  const reducer = useMemo(() => recorderReducer(maxMs), [maxMs]);
  const [state, dispatch] = useReducer(reducer, initialRecorderState);
  const [liveLevels, setLiveLevels] = useState<number[]>([]);
  const session = useRef<Session | null>(null);
  const cancelled = useRef(false);

  const release = useCallback(() => {
    const current = session.current;
    if (!current) return;
    session.current = null;
    clearInterval(current.timer);
    current.meter.close();
    stopTracks(current.stream);
    setLiveLevels([]);
  }, []);

  const hold = useCallback((current: Session) => {
    if (current.startedAt === null) return;
    current.bankedMs += performance.now() - current.startedAt;
    current.startedAt = null;
    if (current.recorder.state === 'recording') current.recorder.pause();
  }, []);

  const start = useCallback(
    async (locked: boolean) => {
      if (!devices.supported()) return dispatch({ type: 'refused', problem: 'unsupported' });
      const mime = pickRecordingFormat(devices.isTypeSupported);
      if (!mime) return dispatch({ type: 'refused', problem: 'unsupported' });
      cancelled.current = false;
      dispatch({ type: 'ask', locked });
      let stream: MediaStream;
      try {
        stream = await devices.getStream();
      } catch (error) {
        return dispatch({ type: 'refused', problem: problemFromError(error) });
      }
      // Let go of the button while the browser was asking: that was not a recording.
      if (cancelled.current) {
        stopTracks(stream);
        return;
      }
      try {
        const current = openSession(devices, stream, mime, () => {
          const active = session.current;
          if (!active || active.startedAt === null) return;
          active.levels.push(active.meter.level());
          setLiveLevels(active.levels.slice(-LIVE_BARS));
          const elapsedMs = elapsed(active);
          if (elapsedMs >= maxMs) hold(active);
          dispatch({ type: 'tick', elapsedMs });
        });
        session.current = current;
        current.recorder.start(CHUNK_MS);
        dispatch({ type: 'started' });
      } catch {
        release();
        stopTracks(stream);
        dispatch({ type: 'refused', problem: 'failed' });
      }
    },
    [devices, hold, maxMs, release],
  );

  const pause = useCallback(() => {
    if (session.current) hold(session.current);
    dispatch({ type: 'pause' });
  }, [hold]);

  const resume = useCallback(() => {
    const current = session.current;
    if (current?.recorder.state === 'paused') {
      current.recorder.resume();
      current.startedAt = performance.now();
    }
    dispatch({ type: 'resume' });
  }, []);

  const cancel = useCallback(() => {
    cancelled.current = true;
    const current = session.current;
    if (current) {
      current.recorder.ondataavailable = null;
      if (current.recorder.state !== 'inactive') current.recorder.stop();
    }
    release();
    dispatch({ type: 'cancel' });
  }, [release]);

  /** Stops, and hands over the recording if it is long enough to keep. */
  const finish = useCallback(() => {
    const current = session.current;
    if (!current) {
      // Let go before the microphone had even started.
      cancelled.current = true;
      dispatch({ type: 'cancel' });
      return;
    }
    const elapsedMs = Math.min(elapsed(current), maxMs);
    const { recorder, chunks, levels } = current;
    const deliver = () => {
      const kept = isLongEnough(elapsedMs);
      release();
      if (!kept) return;
      const type = recorder.mimeType || current.mime;
      onRecorded({
        ...describeRecording(type),
        blob: new Blob(chunks, { type: describeRecording(type).mime }),
        duration: Math.round(elapsedMs / 100) / 10,
        waveform: toWaveform(levels),
      });
    };
    dispatch({ type: 'finish', elapsedMs });
    if (recorder.state === 'inactive') return deliver();
    recorder.onstop = deliver;
    recorder.stop();
  }, [maxMs, onRecorded, release]);

  // Leaving the chat lets go of the microphone.
  useEffect(() => () => release(), [release]);

  return {
    ...state,
    active: isActive(state.status) || state.status === 'asking',
    liveLevels,
    start,
    pause,
    resume,
    cancel,
    finish,
    lock: useCallback(() => dispatch({ type: 'lock' }), []),
    dismiss: useCallback(() => dispatch({ type: 'dismiss' }), []),
  };
}
