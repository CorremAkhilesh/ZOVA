import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from '@/lib/i18n';
import { HttpResponse, http, profileFixture, server, sessionFixture } from '@/test/msw';
import { renderApp } from '@/test/render-app';
import { nextLanguageStep, usePendingLanguage } from './language-sync';

afterEach(() => usePendingLanguage.setState({ pending: null }));

/** A busy machine runs many test files at once. */
const SLOW = { timeout: 10_000 };

const account = { userId: 'u1', saved: 'hi' as const, needsProfile: false };

describe('nextLanguageStep', () => {
  it('applies the server’s language, also on a device that never chose one', () => {
    expect(nextLanguageStep(account, 'en', null)).toEqual({ kind: 'apply', language: 'hi' });
    expect(nextLanguageStep(account, 'hi', null)).toEqual({ kind: 'none' });
  });

  it('saves a choice made here that the server does not have yet', () => {
    const pending = { userId: 'u1', language: 'en' as const };
    expect(nextLanguageStep(account, 'en', pending)).toEqual({ kind: 'save', language: 'en' });
    expect(nextLanguageStep(account, 'hi', { userId: 'u1', language: 'hi' })).toEqual({
      kind: 'none',
    });
  });

  it('ignores another account’s unsaved choice', () => {
    const pending = { userId: 'someone-else', language: 'en' as const };
    expect(nextLanguageStep(account, 'en', pending)).toEqual({ kind: 'apply', language: 'hi' });
  });

  it('a brand-new account takes this device’s language', () => {
    const fresh = { userId: 'u1', saved: 'en' as const, needsProfile: true };
    expect(nextLanguageStep(fresh, 'hi', null)).toEqual({ kind: 'save', language: 'hi' });
  });
});

describe('language in the app', () => {
  it('opens in the language saved on the server', async () => {
    const session = sessionFixture();
    server.use(
      http.get('*/v1/auth/me', () =>
        HttpResponse.json({ ...session, user: { ...session.user, language: 'hi' } }),
      ),
    );
    expect(i18n.resolvedLanguage).toBe('en');
    await renderApp('/settings');
    await waitFor(() => expect(i18n.resolvedLanguage).toBe('hi'), SLOW);
    expect(await screen.findByRole('heading', { name: 'सेटिंग्स' })).toBeInTheDocument();
  });

  it('Settings → Language saves the choice to the profile', async () => {
    const saved: unknown[] = [];
    let language: 'en' | 'hi' = 'en';
    const session = sessionFixture();
    // The server remembers: a session refreshed later says the same.
    server.use(
      http.patch('*/v1/me/profile', async ({ request }) => {
        const body = (await request.json()) as { language: 'en' | 'hi' };
        saved.push(body);
        language = body.language;
        return HttpResponse.json({ profile: profileFixture({ language }) });
      }),
      http.get('*/v1/auth/me', () =>
        HttpResponse.json({ ...session, user: { ...session.user, language } }),
      ),
    );
    await renderApp('/settings');
    const user = userEvent.setup();
    const hindi = await screen.findByRole('radio', { name: 'हिन्दी' });
    hindi.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(saved).toEqual([{ language: 'hi' }]), SLOW);
    expect(i18n.resolvedLanguage).toBe('hi');
    await waitFor(() => expect(usePendingLanguage.getState().pending).toBeNull(), SLOW);
  });

  it('keeps an unsaved choice when the server is unreachable, and does not undo it', async () => {
    server.use(http.patch('*/v1/me/profile', () => HttpResponse.error()));
    await renderApp('/settings');
    const user = userEvent.setup();
    const hindi = await screen.findByRole('radio', { name: 'हिन्दी' });
    hindi.focus();
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(usePendingLanguage.getState().pending).toEqual({ userId: 'u-test', language: 'hi' }),
    );
    expect(i18n.resolvedLanguage).toBe('hi');
  });
});
