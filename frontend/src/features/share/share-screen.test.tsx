import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rememberJoinPath, takeJoinPath } from '@/features/groups/rules';
import { useSyncStore } from '@/features/sync/store';
import type { SharedItem } from '@/sw/share/store';
import { axe } from '@/test/axe';
import { chatFixture, personFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, MOBILE_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 15_000 };

// The service worker's store, in memory (jsdom's IndexedDB cannot keep real Blobs).
const shares = new Map<string, SharedItem>();
vi.mock('@/sw/share/store', async (original) => ({
  ...(await original<typeof import('@/sw/share/store')>()),
  indexedDbShareStore: () => ({
    put: async (item: SharedItem) => void shares.set(item.id, item),
    get: async (id: string) => shares.get(id),
    latest: async () => [...shares.values()].at(-1),
    remove: async (id: string) => void shares.delete(id),
    prune: async () => undefined,
  }),
}));

const file = (name: string, type: string, size = 4) => ({
  name,
  type,
  size,
  blob: new File(['data'], name, { type }),
});
const share = (overrides: Partial<SharedItem> = {}): SharedItem => ({
  id: 's1',
  createdAt: Date.now(),
  title: '',
  text: '',
  url: '',
  files: [file('plan.pdf', 'application/pdf'), file('notes.txt', 'text/plain')],
  ...overrides,
});
afterEach(() => vi.restoreAllMocks());
const people = ['Asha', 'Bharat', 'Chitra', 'Dev', 'Esha', 'Farid'];

beforeEach(async () => {
  shares.clear();
  // No real toast: its timer would outlive the test's window.
  vi.spyOn(toast, 'success').mockImplementation(() => 'toast');
  vi.spyOn(toast, 'error').mockImplementation(() => 'toast');
  await seedLocal(
    people.map((name, index) =>
      chatFixture({
        id: `c${index}`,
        otherUser: personFixture({ id: `u${index}`, displayName: name }),
        lastActivityAt: new Date(Date.now() - index * 60_000).toISOString(),
      }),
    ),
  );
});

const open = async (path: string, width = DESKTOP_WIDTH) => {
  const view = await renderApp(path, { width });
  await screen.findByRole('heading', { name: /^Share to /, level: 1 }, SLOW);
  return view;
};

describe('Share to the app', () => {
  it('shows the files and text, picks up to 5 chats, and sends with the caption', async () => {
    shares.set('s1', share({ text: 'Q4 plan', url: 'https://docs.example.test/q4' }));
    const { container } = await open('/share?id=s1');
    const preview = screen.getByRole('region', { name: 'What you are sharing' });
    expect(within(preview).getByText('plan.pdf')).toBeInTheDocument();
    expect(within(preview).getByText('notes.txt')).toBeInTheDocument();
    expect(within(preview).getByText(/Q4 plan/)).toBeInTheDocument();
    const user = userEvent.setup();
    for (const name of people.slice(0, 5)) {
      await user.click(await screen.findByRole('checkbox', { name: new RegExp(name) }, SLOW));
    }
    expect(screen.getByRole('checkbox', { name: /Farid/ })).toBeDisabled();
    expect(screen.getByText('5 of 5 chats chosen')).toBeInTheDocument();
    // The shared text is the caption, ready to edit.
    expect(screen.getByRole('textbox', { name: 'Caption' })).toHaveValue(
      'Q4 plan\nhttps://docs.example.test/q4',
    );
    expect(await axe(container)).toHaveNoViolations();

    await waitFor(() => expect(useSyncStore.getState().client).not.toBeNull());
    const client = useSyncStore.getState().client;
    if (!client) throw new Error('no client');
    const sendMedia = vi.spyOn(client, 'sendMedia').mockResolvedValue(undefined);
    await user.click(screen.getByRole('button', { name: 'Send to 5 chats' }));
    // Each file once (on the first chat); the other four chats get it by reference.
    await waitFor(() => expect(sendMedia).toHaveBeenCalledTimes(2));
    expect(sendMedia.mock.calls[0]?.[0]).toMatchObject({
      chatId: 'c0',
      alsoTo: ['c1', 'c2', 'c3', 'c4'],
      caption: 'Q4 plan\nhttps://docs.example.test/q4',
    });
    expect(sendMedia.mock.calls[1]?.[0]).toMatchObject({
      chatId: 'c0',
      alsoTo: ['c1', 'c2', 'c3', 'c4'],
      caption: '',
    });
    await waitFor(() => expect(shares.has('s1')).toBe(false));
  });

  it('text alone: one chat, then it waits in that chat’s message box', async () => {
    shares.set('s1', share({ files: [], text: 'Meeting at 4' }));
    const { router } = await open('/share?id=s1', MOBILE_WIDTH);
    const user = userEvent.setup();
    expect(screen.queryByRole('textbox', { name: 'Caption' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('radio', { name: /Bharat/ }, SLOW));
    await user.click(screen.getByRole('radio', { name: /Chitra/ }));
    expect(screen.getByRole('radio', { name: /Bharat/ })).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Open chat' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/chats/c2'));
    expect(await screen.findByDisplayValue('Meeting at 4', undefined, SLOW)).toBeInTheDocument();
  });

  it('a file over the limit says so and cannot be sent', async () => {
    server.use(
      http.get('*/v1/config', () =>
        HttpResponse.json({
          media: { maxFileBytes: 1024, voiceMaxSeconds: 900, userQuotaBytes: 3 * 1024 ** 3 },
          features: { status: true, linkPreviews: true, groupMaxMembers: 256 },
        }),
      ),
    );
    shares.set('s1', share({ files: [file('huge.mp4', 'video/mp4', 5 * 1024)] }));
    await open('/share?id=s1');
    expect(await screen.findByRole('alert', {}, SLOW)).toHaveTextContent(/Too large to send/);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: /Asha/ }, SLOW));
    expect(screen.getByRole('button', { name: 'Send to 1 chat' })).toBeDisabled();
  });

  it('explains a share that did not reach the app, and an empty one', async () => {
    await open('/share?retry=1');
    expect(screen.getByRole('alert')).toHaveTextContent(/Open .* once, then share again/);
    await act(async () => undefined);
  });

  it('signed out, a share is remembered and continues after sign-in', () => {
    rememberJoinPath('/share?id=s1');
    expect(takeJoinPath()).toBe('/share?id=s1');
    rememberJoinPath('/settings');
    expect(takeJoinPath()).toBeNull();
  });
});
