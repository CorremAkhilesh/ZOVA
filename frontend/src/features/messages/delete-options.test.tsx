import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { getUserDb } from '@/features/sync/local-db';
import { useSyncStore } from '@/features/sync/store';
import { axe } from '@/test/axe';
import { chatFixture, ME_ID, messageFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { lastSocket } from '@/test/socket-mock';
import { UNDO_MS } from './delete-actions';
import { useMessageUi } from './store';

const SLOW = { timeout: 15_000 };
let deletes: string[];

beforeEach(() => {
  deletes = [];
  useMessageUi.setState({ menu: null, deleting: null, hidden: [], selecting: null, selected: [] });
  server.use(
    http.delete('*/v1/chats/:id/messages/:mid', ({ request }) => {
      const url = new URL(request.url);
      deletes.push(`${url.pathname}${url.search}`);
      return HttpResponse.json({ ok: true });
    }),
  );
});

const theirs = (seq: number, text: string) =>
  messageFixture(seq, { id: `m${seq}`, senderId: 'u-riya', text });

async function open(messages: ReturnType<typeof theirs>[] = []) {
  await seedLocal([chatFixture({ seq: messages.length })], messages);
  const view = await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
  await waitFor(() => expect(useSyncStore.getState().client).not.toBeNull());
  return view;
}

async function menuOn(text: string) {
  fireEvent.contextMenu(await screen.findByText(text, undefined, SLOW));
  return screen.findByRole('menu', { name: 'Message actions' });
}

/** A message typed while offline: it waits with a clock, on this device only. */
async function unsent(text: string) {
  const user = userEvent.setup();
  act(() => lastSocket().receive('disconnect', 'transport close'));
  const input = await screen.findByRole('textbox', { name: 'Write a message' });
  input.focus();
  await user.keyboard(`${text}{Enter}`);
  await screen.findByText(text);
}

describe('delete for me, with Undo', () => {
  it('hides it at once, and Undo brings it back without asking the server', async () => {
    await open([theirs(1, 'keep me after all')]);
    fireEvent.click(
      within(await menuOn('keep me after all')).getByRole('menuitem', { name: 'Delete' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Delete this message?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete for me' }));
    await waitFor(() => expect(screen.queryByText('keep me after all')).not.toBeInTheDocument());
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('keep me after all')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, UNDO_MS + 500));
    expect(deletes).toEqual([]);
  }, 20_000);

  it('without Undo it is deleted for me once the five seconds pass', async () => {
    await open([theirs(1, 'goodbye')]);
    fireEvent.click(within(await menuOn('goodbye')).getByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this message?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete for me' }));
    expect(await screen.findByText('Message deleted for you')).toBeInTheDocument();
    expect(deletes).toEqual([]);
    await waitFor(() => expect(deletes).toEqual(['/v1/chats/c1/messages/m1?scope=me']), {
      timeout: UNDO_MS + 4000,
    });
    expect(screen.queryByText('goodbye')).not.toBeInTheDocument();
  }, 20_000);
});

describe('a message that was never sent', () => {
  it('offers only Delete (from this device) while it waits, and removes it everywhere locally', async () => {
    const { container } = await open();
    await unsent('typed offline');
    const menu = await menuOn('typed offline');
    const names = within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent);
    expect(names).toEqual(['Delete']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this message?' });
    expect(dialog).toHaveTextContent('never sent, so it is removed from this device only');
    expect(within(dialog).queryByRole('button', { name: 'Delete for everyone' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Delete for me' })).toBeNull();
    expect(await axe(container.ownerDocument.body)).toHaveNoViolations();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('typed offline')).not.toBeInTheDocument());
    const db = getUserDb(ME_ID);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.messages.where('chatId').equals('c1').count()).toBe(0);
    // It never reached the server, so there was nothing to ask it.
    act(() => lastSocket().receive('connect'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(lastSocket().emitted.filter((entry) => entry.event === 'message:send')).toEqual([]);
  });

  it('once "Not sent", offers Retry, which sends it', async () => {
    await open();
    await unsent('try me again');
    const db = getUserDb(ME_ID);
    await db.outbox.toCollection().modify({ state: 'failed' });
    await db.messages.where('chatId').equals('c1').modify({ status: 'failed' });
    // The bubble has caught up with "Not sent" before its menu is opened.
    await screen.findByRole('button', { name: /Not sent/ }, SLOW);
    const menu = await menuOn('try me again');
    expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
    act(() => lastSocket().receive('connect'));
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Retry' }));
    await waitFor(() =>
      expect(lastSocket().emitted.some((entry) => entry.event === 'message:send')).toBe(true),
    );
  });
});
