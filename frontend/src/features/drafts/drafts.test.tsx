import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Draft } from '@zuvo/protocol';
import { describe, expect, it, vi } from 'vitest';
import { newerDraft } from '@/features/sync/apply';
import { getUserDb } from '@/features/sync/local-db';
import { useSyncStore } from '@/features/sync/store';
import { axe } from '@/test/axe';
import { chatFixture, ME_ID, messageFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { lastSocket } from '@/test/socket-mock';
import { applyRemoteDraft, DRAFT_PUSH_MS, draftLine } from './draft-sync';

vi.setConfig({ testTimeout: 30_000 });
const WAIT = { timeout: 10_000 };
const draft = (text: string, at: string, replyTo: Draft['replyTo'] = null): Draft => ({
  text,
  replyTo,
  updatedAt: at,
});

describe('drafts', () => {
  it('keep the newer of two, and an unknown one never clears mine', () => {
    const old = draft('old', '2026-11-01T10:00:00.000Z');
    const fresh = draft('fresh', '2026-11-01T11:00:00.000Z');
    expect(newerDraft(old, fresh)).toBe(fresh);
    expect(newerDraft(fresh, old)).toBe(fresh);
    expect(newerDraft(fresh, null)).toBe(fresh);
    expect(newerDraft(undefined, old)).toBe(old);
    expect(draftLine(draft('  two\nlines ', 'x'))).toBe('two lines');
    expect(draftLine(draft('  ', 'x'))).toBeNull();
  });

  it('typing saves the draft, sends it to my other devices, and shows "Draft:" in the list', async () => {
    const puts: Draft[] = [];
    server.use(
      http.put('*/v1/chats/:id/draft', async ({ request }) => {
        const body = (await request.json()) as Draft;
        puts.push(body);
        return HttpResponse.json({ draft: body, applied: true });
      }),
    );
    await seedLocal([chatFixture({ seq: 1 })], [messageFixture(1)]);
    const { container } = await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    const input = await screen.findByRole('textbox', { name: 'Write a message' });
    await waitFor(() => expect(useSyncStore.getState().client).not.toBeNull());
    input.focus();
    await userEvent.setup().keyboard('see you at 5');
    await waitFor(() => expect(puts.at(-1)?.text).toBe('see you at 5'), WAIT);
    const list = screen.getByRole('link', { name: /Asha Verma/ });
    await waitFor(() => expect(list).toHaveTextContent('Draft: see you at 5'), WAIT);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('a newer draft from another device fills the composer; an older one is ignored', async () => {
    await seedLocal([chatFixture({ seq: 1 })], [messageFixture(1)]);
    await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    const input = await screen.findByRole('textbox', { name: 'Write a message' });
    await waitFor(() => expect(useSyncStore.getState().client).not.toBeNull());
    act(() => lastSocket().receive('connect'));
    const now = Date.now();
    act(() =>
      lastSocket().receive('draft:updated', {
        chatId: 'c1',
        draft: draft('from my phone', new Date(now).toISOString()),
      }),
    );
    await waitFor(() => expect(input).toHaveValue('from my phone'), WAIT);
    await applyRemoteDraft(
      getUserDb(ME_ID),
      'c1',
      draft('older', new Date(now - 60_000).toISOString()),
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(input).toHaveValue('from my phone');
  });

  it('sending clears it everywhere', async () => {
    const puts: Draft[] = [];
    server.use(
      http.put('*/v1/chats/:id/draft', async ({ request }) => {
        const body = (await request.json()) as Draft;
        puts.push(body);
        return HttpResponse.json({ draft: body, applied: true });
      }),
    );
    await seedLocal([chatFixture({ seq: 1 })], [messageFixture(1)]);
    await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    const input = await screen.findByRole('textbox', { name: 'Write a message' });
    await waitFor(() => expect(useSyncStore.getState().client).not.toBeNull());
    act(() => lastSocket().receive('connect'));
    input.focus();
    await userEvent.setup().keyboard('ship it{Enter}');
    await waitFor(() => expect(puts.at(-1)?.text).toBe(''), { timeout: DRAFT_PUSH_MS + 8000 });
    expect(screen.getByRole('link', { name: /Asha Verma/ })).not.toHaveTextContent('Draft:');
  });
});
