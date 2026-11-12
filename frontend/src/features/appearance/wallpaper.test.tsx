import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareImage } from '@/features/media/process';
import { useMessageUi } from '@/features/messages/store';
import { useThemeStore } from '@/features/theme/theme-store';
import { axe } from '@/test/axe';
import { chatFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { DIM_SAVE_DELAY_MS } from './components/DimSlider';
import { useChatWallpaperPicker } from './store';
import { IMAGE_ID, serveAppearance } from './test-server';
import { wallpaperStyle } from './wallpaper-style';

vi.mock('@/features/media/process', async (original) => ({
  ...(await original<typeof import('@/features/media/process')>()),
  prepareImage: vi.fn(),
}));

const SLOW = { timeout: 15_000 };
vi.setConfig({ testTimeout: 30_000 });
const picture = new File(['x'], 'beach.jpg', { type: 'image/jpeg' });

beforeEach(() => {
  vi.mocked(prepareImage).mockResolvedValue({
    file: new Blob(['small'], { type: 'image/jpeg' }),
    name: 'beach.jpg',
    mime: 'image/jpeg',
    kind: 'image',
  });
  useChatWallpaperPicker.setState({ chatId: null });
  useMessageUi.setState({ chatMenu: null, menu: null, jump: null });
});
afterEach(() => useThemeStore.setState({ mode: 'system' }));

async function openSettings() {
  const result = await renderApp('/settings/appearance');
  await screen.findByRole('radiogroup', { name: 'Accent color' }, SLOW);
  return result;
}

describe('default wallpaper', () => {
  it('saves a pattern and a color; shows no pictures yet; no axe violations', async () => {
    const api = serveAppearance();
    const user = userEvent.setup();
    const { container } = await openSettings();
    expect(screen.getByRole('radio', { name: 'Dots' })).toBeChecked();
    expect(
      await screen.findByText('No pictures yet. Upload one to use it as a wallpaper.'),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('radio', { name: 'Grid' }));
    await user.click(screen.getByRole('radio', { name: 'Sage' }));
    await waitFor(() =>
      expect(api.requests.map((request) => request.body)).toEqual([
        { wallpaper: { kind: 'pattern', id: 'grid' } },
        { wallpaper: { kind: 'color', id: 'sage' } },
      ]),
    );
    expect(screen.getByRole('radio', { name: 'Sage' })).toBeChecked();
  });

  it('uploads a compressed picture and uses it', async () => {
    const api = serveAppearance();
    await openSettings();
    await screen.findByText(/No pictures yet/);
    await userEvent.setup().upload(screen.getByLabelText('Upload a picture'), picture);
    expect(prepareImage).toHaveBeenCalledWith(picture);
    const radio = await screen.findByRole('radio', { name: 'Picture 1' });
    await waitFor(() => expect(radio).toBeChecked());
    expect(api.requests).toEqual([
      { method: 'POST', path: '/v1/me/wallpapers', body: null },
      {
        method: 'PATCH',
        path: '/v1/me/appearance',
        body: { wallpaper: { kind: 'image', id: IMAGE_ID } },
      },
    ]);
  });

  it('says so when the upload fails, or the picture cannot be read', async () => {
    serveAppearance();
    server.use(http.post('*/v1/me/wallpapers', () => HttpResponse.json({}, { status: 500 })));
    await openSettings();
    const input = await screen.findByLabelText('Upload a picture');
    await userEvent.setup().upload(input, picture);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t upload the picture. Try again.',
    );
    vi.mocked(prepareImage).mockResolvedValue({
      file: picture,
      name: 'beach.heic',
      mime: 'image/heic',
      kind: 'document',
    });
    await userEvent.setup().upload(input, picture);
    expect(await screen.findByRole('alert')).toHaveTextContent('This picture can’t be used.');
  });

  it('deletes one of my pictures', async () => {
    const api = serveAppearance({}, [{ id: IMAGE_ID, url: `/v1/me/wallpapers/${IMAGE_ID}` }]);
    await openSettings();
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Delete Picture 1' }, SLOW));
    await waitFor(() =>
      expect(api.requests).toEqual([
        { method: 'DELETE', path: `/v1/me/wallpapers/${IMAGE_ID}`, body: null },
      ]),
    );
    expect(await screen.findByText(/No pictures yet/)).toBeInTheDocument();
  });

  it('shows an error when my pictures cannot load', async () => {
    serveAppearance();
    server.use(http.get('*/v1/me/wallpapers', () => HttpResponse.json({}, { status: 500 })));
    await openSettings();
    expect(await screen.findByRole('alert', {}, SLOW)).toHaveTextContent(
      'Couldn’t load your pictures.',
    );
  });
});

