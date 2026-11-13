import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyHistory } from '@/features/sync/apply';
import { getUserDb, type LocalDb } from '@/features/sync/local-db';
import { chatFixture, ME_ID, messageFixture, personFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';
import { connectPlayer, playTrack, resetPlayerForTests, type Track, usePlayer } from './player';
import { rowToTrack, senderOf } from './track';

const labels = { voice: 'Voice message', you: 'You', unknown: 'Unknown' };
const RAVI = personFixture({
  id: 'u-ravi',
  displayName: 'Ravi Kumar',
  avatar: { small: '/ravi.webp', large: '/ravi-large.webp' },
});

const voice = (seq: number, senderId: string) =>
  messageFixture(seq, {
    senderId,
    clientMsgId: null,
    type: 'voice',
    media: {
      id: `media-${seq}`,
      kind: 'voice',
      mime: 'audio/webm',
      size: 1000,
      name: 'voice.webm',
      duration: 5,
    } as never,
  });

describe('the note after this one names its own sender', () => {
  let db: LocalDb;
  beforeEach(async () => {
    db = getUserDb(ME_ID);
    await db.open();
  });

  async function nextTrackIn(chat: Parameters<typeof chatFixture>[0], senderId: string) {
    await db.chats.put({ ...chatFixture(chat), sortAt: 0 });
    await db.profiles.put(RAVI);
    await applyHistory(db, ME_ID, [voice(2, senderId)]);
    const row = await db.messages.get('m2');
    if (!row) throw new Error('not stored');
    return rowToTrack(row, ME_ID, await senderOf(db, row, ME_ID, labels), labels);
  }

  it('a group: another member’s note shows that member, with their photo', async () => {
    const next = await nextTrackIn({ type: 'group', otherUser: null }, RAVI.id);
    expect(next).toMatchObject({ title: 'Ravi Kumar', subtitle: 'Voice message' });
    expect(next?.artwork).toBe('/ravi.webp');
  });

  it('my own note is “You”, not the person before me', async () => {
    const next = await nextTrackIn({}, ME_ID);
    expect(next).toMatchObject({ title: 'You', reportPlay: false });
  });

  it('a direct chat: the other person; someone unknown is “Unknown”', async () => {
    expect((await nextTrackIn({}, 'u-asha'))?.title).toBe('Asha Verma');
    await db.messages.clear();
    const stranger = await nextTrackIn({ type: 'group', otherUser: null }, 'u-gone');
    expect(stranger?.title).toBe('Unknown');
  });
});

const track = (id: string, title: string, artwork?: string): Track => ({
  mediaId: id,
  key: `key-${id}`,
  messageId: `message-${id}`,
  chatId: 'c1',
  kind: 'voice',
  mime: 'audio/webm',
  title,
  subtitle: 'Voice message',
  ...(artwork ? { artwork } : {}),
  duration: 100,
  reportPlay: false,
});

interface FakeSession {
  metadata: { title: string; artist: string; artwork: { src: string }[] } | null;
  playbackState: string;
  setActionHandler: ReturnType<typeof vi.fn>;
  setPositionState: ReturnType<typeof vi.fn>;
}

describe('lock-screen controls follow each note', () => {
  let elements: HTMLAudioElement[];
  let session: FakeSession;
  const fire = (name: string) => elements.at(-1)?.dispatchEvent(new Event(name));
  const ended = async () => {
    fire('ended');
    await new Promise((resolve) => setTimeout(resolve, 10));
  };

  beforeEach(() => {
    elements = [];
    resetPlayerForTests();
    session = {
      metadata: null,
      playbackState: 'none',
      setActionHandler: vi.fn(),
      setPositionState: vi.fn(),
    };
    vi.stubGlobal('navigator', { ...navigator, mediaSession: session });
    vi.stubGlobal(
      'MediaMetadata',
      class {
        constructor(init: object) {
          Object.assign(this, init);
        }
      },
    );
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
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => undefined);
    server.use(
      http.get('*/v1/media/:id/link', ({ params }) =>
        HttpResponse.json({
          url: `/v1/media/${params.id}/content`,
          expiresAt: new Date(Date.now() + 900_000).toISOString(),
        }),
      ),
    );
  });

  afterEach(() => {
    resetPlayerForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the next note’s sender and photo as soon as it starts', async () => {
    connectPlayer({ reportPlayed: vi.fn(), nextAfter: async () => track('b', 'Ravi', '/r.webp') });
    playTrack(track('a', 'Asha'));
    expect(session.metadata?.title).toBe('Asha');
    expect(session.metadata?.artwork).toEqual([
      expect.objectContaining({ src: '/icons/icon-192.png' }),
    ]);
    await ended();
    expect(usePlayer.getState().track?.title).toBe('Ravi');
    expect(session.metadata).toMatchObject({ title: 'Ravi', artwork: [{ src: '/r.webp' }] });
  });

  it('clears the metadata and the buttons when the run ends', async () => {
    connectPlayer({ reportPlayed: vi.fn(), nextAfter: async () => null });
    playTrack(track('a', 'Asha'));
    expect(session.setActionHandler).toHaveBeenCalledWith('play', expect.any(Function));
    await ended();
    expect(session.metadata).toBeNull();
    expect(session.playbackState).toBe('none');
    for (const action of ['play', 'pause', 'seekbackward', 'seekforward', 'seekto']) {
      expect(session.setActionHandler).toHaveBeenCalledWith(action, null);
    }
  });
});
