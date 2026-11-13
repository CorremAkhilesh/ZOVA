import { create } from 'zustand';
import { mediaApi } from '@/features/media/api';
import { updateMediaSession } from './media-session';

export const SPEEDS = [1, 1.5, 2] as const;
export type Speed = (typeof SPEEDS)[number];

const SPEED_KEY = 'zuvo.voice-speed';
/** A new link that fails straight away means the file itself cannot be played. */
const FRESH_LINK_MS = 30_000;
/** Played once it has been heard this far, or to the end. */
const PLAYED_FRACTION = 0.5;

export interface Track {
  mediaId: string;
  /** The message's local key: bubbles use it to find themselves. */
  key: string;
  messageId: string | null;
  chatId: string;
  kind: 'voice' | 'audio';
  mime: string;
  /** Who said it, or the file's name. */
  title: string;
  /** What it is, for lock screens. */
  subtitle: string;
  /** The sender's photo, for lock screens. */
  artwork?: string | undefined;
  /** From the message: a recording in WebM does not know its own length. */
  duration: number;
  /** An incoming voice note nobody has reported as played yet. */
  reportPlay: boolean;
}

export interface PlayerState {
  track: Track | null;
  playing: boolean;
  loading: boolean;
  position: number;
  speed: Speed;
  /** Files this device could not play, so bubbles can offer the download instead. */
  failed: ReadonlySet<string>;
}

/** What the rest of the app supplies: reporting a play, and finding what comes next. */
export interface PlayerLinks {
  reportPlayed: (track: Track) => void;
  nextAfter: (track: Track) => Promise<Track | null>;
}

function savedSpeed(): Speed {
  try {
    const saved = Number(localStorage.getItem(SPEED_KEY));
    return SPEEDS.find((speed) => speed === saved) ?? 1;
  } catch {
    return 1;
  }
}

function saveSpeed(speed: Speed) {
  try {
    localStorage.setItem(SPEED_KEY, String(speed));
  } catch {
    // Only means starting at 1x next time.
  }
}

export const usePlayer = create<PlayerState>(() => ({
  track: null,
  playing: false,
  loading: false,
  position: 0,
  speed: savedSpeed(),
  failed: new Set(),
}));

let links: PlayerLinks | null = null;
export function connectPlayer(next: PlayerLinks | null) {
  links = next;
}

let audio: HTMLAudioElement | null = null;
/** Each new track, so answers about an older one are ignored. */
let generation = 0;
let reported = false;
let linkedAt = 0;
let resumeAt: number | null = null;

const state = usePlayer.getState;
const set = usePlayer.setState;

function markFailed(track: Track) {
  set({
    failed: new Set(state().failed).add(track.mediaId),
    playing: false,
    loading: false,
  });
}

function checkPlayed(track: Track, position: number) {
  if (reported || !track.reportPlay || track.duration <= 0) return;
  if (position / track.duration < PLAYED_FRACTION) return;
  reported = true;
  links?.reportPlayed(track);
}

async function loadLink(track: Track, startAt: number) {
  const mine = generation;
  resumeAt = startAt;
  const element = element_();
  try {
    const { url } = await mediaApi.link(track.mediaId, false);
    if (mine !== generation) return;
    linkedAt = Date.now();
    const absolute = new URL(url, window.location.href).href;
    // Asked again within the same second: the same link, and setting it would not reload.
    if (element.src === absolute) element.load();
    else element.src = url;
    element.playbackRate = state().speed;
    await element.play();
  } catch (error) {
    if (mine !== generation) return;
    // Autoplay rules: the file is fine, and the next tap plays it.
    if (error instanceof Error && error.name === 'NotAllowedError') {
      set({ playing: false, loading: false });
      return;
    }
    // Interrupted by a newer request for the same track.
    if (error instanceof Error && error.name === 'AbortError') return;
    markFailed(track);
  }
}

