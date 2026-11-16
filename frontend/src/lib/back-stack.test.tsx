import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { setViewportWidth } from '@/test/media';
import { scrollKeyOf, useBackClose } from './back-stack';

/** Two overlays; B, once open, needs two Backs to close (like a reply and a selection). */
function Page() {
  const [a, setA] = useState(false);
  const [b, setB] = useState(0);
  useBackClose(a, () => setA(false));
  useBackClose(b > 0, () => setB((value) => value - 1));
  return (
    <>
      <button type="button" onClick={() => setA(true)}>
        open A
      </button>
      <button type="button" onClick={() => setA(false)}>
        close A
      </button>
      <button type="button" onClick={() => setB(2)}>
        open B
      </button>
      {a ? <p>A is open</p> : null}
      {b > 0 ? <p>B is open</p> : null}
    </>
  );
}

function setup(width = 390) {
  setViewportWidth(width);
  const root = createRootRoute({ component: Outlet });
  const page = createRoute({ getParentRoute: () => root, path: '/page', component: Page });
  const other = createRoute({
    getParentRoute: () => root,
    path: '/other',
    component: () => <p>Other page</p>,
  });
  const history = createMemoryHistory({ initialEntries: ['/start', '/page'] });
  const router = createRouter({ routeTree: root.addChildren([page, other]), history });
  render(<RouterProvider router={router} />);
  const index = () => Number(history.location.state.__TSR_index);
  /** The OS back gesture. */
  const back = () => act(() => history.back());
  return { router, history, index, back, user: userEvent.setup() };
}

const ready = () => screen.findByRole('button', { name: 'open A' });

describe('the back stack', () => {
  it('closes an overlay on Back, and stays on the page', async () => {
    const { history, index, back, user } = setup();
    await ready();
    const start = index();
    await user.click(screen.getByRole('button', { name: 'open A' }));
    await waitFor(() => expect(index()).toBe(start + 1));
    expect(history.location.pathname).toBe('/page');

    back();
    await waitFor(() => expect(screen.queryByText('A is open')).not.toBeInTheDocument());
    expect(history.location.pathname).toBe('/page');
    expect(index()).toBe(start);
  });

  it('takes its entry back out when closed another way', async () => {
    const { index, user } = setup();
    await ready();
    const start = index();
    await user.click(screen.getByRole('button', { name: 'open A' }));
    await waitFor(() => expect(index()).toBe(start + 1));
    await user.click(screen.getByRole('button', { name: 'close A' }));
    await waitFor(() => expect(index()).toBe(start));
  });

  it('closes the one opened last first', async () => {
    const { back, index, user } = setup();
    await ready();
    const start = index();
    await user.click(screen.getByRole('button', { name: 'open A' }));
    await waitFor(() => expect(index()).toBe(start + 1));
    await user.click(screen.getByRole('button', { name: 'open B' }));
    await waitFor(() => expect(index()).toBe(start + 2));

    // B cancels one thing per Back, as Esc does, and only then A closes.
    back();
    await waitFor(() => expect(index()).toBe(start + 2));
    expect(screen.getByText('B is open')).toBeInTheDocument();
    expect(screen.getByText('A is open')).toBeInTheDocument();
    back();
    await waitFor(() => expect(screen.queryByText('B is open')).not.toBeInTheDocument());
    expect(screen.getByText('A is open')).toBeInTheDocument();
    back();
    await waitFor(() => expect(screen.queryByText('A is open')).not.toBeInTheDocument());
    expect(index()).toBe(start);
  });

  it('never undoes a page change made while an overlay was open', async () => {
    const { history, user } = setup();
    await ready();
    await user.click(screen.getByRole('button', { name: 'open A' }));
    await waitFor(() => expect(history.location.state).toHaveProperty('zuvoOverlay'));
    // What a link or navigate() does underneath (this test's routes are not the app's).
    act(() => history.push('/other'));
    expect(await screen.findByText('Other page')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(history.location.pathname).toBe('/other');
  });

  it('leaves Back alone on a desktop with a mouse', async () => {
    const { index, user } = setup(1280);
    await ready();
    const start = index();
    await user.click(screen.getByRole('button', { name: 'open A' }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(index()).toBe(start);
  });
});

describe('scrollKeyOf', () => {
  it('gives an overlay entry the key of the page under it', () => {
    expect(scrollKeyOf({ href: '/c', state: { __TSR_key: 'k2', zuvoOverlayBase: 'k1' } })).toBe(
      'k1',
    );
    expect(scrollKeyOf({ href: '/c', state: { __TSR_key: 'k1' } })).toBe('k1');
    expect(scrollKeyOf({ href: '/c', state: {} })).toBe('/c');
  });
});
