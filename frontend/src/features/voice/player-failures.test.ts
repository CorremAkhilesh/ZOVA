import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpResponse, http, server } from '@/test/msw';
import { playTrack, resetPlayerForTests, type Track, usePlayer } from './player';

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

describe('when it cannot play', () => {
  it('says so at once for a format this browser does not know', () => {
    vi.mocked(HTMLMediaElement.prototype.canPlayType).mockReturnValue('');
    playTrack(track('a'));
    expect(state().failed.has('a')).toBe(true);
    expect(linkCount).toBe(0);
  });

  it('gets a new link when an old one has expired, and carries on from the same place', async () => {
    const clock = vi.spyOn(Date, 'now');
    clock.mockReturnValue(1_000_000);
    playTrack(track('a'));
    await started();
    await vi.waitFor(() => expect(element().src).toContain('sig=1'));
    element().currentTime = 42;
    clock.mockReturnValue(1_000_000 + 16 * 60_000);
    fire('error');
    await vi.waitFor(() => expect(element().src).toContain('sig=2'));
    fire('loadedmetadata');
    expect(element().currentTime).toBe(42);
    expect(state().failed.has('a')).toBe(false);
  });

  it('gives up when a new link fails too: the file is gone', async () => {
    playTrack(track('a'));
    await started();
    await vi.waitFor(() => expect(linkCount).toBe(1));
    fire('error');
    expect(state().failed.has('a')).toBe(true);
    expect(linkCount).toBe(1);
  });

  it('reloads even if the new link happens to be the same', async () => {
    server.use(
      http.get('*/v1/media/:id/link', () =>
        HttpResponse.json({
          url: '/v1/media/a/content?sig=same',
          expiresAt: new Date(Date.now() + 900_000).toISOString(),
        }),
      ),
    );
    const clock = vi.spyOn(Date, 'now');
    clock.mockReturnValue(1_000_000);
    playTrack(track('a'));
    await vi.waitFor(() => expect(element().src).toContain('sig=same'));
    clock.mockReturnValue(1_000_000 + 16 * 60_000);
    fire('error');
    await vi.waitFor(() => expect(HTMLMediaElement.prototype.load).toHaveBeenCalled());
  });

  it('does not treat the browser’s autoplay rule as a broken file', async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(
      Object.assign(new Error('no'), { name: 'NotAllowedError' }),
    );
    playTrack(track('a'));
    await vi.waitFor(() => expect(state().loading).toBe(false));
    expect(state().failed.has('a')).toBe(false);
  });
});
