import { describe, expect, it } from 'vitest';
import { mergeChat, toChatRow } from '@/features/sync/apply';
import { chatFixture, messageFixture } from '@/test/chat-fixtures';
import { seedLocal } from '@/test/seed';
import { applyExpired, purgeExpired } from './purge';

const NOW = Date.parse('2026-11-12T10:00:00.000Z');
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

describe('disappearing messages on this device', () => {
  it('removes the ones whose time ran out, and the chat line that showed one', async () => {
    const db = await seedLocal(
      [chatFixture({ seq: 3 })],
      [
        messageFixture(1, { text: 'stays' }),
        messageFixture(2, { text: 'gone', expiresAt: at(-1000) }),
        messageFixture(3, { text: 'later', expiresAt: at(60_000) }),
      ],
    );
    const lastMessage = {
      id: 'm2',
      seq: 2,
      senderId: 'u-asha',
      type: 'text' as const,
      preview: 'gone',
      createdAt: at(-60_000),
    };
    await db.chats.update('c1', { lastMessage });
    expect(await purgeExpired(db, NOW)).toBe(1);
    const texts = (await db.messages.toArray()).map((row) => row.text).sort();
    expect(texts).toEqual(['later', 'stays']);
    expect((await db.chats.get('c1'))?.lastMessage).toBeNull();
    // Nothing more until the next one's time.
    expect(await purgeExpired(db, NOW)).toBe(0);
    expect(await purgeExpired(db, NOW + 61_000)).toBe(1);
  });

  it('removes what the server says expired, even before its local time', async () => {
    const db = await seedLocal(
      [chatFixture({ seq: 2 })],
      [
        messageFixture(1, { text: 'a', expiresAt: at(86_400_000) }),
        messageFixture(2, { text: 'b' }),
      ],
    );
    await applyExpired(db, 'c1', [1]);
    expect((await db.messages.toArray()).map((row) => row.text)).toEqual(['b']);
    await applyExpired(db, 'c1', []);
    expect(await db.messages.count()).toBe(1);
  });
});

describe('chat changes', () => {
  it('take the timer, lock and wallpaper only when sent', () => {
    const row = toChatRow(chatFixture({ disappearing: '7d', locked: true, wallpaper: null }));
    const untouched = mergeChat(row, { seq: row.seq });
    expect(untouched).toMatchObject({ disappearing: '7d', locked: true, wallpaper: null });
    const changed = mergeChat(row, {
      disappearing: 'off',
      locked: false,
      wallpaper: { kind: 'color', id: 'sage' },
    });
    expect(changed).toMatchObject({
      disappearing: 'off',
      locked: false,
      wallpaper: { kind: 'color', id: 'sage' },
    });
  });
});
