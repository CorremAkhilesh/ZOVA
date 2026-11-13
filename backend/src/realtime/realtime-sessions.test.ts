import { sessionRevokedEventSchema } from '@zuvo/protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { headers } from '../../test/auth-helpers.ts';
import { buildTestApp } from '../../test/helpers.ts';
import {
  closeAllSockets,
  connect,
  connected,
  listen,
  nextDisconnect,
  openSocket,
  record,
  send,
  signedIn,
} from '../../test/realtime-helpers.ts';
import { getOrCreateDirectChat } from '../chats/chats.service.ts';
import { registerAuthModels } from '../db/auth-models.ts';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let url: string;
const app = () => ctx.app;
let alice: Awaited<ReturnType<typeof signedIn>>;
let bob: Awaited<ReturnType<typeof signedIn>>;

beforeAll(async () => {
  ctx = await buildTestApp();
  url = await listen(app());
  alice = await signedIn(app(), 'alice@corremadvisory.com');
  bob = await signedIn(app(), 'bob@corremadvisory.com');
});
afterEach(() => closeAllSockets());
afterAll(async () => {
  await ctx.cleanup();
});

describe('handshake', () => {
  const refusal = (socket: ReturnType<typeof openSocket>) =>
    connected(socket).then(
      () => null,
      (error: Error & { data?: { code: string } }) => error.data?.code ?? error.message,
    );

  it('refuses a missing or invalid session', async () => {
    expect(await refusal(openSocket(url))).toBe('UNAUTHENTICATED');
    expect(await refusal(openSocket(url, 'zuvo.session_token=forged.signature'))).toBe(
      'SESSION_EXPIRED',
    );
  });

  it('refuses a session that has already expired', async () => {
    const dave = await signedIn(app(), 'dave@corremadvisory.com');
    await registerAuthModels(app().mongo).AuthSession.updateOne(
      { _id: dave.sessionId },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    expect(await refusal(openSocket(url, dave.cookie))).toBe('SESSION_EXPIRED');
  });

  it('refuses other websites (cross-site WebSocket hijacking)', async () => {
    const socket = openSocket(url, alice.cookie, 'https://evil.example');
    expect(await refusal(socket)).not.toBeNull();
  });
});

describe('sessions end on the socket too', () => {
  const closesWith = async (socket: ReturnType<typeof openSocket>, act: () => Promise<unknown>) => {
    const revoked = record(socket, 'session:revoked');
    const closed = nextDisconnect(socket);
    await act();
    const reason = await closed;
    return { reason, revoked: revoked.map((event) => sessionRevokedEventSchema.parse(event)) };
  };

  it('on revoking a session from Devices, leaving the other device connected', async () => {
    const grace = await signedIn(app(), 'grace@corremadvisory.com');
    const second = await signedIn(app(), 'grace@corremadvisory.com');
    const stays = await connect(url, grace.cookie);
    const goes = await connect(url, second.cookie);
    const result = await closesWith(goes, () =>
      app().inject({
        method: 'DELETE',
        url: `/v1/me/sessions/${second.sessionId}`,
        headers: headers(grace.cookie),
      }),
    );
    expect(result).toEqual({ reason: 'io server disconnect', revoked: [{ reason: 'revoked' }] });
    expect(stays.connected).toBe(true);
    // And it cannot come back.
    await expect(connect(url, second.cookie)).rejects.toMatchObject({
      data: { code: 'SESSION_EXPIRED' },
    });
  });

  it('on logout and on "sign out all other devices"', async () => {
    await signedIn(app(), 'heidi@corremadvisory.com');
    const second = await signedIn(app(), 'heidi@corremadvisory.com');
    const third = await signedIn(app(), 'heidi@corremadvisory.com');
    const other = await connect(url, second.cookie);
    const mine = await connect(url, third.cookie);
    expect(
      (
        await closesWith(other, () =>
          app().inject({
            method: 'POST',
            url: '/v1/me/sessions/revoke-others',
            headers: headers(third.cookie),
          }),
        )
      ).revoked,
    ).toEqual([{ reason: 'revoked' }]);
    const logout = await closesWith(mine, () =>
      app().inject({
        method: 'POST',
        url: '/v1/auth/logout',
        headers: headers(third.cookie),
        payload: {},
      }),
    );
    expect(logout.revoked).toEqual([{ reason: 'revoked' }]);
  });

  it('on deactivation, on every device, saying why', async () => {
    const admin = await signedIn(app(), 'admin@corremadvisory.com');
    const ivan = await signedIn(app(), 'ivan@corremadvisory.com');
    const socket = await connect(url, ivan.cookie);
    const result = await closesWith(socket, () =>
      app().inject({
        method: 'POST',
        url: `/v1/admin/users/${ivan.id}/deactivate`,
        headers: headers(admin.cookie),
      }),
    );
    expect(result.revoked[0]).toEqual({ reason: 'deactivated' });
    await expect(connect(url, ivan.cookie)).rejects.toMatchObject({
      data: { code: 'SESSION_EXPIRED' },
    });
  });

  it('at session expiry, by itself', async () => {
    const judy = await signedIn(app(), 'judy@corremadvisory.com');
    await registerAuthModels(app().mongo).AuthSession.updateOne(
      { _id: judy.sessionId },
      { $set: { expiresAt: new Date(Date.now() + 1500) } },
    );
    const socket = await connect(url, judy.cookie);
    const revoked = record(socket, 'session:revoked');
    expect(await nextDisconnect(socket)).toBe('io server disconnect');
    expect(revoked).toEqual([{ reason: 'expired' }]);
  });

  it('refuses an event if the session is gone but the push was missed', async () => {
    const kim = await signedIn(app(), 'kim@corremadvisory.com');
    const room = await getOrCreateDirectChat(app(), kim.id, bob.id);
    const socket = await connect(url, kim.cookie);
    await registerAuthModels(app().mongo).AuthSession.deleteOne({ _id: kim.sessionId });
    const closed = nextDisconnect(socket);
    const ack = await send(socket, room.id, 'too late');
    expect(!ack.ok && ack.error.code).toBe('SESSION_EXPIRED');
    await closed;
  });
});
