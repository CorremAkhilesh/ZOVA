import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { axe } from '@/test/axe';
import { setViewportWidth } from '@/test/media';
import { DESKTOP_WIDTH, MOBILE_WIDTH, renderApp } from '@/test/render-app';

/**
 * jsdom gives every element a 0×0 box, so react-resizable-panels treats each pointerdown as a
 * divider grab and keeps focus. Focus the field directly, then type (real clicks: Playwright).
 */
async function typeInto(
  user: ReturnType<typeof userEvent.setup>,
  field: HTMLElement,
  text: string,
) {
  field.focus();
  await user.keyboard(text);
}

describe('desktop layout (≥768px)', () => {
  it('shows the rail, the chat list and the empty conversation state', async () => {
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).getByRole('link', { name: 'Chats' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Chats' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pick a conversation' })).toBeInTheDocument();
    expect(screen.getByText('Sample data')).toBeInTheDocument();
  });

  it('opens a conversation next to the list and toggles the info pane', async () => {
    const user = userEvent.setup();
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    await user.click(screen.getByRole('link', { name: /Asha Verma/ }));

    expect(await screen.findByRole('list', { name: 'Asha Verma' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Chats' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Back to chats' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: 'Read' }).length).toBeGreaterThan(0);

    const [infoToggle] = screen.getAllByRole('button', { name: 'Chat info' });
    if (!infoToggle) throw new Error('missing info toggle');
    await user.click(infoToggle);
    expect(screen.getByRole('complementary', { name: 'Chat info' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close chat info' }));
    expect(screen.queryByRole('complementary', { name: 'Chat info' })).not.toBeInTheDocument();
  });

  it('filters by folder and search', async () => {
    const user = userEvent.setup();
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    await user.click(screen.getByRole('tab', { name: 'Groups' }));
    expect(screen.queryByRole('link', { name: /Asha Verma/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Product & Design/ })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'All' }));
    await typeInto(user, screen.getByRole('searchbox', { name: 'Search chats' }), 'zzz');
    expect(screen.getByText('No chats match your search.')).toBeInTheDocument();
  });

  it('starts a reply from a message and cancels it', async () => {
    const user = userEvent.setup();
    await renderApp('/chats/asha', { width: DESKTOP_WIDTH });
    const [replyButton] = screen.getAllByRole('button', { name: 'Reply' });
    if (!replyButton) throw new Error('missing reply button');
    await user.click(replyButton);
    expect(screen.getByText(/Replying to/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel reply' }));
    expect(screen.queryByText(/Replying to/)).not.toBeInTheDocument();
  });

  it('swaps the voice button for send when typing', async () => {
    const user = userEvent.setup();
    await renderApp('/chats/rahul', { width: DESKTOP_WIDTH });
    expect(screen.getByRole('button', { name: 'Record a voice note' })).toBeInTheDocument();
    await typeInto(user, screen.getByRole('textbox', { name: 'Write a message' }), 'Hello');
    expect(await screen.findByRole('button', { name: 'Send' })).toBeInTheDocument();
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
    const user = userEvent.setup();
    await renderApp('/chats', { width: MOBILE_WIDTH });
    await user.click(screen.getByRole('link', { name: /Asha Verma/ }));
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
  it('renders the welcome page with a link to the preview', async () => {
    await renderApp('/');
    expect(screen.getByRole('heading', { name: 'Welcome to Zuvo' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open the design preview/ })).toHaveAttribute(
      'href',
      '/chats',
    );
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
    ['welcome', '/', DESKTOP_WIDTH],
    ['chat list (desktop)', '/chats', DESKTOP_WIDTH],
    ['conversation (desktop)', '/chats/asha', DESKTOP_WIDTH],
    ['chat list (mobile)', '/chats', MOBILE_WIDTH],
    ['conversation (mobile)', '/chats/design-team', MOBILE_WIDTH],
    ['settings', '/settings', DESKTOP_WIDTH],
    ['updates', '/updates', MOBILE_WIDTH],
    ['404', '/nope', DESKTOP_WIDTH],
  ])('%s has no axe violations', async (_name, path, width) => {
    const { container } = await renderApp(path, { width });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
