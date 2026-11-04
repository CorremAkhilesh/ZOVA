import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { axe } from '@/test/axe';
import { chatFixture, messageFixture } from '@/test/chat-fixtures';
import { setViewportWidth } from '@/test/media';
import { server, signedOut } from '@/test/msw';
import { DESKTOP_WIDTH, MOBILE_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';

const seedChat = () => seedLocal([chatFixture()], [messageFixture(1)]);

describe('desktop layout (≥768px)', () => {
  it('shows the rail, the chat list and the empty conversation state', async () => {
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).getByRole('link', { name: 'Chats' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Chats' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pick a conversation' })).toBeInTheDocument();
  });

  it('opens a conversation next to the list', async () => {
    await seedChat();
    const user = userEvent.setup();
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    await user.click(await screen.findByRole('link', { name: /Asha Verma/ }));

    expect(await screen.findByRole('list', { name: 'Asha Verma' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Chats' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Back to chats' })).not.toBeInTheDocument();
  });
});

describe('mobile layout (<768px)', () => {
  it('shows bottom tabs and the chat list only', async () => {
    await renderApp('/chats', { width: MOBILE_WIDTH });
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).getAllByRole('link')).toHaveLength(4);
    expect(screen.queryByRole('heading', { name: 'Pick a conversation' })).not.toBeInTheDocument();
  });

  it('opens a conversation full screen with a back button and no tabs', async () => {
    await seedChat();
    const user = userEvent.setup();
    await renderApp('/chats', { width: MOBILE_WIDTH });
    await user.click(await screen.findByRole('link', { name: /Asha Verma/ }));
    expect(await screen.findByRole('link', { name: 'Back to chats' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Back to chats' }));
    expect(await screen.findByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
  });

  it('switches layout when the viewport crosses 768px', async () => {
    await renderApp('/chats', { width: MOBILE_WIDTH });
    expect(screen.queryByRole('heading', { name: 'Pick a conversation' })).not.toBeInTheDocument();
    act(() => setViewportWidth(DESKTOP_WIDTH));
    expect(await screen.findByRole('heading', { name: 'Pick a conversation' })).toBeInTheDocument();
  });
});

describe('screens', () => {
  it('shows the email sign-in screen when signed out', async () => {
    server.use(signedOut());
    await renderApp('/');
    expect(screen.getByRole('heading', { name: 'Welcome to Zuvo' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Work email' })).toBeEnabled();
    expect(screen.queryByText(/design preview/i)).not.toBeInTheDocument();
  });

  it('renders a 404 page for unknown URLs and unknown chats', async () => {
    await renderApp('/does-not-exist');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('switches the UI to Hindi from settings', async () => {
    const user = userEvent.setup();
    await renderApp('/settings', { width: DESKTOP_WIDTH });
    await user.click(screen.getByRole('radio', { name: 'हिन्दी' }));
    expect(await screen.findByRole('heading', { name: 'सेटिंग्स' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('hi');
  });

  it.each([
    ['chat list (desktop)', '/chats', DESKTOP_WIDTH],
    ['chat list (mobile)', '/chats', MOBILE_WIDTH],
    ['settings', '/settings', DESKTOP_WIDTH],
    ['updates', '/updates', MOBILE_WIDTH],
    ['404', '/nope', DESKTOP_WIDTH],
  ])('%s has no axe violations', async (_name, path, width) => {
    const { container } = await renderApp(path, { width });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