function onTimeUpdate() {
  const { track } = state();
  if (!track || !audio) return;
  const position = audio.currentTime;
  set({ position });
  checkPlayed(track, position);
  updateMediaSession({ track, position, playing: state().playing, speed: state().speed });
}

function onMetadata() {
  if (!audio) return;
  if (resumeAt !== null && resumeAt > 0) audio.currentTime = resumeAt;
  resumeAt = null;
  const { track } = state();
  // Only attached files: a recording's own idea of its length can be wrong or missing.
  if (track?.kind === 'audio' && track.duration <= 0 && Number.isFinite(audio.duration)) {
    set({ track: { ...track, duration: audio.duration } });
  }
}

async function onEnded() {
  const { track } = state();
  if (!track) return;
  if (track.reportPlay && !reported) {
    reported = true;
    links?.reportPlayed(track);
  }
  const mine = generation;
  const next = track.kind === 'voice' ? await links?.nextAfter(track).catch(() => null) : null;
  if (mine !== generation) return;
  if (next) playTrack(next);
  else closePlayer();
}

/** Links expire, and a player notices on its next request, such as a seek. */
function onError() {
  const { track } = state();
  if (!track || !audio) return;
  if (Date.now() - linkedAt < FRESH_LINK_MS) return markFailed(track);
  void loadLink(track, audio.currentTime);
}

function element_(): HTMLAudioElement {
  if (audio) return audio;
  const created = new Audio();
  created.preload = 'auto';
  created.ontimeupdate = onTimeUpdate;
  created.onloadedmetadata = onMetadata;
  created.onended = () => void onEnded();
  created.onerror = onError;
  created.onplaying = () => set({ playing: true, loading: false });
  created.onpause = () => set({ playing: false });
  created.onwaiting = () => set({ loading: true });
  created.oncanplay = () => set({ loading: false });
  audio = created;
  return created;
}

/** The one thing playing, across the whole app. Starting another stops this one. */
export function playTrack(track: Track, startAt = 0) {
  const element = element_();
  generation += 1;
  reported = false;
  element.pause();
  if (element.canPlayType(track.mime) === '') {
    set({ track, position: startAt, playing: false, loading: false });
    return markFailed(track);
  }
  set({ track, position: startAt, playing: false, loading: true });
  // Lock screens show this note's sender now, not the last one's until the first time update.
  updateMediaSession({ track, position: startAt, playing: false, speed: state().speed });
  void loadLink(track, startAt);
}

export function togglePlaying() {
  const { track, playing } = state();
  if (!track || !audio) return;
  if (playing) audio.pause();
  else void audio.play().catch(() => undefined);
}

export function seekTo(seconds: number) {
  const { track } = state();
  if (!track || !audio) return;
  const position = Math.max(0, Math.min(seconds, track.duration || seconds));
  audio.currentTime = position;
  set({ position });
  checkPlayed(track, position);
}

export function seekBy(seconds: number) {
  seekTo(state().position + seconds);
}

export function cycleSpeed() {
  const current = SPEEDS.indexOf(state().speed);
  const speed = SPEEDS[(current + 1) % SPEEDS.length] ?? 1;
  set({ speed });
  saveSpeed(speed);
  if (audio) audio.playbackRate = speed;
}

export function closePlayer() {
  generation += 1;
  if (audio) {
    audio.pause();
    audio.removeAttribute('src');
  }
  set({ track: null, playing: false, loading: false, position: 0 });
  updateMediaSession(null);
}

export const mediaSessionControls = {
  play: () => {
    if (!state().playing) togglePlaying();
  },
  pause: () => {
    if (state().playing) togglePlaying();
  },
  seekTo,
  seekBy,
};

/** For tests: a new element and clean state. */
export function resetPlayerForTests() {
  closePlayer();
  audio = null;
  links = null;
  linkedAt = 0;
  set({ speed: 1, failed: new Set() });
}
