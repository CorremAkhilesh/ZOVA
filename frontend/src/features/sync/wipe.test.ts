import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dexie from 'dexie';
import { describe, expect, it, vi } from 'vitest';
import { recentPeople } from '@/features/people/recent-people';
import { uuidv7 } from '@/lib/uuid';
import { chatFixture, ME_ID, personFixture, syncPage } from '@/test/chat-fixtures';
import { HttpResponse, http, server, signedOut } from '@/test/msw';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { lastSocket } from '@/test/socket-mock';
import { applySyncPage } from './apply';
import { getUserDb, wipeLocalDatabases } from './local-db';
import { openTabChannel, watchLeadership } from './tabs';

const localDatabases = async () =>
  (await Dexie.getDatabaseNames()).filter((name) => name.startsWith('zuvo-'));

async function seed(userId = ME_ID) {
  const db = getUserDb(userId);
  await db.open();
  await applySyncPage(db, userId, syncPage({ cursor: '5', chats: [chatFixture()] }));
  await db.outbox.add({
    clientMsgId: uuidv7(),
    chatId: 'c1',
    text: 'secret',
    attempts: 0,
    state: 'pending',
  });
  await db.drafts.put({ chatId: 'c1', text: 'secret draft' });
  return db;
}

describe('wiping local data', () => {
  it('deletes every user database and leaves nothing behind', async () => {
    await seed('u-one');
    await seed('u-two');
    expect(await localDatabases()).toHaveLength(2);
    await wipeLocalDatabases();
    expect(await localDatabases()).toEqual([]);
  });

  it('a user signing in afterwards starts empty', async () => {
    await seed('u-one');
    await wipeLocalDatabases();
    const db = getUserDb('u-one');
    await db.open();
    expect(await db.chats.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.drafts.count()).toBe(0);
  });

  it('keeps each user in a separate database', async () => {
    const one = await seed('u-one');
    const two = getUserDb('u-two');
    await two.open();
    expect(await one.chats.count()).toBe(1);
    expect(await two.chats.count()).toBe(0);
  });

  it('wipes on sign-out', async () => {
    server.use(http.post('*/v1/auth/logout', () => HttpResponse.json({ status: 'signed_out' })));
    await seed();
    recentPeople.add(personFixture());
    const user = userEvent.setup();
    const { router } = await renderApp('/settings', { width: DESKTOP_WIDTH });
    server.use(signedOut());
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    await waitFor(async () => expect(await localDatabases()).toEqual([]));
    expect(recentPeople.load()).toEqual([]);
  });

  it.each(['revoked', 'deactivated', 'expired'])('wipes when the session is %s', async (reason) => {
    await seed();
    const { router } = await renderApp('/settings', { width: DESKTOP_WIDTH });
    await waitFor(() => expect(lastSocket()).toBeDefined());
    server.use(signedOut(reason === 'expired' ? 'SESSION_EXPIRED' : 'UNAUTHENTICATED'));
    act(() => lastSocket().receive('session:revoked', { reason }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    await waitFor(async () => expect(await localDatabases()).toEqual([]));
  });

  it('wipes when the app opens and the session has already gone', async () => {
    await seed();
    server.use(signedOut('SESSION_EXPIRED'));
    await renderApp('/chats');
    await waitFor(async () => expect(await localDatabases()).toEqual([]));
  });
});

describe('between tabs', () => {
  it('passes messages to other tabs of the browser', async () => {
    const received: string[] = [];
    const listener = openTabChannel((message) => received.push(message));
    const sender = openTabChannel(() => undefined);
    sender.post('outbox-changed');
    await vi.waitFor(() => expect(received).toEqual(['outbox-changed']));
    listener.close();
    sender.close();
  });

  it('gives the outbox to one tab at a time, then to the next when it closes', async () => {
    const locks = new Map<string, Array<() => void>>();
    vi.stubGlobal('navigator', {
      ...navigator,
      locks: {
        request: (name: string, options: { signal: AbortSignal }, run: () => Promise<void>) => {
          const start = () =>
            run().finally(() => {
              const queue = locks.get(name) ?? [];
              queue.shift();
              queue[0]?.();
            });
          const queue = locks.get(name) ?? [];
          locks.set(name, [...queue, start]);
          if (queue.length === 0) void start();
          expect(options.signal).toBeInstanceOf(AbortSignal);
          return Promise.resolve();
        },
      },
    });
    const leaders: string[] = [];
    const first = watchLeadership('lock', () => leaders.push('first'));
    watchLeadership('lock', () => leaders.push('second'));
    expect(leaders).toEqual(['first']);
    first.stop();
    await vi.waitFor(() => expect(leaders).toEqual(['first', 'second']));
    vi.unstubAllGlobals();
  });

  it('lets go of a lock granted just as the client stopped', async () => {
    let finished = false;
    let grant: () => Promise<void> = async () => undefined;
    vi.stubGlobal('navigator', {
      ...navigator,
      locks: {
        request: (_name: string, _options: unknown, run: () => Promise<void> | undefined) => {
          grant = async () => {
            await run();
            finished = true;
          };
          return Promise.resolve();
        },
      },
    });
    const onLeader = vi.fn();
    watchLeadership('lock', onLeader).stop();
    await grant();
    expect(finished).toBe(true);
    expect(onLeader).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('treats every tab as leader where Web Locks do not exist', () => {
    const onLeader = vi.fn();
    watchLeadership('lock', onLeader).stop();
    expect(onLeader).toHaveBeenCalledOnce();
  });
});
