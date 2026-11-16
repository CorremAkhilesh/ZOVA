import type { ChatSummary as ServerChat } from '@zuvo/protocol';
import { describe, expect, it } from 'vitest';
import type { ChatRow } from '@/features/sync/local-db';
import { chatFixture, ME_ID, personFixture } from '@/test/chat-fixtures';
import { toChatSummary } from './view';

const labels = { saved: 'Saved Messages', unknown: 'Unknown' };

const groupRow = (senderName?: string | null): ChatRow =>
  ({
    ...chatFixture({
      id: 'g',
      type: 'group',
      otherUser: null,
      seq: 1,
      group: {
        name: 'Quarterly planning',
        description: '',
        photo: null,
        memberCount: 3,
        myRole: 'member',
        active: true,
      } as ServerChat['group'],
      lastMessage: {
        id: 'm1',
        seq: 1,
        senderId: 'u-chitra',
        ...(senderName === undefined ? {} : { senderName }),
        type: 'text',
        preview: 'Thanks!',
        createdAt: '2026-11-05T10:00:00.000Z',
      } as ServerChat['lastMessage'],
    }),
    sortAt: 1,
  }) as ChatRow;

describe('toChatSummary', () => {
  it('never names a group as the sender of its last message while the member is unknown', () => {
    const summary = toChatSummary(groupRow(), ME_ID, labels, undefined, new Map());
    expect(summary.lastMessage?.authorName).toBe('');
  });

  it('names the sender once the member is known', () => {
    const people = new Map([
      ['u-chitra', personFixture({ id: 'u-chitra', displayName: 'Chitra Iyer' })],
    ]);
    const summary = toChatSummary(groupRow(), ME_ID, labels, undefined, people);
    expect(summary.lastMessage?.authorName).toBe('Chitra Iyer');
  });

  it('names the sender at once from the name the message was sent with', () => {
    const summary = toChatSummary(groupRow('Chitra'), ME_ID, labels, undefined, new Map());
    expect(summary.lastMessage?.authorName).toBe('Chitra');
  });

  it('prefers the loaded profile, which has any newer name', () => {
    const people = new Map([
      ['u-chitra', personFixture({ id: 'u-chitra', displayName: 'Chitra Iyer' })],
    ]);
    const summary = toChatSummary(groupRow('Chitra'), ME_ID, labels, undefined, people);
    expect(summary.lastMessage?.authorName).toBe('Chitra Iyer');
  });

  it('has no sender for an old snapshot without a name, nor a null one', () => {
    for (const senderName of [undefined, null]) {
      const summary = toChatSummary(groupRow(senderName), ME_ID, labels, undefined, new Map());
      expect(summary.lastMessage?.authorName).toBe('');
    }
  });
});
