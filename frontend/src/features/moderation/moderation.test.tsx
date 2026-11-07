import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMessageUi } from '@/features/messages/store';
import { axe } from '@/test/axe';
import { chatFixture, ME_ID, messageFixture, personFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { useModeration } from './store';

const SLOW = { timeout: 15_000 };
vi.setConfig({ testTimeout: 30_000 });
const bharat = personFixture({ id: 'u-bharat', displayName: 'Bharat Rao' });
let blocked: string[];
let reports: unknown[];

beforeEach(() => {
  blocked = [];
  reports = [];
  useMessageUi.setState({ chatMenu: null, menu: null, jump: null });
  useModeration.setState({ report: null, confirmBlock: null });
  server.use(
    http.get('*/v1/me/blocks', () =>
      HttpResponse.json({
        items: blocked.map((id) => ({
          user: id === bharat.id ? bharat : personFixture({ id }),
          blockedAt: '2026-11-05T10:00:00.000Z',
        })),
      }),
    ),
    http.put('*/v1/me/blocks/:id', ({ params }) => {
      blocked = [...new Set([...blocked, String(params.id)])];
      return HttpResponse.json({ userId: params.id, blocked: true });
    }),
    http.delete('*/v1/me/blocks/:id', ({ params }) => {
      blocked = blocked.filter((id) => id !== params.id);
      return HttpResponse.json({ userId: params.id, blocked: false });
    }),
    http.post('*/v1/reports', async ({ request }) => {
      const body = (await request.json()) as { block?: boolean };
      reports.push(body);
      return HttpResponse.json({ reportId: 'r1', blocked: body.block === true });
    }),
  );
});

const direct = chatFixture({
  id: 'c1',
  seq: 1,
  otherUser: bharat,
  lastActivityAt: new Date().toISOString(),
});

async function chatMenu() {
  const link = await screen.findByRole('link', { name: /Bharat Rao/ }, SLOW);
  fireEvent.contextMenu(link);
  return screen.findByRole('menu', { name: 'Actions for Bharat Rao' });
}

describe('blocking', () => {
  it('asks first, then swaps the composer for a banner that unblocks', async () => {
    await seedLocal([direct], [messageFixture(1, { senderId: bharat.id })]);
    const { container } = await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    await screen.findByRole('textbox', { name: 'Write a message' }, SLOW);
    fireEvent.click(within(await chatMenu()).getByRole('menuitem', { name: 'Block Bharat Rao' }));
    const dialog = await screen.findByRole('dialog', { name: 'Block Bharat Rao?' });
    expect(dialog).toHaveTextContent('Groups you share are not affected');
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Block' }));
    const banner = await screen.findByRole('button', { name: /You blocked this contact/ }, SLOW);
    expect(blocked).toEqual([bharat.id]);
    expect(screen.queryByRole('textbox', { name: 'Write a message' })).not.toBeInTheDocument();
    await userEvent.setup().click(banner);
    expect(
      await screen.findByRole('textbox', { name: 'Write a message' }, SLOW),
    ).toBeInTheDocument();
    expect(blocked).toEqual([]);
  });

  it('rolls back when the server refuses', async () => {
    server.use(
      http.put('*/v1/me/blocks/:id', () =>
        HttpResponse.json(
          { code: 'INTERNAL_ERROR', message: 'nope', requestId: 'r' },
          { status: 500 },
        ),
      ),
    );
    await seedLocal([direct]);
    await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    await screen.findByRole('textbox', { name: 'Write a message' }, SLOW);
    fireEvent.click(within(await chatMenu()).getByRole('menuitem', { name: 'Block Bharat Rao' }));
    await userEvent
      .setup()
      .click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Block' }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Write a message' })).toBeInTheDocument(),
    );
  });

  it('lists blocked contacts in Settings → Privacy, each with Unblock', async () => {
    blocked = [bharat.id];
    const { container } = await renderApp('/settings/privacy');
    const list = await screen.findByRole('list', { name: 'Blocked contacts' }, SLOW);
    expect(within(list).getByText('Bharat Rao')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.setup().click(within(list).getByRole('button', { name: 'Unblock Bharat Rao' }));
    expect(await screen.findByText('You haven’t blocked anyone.')).toBeInTheDocument();
  });

  it('shows an error when the list cannot load', async () => {
    server.use(http.get('*/v1/me/blocks', () => HttpResponse.json({}, { status: 500 })));
    await renderApp('/settings/privacy');
    expect(
      await screen.findByText('Couldn’t load your blocked contacts.', {}, SLOW),
    ).toBeInTheDocument();
  });
});

describe('reporting', () => {
  it('a person from the chat menu, with a reason, a note and "report and block"', async () => {
    await seedLocal([direct]);
    const { container } = await renderApp('/chats', { width: DESKTOP_WIDTH });
    fireEvent.click(within(await chatMenu()).getByRole('menuitem', { name: 'Report Bharat Rao' }));
    const dialog = await screen.findByRole('dialog', { name: 'Report Bharat Rao' });
    const send = within(dialog).getByRole('button', { name: 'Report' });
    expect(send).toBeDisabled();
    const user = userEvent.setup();
    await user.click(within(dialog).getByRole('radio', { name: 'Scam or fraud' }));
    await user.type(within(dialog).getByRole('textbox', { name: /note/ }), 'asked for money');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Also block Bharat Rao' }));
    expect(await axe(container)).toHaveNoViolations();
    await user.click(within(dialog).getByRole('button', { name: 'Report and block' }));
    await waitFor(() =>
      expect(reports).toEqual([
        {
          target: { kind: 'user', userId: bharat.id, chatId: 'c1' },
          reason: 'scam',
          note: 'asked for money',
          block: true,
        },
      ]),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('a message from its menu', async () => {
    await seedLocal([direct], [messageFixture(1, { senderId: bharat.id, text: 'pay me now' })]);
    await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    fireEvent.contextMenu(await screen.findByText('pay me now', {}, SLOW));
    const menu = await screen.findByRole('menu', { name: 'Message actions' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Report' }));
    const dialog = await screen.findByRole('dialog', { name: 'Report a message from Bharat Rao' });
    const user = userEvent.setup();
    await user.click(within(dialog).getByRole('radio', { name: 'Spam' }));
    await user.click(within(dialog).getByRole('button', { name: 'Report' }));
    await waitFor(() =>
      expect(reports).toEqual([
        {
          target: { kind: 'message', chatId: 'c1', messageIds: ['m1'] },
          reason: 'spam',
          block: false,
        },
      ]),
    );
  });

  it('never offers to report my own message', async () => {
    await seedLocal([direct], [messageFixture(1, { senderId: ME_ID, text: 'my words' })]);
    await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    fireEvent.contextMenu(await screen.findByText('my words', {}, SLOW));
    const menu = await screen.findByRole('menu', { name: 'Message actions' });
    expect(within(menu).queryByRole('menuitem', { name: 'Report' })).not.toBeInTheDocument();
  });
});
