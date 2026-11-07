import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LinkPreview } from '@zuvo/protocol';
import { describe, expect, it, vi } from 'vitest';
import { ChatGallery } from '@/features/media/components/ChatGallery';
import { useSyncStore } from '@/features/sync/store';
import { axe } from '@/test/axe';
import { chatFixture, messageFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { lastSocket } from '@/test/socket-mock';
import { firstWebLink } from './use-link-preview-draft';

const preview: LinkPreview = {
  url: 'https://example.com/results',
  title: 'Quarterly results',
  description: 'Revenue grew',
  siteName: 'Example News',
  image: { id: '0123456789abcdef01234567', width: 600, height: 315 },
};
const WAIT = { timeout: 5000 };
// Typing, the pause before asking, and the answer: more than the default 5 s on a slow runner.
vi.setConfig({ testTimeout: 30_000 });

async function openChat(messages = [messageFixture(1)]) {
  await seedLocal([chatFixture({ seq: messages.length })], messages);
  const result = await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
  const input = await screen.findByRole('textbox', { name: 'Write a message' });
  await waitFor(() => expect(useSyncStore.getState().client).not.toBeNull());
  act(() => lastSocket().receive('connect'));
  return { ...result, input };
}

const sentPayloads = () =>
  lastSocket()
    .emitted.filter((entry) => entry.event === 'message:send')
    .map((entry) => entry.payload as { text: string; linkPreviewId?: string });

describe('formatted messages', () => {
  it('render bold, code and links safely, and the preview card the sender attached', async () => {
    const { container } = await openChat([
      messageFixture(1, { text: '*Hello* `npm i` see https://example.com/results' }),
      messageFixture(2, { text: 'with a card https://example.com/results', linkPreview: preview }),
    ]);
    const thread = await screen.findByRole('list', { name: /.+/ });
    expect(await within(thread).findByText('Hello')).toContainHTML('');
    expect(within(thread).getByText('Hello').tagName).toBe('STRONG');
    expect(within(thread).getByText('npm i').tagName).toBe('CODE');
    const links = within(thread).getAllByRole('link', { name: /example\.com\/results/ });
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    const card = within(thread).getByRole('link', { name: /Quarterly results on Example News/ });
    expect(card).toHaveAttribute('href', 'https://example.com/results');
    expect(card.querySelector('img')).toHaveAttribute(
      'src',
      '/v1/link-previews/images/0123456789abcdef01234567',
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('show plain text in the chat list', async () => {
    await seedLocal([
      chatFixture({
        seq: 1,
        lastMessage: {
          id: 'm1',
          seq: 1,
          senderId: 'u-asha',
          type: 'text',
          preview: '*Budget* is _final_',
          createdAt: '2026-11-04T10:00:00.000Z',
        },
      }),
    ]);
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    expect(await screen.findByText('Budget is final')).toBeInTheDocument();
  });
});

describe('the composer', () => {
  it('Ctrl+B and Ctrl+I wrap the selection, and the hint shows while typing', async () => {
    const user = userEvent.setup();
    const { input } = await openChat();
    input.focus();
    await user.keyboard('hello');
    await waitFor(() => expect(document.getElementById('composer-hint')).toHaveTextContent(/bold/));
    expect(input).toHaveAttribute('aria-describedby', 'composer-hint');
    (input as HTMLTextAreaElement).setSelectionRange(0, 5);
    await user.keyboard('{Control>}b{/Control}');
    expect(input).toHaveValue('*hello*');
    await user.keyboard('{Control>}i{/Control}');
    expect(input).toHaveValue('*_hello_*');
  });

  it('previews a link after a pause, and sends it with the message', async () => {
    const asked: string[] = [];
    server.use(
      http.post('*/v1/link-previews', async ({ request }) => {
        asked.push(((await request.json()) as { url: string }).url);
        return HttpResponse.json({ id: 'aaaaaaaaaaaaaaaaaaaaaaaa', preview });
      }),
    );
    const user = userEvent.setup();
    const { input } = await openChat();
    input.focus();
    await user.keyboard('look https://example.com/results');
    const attached = await screen.findByRole('region', { name: 'Link preview' }, WAIT);
    expect(await within(attached).findByText('Quarterly results')).toBeInTheDocument();
    expect(asked).toEqual(['https://example.com/results']);
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(sentPayloads().at(-1)).toMatchObject({ linkPreviewId: 'aaaaaaaaaaaaaaaaaaaaaaaa' }),
    );
    // My own bubble shows the card straight away.
    expect(
      await screen.findByRole('link', { name: /Quarterly results on Example News/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Link preview' })).not.toBeInTheDocument();
  });

  it('can send the link without its preview, and does not ask again', async () => {
    let asked = 0;
    server.use(
      http.post('*/v1/link-previews', () => {
        asked += 1;
        return HttpResponse.json({ id: 'bbbbbbbbbbbbbbbbbbbbbbbb', preview });
      }),
    );
    const user = userEvent.setup();
    const { input } = await openChat();
    input.focus();
    await user.keyboard('https://example.com/results');
    await screen.findByRole('region', { name: 'Link preview' }, WAIT);
    await user.click(screen.getByRole('button', { name: 'Send without a preview' }));
    input.focus();
    await user.keyboard(' ok');
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(asked).toBe(1);
    expect(screen.queryByRole('region', { name: 'Link preview' })).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(sentPayloads().at(-1)?.text).toBe('https://example.com/results ok'));
    expect(sentPayloads().at(-1)?.linkPreviewId).toBeUndefined();
  });

  it('sends without a preview when the server has none', async () => {
    server.use(
      http.post('*/v1/link-previews', () =>
        HttpResponse.json(
          { code: 'PREVIEW_UNAVAILABLE', message: 'No preview', requestId: 'r' },
          { status: 422 },
        ),
      ),
    );
    const user = userEvent.setup();
    const { input } = await openChat();
    input.focus();
    await user.keyboard('https://example.com/file.pdf');
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(screen.queryByRole('region', { name: 'Link preview' })).not.toBeInTheDocument();
  });

  it('finds the first web link only', () => {
    expect(firstWebLink('mail a@b.com or call +91 98765 43210')).toBeNull();
    expect(firstWebLink('see www.example.com and https://b.example')).toBe(
      'https://www.example.com',
    );
  });
});

describe('chat info → Links', () => {
  it('lists messages with links, with their preview titles', async () => {
    server.use(
      http.get('*/v1/chats/c1/media', ({ request }) => {
        const tab = new URL(request.url).searchParams.get('tab');
        const items =
          tab === 'links'
            ? [
                messageFixture(4, {
                  text: 'read https://example.com/results',
                  linkPreview: preview,
                }),
              ]
            : [];
        return HttpResponse.json({ items, hasMore: false });
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ChatGallery chatId="c1" onOpen={() => undefined} />
      </QueryClientProvider>,
    );
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Links' }));
    const row = await screen.findByRole('link', { name: /Quarterly results/ });
    expect(row).toHaveAttribute('href', 'https://example.com/results');
  });
});
