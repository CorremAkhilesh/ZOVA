import { screen } from '@testing-library/react';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAuthFlow } from '@/features/auth/flow-store';
import { server, signedOut } from '@/test/msw';
import { renderApp } from '@/test/render-app';
import { getUserDb, hasPendingWipe, wipeLocalDatabases, wipeTiming } from './local-db';
import { finishPendingWipe } from './wipe';

const localDatabases = async () =>
  (await Dexie.getDatabaseNames()).filter((name) => name.startsWith('zuvo-'));

/** Another tab's connection that, unlike Dexie, never lets go when a delete asks it to. */
async function holdOpen(name: string): Promise<IDBDatabase> {
  await getUserDb('u-one').open();
  getUserDb('u-one').close();
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

let stubborn: IDBDatabase | undefined;
beforeEach(() => {
  wipeTiming.attemptMs = 50;
});
afterEach(() => {
  stubborn?.close();
  stubborn = undefined;
  wipeTiming.attemptMs = 3000;
  useAuthFlow.setState({ wipeIncomplete: false });
});

describe('a wipe that another tab blocks', () => {
  it('does not hang, reports it, and remembers it', async () => {
    stubborn = await holdOpen('zuvo-user-u-one');

    const started = Date.now();
    expect(await wipeLocalDatabases()).toEqual({ complete: false });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(await localDatabases()).toEqual(['zuvo-user-u-one']);
    expect(hasPendingWipe()).toBe(true);

    // Once the other tab lets go, the next start finishes the job.
    stubborn.close();
    await finishPendingWipe();
    expect(await localDatabases()).toEqual([]);
    expect(hasPendingWipe()).toBe(false);
    expect(useAuthFlow.getState().wipeIncomplete).toBe(false);
  });

  it('a complete wipe leaves nothing to finish', async () => {
    await getUserDb('u-one').open();
    expect(await wipeLocalDatabases()).toEqual({ complete: true });
    expect(hasPendingWipe()).toBe(false);
  });

  it('tells the person on the sign-in screen', async () => {
    stubborn = await holdOpen('zuvo-user-u-one');
    server.use(signedOut());
    await renderApp('/');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /still stored in this browser.*Close all .* tabs/,
    );
  });
});
