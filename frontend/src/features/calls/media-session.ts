import { CALL_BEAT_SECONDS, type CallSignal, type IceServer } from '@zuvo/protocol';
import type { Quality } from './machine';
import { type LinkState, PeerLink } from './rtc';

/** Without audio for this long, the call is given up. */
export const GIVE_UP_AFTER_MS = 30_000;
/** Without a direct route by then, try the relay only ("Trying another route…"). */
export const RELAY_AFTER_MS = 10_000;
/** A lost path gets a little time to come back by itself before an ICE restart. */
const RESTART_AFTER_MS = 2000;
const QUALITY_EVERY_MS = 4000;

export interface MediaSessionOptions {
  role: 'caller' | 'callee';
  iceServers: IceServer[];
  local: MediaStream;
  send: (signal: CallSignal) => void;
  beat: () => void;
  onConnected: () => void;
  /** Switching to the relay: the screen says "Trying another route…". */
  onRerouting: () => void;
  onLost: () => void;
  onGiveUp: () => void;
  onQuality: (quality: Quality | null) => void;
}

/**
 * The audio of one call on this device: the WebRTC link, the other person's voice playing, a
 * heartbeat to the server, the quality indicator, and getting the path back after a network change
 * (an ICE restart) or giving up after half a minute without audio.
 */
export class MediaSession {
  private readonly link: PeerLink;
  private readonly audio: HTMLAudioElement;
  private readonly options: MediaSessionOptions;
  private readonly timers: Array<ReturnType<typeof setInterval>> = [];
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  private giveUpTimer: ReturnType<typeof setTimeout> | undefined;
  private connectedOnce = false;
  private relayTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(options: MediaSessionOptions) {
    this.options = options;
    this.audio = new Audio();
    this.audio.autoplay = true;
    this.audio.dataset.callAudio = 'remote';
    // In the page (hidden): some browsers only play a remote stream from an element in the document.
    this.audio.hidden = true;
    document.body.append(this.audio);
    this.link = new PeerLink({
      iceServers: options.iceServers,
      role: options.role,
      send: options.send,
      onRemoteStream: (stream) => {
        this.audio.srcObject = stream;
        void this.audio.play().catch(() => undefined);
      },
      onState: (state) => this.onLinkState(state),
    });
    this.timers.push(setInterval(options.beat, CALL_BEAT_SECONDS * 1000));
    // Not connected at all within the time limit (no route between the two): give up.
    this.giveUpTimer = setTimeout(() => this.giveUp(), GIVE_UP_AFTER_MS);
    this.relayTimer = setTimeout(() => void this.reroute(), RELAY_AFTER_MS);
  }

  async start(): Promise<void> {
    await this.link.start(this.options.local);
  }

  handle(signal: CallSignal): Promise<void> {
    return this.link.handle(signal);
  }

  private onLinkState(state: LinkState) {
    if (this.closed) return;
    if (state === 'connected') {
      clearTimeout(this.restartTimer);
      clearTimeout(this.giveUpTimer);
      clearTimeout(this.relayTimer);
      this.giveUpTimer = undefined;
      if (!this.connectedOnce) {
        this.connectedOnce = true;
        this.timers.push(setInterval(() => void this.measure(), QUALITY_EVERY_MS));
      }
      this.options.onConnected();
      return;
    }
    this.options.onLost();
    clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(
      () => void this.restart(),
      state === 'failed' ? 0 : RESTART_AFTER_MS,
    );
    // Counted from the first loss: flapping on and off does not keep a dead call alive.
    this.giveUpTimer ??= setTimeout(() => this.giveUp(), GIVE_UP_AFTER_MS);
  }

  /** Still not connected after RELAY_AFTER_MS: the relay is the other route (if there is one). */
  private async reroute() {
    if (this.closed || this.connectedOnce || !this.link.hasRelay()) return;
    this.options.onRerouting();
    await this.link.relayOnly().catch(() => undefined);
  }

  private giveUp() {
    if (!this.closed) this.options.onGiveUp();
  }

  private async measure() {
    if (!this.closed) this.options.onQuality(await this.link.quality());
  }

  /** The network changed (WiFi ↔ mobile data, back online): look for a new path. */
  restart(): Promise<void> {
    return this.link.restart().catch(() => undefined);
  }

  setMuted(muted: boolean) {
    for (const track of this.options.local.getAudioTracks()) track.enabled = !muted;
  }

  /** Plays through another output where the browser lets a page choose one. */
  async setOutput(deviceId: string): Promise<boolean> {
    const audio = this.audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    if (typeof audio.setSinkId !== 'function') return false;
    return audio.setSinkId(deviceId).then(
      () => true,
      () => false,
    );
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const timer of this.timers) clearInterval(timer);
    clearTimeout(this.restartTimer);
    clearTimeout(this.giveUpTimer);
    clearTimeout(this.relayTimer);
    this.link.close();
    for (const track of this.options.local.getTracks()) track.stop();
    this.audio.srcObject = null;
    this.audio.remove();
  }
}

/** Whether this browser lets a page pick the speaker (setSinkId): mostly desktop Chrome and Edge. */
export const canChooseOutput = () =>
  typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

/** The output that is not the default one: the loudspeaker, if the browser names it. */
export async function otherOutput(): Promise<string | null> {
  const devices = await navigator.mediaDevices?.enumerateDevices?.().catch(() => []);
  const outputs = (devices ?? []).filter(
    (device) => device.kind === 'audiooutput' && device.deviceId !== 'default',
  );
  const speaker = outputs.find((device) => /speaker/i.test(device.label));
  return (speaker ?? outputs[0])?.deviceId ?? null;
}
