import { type Appearance, DEFAULT_APPEARANCE } from '@zuvo/protocol';
import { HttpResponse, http, server } from '@/test/msw';

type Image = { id: string; url: string };

/** Test-only: the appearance and wallpaper API kept in memory, recording what the app sends. */
export interface AppearanceServer {
  appearance: Appearance;
  images: Image[];
  requests: Array<{ method: string; path: string; body: unknown }>;
  /** Make the next PATCH fail. */
  failNextPatch: boolean;
}

export const IMAGE_ID = '64b7f0c2a1b2c3d4e5f60718';

export function serveAppearance(
  initial: Partial<Appearance> = {},
  images: Image[] = [],
): AppearanceServer {
  const state: AppearanceServer = {
    appearance: { ...DEFAULT_APPEARANCE, ...initial },
    images: [...images],
    requests: [],
    failNextPatch: false,
  };
  const path = (request: Request) => new URL(request.url).pathname;
  server.use(
    http.get('*/v1/me/appearance', () => HttpResponse.json({ appearance: state.appearance })),
    http.patch('*/v1/me/appearance', async ({ request }) => {
      const body = (await request.json()) as Partial<Appearance>;
      state.requests.push({ method: 'PATCH', path: path(request), body });
      if (state.failNextPatch) {
        state.failNextPatch = false;
        return HttpResponse.json(
          { code: 'INTERNAL', message: 'no', requestId: 'r' },
          { status: 500 },
        );
      }
      state.appearance = { ...state.appearance, ...body };
      return HttpResponse.json({ appearance: state.appearance });
    }),
    http.get('*/v1/me/wallpapers', () => HttpResponse.json({ images: state.images })),
    http.post('*/v1/me/wallpapers', ({ request }) => {
      state.requests.push({ method: 'POST', path: path(request), body: null });
      const image = { id: IMAGE_ID, url: `/v1/me/wallpapers/${IMAGE_ID}` };
      state.images.push(image);
      return HttpResponse.json({ image });
    }),
    http.delete('*/v1/me/wallpapers/:id', ({ request, params }) => {
      state.requests.push({ method: 'DELETE', path: path(request), body: null });
      state.images = state.images.filter((image) => image.id !== params.id);
      return HttpResponse.json({ ok: true });
    }),
    http.put('*/v1/chats/:id/wallpaper', async ({ request }) => {
      state.requests.push({ method: 'PUT', path: path(request), body: await request.json() });
      return HttpResponse.json({ ok: true });
    }),
  );
  return state;
}
