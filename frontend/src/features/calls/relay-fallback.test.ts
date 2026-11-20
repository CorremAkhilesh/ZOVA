import type { CallSignal, IceServer } from '@zuvo/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callReducer, IDLE } from './machine';
import { MediaSession, RELAY_AFTER_MS } from './media-session';
import { PeerLink } from './rtc';

// When the two devices cannot reach each other directly (CGNAT on Jio broadband, symmetric NAT on
// mobile data), the call must not sit on "Connecting…": after 10 s it tries the TURN relay only,
// and the screen says "Trying another route…".

/** Just enough of RTCPeerConnection to see what the app asks of it. */
class FakePeer {
  static last: FakePeer | null = null;
  configs: RTCConfiguration[] = [];
  offers: Array<RTCOfferOptions | undefined> = [];
  signalingState: RTCSignalingState = 'stable';
  connectionState: RTCPeerConnectionState = 'new';
  remoteDescription: RTCSessionDescriptionInit | null = null;
  onicecandidate: ((event: { candidate: null }) => void) | null = null;
  ontrack: (() => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  constructor(config: RTCConfiguration) {
    this.configs.push(config);
    FakePeer.last = this;
  }
  setConfiguration(config: RTCConfiguration) {
    this.configs.push(config);
  }
  async createOffer(options?: RTCOfferOptions) {
    this.offers.push(options);
    return { type: 'offer' as const, sdp: 'v=0' };
  }
  async setLocalDescription() {}
  addTrack() {
    return {};
  }
  getTransceivers() {
    return [];
  }
  getSenders() {
    return [];
  }
  async getStats() {
    return new Map();
  }
  close() {}
  /** The browser reports a connection change. */
  become(state: RTCPeerConnectionState) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

const STUN: IceServer[] = [{ urls: ['stun:stun.example.test:3478'] }];
const TURN: IceServer[] = [
  ...STUN,
  { urls: ['turn:turn.example.test:3478?transport=udp'], username: '1:u', credential: 'c' },
];
const stream = { getAudioTracks: () => [], getTracks: () => [] } as unknown as MediaStream;

function session(iceServers: IceServer[], role: 'caller' | 'callee' = 'caller') {
  const sent: CallSignal[] = [];
  const events = { rerouting: 0, connected: 0, gaveUp: 0 };
  const media = new MediaSession({
    role,
    iceServers,
    local: stream,
    send: (signal) => sent.push(signal),
    beat: () => undefined,
    onConnected: () => {
      events.connected += 1;
    },
    onRerouting: () => {
      events.rerouting += 1;
    },
    onLost: () => undefined,
    onGiveUp: () => {
      events.gaveUp += 1;
    },
    onQuality: () => undefined,
  });
  const peer = FakePeer.last as FakePeer;
  return { media, peer, sent, events };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('RTCPeerConnection', FakePeer);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('relay fallback', () => {
  it('direct first (every route allowed); after 10 s without a connection, relay only', async () => {
    const { media, peer, events } = session(TURN);
    await media.start();
    expect(peer.configs[0]?.iceTransportPolicy).toBeUndefined();
    expect(peer.offers).toEqual([{ iceRestart: false }]);
    await vi.advanceTimersByTimeAsync(RELAY_AFTER_MS - 1);
    expect(events.rerouting).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(events.rerouting).toBe(1);
    expect(peer.configs.at(-1)?.iceTransportPolicy).toBe('relay');
    // The caller looks for a route again, through the relay.
    expect(peer.offers.at(-1)).toEqual({ iceRestart: true });
    media.close();
  });

  it('the person called asks the caller for the new route', async () => {
    const { media, peer, sent } = session(TURN, 'callee');
    await media.start();
    await vi.advanceTimersByTimeAsync(RELAY_AFTER_MS);
    expect(peer.configs.at(-1)?.iceTransportPolicy).toBe('relay');
    expect(sent).toContainEqual({ type: 'restart' });
    media.close();
  });

  it('nothing to switch to without TURN, and nothing once connected directly', async () => {
    const noTurn = session(STUN);
    await noTurn.media.start();
    await vi.advanceTimersByTimeAsync(RELAY_AFTER_MS);
    expect(noTurn.events.rerouting).toBe(0);
    expect(noTurn.peer.configs).toHaveLength(1);
    noTurn.media.close();

    const direct = session(TURN);
    await direct.media.start();
    direct.peer.become('connected');
    await vi.advanceTimersByTimeAsync(RELAY_AFTER_MS);
    expect(direct.events).toMatchObject({ connected: 1, rerouting: 0 });
    direct.media.close();
  });

  it('PeerLink knows whether a relay was offered', () => {
    const send = () => undefined;
    const base = { role: 'caller' as const, send, onRemoteStream: send, onState: send };
    const create = (config: RTCConfiguration) =>
      new FakePeer(config) as unknown as RTCPeerConnection;
    expect(new PeerLink({ ...base, iceServers: TURN, createPeer: create }).hasRelay()).toBe(true);
    expect(new PeerLink({ ...base, iceServers: STUN, createPeer: create }).hasRelay()).toBe(false);
  });
});

describe('"Trying another route…"', () => {
  it('shows while connecting through the relay, and goes once connected', () => {
    const call = {
      id: 'c',
      chatId: 'chat',
      kind: 'voice' as const,
      callerId: 'a',
      calleeId: 'b',
      status: 'active' as const,
      outcome: null,
      startedAt: '2026-11-20T10:00:00.000Z',
      ringingAt: null,
      answeredAt: null,
      endedAt: null,
    };
    let state = callReducer(IDLE, {
      type: 'dial',
      call: { ...call, status: 'ringing' },
      busy: false,
    });
    state = callReducer(state, { type: 'update', call });
    state = callReducer(state, { type: 'rerouting' });
    expect(state).toMatchObject({ phase: 'connecting', rerouting: true });
    state = callReducer(state, { type: 'connected', at: 1 });
    expect(state).toMatchObject({ phase: 'active', rerouting: false });
    expect(callReducer(state, { type: 'rerouting' })).toBe(state);
  });
});
