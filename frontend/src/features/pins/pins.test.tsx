import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PinnedMessage } from '@zuvo/protocol';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '@/test/axe';
import { chatFixture, messageFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { canPin, livePins, replacesOldest } from './pins';

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 10_000 };
const later = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const pinOf = (seq: number, expiresAt = later(1)): PinnedMessage => ({
  messageId: `m${seq}`,
  seq,
  pinnedBy: 'u-asha',
  pinnedAt: '2026-11-10T10:00:00.000Z',
  expiresAt,
});

async function openChat(pins: PinnedMessage[]) {
  const messages = [1, 2, 3, 4].map((seq) =>
    messageFixture(seq, { text: `point ${seq}`, createdAt: `2026-11-10T10:0${seq}:00.000Z` }),
  );
  await seedLocal([chatFixture({ seq: 4, pins })], messages);
  return renderApp('/chats/c1', { width: DESKTOP_WIDTH });
}

describe('pinned messages', () => {
  it('the bar shows the newest pin, and each tap jumps to one and moves on to the next', async () => {
    const { container } = await openChat([pinOf(3), pinOf(1), pinOf(2, later(-1))]);
    const bar = await screen.findByRole('button', { name: 'Go to pinned message 1 of 2' }, SLOW);
    await waitFor(() => expect(bar).toHaveTextContent('point 3'));
    expect(await axe(container)).toHaveNoViolations();
    fireEvent.click(bar);
    await waitFor(() => expect(document.querySelector('[data-seq="3"]')).toHaveClass(/bg-brand/));
    const next = screen.getByRole('button', { name: 'Go to pinned message 2 of 2' });
    await waitFor(() => expect(next).toHaveTextContent('point 1'));
    fireEvent.click(next);
    await waitFor(() => expect(document.querySelector('[data-seq="1"]')).toHaveClass(/bg-brand/));
  });

  it('pins from the message menu for the time picked, warning when it replaces the oldest', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.put('*/v1/chats/:id/messages/:messageId/pin', async ({ request, params }) => {
        bodies.push(await request.json());
        return HttpResponse.json({
          pins: [pinOf(Number(String(params.messageId).slice(1)), later(30))],
        });
      }),
    );
    await openChat([pinOf(1), pinOf(2), pinOf(3)]);
    fireEvent.contextMenu(await screen.findByText('point 4', {}, SLOW));
    const menu = await screen.findByRole('menu', { name: 'Message actions' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Pin' }));
    const dialog = await screen.findByRole('dialog', { name: 'Pin for everyone' });
    expect(dialog).toHaveTextContent('replaces the oldest pin');
    const user = userEvent.setup();
    await user.click(within(dialog).getByRole('radio', { name: '30 days' }));
    await user.click(within(dialog).getByRole('button', { name: 'Pin' }));
    await waitFor(() => expect(bodies).toEqual([{ duration: '30d' }]));
    const bar = await screen.findByRole('button', { name: 'Go to pinned message 1 of 1' });
    await waitFor(() => expect(bar).toHaveTextContent('point 4'));
  });

  it('unpins from the bar', async () => {
    server.use(
      http.delete('*/v1/chats/:id/messages/:messageId/pin', () => HttpResponse.json({ pins: [] })),
    );
    await openChat([pinOf(2)]);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Unpin' }, SLOW));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /pinned message/ })).toBeNull(),
    );
  });

  it('follow the group setting, and ignore pins whose time is up', () => {
    const groupInfo = {
      name: 'g',
      description: '',
      photo: null,
      memberCount: 2,
      settings: {
        editInfo: 'all' as const,
        sendMessages: 'all' as const,
        addMembers: 'all' as const,
        pinMessages: 'admins' as const,
        mentionEveryone: 'admins' as const,
        disappearing: 'admins' as const,
      },
      myRole: 'member' as const,
      active: true,
    };
    expect(canPin({ type: 'direct', group: null })).toBe(true);
    expect(canPin({ type: 'group', group: groupInfo })).toBe(false);
    expect(canPin({ type: 'group', group: { ...groupInfo, myRole: 'admin' } })).toBe(true);
    const pins = [pinOf(1), pinOf(2), pinOf(3, later(-1))];
    expect(livePins(pins).map((pin) => pin.seq)).toEqual([1, 2]);
    expect(replacesOldest([...pins.slice(0, 2), pinOf(4)], 'm9')).toBe(true);
    expect(replacesOldest([...pins.slice(0, 2), pinOf(4)], 'm1')).toBe(false);
  });
});
