import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useInstallStore } from '@/features/install/install-store';
import { axe } from '@/test/axe';
import { server, signedOut } from '@/test/msw';
import { MOBILE_WIDTH, renderApp } from '@/test/render-app';

vi.setConfig({ testTimeout: 40_000 });

afterEach(() => {
  useInstallStore.setState({ promptEvent: null, installed: false });
});

const PAGES = [
  ['/help', 'Help & About'],
  ['/help/install', 'Install the app'],
  ['/help/faq', 'Common questions'],
  ['/help/privacy', 'Your privacy'],
  ['/help/contact', 'Contact us'],
  ['/help/about', /^About /],
] as const;

/** Every request the app makes while `run` goes, by path. */
async function requestsDuring(run: () => Promise<void>): Promise<string[]> {
  const paths: string[] = [];
  const listener = ({ request }: { request: Request }) => {
    paths.push(new URL(request.url).pathname);
  };
  server.events.on('request:start', listener);
  try {
    await run();
  } finally {
    server.events.removeListener('request:start', listener);
  }
  return paths;
}

describe('Help without an account', () => {
  it('opens every page signed out, offers sign-in, and asks the server for nothing', async () => {
    server.use(signedOut());
    const asked = await requestsDuring(async () => {
      for (const [path, title] of PAGES) {
        const { container, unmount } = await renderApp(path, { width: MOBILE_WIDTH });
        expect(
          await screen.findByRole('heading', { level: 1, name: title }, { timeout: 15_000 }),
        ).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/');
        // No Settings to go back to, and nobody's details anywhere.
        expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
        expect(document.body).not.toHaveTextContent('Kiran');
        if (path === '/help/faq') {
          // Every answer open, the storage one included (it would ask for the file limit).
          for (const question of screen.getAllByRole('button', { expanded: false })) {
            await userEvent.setup().click(question);
          }
        }
        expect(await axe(container)).toHaveNoViolations();
        unmount();
      }
    });
    expect(asked.filter((path) => path.startsWith('/v1/'))).toEqual([]);
  });

  it('"Install now" still works signed out', async () => {
    server.use(signedOut());
    const prompt = vi.fn(async () => {});
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' }),
    });
    await renderApp('/help/install', { width: MOBILE_WIDTH });
    await screen.findByRole('heading', { level: 1, name: 'Install the app' }, { timeout: 15_000 });
    act(() => {
      window.dispatchEvent(event);
    });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Install now' }));
    expect(prompt).toHaveBeenCalledOnce();
  });

  it('links between Help pages without signing in', async () => {
    server.use(signedOut());
    const { router } = await renderApp('/help', { width: MOBILE_WIDTH });
    const main = await screen.findByRole('main');
    await userEvent.setup().click(within(main).getByRole('link', { name: /Common questions/ }));
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: 'Common questions' },
        { timeout: 15_000 },
      ),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/help/faq');
  });
});
