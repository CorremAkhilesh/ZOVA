import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { App } from '@/app/App';
import { createAppRouter, createQueryClient } from '@/app/router';
import { setViewportWidth } from './media';

/** Renders the whole app at `path` with a fresh router and query client. */
export async function renderApp(path: string, options: { width?: number } = {}) {
  setViewportWidth(options.width ?? 1280);
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false, refetchInterval: false } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  const result = render(<App queryClient={queryClient} router={router} />);
  await router.load();
  // Wait for the first route content (every screen has a heading).
  await screen.findAllByRole('heading');
  return { ...result, router, queryClient };
}

export const DESKTOP_WIDTH = 1280;
export const MOBILE_WIDTH = 390;