describe('dimming', () => {
  it('is only offered in the dark theme, and saves when the slider rests', async () => {
    const api = serveAppearance();
    useThemeStore.setState({ mode: 'light' });
    await openSettings();
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.getByText(/Dimming applies in the dark theme/)).toBeInTheDocument();

    useThemeStore.setState({ mode: 'dark' });
    const slider = await screen.findByRole('slider', { name: /Dim wallpaper in dark theme/ });
    expect(slider).toHaveValue('30');
    fireEvent.change(slider, { target: { value: '60' } });
    expect(api.requests).toEqual([]);
    await waitFor(
      () => expect(api.requests.map((request) => request.body)).toEqual([{ dim: 60 }]),
      {
        timeout: DIM_SAVE_DELAY_MS + 2000,
      },
    );
  });
});

describe('a chat’s own wallpaper', () => {
  it('is picked from the chat menu, shows behind the messages, and goes back to the default', async () => {
    const api = serveAppearance();
    await seedLocal([chatFixture({ id: 'c1', seq: 0, lastActivityAt: new Date().toISOString() })]);
    const { container } = await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    const wallpaper = await screen.findByTestId('chat-wallpaper', {}, SLOW);
    expect(wallpaper).toHaveAttribute('data-wallpaper', 'pattern:dots');

    fireEvent.contextMenu(await screen.findByRole('link', { name: /Asha Verma/ }, SLOW));
    const menu = await screen.findByRole('menu', { name: 'Actions for Asha Verma' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Wallpaper…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Chat wallpaper' }, SLOW);
    expect(within(dialog).getByRole('radio', { name: 'Use default' })).toBeChecked();
    expect(await axe(container)).toHaveNoViolations();

    const user = userEvent.setup();
    await user.click(within(dialog).getByRole('radio', { name: 'Blush' }));
    await waitFor(() => expect(wallpaper).toHaveAttribute('data-wallpaper', 'color:blush'));
    await user.click(within(dialog).getByRole('radio', { name: 'Use default' }));
    await waitFor(() => expect(wallpaper).toHaveAttribute('data-wallpaper', 'pattern:dots'));
    expect(api.requests).toEqual([
      {
        method: 'PUT',
        path: '/v1/chats/c1/wallpaper',
        body: { wallpaper: { kind: 'color', id: 'blush' } },
      },
      { method: 'PUT', path: '/v1/chats/c1/wallpaper', body: { wallpaper: null } },
    ]);
  });
});

describe('wallpaperStyle', () => {
  it('draws patterns on the theme background, and dims colors and pictures only in dark', () => {
    expect(wallpaperStyle({ kind: 'pattern', id: 'none' }, 'dark', 50).backgroundImage).toBe(
      'none',
    );
    expect(wallpaperStyle({ kind: 'pattern', id: 'waves' }, 'light', 0).backgroundImage).toMatch(
      /^url\("data:image\/svg\+xml,/,
    );
    expect(wallpaperStyle({ kind: 'color', id: 'sand' }, 'light', 50)).toEqual({
      backgroundColor: '#F4EEE6',
      backgroundImage: 'none',
    });
    expect(wallpaperStyle({ kind: 'color', id: 'sand' }, 'dark', 40).backgroundImage).toContain(
      'rgb(0 0 0 / 0.4)',
    );
    const image = wallpaperStyle({ kind: 'image', id: IMAGE_ID }, 'dark', 0);
    expect(image.backgroundImage).toBe(`url("/v1/me/wallpapers/${IMAGE_ID}")`);
  });
});
