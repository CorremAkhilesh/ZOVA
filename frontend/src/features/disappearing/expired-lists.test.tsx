import { act, fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MediaInfo, MessageSearchHit, PinnedMessage } from '@zuvo/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from '@/test/axe';
import { chatFixture, messageFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { isExpired, timerAccess } from './rules';
import { useWithoutExpired } from './use-without-expired';

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 10_000 };
const GONE = { timeout: 6_000 };
const soon = (ms: number) => new Date(Date.now() + ms).toISOString();

const photo = (id: string): MediaInfo => ({
  id,
  kind: 'image',
  mime: 'image/webp',
  size: 2048,
  name: `${id}.jpg`,
  width: 800,
  height: 600,
  duration: null,
  waveform: null,
  placeholder: null,
  hasThumbnail: false,
});

describe('useWithoutExpired', () => {
  afterEach(() => vi.useRealTimers());

  it('drops expired items, then each one the moment its time is up', () => {
    vi.useFakeTimers();
    const items = [
      { id: 'a', at: null },
      { id: 'b', at: soon(-1) },
      { id: 'c', at: soon(1_000) },
    ];
    const { result } = renderHook(() => useWithoutExpired(items, (item) => item.at));
    expect(result.current?.map((item) => item.id)).toEqual(['a', 'c']);
    act(() => vi.advanceTimersByTime(1_100));
    expect(result.current?.map((item) => item.id)).toEqual(['a']);
  });

  it('returns the same array when nothing has expired, and undefined for undefined', () => {
    const items = [{ at: soon(60_000) }];
    const { result, rerender } = renderHook(({ list }) => useWithoutExpired(list, (i) => i.at), {
      initialProps: { list: items as typeof items | undefined },
    });
    expect(result.current).toBe(items);
    rerender({ list: undefined });
    expect(result.current).toBeUndefined();
  });

  it('rules: expiry and who may set the timer', () => {
    expect(isExpired(null)).toBe(false);
    expect(isExpired(soon(-1))).toBe(true);
    expect(timerAccess({ type: 'self', group: null })).toBe('hidden');
    expect(timerAccess({ type: 'direct', group: null })).toBe('change');
  });
});

describe('expired messages kept in memory', () => {
  it('leave the chat info gallery, which never lists view-once media', async () => {
    server.use(
      http.get('*/v1/chats/:id/media', () =>
        HttpResponse.json({
          items: [
            messageFixture(3, {
              type: 'image',
              text: null,
              media: photo('p3'),
              expiresAt: soon(2_000),
            }),
            messageFixture(2, { type: 'image', text: null, media: photo('p2'), viewOnce: true }),
            messageFixture(1, {
              type: 'image',
              text: null,
              media: photo('p1'),
              expiresAt: soon(-5),
            }),
            messageFixture(4, { type: 'image', text: null, media: photo('p4') }),
          ],
          hasMore: false,
        }),
      ),
    );
    await seedLocal([chatFixture()]);
    const { container } = await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Chat info', pressed: false }, SLOW));
    const pane = await screen.findByRole('complementary', { name: 'Chat info' });
    await waitFor(
      () => expect(within(pane).getAllByRole('button', { name: /^Open photo/ })).toHaveLength(2),
      SLOW,
    );
    expect(await axe(container)).toHaveNoViolations();
    await waitFor(
      () => expect(within(pane).getAllByRole('button', { name: /^Open photo/ })).toHaveLength(1),
      GONE,
    );
  });

  it('leave the Starred screen', async () => {
    const star = (seq: number, text: string, expiresAt: string | null) => ({
      message: messageFixture(seq, { text, starred: true, expiresAt }),
      starredAt: '2026-11-06T10:00:00.000Z',
    });
    server.use(
      http.get('*/v1/stars', () =>
        HttpResponse.json({
          items: [star(1, 'kept', null), star(2, 'going', soon(2_000)), star(3, 'gone', soon(-5))],
          nextCursor: null,
        }),
      ),
    );
    await seedLocal([chatFixture()]);
    const { container } = await renderApp('/starred', { width: DESKTOP_WIDTH });
    expect(await screen.findByText('going', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByText('kept')).toBeInTheDocument();
    expect(screen.queryByText('gone')).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
    await waitFor(() => expect(screen.queryByText('going')).toBeNull(), GONE);
    expect(screen.getByText('kept')).toBeInTheDocument();
  });

  it('leave the pinned bar', async () => {
    const pin: PinnedMessage = {
      messageId: 'm1',
      seq: 1,
      pinnedBy: 'u-asha',
      pinnedAt: soon(-1_000),
      expiresAt: soon(86_400_000),
    };
    await seedLocal(
      [chatFixture({ seq: 2, pins: [pin] })],
      [
        messageFixture(1, { text: 'pinned and going', expiresAt: soon(2_500) }),
        messageFixture(2, { text: 'other' }),
      ],
    );
    await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    const bar = await screen.findByRole('button', { name: 'Go to pinned message 1 of 1' }, SLOW);
    await waitFor(() => expect(bar).toHaveTextContent('pinned and going'));
    await waitFor(
      () => expect(screen.queryByRole('button', { name: /pinned message/ })).toBeNull(),
      GONE,
    );
  });

  it('leave search results', async () => {
    const hit = (seq: number, text: string, expiresAt: string | null): MessageSearchHit => ({
      message: messageFixture(seq, { text, expiresAt, createdAt: `2026-01-0${seq}T10:00:00.000Z` }),
      chat: { id: 'c1', type: 'direct', title: 'Asha Verma' },
      senderName: 'Asha Verma',
    });
    server.use(
      http.get('*/v1/search/messages', () =>
        HttpResponse.json({
          items: [
            hit(1, 'plan kept', null),
            hit(2, 'plan going', soon(2_500)),
            hit(3, 'plan gone', soon(-5)),
          ],
          nextCursor: null,
        }),
      ),
    );
    await seedLocal([chatFixture()]);
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    await screen.findByRole('heading', { name: 'Chats' }, SLOW);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const box = await screen.findByRole('combobox', { name: /Search chats/ }, SLOW);
    box.focus();
    await userEvent.setup().keyboard('plan');
    const messages = await screen.findByRole('group', { name: 'Messages' }, SLOW);
    await waitFor(() => expect(messages).toHaveTextContent(/going/), SLOW);
    expect(messages).toHaveTextContent(/kept/);
    expect(messages).not.toHaveTextContent(/gone/);
    await waitFor(() => expect(messages).not.toHaveTextContent(/going/), GONE);
    expect(messages).toHaveTextContent(/kept/);
  });
});
