import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { brand } from '@zuvo/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useInstallStore } from '@/features/install/install-store';
import { useGlobalSearch } from '@/features/search/store';
import { i18n } from '@/lib/i18n';
import { axe } from '@/test/axe';
import { HttpResponse, http, server, sessionFixture } from '@/test/msw';
import { DESKTOP_WIDTH, MOBILE_WIDTH, renderApp } from '@/test/render-app';

vi.setConfig({ testTimeout: 30_000 });

/** Hindi is saved on the account: the app follows the server's language (language-sync). */
async function asHindiUser() {
  const session = sessionFixture();
  server.use(
    http.get('*/v1/auth/me', () =>
      HttpResponse.json({ ...session, user: { ...session.user, language: 'hi' } }),
    ),
  );
  await act(() => i18n.changeLanguage('hi'));
}

afterEach(() => {
  vi.restoreAllMocks();
  useInstallStore.setState({ promptEvent: null, installed: false });
  useGlobalSearch.setState({ open: false, initial: '' });
  // jsdom has no maxTouchPoints; some tests define it.
  Reflect.deleteProperty(navigator, 'maxTouchPoints');
});

const PAGES = [
  { path: '/help', en: 'Help & About', hi: 'मदद और जानकारी' },
  { path: '/help/install', en: 'Install the app', hi: 'ऐप इंस्टॉल करें' },
  { path: '/help/faq', en: 'Common questions', hi: 'आम सवाल' },
  { path: '/help/privacy', en: 'Your privacy', hi: 'आपकी प्राइवेसी' },
  { path: '/help/contact', en: 'Contact us', hi: 'हमसे संपर्क करें' },
  { path: '/help/about', en: `About ${brand.name}`, hi: `${brand.name} के बारे में` },
] as const;

const h1 = (name: string) => screen.findByRole('heading', { level: 1, name }, { timeout: 15_000 });

describe.each(PAGES)('$path', ({ path, en, hi }) => {
  it('renders one h1 in English with no axe violations (phone width)', async () => {
    const { container } = await renderApp(path, { width: MOBILE_WIDTH });
    expect(await h1(en)).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('renders in Hindi with no axe violations (desktop)', async () => {
    await asHindiUser();
    const { container } = await renderApp(path, { width: DESKTOP_WIDTH });
    expect(await h1(hi)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Help navigation', () => {
  it('Settings → Help & About → each topic, and back again', async () => {
    const user = userEvent.setup();
    const { router } = await renderApp('/settings', { width: DESKTOP_WIDTH });
    await user.click(await screen.findByRole('link', { name: /Help & About/ }));
    await h1('Help & About');
    expect(router.state.location.pathname).toBe('/help');

    const topics = () => within(screen.getByRole('navigation', { name: 'Help topics' }));
    for (const page of PAGES.slice(1)) {
      await user.click(topics().getByRole('link', { name: new RegExp(page.en) }));
      await h1(page.en);
      expect(router.state.location.pathname).toBe(page.path);
      await user.click(screen.getByRole('link', { name: 'Help & About' }));
      await h1('Help & About');
    }
    await user.click(within(screen.getByRole('main')).getByRole('link', { name: 'Settings' }));
    expect(await h1('Settings')).toBeInTheDocument();
  });

  it('the palette’s Help command opens /help', async () => {
    const { router } = await renderApp('/chats', { width: DESKTOP_WIDTH });
    act(() => useGlobalSearch.getState().show('>help'));
    const group = await screen.findByRole('group', { name: 'Commands' }, { timeout: 15_000 });
    expect(within(group).getAllByRole('option')[0]).toHaveAccessibleName(/Help & About/);
    (await screen.findByRole('combobox')).focus();
    await userEvent.setup().keyboard('{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/help'));
    expect(await h1('Help & About')).toBeInTheDocument();
  });
});

describe('Install guide', () => {
  const setUserAgent = (userAgent: string, maxTouchPoints = 0) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
    Object.defineProperty(navigator, 'maxTouchPoints', {
      value: maxTouchPoints,
      configurable: true,
    });
  };
  const sectionTitles = () =>
    screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);

  it('shows the iPhone guide first on an iPhone, with why notifications need the icon', async () => {
    setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
      5,
    );
    await renderApp('/help/install', { width: MOBILE_WIDTH });
    await h1('Install the app');
    expect(sectionTitles()).toEqual([
      'iPhone or iPad',
      'Windows, Mac or Linux computer',
      'Android phone or tablet',
    ]);
    const ios = screen.getByRole('region', { name: 'iPhone or iPad' });
    expect(within(ios).getByText('Your device')).toBeInTheDocument();
    expect(within(ios).getByText(/Add to Home Screen/)).toBeInTheDocument();
    expect(within(ios).getByText(/16\.4/)).toBeInTheDocument();
    expect(
      within(ios).getByRole('heading', { name: 'Why notifications need the Home Screen icon' }),
    ).toBeInTheDocument();
  });

  it('shows Android first on Android, and Edge before Chrome on Edge', async () => {
    setUserAgent(
      'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
      5,
    );
    const { unmount } = await renderApp('/help/install', { width: MOBILE_WIDTH });
    await h1('Install the app');
    expect(sectionTitles()[0]).toBe('Android phone or tablet');
    unmount();

    setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0',
    );
    await renderApp('/help/install', { width: DESKTOP_WIDTH });
    await h1('Install the app');
    expect(sectionTitles()[0]).toBe('Windows, Mac or Linux computer');
    const browsers = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(browsers.slice(0, 2)).toEqual(['Microsoft Edge', 'Google Chrome']);
  });

  it('offers "Install now" when the browser can install, and runs its prompt', async () => {
    const prompt = vi.fn(async () => {});
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' }),
    });
    await renderApp('/help/install', { width: DESKTOP_WIDTH });
    await h1('Install the app');
    expect(screen.queryByRole('button', { name: 'Install now' })).not.toBeInTheDocument();
    act(() => {
      window.dispatchEvent(event);
    });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Install now' }));
    expect(prompt).toHaveBeenCalledOnce();
  });
});

describe('Contact and About', () => {
  it('links to the support address', async () => {
    await renderApp('/help/contact', { width: DESKTOP_WIDTH });
    await h1('Contact us');
    const link = screen.getByRole('link', { name: brand.supportEmail });
    expect(link.getAttribute('href')).toMatch(
      new RegExp(`^mailto:${brand.supportEmail}\\?subject=`),
    );
  });

  it('shows the version and what’s new', async () => {
    await renderApp('/help/about', { width: DESKTOP_WIDTH });
    await h1(`About ${brand.name}`);
    expect(screen.getByText(/^Version \d+\.\d+\.\d+/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Groups' })).toBeInTheDocument();
  });

  it('shows the version and what’s new in Hindi', async () => {
    await asHindiUser();
    await renderApp('/help/about', { width: DESKTOP_WIDTH });
    expect(await screen.findByRole('heading', { level: 3, name: 'ग्रुप' })).toBeInTheDocument();
    expect(screen.getByText(/^वर्ज़न \d+/)).toBeInTheDocument();
  });
});
