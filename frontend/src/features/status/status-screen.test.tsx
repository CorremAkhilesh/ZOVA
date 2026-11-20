import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { StatusFeedResponse } from '@zuvo/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSyncStore } from '@/features/sync/store';
import { axe } from '@/test/axe';
import { chatFixture, ME_ID } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, MOBILE_WIDTH, renderApp } from '@/test/render-app';
import { lastSocket } from '@/test/socket-mock';
import { feedFixture, statusFixture } from './status-test-fixtures';
import { useStatusViewer } from './viewer/queue';

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 15_000 };
let views: string[];
let feed: StatusFeedResponse;

beforeEach(() => {
  views = [];
  feed = feedFixture();
  server.use(
    http.get('*/v1/statuses', () => HttpResponse.json(feed)),
    http.post('*/v1/statuses/:id/view', ({ params }) => {
      views.push(String(params.id));
      return HttpResponse.json({ ok: true });
    }),
    http.post('*/v1/chats/direct', () =>
      HttpResponse.json({
        chat: chatFixture({ id: 'c-riya', otherUser: feed.people[0]?.user ?? null }),
      }),
    ),
  );
  // jsdom lays nothing out: a 300 px wide picture area, so a tap's side can be told.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 300,
    height: 600,
    right: 300,
    bottom: 600,
    toJSON: () => ({}),
  } as DOMRect);
});
afterEach(() => {
  act(() => useStatusViewer.getState().close());
  vi.restoreAllMocks();
});

const open = async (width = DESKTOP_WIDTH) => {
  const view = await renderApp('/updates', { width });
  await screen.findByRole('heading', { name: 'Status', level: 1 }, SLOW);
  await screen.findByRole('button', { name: /^Riya Shah / }, SLOW);
  return view;
};
const viewer = () => screen.findByRole('dialog', { name: /’s status|My status/ }, SLOW);
const pictureArea = (dialog: HTMLElement) =>
  dialog.querySelector('[role="presentation"]') as HTMLElement;
const tap = (dialog: HTMLElement, x: number) => {
  const area = pictureArea(dialog);
  fireEvent.pointerDown(area, { clientX: x, clientY: 200, button: 0 });
  fireEvent.pointerUp(area, { clientX: x, clientY: 200, button: 0 });
};

describe('the status list', () => {
  it('shows mine, then new, seen and muted people, each in a ring with one part per status', async () => {
    const { container } = await open();
    expect(
      screen.getByRole('button', { name: /My status Tap to add a status update/ }),
    ).toBeInTheDocument();
    const recent = screen.getByRole('list', { name: 'Recent updates' });
    expect(within(recent).getByRole('button', { name: /Riya Shah.*new/ })).toBeInTheDocument();
    const rings = within(recent).getAllByTestId('status-ring');
    expect(rings[0]?.querySelectorAll('circle')).toHaveLength(2);
    expect(
      within(screen.getByRole('list', { name: 'Viewed updates' })).getByText('Vikram Rao'),
    ).toBeInTheDocument();
    const muted = screen.getByRole('list', { name: 'Muted' });
    const seenRing = within(screen.getByRole('list', { name: 'Viewed updates' })).getByTestId(
      'status-ring',
    );
    expect(seenRing.querySelector('circle')?.getAttribute('data-seen')).toBe('true');
    expect(within(muted).getByText('Meera Iyer')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('says so when nobody has posted anything', async () => {
    feed = { mine: [], people: [] };
    await renderApp('/updates', { width: MOBILE_WIDTH });
    expect(
      await screen.findByText('No status updates from colleagues right now.', undefined, SLOW),
    ).toBeInTheDocument();
  });
});

describe('the viewer', () => {
  it('starts at the first unseen, marks it seen, and taps move right and left', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: /^Riya Shah / }));
    const dialog = await viewer();
    expect(within(dialog).getByText('first from Riya')).toBeInTheDocument();
    await waitFor(() => expect(views).toContain(feed.people[0]?.statuses[0]?.id));
    tap(dialog, 250);
    expect(await within(dialog).findByText('second from Riya')).toBeInTheDocument();
    tap(dialog, 20);
    expect(await within(dialog).findByText('first from Riya')).toBeInTheDocument();
    expect(await axe(dialog)).toHaveNoViolations();
  });

  it('arrow keys move, after the last one the next person starts, and Esc closes', async () => {
    const user = userEvent.setup();
    // Both in "Recent updates": the viewer goes through that part of the list.
    feed = feedFixture();
    const vikram = feed.people[1];
    if (vikram) vikram.statuses = vikram.statuses.map((status) => ({ ...status, viewed: false }));
    await open();
    fireEvent.click(screen.getByRole('button', { name: /^Riya Shah / }));
    const dialog = await viewer();
    await user.keyboard('{ArrowRight}');
    expect(await within(dialog).findByText('second from Riya')).toBeInTheDocument();
    await user.keyboard('{ArrowRight}');
    expect(await within(dialog).findByText('from Vikram')).toBeInTheDocument();
    await user.keyboard('{ArrowLeft}');
    expect(await within(dialog).findByText('second from Riya')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('holding pauses (a long press moves nowhere), and swiping down closes', async () => {
    await open(MOBILE_WIDTH);
    fireEvent.click(screen.getByRole('button', { name: /^Riya Shah / }));
    const dialog = await viewer();
    const area = pictureArea(dialog);
    fireEvent.pointerDown(area, { clientX: 250, clientY: 200, button: 0 });
    await new Promise((resolve) => setTimeout(resolve, 600));
    fireEvent.pointerUp(area, { clientX: 250, clientY: 200, button: 0 });
    expect(within(dialog).getByText('first from Riya')).toBeInTheDocument();
    fireEvent.pointerDown(area, { clientX: 150, clientY: 100, button: 0 });
    fireEvent.pointerUp(area, { clientX: 150, clientY: 320, button: 0 });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('a reply goes to our 1:1 chat with the status attached', async () => {
    const user = userEvent.setup();
    await open();
    await waitFor(() => expect(useSyncStore.getState().client).not.toBeNull());
    act(() => lastSocket().receive('connect'));
    fireEvent.click(screen.getByRole('button', { name: /^Riya Shah / }));
    const dialog = await viewer();
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Reply to Riya Shah' }),
      'Looks great',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Send reply' }));
    await waitFor(() =>
      expect(
        lastSocket().emitted.find((entry) => entry.event === 'message:send')?.payload,
      ).toMatchObject({
        chatId: 'c-riya',
        text: 'Looks great',
        statusId: feed.people[0]?.statuses[0]?.id,
      }),
    );
  });

  it('my own status shows how many viewed it, and who', async () => {
    feed = feedFixture({
      mine: [statusFixture(ME_ID, { text: 'mine', viewed: true, viewCount: 2 })],
    });
    server.use(
      http.get('*/v1/statuses/:id/viewers', () =>
        HttpResponse.json({
          viewers: [
            { user: feed.people[0]?.user, viewedAt: new Date().toISOString(), reaction: '😍' },
            { user: feed.people[1]?.user, viewedAt: new Date().toISOString(), reaction: null },
          ],
          count: 2,
        }),
      ),
    );
    await open();
    fireEvent.click(screen.getByRole('button', { name: /^My status/ }));
    const dialog = await viewer();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Viewed by 2' }));
    const list = await screen.findByRole('list', { name: 'Viewed by' }, SLOW);
    expect(within(list).getByText('Riya Shah')).toBeInTheDocument();
    expect(within(list).getByRole('img', { name: 'Reacted 😍' })).toBeInTheDocument();
    expect(views).toEqual([]);
  });
});
