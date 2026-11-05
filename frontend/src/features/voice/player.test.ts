import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpResponse, http, server } from '@/test/msw';
import {
  closePlayer,
  connectPlayer,
  cycleSpeed,
  playTrack,
  resetPlayerForTests,
  seekBy,
  seekTo,
  type Track,
  togglePlaying,
  usePlayer,
} from './player';

const track = (id: string, overrides: Partial<Track> = {}): Track => ({
  mediaId: id,
  key: `key-${id}`,
  messageId: `message-${id}`,
  chatId: 'c1',
  kind: 'voice',
  mime: 'audio/webm',
  title: 'Asha',
  subtitle: 'Voice message',
  duration: 100,
  reportPlay: true,
  ...overrides,
});

let elements: HTMLAudioElement[];
let plays: number;
let linkCount: number;
const element = () => elements.at(-1) as HTMLAudioElement;
const state = () => usePlayer.getState();

function fire(name: string) {
  element().dispatchEvent(new Event(name));
}

function setTime(seconds: number) {
  element().currentTime = seconds;
  fire('timeupdate');
}

const started = () => vi.waitFor(() => expect(plays).toBeGreaterThan(0));

beforeEach(() => {
  elements = [];
  plays = 0;
  linkCount = 0;
  resetPlayerForTests();
  const RealAudio = globalThis.Audio;
  vi.stubGlobal(
    'Audio',
    class extends RealAudio {
      constructor() {
        super();
        elements.push(this);
      }
    },
  );
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => {
    plays += 1;
  });
  server.use(
    http.get('*/v1/media/:id/link', ({ params }) => {
      linkCount += 1;
      return HttpResponse.json({
        url: `/v1/media/${params.id}/content?sig=${linkCount}`,
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
      });
    }),
  );
});

afterEach(() => {
  resetPlayerForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('one thing at a time', () => {
  it('starting another stops the first, and only one element ever exists', async () => {
    playTrack(track('a'));
    await started();
    playTrack(track('b'));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(state().track?.mediaId).toBe('b');
    await vi.waitFor(() => expect(element().src).toContain('/v1/media/b/'));
    expect(elements).toHaveLength(1);
  });

  it('ignores the link for a track that is no longer wanted', async () => {
    playTrack(track('slow'));
    playTrack(track('b'));
    await vi.waitFor(() => expect(element().src).toContain('/v1/media/b/'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(element().src).toContain('/v1/media/b/');
  });

  it('closes completely', async () => {
    playTrack(track('a'));
    await started();
    closePlayer();
    expect(state()).toMatchObject({ track: null, playing: false, position: 0 });
    expect(element().getAttribute('src')).toBeNull();
  });
});

describe('position and speed', () => {
  it('starts where it was asked to, once the file has loaded', async () => {
    playTrack(track('a'), 40);
    await started();
    fire('loadedmetadata');
    expect(element().currentTime).toBe(40);
  });

  it('seeks within the note, and stays inside it', async () => {
    playTrack(track('a'));
    await started();
    seekTo(30);
    expect(state().position).toBe(30);
    seekBy(5);
    expect(state().position).toBe(35);
    seekTo(500);
    expect(state().position).toBe(100);
    seekBy(-500);
    expect(state().position).toBe(0);
  });

  it('cycles the speed, applies it, and remembers it', async () => {
    playTrack(track('a'));
    await started();
    cycleSpeed();
    expect(state().speed).toBe(1.5);
    expect(element().playbackRate).toBe(1.5);
    cycleSpeed();
    expect(state().speed).toBe(2);
    expect(localStorage.getItem('zuvo.voice-speed')).toBe('2');
    cycleSpeed();
    expect(state().speed).toBe(1);
  });

  it('plays a new track at the chosen speed', async () => {
    usePlayer.setState({ speed: 2 });
    playTrack(track('a'));
    await started();
    expect(element().playbackRate).toBe(2);
  });

  it('pauses and carries on', async () => {
    playTrack(track('a'));
    await started();
    fire('playing');
    expect(state().playing).toBe(true);
    togglePlaying();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    fire('pause');
    expect(state().playing).toBe(false);
    togglePlaying();
    expect(plays).toBe(2);
  });
});

describe('reporting a play', () => {
  const reportPlayed = vi.fn();
  beforeEach(() => {
    reportPlayed.mockClear();
    connectPlayer({ reportPlayed, nextAfter: async () => null });
  });

  it('waits until half way', async () => {
    playTrack(track('a'));
    await started();
    setTime(49);
    expect(reportPlayed).not.toHaveBeenCalled();
    setTime(50);
    expect(reportPlayed).toHaveBeenCalledTimes(1);
  });

  it('reports once, however long it goes on', async () => {
    playTrack(track('a'));
    await started();
    setTime(60);
    setTime(70);
    await fireEnded();
    expect(reportPlayed).toHaveBeenCalledTimes(1);
  });

  it('counts seeking past half way', async () => {
    playTrack(track('a'));
    await started();
    seekTo(60);
    expect(reportPlayed).toHaveBeenCalledTimes(1);
  });

  it('counts playing to the end, even for a note too short for a time update', async () => {
    playTrack(track('a', { duration: 1 }));
    await started();
    await fireEnded();
    expect(reportPlayed).toHaveBeenCalledTimes(1);
  });

  it('says nothing about my own notes, or ones already played', async () => {
    playTrack(track('a', { reportPlay: false }));
    await started();
    setTime(90);
    await fireEnded();
    expect(reportPlayed).not.toHaveBeenCalled();
  });
});

const fireEnded = async () => {
  fire('ended');
  await new Promise((resolve) => setTimeout(resolve, 10));
};

describe('what comes next', () => {
  it('moves on to the next voice note by itself', async () => {
    const nextAfter = vi.fn(async () => track('b'));
    connectPlayer({ reportPlayed: vi.fn(), nextAfter });
    playTrack(track('a'));
    await started();
    await fireEnded();
    expect(state().track?.mediaId).toBe('b');
    expect(nextAfter).toHaveBeenCalledTimes(1);
  });

  it('stops at the end of the run', async () => {
    connectPlayer({ reportPlayed: vi.fn(), nextAfter: async () => null });
    playTrack(track('a'));
    await started();
    await fireEnded();
    expect(state().track).toBeNull();
  });

  it('does not run on from an attached file', async () => {
    const nextAfter = vi.fn(async () => track('b'));
    connectPlayer({ reportPlayed: vi.fn(), nextAfter });
    playTrack(track('song', { kind: 'audio', reportPlay: false }));
    await started();
    await fireEnded();
    expect(nextAfter).not.toHaveBeenCalled();
    expect(state().track).toBeNull();
  });
});
