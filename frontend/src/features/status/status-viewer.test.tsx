import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { StatusFeedResponse } from '@zuvo/protocol';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSyncStore } from '@/features/sync/store';
import { axe } from '@/test/axe';
import { ME_ID } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, MOBILE_WIDTH, renderApp } from '@/test/render-app';
import { feedFixture, statusFixture } from './status-test-fixtures';
import { textSizeClass } from './text-styles';
import { useStatusViewer } from './viewer/queue';

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 15_000 };
let feed: StatusFeedResponse;
let deleted: string[];

const mine = () => [
  statusFixture(ME_ID, { text: 'my first', viewed: true, viewCount: 1 }),
  statusFixture(ME_ID, { text: 'my second', viewed: true, viewCount: 0 }),
];

beforeEach(() => {
  deleted = [];
  feed = feedFixture({ mine: mine() });
  server.use(
    http.get('*/v1/statuses', () => HttpResponse.json(feed)),
    http.post('*/v1/statuses/:id/view', () => HttpResponse.json({ ok: true })),
    http.delete('*/v1/statuses/:id', ({ params }) => {
      deleted.push(String(params.id));
      feed = { ...feed, mine: feed.mine.filter((status) => status.id !== params.id) };
      return HttpResponse.json({ ok: true });
    }),
  );
  vi.spyOn(toast, 'success').mockImplementation(() => 'toast');
  vi.spyOn(toast, 'error').mockImplementation(() => 'toast');
});
afterEach(() => {
  act(() => useStatusViewer.getState().close());
  vi.restoreAllMocks();
});

const open = async (width = DESKTOP_WIDTH) => {
  const view = await renderApp('/updates', { width });
  await screen.findByRole('button', { name: /^Riya Shah / }, SLOW);
  return view;
};
const viewer = (name: RegExp | string) => screen.findByRole('dialog', { name }, SLOW);

describe('deleting my status', () => {
  it('⋯ → Delete status asks first, then the next one shows; after the last, the list', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: /^My status 2 updates/ }));
    const dialog = await viewer('My status');
    expect(within(dialog).getByText('my first')).toBeInTheDocument();

    const remove = async () => {
      await user.click(within(dialog).getByRole('button', { name: 'More options' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Delete status' }));
      // The bug: the menu closing wiped the question before it showed.
      const confirm = await screen.findByRole('alertdialog', { name: 'Delete this status?' });
      expect(await axe(confirm)).toHaveNoViolations();
      await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    };
    await remove();
    expect(await within(dialog).findByText('my second')).toBeInTheDocument();
    await waitFor(() => expect(deleted).toHaveLength(1));
    await remove();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(deleted).toHaveLength(2));
    expect(
      await screen.findByRole('button', { name: /^My status Add a status/ }, SLOW),
    ).toBeInTheDocument();
  });

  it('Cancel keeps it, and the status stays put while the menu is open', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: /^My status 2 updates/ }));
    const dialog = await viewer('My status');
    await user.click(within(dialog).getByRole('button', { name: 'More options' }));
    await screen.findByRole('menuitem', { name: 'Delete status' });
    // Longer than a status lasts (5 s): the open menu holds it.
    await act(() => new Promise((resolve) => setTimeout(resolve, 5_600)));
    expect(within(dialog).getByText('my first')).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Delete status' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete this status?' });
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(deleted).toEqual([]);
  });

  it('a status deleted elsewhere (another device, the owner) leaves the open viewer', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: /^Riya Shah / }));
    const dialog = await viewer(/Riya Shah’s status/);
    expect(within(dialog).getByText('first from Riya')).toBeInTheDocument();
    const riya = feed.people[0];
    if (!riya) throw new Error('no fixture');
    feed = { ...feed, people: [{ ...riya, statuses: riya.statuses.slice(1) }] };
    const db = useSyncStore.getState().client?.db;
    if (!db) throw new Error('no db');
    const { refreshStatuses } = await import('./feed');
    await act(() => refreshStatuses(db));
    expect(await within(dialog).findByText('second from Riya')).toBeInTheDocument();
  });
});

describe('the layout', () => {
  it('desktop: the list on the left, a quiet pane on the right, ‹ › to move', async () => {
    const user = userEvent.setup();
    const { container } = await open();
    expect(screen.getByText('Choose a colleague to see their status updates')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: /^Riya Shah / }));
    const dialog = await viewer(/Riya Shah’s status/);
    expect(within(dialog).queryByRole('button', { name: 'Previous status' })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Next status' }));
    expect(await within(dialog).findByText('second from Riya')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Previous status' }));
    expect(await within(dialog).findByText('first from Riya')).toBeInTheDocument();
    expect(await axe(dialog)).toHaveNoViolations();
  });

  it('phone: no side pane; "Reply" opens the reply box, a swipe up does too', async () => {
    const user = userEvent.setup();
    await open(MOBILE_WIDTH);
    expect(screen.queryByText('Choose a colleague to see their status updates')).toBeNull();
    await user.click(screen.getByRole('button', { name: /^Riya Shah / }));
    const dialog = await viewer(/Riya Shah’s status/);
    await user.click(within(dialog).getByRole('button', { name: 'Reply' }));
    expect(within(dialog).getByRole('textbox', { name: 'Reply to Riya Shah' })).toHaveFocus();
    expect(within(dialog).queryByRole('button', { name: 'Reply' })).toBeNull();
    // A tap on the picture closes the box (and does not move on).
    const stage = within(dialog).getByTestId('status-stage');
    fireEvent.pointerDown(stage, { clientX: 250, clientY: 300, button: 0 });
    fireEvent.pointerUp(stage, { clientX: 250, clientY: 300, button: 0 });
    expect(await within(dialog).findByRole('button', { name: 'Reply' })).toBeInTheDocument();
    expect(within(dialog).getByText('first from Riya')).toBeInTheDocument();
    fireEvent.pointerDown(stage, { clientX: 150, clientY: 500, button: 0 });
    fireEvent.pointerUp(stage, { clientX: 150, clientY: 300, button: 0 });
    expect(within(dialog).queryByRole('button', { name: 'Reply' })).toBeNull();
  });
});

describe('text status lettering', () => {
  it('shorter words are bigger, long ones still readable', () => {
    expect(textSizeClass('Hi')).toContain('text-4xl');
    expect(textSizeClass('x'.repeat(100))).toContain('text-3xl');
    expect(textSizeClass('x'.repeat(300))).toContain('text-2xl');
    expect(textSizeClass('x'.repeat(600))).toContain('text-xl');
  });
});
