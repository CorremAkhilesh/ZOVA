import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { headers } from '../../../test/auth-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { flushPushes, pushesTo, subscribeDevice } from '../../../test/push-helpers.ts';
import { signedIn, uuidv7 } from '../../../test/realtime-helpers.ts';
import { getOrCreateDirectChat, oid } from '../../chats/chats.service.ts';
import { sendMessage } from '../../chats/messages.service.ts';
import { registerAuthModels } from '../../db/auth-models.ts';
import { pushModels } from '../../push/subscriptions.service.ts';
import { createRevokeToken } from '../../security/security-tokens.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
let seed = 0;

/** One person on two devices, both with push on. */
async function twoDevices() {
  seed += 1;
  const email = `life${seed}@corremadvisory.com`;
  const laptop = await signedIn(app(), email);
  const phone = await signedIn(app(), email);
  await subscribeDevice(app(), laptop.cookie);
  await subscribeDevice(app(), phone.cookie);
  return { laptop, phone };
}

const subscriptionsOf = async (userId: string) =>
  (
    await pushModels(app().mongo)
      .PushSubscription.find({ userId: oid(userId) })
      .lean()
  ).map((doc) => doc.sessionId);

const send = (cookie: string, method: 'POST' | 'DELETE', path: string, payload?: object) =>
  app().inject({ method, url: path, headers: headers(cookie), ...(payload ? { payload } : {}) });

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
});
afterAll(async () => {
  await built.cleanup();
});

describe('a subscription ends with its session', () => {
  it('on sign-out', async () => {
    const { laptop, phone } = await twoDevices();
    expect((await send(laptop.cookie, 'POST', '/v1/auth/logout', {})).statusCode).toBe(200);
    await expect.poll(() => subscriptionsOf(laptop.id)).toEqual([phone.sessionId]);
  });

  it('when one device is revoked, or all the others', async () => {
    const { laptop, phone } = await twoDevices();
    const third = await signedIn(app(), laptop.email);
    await subscribeDevice(app(), third.cookie);
    await send(laptop.cookie, 'DELETE', `/v1/me/sessions/${phone.sessionId}`);
    await expect
      .poll(async () => (await subscriptionsOf(laptop.id)).sort())
      .toEqual([laptop.sessionId, third.sessionId].sort());
    await send(laptop.cookie, 'POST', '/v1/me/sessions/revoke-others', {});
    await expect.poll(() => subscriptionsOf(laptop.id)).toEqual([laptop.sessionId]);
  });

  it('with "This wasn’t me"', async () => {
    const { laptop } = await twoDevices();
    const token = await createRevokeToken(app(), laptop.id);
    const response = await app().inject({
      method: 'POST',
      url: '/v1/auth/not-me',
      headers: headers(),
      payload: { token },
    });
    expect(response.statusCode).toBe(200);
    expect(await subscriptionsOf(laptop.id)).toEqual([]);
  });

  it('when an admin deactivates the account', async () => {
    const { laptop } = await twoDevices();
    const admin = await signedIn(app(), 'admin@corremadvisory.com');
    const response = await send(
      admin.cookie,
      'POST',
      `/v1/admin/users/${laptop.id}/deactivate`,
      {},
    );
    expect(response.statusCode).toBe(200);
    expect(await subscriptionsOf(laptop.id)).toEqual([]);
  });

  it('when the session expires: nothing is sent to it, and it is removed', async () => {
    const { laptop, phone } = await twoDevices();
    const writer = await signedIn(app(), `life-writer${seed}@corremadvisory.com`);
    const chat = await getOrCreateDirectChat(app(), writer.id, laptop.id);
    await registerAuthModels(app().mongo).AuthSession.updateOne(
      { _id: oid(phone.sessionId) },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    await sendMessage(app(), {
      userId: writer.id,
      chatId: chat.id,
      clientMsgId: uuidv7(),
      text: 'hi',
    });
    await flushPushes(app());
    expect(pushesTo(app(), laptop.id).map((push) => push.sessionId)).toEqual([laptop.sessionId]);
    expect(await subscriptionsOf(laptop.id)).toEqual([laptop.sessionId]);
  });

  it('expires with the session in MongoDB (TTL index on the session expiry)', async () => {
    const { laptop } = await twoDevices();
    const doc = await pushModels(app().mongo)
      .PushSubscription.findOne({ sessionId: laptop.sessionId })
      .lean();
    const session = await registerAuthModels(app().mongo)
      .AuthSession.findById(oid(laptop.sessionId))
      .lean();
    expect(doc?.expiresAt.getTime()).toBe(new Date(session?.expiresAt as Date).getTime());
  });
});
