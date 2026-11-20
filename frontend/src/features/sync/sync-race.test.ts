import type { Message, SyncResponse } from '@zuvo/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chatFixture,
  ME_ID,
  messageFixture,
  savedChatFixture,
  syncPage,
} from '@/test/chat-fixtures';
import { applySyncPage, readCursor } from './apply';
import { getUserDb, type LocalDb } from './local-db';
import { SyncEngine } from './sync-engine';

// Fault injection for live sync: a fake server log (one number per change, as the real one), sync
// answers that can be held back, live events delivered late, early, twice or not at all. Whatever
// the timing, every message the server has must end up stored, once.

let db: LocalDb;

/** The server's update log for this user: change number → the message it carries (if any). */
class FakeServer {
  readonly log: Array<{ pts: number; message: Message | null }> = [];
  private held: Array<() => void> | null = null;
  calls: Array<string | undefined> = [];

  add(message: Message | null) {
    const pts = (this.log.at(-1)?.pts ?? 0) + 1;
    this.log.push({ pts, message });
    return pts;
  }
  /** Sync answers wait until `release()`: the run is in flight while events arrive. */
  hold() {
    this.held = [];
  }
  release() {
    const waiting = this.held ?? [];
    this.held = null;
    for (const resume of waiting) resume();
  }
  async sync(since: string | undefined): Promise<SyncResponse> {
    this.calls.push(since);
    // What the server has at the moment the request is answered... as of when it was asked.
    const snapshot = [...this.log];
    if (this.held) await new Promise<void>((resolve) => this.held?.push(resolve));
    const after = snapshot.filter((row) => row.pts > Number(since ?? 0));
    return syncPage({
      cursor: String(after.at(-1)?.pts ?? since ?? '0'),
      chats: [chatFixture({ seq: Math.max(0, ...snapshot.map((row) => row.message?.seq ?? 0)) })],
      messages: after.flatMap((row) => (row.message ? [row.message] : [])),
    });
  }
}

let server: FakeServer;
/** Runs between one sync page and the next ask (Saved Messages is looked up there). */
let betweenPages: (() => Promise<unknown>) | null = null;
const engine = () =>
  new SyncEngine({
    db,
    me: ME_ID,
    retryBaseMs: 5,
    api: {
      sync: (since) => server.sync(since),
      listAllChats: async () => [chatFixture()],
      selfChat: async () => {
        const hook = betweenPages;
        betweenPages = null;
        await hook?.();
        return savedChatFixture();
      },
    },
  });

const storedSeqs = async () =>
  (await db.messages.where('chatId').equals('c1').toArray())
    .map((row) => row.seq)
    .sort((a, b) => (a ?? 0) - (b ?? 0));

/** The two events the server sends for a new message, with the same change number. */
function events(sync: SyncEngine, message: Message, pts: number) {
  const cursor = String(pts);
  return {
    message: () => sync.onMessage(message, cursor),
    chat: () =>
      sync.onChatChange(
        'c1',
        {
          seq: message.seq,
          lastMessage: {
            id: message.id,
            seq: message.seq,
            senderId: message.senderId,
            senderName: 'Asha Verma',
            type: 'text',
            preview: message.text ?? '',
            createdAt: message.createdAt,
          },
          lastActivityAt: message.createdAt,
        },
        cursor,
      ),
  };
}

/** Waits until the engine has nothing running and no event pending. */
async function settle(sync: SyncEngine) {
  for (let round = 0; round < 5; round++) {
    await sync.run();
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

beforeEach(async () => {
  db = getUserDb(ME_ID);
  await db.open();
  server = new FakeServer();
  // This device is at change 4 with messages 1 and 2; the chat is known.
  const first = [messageFixture(1), messageFixture(2)];
  server.add(first[0] ?? null);
  server.add(first[1] ?? null);
  server.add(null);
  server.add(null);
  await applySyncPage(
    db,
    ME_ID,
    syncPage({
      cursor: '4',
      chats: [chatFixture({ seq: 2 }), savedChatFixture()],
      messages: first,
    }),
  );
  betweenPages = null;
});

describe('a new message while a sync is in flight (the CI case)', () => {
  it('its chat:updated never moves the cursor past the message it did not store', async () => {
    // No Saved Messages yet, so the engine looks it up after each sync page: that is where the
    // chat:updated is delivered, after the page and before the next ask, as the timing was in CI.
    await db.chats.delete('c-saved');
    const sync = engine();
    server.add(null); // change 5: something else
    server.hold();
    const running = sync.run(); // asks since 4; the answer (up to 5) is held back
    await vi.waitFor(() => expect(server.calls).toEqual(['4']));
    const third = messageFixture(3, { text: 'notes.txt' });
    const pts = server.add(third); // change 6: the message, committed after the sync was asked
    const live = events(sync, third, pts);
    await live.message(); // 4 → 6 skips 5: a gap, so it waits for the sync
    betweenPages = live.chat; // chat:updated (6) lands once the held page (5) is in
    server.release();
    await running;
    await settle(sync);
    expect(await storedSeqs()).toEqual([1, 2, 3]);
    expect(await readCursor(db)).toBe('6');
  });
});

describe('fault injection: any order, any timing', () => {
  /** A small seeded random, so a failure can be replayed. */
  const random = (seed: number) => {
    let state = seed;
    return () => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state / 2_147_483_648;
    };
  };

  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'five quick messages, events shuffled and some lost, a sync in the middle (seed %i)',
    async (seed) => {
      const next = random(seed);
      const sync = engine();
      const sent = [3, 4, 5, 6, 7].map((seq) => messageFixture(seq));
      const all = sent.flatMap((message) => {
        const live = events(sync, message, server.add(message));
        return [live.message, live.chat];
      });
      // Shuffle, drop about one in six (a reconnect loses events), and a sync somewhere among them.
      const order = all
        .map((deliver) => ({ deliver, at: next() }))
        .sort((a, b) => a.at - b.at)
        .filter(() => next() > 0.16);
      const syncAt = Math.floor(next() * order.length);
      const pending: Promise<unknown>[] = [];
      for (const [index, { deliver }] of order.entries()) {
        if (index === syncAt) pending.push(sync.run());
        pending.push(deliver());
        if (next() < 0.3) await new Promise((resolve) => setTimeout(resolve, next() * 10));
      }
      await Promise.all(pending);
      await settle(sync);
      expect(await storedSeqs()).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(await readCursor(db)).toBe(String(server.log.at(-1)?.pts));
    },
  );

  it('the same message twice (live and from sync) is stored once', async () => {
    const sync = engine();
    const third = messageFixture(3);
    const live = events(sync, third, server.add(third));
    await Promise.all([live.message(), sync.run(), live.message(), live.chat()]);
    await settle(sync);
    expect(await storedSeqs()).toEqual([1, 2, 3]);
  });

  it('a write that fails once is not lost: the sync brings it', async () => {
    const sync = engine();
    const third = messageFixture(3);
    const live = events(sync, third, server.add(third));
    const put = vi.spyOn(db.messages, 'bulkPut').mockRejectedValueOnce(new Error('disk busy'));
    await live.message();
    await live.chat();
    put.mockRestore();
    await settle(sync);
    expect(await storedSeqs()).toEqual([1, 2, 3]);
  });
});
