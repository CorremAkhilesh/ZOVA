import type { CallSignal, IceServer } from '@zuvo/protocol';
import type { Quality } from './machine';

/** The microphone, cleaned up by the browser: echo cancellation, noise suppression, auto gain. */
export const VOICE_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  },
  video: false,
};

export type LinkState = 'connected' | 'lost' | 'failed';

export interface PeerLinkOptions {
  iceServers: IceServer[];
  /** The caller makes offers (also for ICE restarts); the callee answers and asks for restarts. */
  role: 'caller' | 'callee';
  send: (signal: CallSignal) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onState: (state: LinkState) => void;
  /** For tests: the RTCPeerConnection constructor. */
  createPeer?: (config: RTCConfiguration) => RTCPeerConnection;
}

/** Opus first (with its in-band error correction); other codecs stay as a fallback. */
export function preferOpus(transceiver: RTCRtpTransceiver): void {
  const capabilities = globalThis.RTCRtpReceiver?.getCapabilities?.('audio');
  if (!capabilities || typeof transceiver.setCodecPreferences !== 'function') return;
  const codecs = [...capabilities.codecs].sort(
    (a, b) =>
      Number(b.mimeType.toLowerCase() === 'audio/opus') -
      Number(a.mimeType.toLowerCase() === 'audio/opus'),
  );
  try {
    transceiver.setCodecPreferences(codecs);
  } catch {
    // Some browsers refuse a list they gave themselves; their default is Opus anyway.
  }
}

/** Round-trip time and loss, from getStats(), as good / fair / poor. */
export function judgeQuality(rttSeconds: number | null, lossRatio: number | null): Quality | null {
  if (rttSeconds === null && lossRatio === null) return null;
  const rtt = rttSeconds ?? 0;
  const loss = lossRatio ?? 0;
  if (rtt > 0.6 || loss > 0.1) return 'poor';
  if (rtt > 0.3 || loss > 0.03) return 'fair';
  return 'good';
}

/**
 * One WebRTC audio connection to the other device. Signals go out through `send` and come in through
 * `handle`; ICE candidates that arrive before the offer or answer wait for it.
 */
export class PeerLink {
  private readonly pc: RTCPeerConnection;
  private readonly config: RTCConfiguration;
  private readonly options: PeerLinkOptions;
  private pending: RTCIceCandidateInit[] = [];
  private lastLoss = { lost: 0, received: 0 };
  private closed = false;

  constructor(options: PeerLinkOptions) {
    this.options = options;
    // RTCIceServer has no room for an absent username: leave the keys out rather than undefined.
    const iceServers: RTCIceServer[] = options.iceServers.map(({ urls, username, credential }) => ({
      urls,
      ...(username === undefined ? {} : { username }),
      ...(credential === undefined ? {} : { credential }),
    }));
    const config: RTCConfiguration = { iceServers, bundlePolicy: 'max-bundle' };
    this.config = config;
    this.pc = options.createPeer ? options.createPeer(config) : new RTCPeerConnection(config);
    this.pc.onicecandidate = ({ candidate }) => {
      if (!candidate || this.closed) return;
      options.send({
        type: 'candidate',
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
      });
    };
    this.pc.ontrack = ({ streams, track }) => {
      options.onRemoteStream(streams[0] ?? new MediaStream([track]));
    };
    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      if (state === 'connected') options.onState('connected');
      else if (state === 'disconnected') options.onState('lost');
      else if (state === 'failed') options.onState('failed');
    };
  }

  /** Adds my microphone; the caller then sends the first offer. */
  async start(local: MediaStream): Promise<void> {
    for (const track of local.getAudioTracks()) {
      // addTrack, not addTransceiver: the callee adds its microphone before the offer arrives, and
      // only a transceiver made by addTrack is matched to the offer's audio (otherwise the callee
      // would hear the caller but send nothing back).
      const sender = this.pc.addTrack(track, local);
      const transceiver = this.pc.getTransceivers().find((item) => item.sender === sender);
      if (transceiver) preferOpus(transceiver);
    }
    if (this.options.role === 'caller') await this.offer(false);
  }

  private async offer(iceRestart: boolean) {
    const offer = await this.pc.createOffer({ iceRestart });
    await this.pc.setLocalDescription(offer);
    if (offer.sdp) this.options.send({ type: 'offer', sdp: offer.sdp });
  }

  private async flushCandidates() {
    const waiting = this.pending;
    this.pending = [];
    for (const candidate of waiting)
      await this.pc.addIceCandidate(candidate).catch(() => undefined);
  }

  async handle(signal: CallSignal): Promise<void> {
    if (this.closed) return;
    if (signal.type === 'offer') {
      await this.pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      if (answer.sdp) this.options.send({ type: 'answer', sdp: answer.sdp });
      await this.flushCandidates();
    } else if (signal.type === 'answer') {
      await this.pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
      await this.flushCandidates();
    } else if (signal.type === 'candidate') {
      const candidate = {
        candidate: signal.candidate,
        sdpMid: signal.sdpMid,
        sdpMLineIndex: signal.sdpMLineIndex,
      };
      if (this.pc.remoteDescription)
        await this.pc.addIceCandidate(candidate).catch(() => undefined);
      else this.pending.push(candidate);
    } else if (this.options.role === 'caller') {
      await this.restart();
    }
  }

  /** A new network (WiFi ↔ mobile data) or a dropped path: find a new route without hanging up. */
  /** Whether a TURN relay was offered (only then is there another route to try). */
  hasRelay(): boolean {
    return (this.config.iceServers ?? []).some((server) =>
      [server.urls].flat().some((url) => /^turns?:/.test(url)),
    );
  }

  /**
   * Direct routes did not connect in time (CGNAT, symmetric NAT, strict firewalls): from now on only
   * the TURN relay, and the caller looks for a route again (an ICE restart).
   */
  async relayOnly(): Promise<void> {
    if (this.closed || !this.hasRelay()) return;
    this.pc.setConfiguration({ ...this.config, iceTransportPolicy: 'relay' });
    await this.restart();
  }

  async restart(): Promise<void> {
    if (this.closed) return;
    if (this.options.role === 'caller') {
      if (this.pc.signalingState !== 'stable') return;
      await this.offer(true);
    } else {
      this.options.send({ type: 'restart' });
    }
  }

  async quality(): Promise<Quality | null> {
    const stats = await this.pc.getStats().catch(() => null);
    if (!stats) return null;
    let rtt: number | null = null;
    let lost = 0;
    let received = 0;
    stats.forEach((report: { type: string; [key: string]: unknown }) => {
      if (
        report.type === 'candidate-pair' &&
        report.nominated &&
        typeof report.currentRoundTripTime === 'number'
      ) {
        rtt = report.currentRoundTripTime;
      }
      if (report.type === 'inbound-rtp' && report.kind === 'audio') {
        lost += Number(report.packetsLost ?? 0);
        received += Number(report.packetsReceived ?? 0);
      }
    });
    const deltaLost = lost - this.lastLoss.lost;
    const deltaReceived = received - this.lastLoss.received;
    this.lastLoss = { lost, received };
    const total = deltaLost + deltaReceived;
    return judgeQuality(rtt, total > 0 ? Math.max(0, deltaLost) / total : null);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const sender of this.pc.getSenders()) sender.track?.stop();
    this.pc.close();
  }
}
