import type {
  CallSignal,
  CallView,
  ClientToServerEvents,
  ServerToClientEvents,
} from '@zuvo/protocol';
import type { Socket } from 'socket.io-client';
import { toast } from 'sonner';
import { i18n } from '@/lib/i18n';
import { callsApi } from './api';
import { inCall } from './machine';
import { canChooseOutput, MediaSession, otherOutput } from './media-session';
import { startTone } from './ringtone';
import { VOICE_CONSTRAINTS } from './rtc';
import { callState, useCallStore } from './store';

type CallSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const ACK_MS = 15_000;
/** How long "Call ended" stays on screen. */
const ENDED_SCREEN_MS = 2500;

/** What the person sees when a call cannot start. */
export function callErrorText(code: string | undefined): string {
  const known = [
    'CALLS_UNAVAILABLE',
    'BLOCKED',
    'CANNOT_MESSAGE',
    'CALL_IN_PROGRESS',
    'RATE_LIMITED',
  ];
  return i18n.t(`calls.errors.${known.includes(code ?? '') ? code : 'generic'}`);
}

/**
 * Calls for one signed-in tab: listens to the server, rings, answers, and runs the audio. Every tab
 * of mine rings; the one that answers keeps the call and the others stop.
 */
export function startCalls(socket: CallSocket, me: string) {
  const { send } = useCallStore.getState();
  let media: MediaSession | null = null;
  let local: MediaStream | null = null;
  let stopTone: (() => void) | null = null;
  let waiting: CallSignal[] = [];
  let ice: Promise<Awaited<ReturnType<typeof callsApi.ice>>> | null = null;
  let dismissTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const current = () => callState().call;
  const tone = (next: (() => void) | null) => {
    stopTone?.();
    stopTone = next;
  };

  function cleanUp() {
    tone(null);
    media?.close();
    media = null;
    for (const track of local?.getTracks() ?? []) track.stop();
    local = null;
    waiting = [];
    ice = null;
  }

  function afterEnd() {
    cleanUp();
    clearTimeout(dismissTimer);
    dismissTimer = setTimeout(() => send({ type: 'dismiss' }), ENDED_SCREEN_MS);
  }

  async function emit<
    E extends
      | 'call:start'
      | 'call:accept'
      | 'call:decline'
      | 'call:end'
      | 'call:ringing'
      | 'call:beat'
      | 'call:signal',
  >(event: E, payload: Parameters<ClientToServerEvents[E]>[0]) {
    // Bound: emitWithAck reads the socket (and its timeout flag) from `this`.
    const timed = socket.timeout(ACK_MS);
    const emitWithAck = timed.emitWithAck.bind(timed) as (e: E, p: unknown) => Promise<unknown>;
    return (await emitWithAck(event, payload).catch(() => null)) as
      | Parameters<Parameters<ClientToServerEvents[E]>[1]>[0]
      | null;
  }

  async function microphone(): Promise<MediaStream | null> {
    try {
      return await navigator.mediaDevices.getUserMedia(VOICE_CONSTRAINTS);
    } catch {
      toast.error(i18n.t('calls.errors.microphone'));
      return null;
    }
  }

  /** The audio, once the call is answered: the caller offers, the device that answered replies. */
  async function connect(role: 'caller' | 'callee', call: CallView) {
    if (!local || media) return;
    const servers = await (ice ?? callsApi.ice()).catch(() => ({ iceServers: [], ttlSeconds: 0 }));
    if (current()?.id !== call.id || !local || stopped) return;
    media = new MediaSession({
      role,
      iceServers: servers.iceServers,
      local,
      send: (signal) => void emit('call:signal', { callId: call.id, signal }),
      beat: () => void emit('call:beat', { callId: call.id }),
      onConnected: () => send({ type: 'connected', at: Date.now() }),
      onRerouting: () => send({ type: 'rerouting' }),
      onLost: () => send({ type: 'media-lost' }),
      onGiveUp: () => hangUp('failed'),
      onQuality: (quality) => send({ type: 'quality', quality }),
    });
    media.setMuted(callState().muted);
    const queued = waiting;
    waiting = [];
    await media.start();
    for (const signal of queued) await media.handle(signal);
  }

  function hangUp(reason: 'failed' | 'user' = 'user') {
    const state = callState();
    const call = state.call;
    if (!call || !inCall(state)) return;
    if (state.phase === 'incoming') {
      void emit('call:decline', { callId: call.id });
      send({ type: 'end', reason: 'declined', at: Date.now() });
    } else {
      void emit('call:end', { callId: call.id });
      const answered = state.phase === 'active' || state.phase === 'connecting';
      send({
        type: 'end',
        reason: reason === 'failed' ? 'failed' : answered ? 'answered' : 'cancelled',
        at: Date.now(),
      });
    }
    afterEnd();
  }

  socket.on('call:incoming', ({ call, silent }) => {
    if (inCall(callState())) return;
    clearTimeout(dismissTimer);
    send({ type: 'incoming', call, silent });
    void emit('call:ringing', { callId: call.id });
    tone(silent ? null : startTone('ringtone', { vibrate: true }));
    // Ready before the answer: the offer follows it within a moment.
    ice = callsApi.ice();
  });

  socket.on('call:update', ({ call }) => {
    const before = callState();
    if (before.call?.id !== call.id) return;
    send({ type: 'update', call });
    const after = callState();
    if (after.phase === 'idle' || after.phase === 'ended') {
      afterEnd();
      if (after.phase === 'idle') clearTimeout(dismissTimer);
      return;
    }
    if (before.phase === 'outgoing' && after.phase === 'outgoing' && after.peerRinging) {
      tone(startTone('ringback'));
    }
    if (before.phase === 'outgoing' && after.phase === 'connecting') {
      tone(null);
      void connect('caller', call);
    }
  });

  socket.on('call:signal', ({ callId, signal }) => {
    if (current()?.id !== callId) return;
    if (media) void media.handle(signal).catch(() => undefined);
    else waiting.push(signal);
  });

  /** Opened from a notification, or back online: a call may be ringing for me right now. */
  const lookForRinging = async () => {
    if (inCall(callState())) return;
    const call = await callsApi.active().catch(() => null);
    if (call?.status === 'ringing' && call.calleeId === me && !inCall(callState())) {
      send({ type: 'incoming', call, silent: false });
      void emit('call:ringing', { callId: call.id });
      tone(startTone('ringtone', { vibrate: true }));
      ice = callsApi.ice();
    }
  };
  socket.on('connect', () => void lookForRinging());

  const onNetworkChange = () => {
    if (callState().phase === 'active') void media?.restart();
  };
  window.addEventListener('online', onNetworkChange);
  const connection = (navigator as Navigator & { connection?: EventTarget }).connection;
  connection?.addEventListener?.('change', onNetworkChange);

  useCallStore.setState({
    actions: {
      async dial(chatId) {
        if (inCall(callState())) return;
        if (!socket.connected) {
          toast.error(i18n.t('calls.errors.offline'));
          return;
        }
        const mic = await microphone();
        if (!mic) return;
        const ack = await emit('call:start', { chatId, kind: 'voice' });
        if (!ack?.ok) {
          for (const track of mic.getTracks()) track.stop();
          toast.error(callErrorText(ack?.error.code));
          return;
        }
        clearTimeout(dismissTimer);
        send({ type: 'dial', call: ack.data.call, busy: ack.data.busy });
        if (ack.data.busy) {
          for (const track of mic.getTracks()) track.stop();
          afterEnd();
          return;
        }
        local = mic;
        ice = callsApi.ice();
      },
      async accept() {
        const state = callState();
        const call = state.call;
        if (state.phase !== 'incoming' || !call) return;
        tone(null);
        const mic = await microphone();
        if (!mic) {
          hangUp();
          return;
        }
        // Before asking: the server tells all my devices "answered" possibly before this ack, and
        // this one must not take that for "answered elsewhere".
        send({ type: 'accept' });
        const ack = await emit('call:accept', { callId: call.id });
        if (!ack?.ok) {
          for (const track of mic.getTracks()) track.stop();
          send({ type: 'end', reason: 'error', at: Date.now() });
          afterEnd();
          return;
        }
        local = mic;
        await connect('callee', call);
      },
      decline: () => hangUp(),
      hangUp: () => hangUp(),
      toggleMute() {
        const muted = !callState().muted;
        media?.setMuted(muted);
        send({ type: 'mute', muted });
      },
      async toggleSpeaker() {
        const on = !callState().speaker;
        const target = on ? await otherOutput() : 'default';
        if (target && (await media?.setOutput(target))) send({ type: 'speaker', on });
      },
      canChooseSpeaker: canChooseOutput,
    },
  });
  void lookForRinging();

  return {
    stop() {
      stopped = true;
      hangUp();
      cleanUp();
      clearTimeout(dismissTimer);
      window.removeEventListener('online', onNetworkChange);
      connection?.removeEventListener?.('change', onNetworkChange);
      useCallStore.setState({ actions: null });
      send({ type: 'dismiss' });
    },
  };
}
