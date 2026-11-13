import {
  apiErrorSchema,
  DEFAULT_PUSH_SETTINGS,
  pushRemovedResponseSchema,
  pushSettingsResponseSchema,
  pushStateResponseSchema,
  pushTestResponseSchema,
} from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { headers } from '../../../test/auth-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { fakeSubscription, pushOutbox, subscribeDevice } from '../../../test/push-helpers.ts';
import {
  closeAllSockets,
  connect,
  listen,
  record,
  signedIn,
  waitUntil,
} from '../../../test/realtime-helpers.ts';
import { deviceLabel } from '../../push/subscriptions.service.ts';
import { isVapidPublicKey } from '../../push/vapid.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
let url: string;
const app = () => built.app;
let people = 0;
const person = () => {
  people += 1;
  return signedIn(app(), `push${people}@corremadvisory.com`);
};
type Person = Awaited<ReturnType<typeof person>>;

const call = (
  who: Person | null,
  method: 'GET' | 'PUT' | 'POST' | 'DELETE',
  path: string,
  payload?: object,
) =>
  app().inject({
    method,
    url: path,
    headers: headers(who?.cookie),
    ...(payload ? { payload } : {}),
  });
const state = async (who: Person) => {
  const response = await call(who, 'GET', '/v1/me/push');
  expect(response.statusCode).toBe(200);
  return pushStateResponseSchema.parse(response.json());
};

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
  url = await listen(app());
});
afterAll(async () => {
  closeAllSockets();
  await built.cleanup();
});

describe('GET /v1/me/push', () => {
  it('gives the public key, my settings and my devices', async () => {
    const asha = await person();
    const body = await state(asha);
    expect(body.publicKey && isVapidPublicKey(body.publicKey)).toBe(true);
    expect(body.settings).toEqual(DEFAULT_PUSH_SETTINGS);
    expect(body.devices).toEqual([]);
  });

  it('needs a session', async () => {
    const response = await call(null, 'GET', '/v1/me/push');
    expect(response.statusCode).toBe(401);
    expect(apiErrorSchema.parse(response.json()).code).toBe('UNAUTHENTICATED');
  });
});

describe('PUT/DELETE /v1/me/push/subscription', () => {
  it('registers this device once, however often it subscribes', async () => {
    const asha = await person();
    const { endpoint, device } = await subscribeDevice(app(), asha.cookie);
    expect(device.current).toBe(true);
    expect(device.lastUsedAt).toBeNull();
    await subscribeDevice(app(), asha.cookie, endpoint);
    expect((await state(asha)).devices).toEqual([device]);
  });

  it('keeps one subscription per device: a new endpoint replaces the old one', async () => {
    const asha = await person();
    await subscribeDevice(app(), asha.cookie);
    const { device } = await subscribeDevice(app(), asha.cookie);
    expect((await state(asha)).devices.map((d) => d.id)).toEqual([device.id]);
  });

  it('moves an endpoint to whoever signs in on that browser next', async () => {
    const asha = await person();
    const ben = await person();
    const { endpoint } = await subscribeDevice(app(), asha.cookie);
    await subscribeDevice(app(), ben.cookie, endpoint);
    expect((await state(asha)).devices).toEqual([]);
    expect((await state(ben)).devices).toHaveLength(1);
  });

  it('refuses http endpoints, bad keys and missing fields', async () => {
    const asha = await person();
    const bad = [
      { ...fakeSubscription(), endpoint: 'http://push.example.test/x' },
      { ...fakeSubscription(), keys: { p256dh: 'BOr5', auth: 'k3y' } },
      { endpoint: 'https://push.example.test/x' },
    ];
    for (const payload of bad) {
      const response = await call(asha, 'PUT', '/v1/me/push/subscription', payload);
      expect(response.statusCode).toBe(400);
    }
    expect((await state(asha)).devices).toEqual([]);
  });

  it('needs a session to subscribe or unsubscribe', async () => {
    expect(
      (await call(null, 'PUT', '/v1/me/push/subscription', fakeSubscription())).statusCode,
    ).toBe(401);
    expect(
      (await call(null, 'DELETE', '/v1/me/push/subscription', { endpoint: 'https://x.test/a' }))
        .statusCode,
    ).toBe(401);
  });

  it('unsubscribes only my own endpoint', async () => {
    const asha = await person();
    const ben = await person();
    const { endpoint } = await subscribeDevice(app(), ben.cookie);
    const theirs = await call(asha, 'DELETE', '/v1/me/push/subscription', { endpoint });
    expect(pushRemovedResponseSchema.parse(theirs.json())).toEqual({ removed: 0 });
    expect((await state(ben)).devices).toHaveLength(1);
    const mine = await call(ben, 'DELETE', '/v1/me/push/subscription', { endpoint });
    expect(pushRemovedResponseSchema.parse(mine.json())).toEqual({ removed: 1 });
    expect((await state(ben)).devices).toEqual([]);
  });
});

describe('DELETE /v1/me/push/devices/:id', () => {
  it('removes my device; someone else’s looks missing', async () => {
    const asha = await person();
    const ben = await person();
    const { device } = await subscribeDevice(app(), ben.cookie);
    const forbidden = await call(asha, 'DELETE', `/v1/me/push/devices/${device.id}`);
    expect(forbidden.statusCode).toBe(404);
    expect((await state(ben)).devices).toHaveLength(1);
    const removed = await call(ben, 'DELETE', `/v1/me/push/devices/${device.id}`);
    expect(pushRemovedResponseSchema.parse(removed.json())).toEqual({ removed: 1 });
    expect((await call(ben, 'DELETE', '/v1/me/push/devices/not-an-id')).statusCode).toBe(400);
    expect((await call(null, 'DELETE', `/v1/me/push/devices/${device.id}`)).statusCode).toBe(401);
  });
});

describe('PUT /v1/me/push/settings', () => {
  it('changes only what was sent and tells my other devices', async () => {
    const asha = await person();
    const socket = await connect(url, asha.cookie);
    const updates = record(socket, 'push:updated');
    const first = await call(asha, 'PUT', '/v1/me/push/settings', { sound: false });
    expect(pushSettingsResponseSchema.parse(first.json()).settings).toEqual({
      showPreview: true,
      sound: false,
    });
    const second = await call(asha, 'PUT', '/v1/me/push/settings', { showPreview: false });
    expect(second.json().settings).toEqual({ showPreview: false, sound: false });
    expect((await state(asha)).settings).toEqual({ showPreview: false, sound: false });
    await waitUntil(() => expect(updates).toHaveLength(2));
    expect(updates[1]).toEqual({ settings: { showPreview: false, sound: false } });
  });

  it('refuses values that are not true or false, and needs a session', async () => {
    const asha = await person();
    expect((await call(asha, 'PUT', '/v1/me/push/settings', { sound: 'loud' })).statusCode).toBe(
      400,
    );
    expect((await call(null, 'PUT', '/v1/me/push/settings', { sound: true })).statusCode).toBe(401);
  });
});

describe('POST /v1/me/push/test', () => {
  it('notifies this device only, and the test outbox shows it', async () => {
    const asha = await person();
    const phone = await signedIn(app(), asha.email);
    const { endpoint } = await subscribeDevice(app(), asha.cookie);
    await subscribeDevice(app(), phone.cookie);
    const response = await call(asha, 'POST', '/v1/me/push/test');
    expect(pushTestResponseSchema.parse(response.json())).toEqual({ sent: 1 });

    const outbox = await app().inject({
      method: 'GET',
      url: `/v1/test/push/outbox?email=${encodeURIComponent(asha.email)}`,
    });
    const pushes = outbox.json().pushes as Array<{ endpoint: string; payload: { kind: string } }>;
    expect(pushes.map((push) => [push.endpoint, push.payload.kind])).toEqual([[endpoint, 'test']]);
    expect((await state(asha)).devices.find((d) => d.current)?.lastUsedAt).not.toBeNull();
  });

  it('sends nothing to a device without push, and needs a session', async () => {
    const asha = await person();
    expect((await call(asha, 'POST', '/v1/me/push/test')).json()).toEqual({ sent: 0 });
    expect((await call(null, 'POST', '/v1/me/push/test')).statusCode).toBe(401);
  });

  it('clears the test outbox', async () => {
    const asha = await person();
    await subscribeDevice(app(), asha.cookie);
    await call(asha, 'POST', '/v1/me/push/test');
    const cleared = await app().inject({ method: 'DELETE', url: '/v1/test/push/outbox' });
    expect(cleared.json()).toEqual({ cleared: true });
    expect(pushOutbox(app()).sent).toEqual([]);
    const unknown = await app().inject({
      method: 'GET',
      url: '/v1/test/push/outbox?email=nobody@corremadvisory.com',
    });
    expect(unknown.statusCode).toBe(404);
  });
});

describe('device labels', () => {
  it('name the browser and system, or use the name given in Settings → Devices', () => {
    const chrome =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    expect(deviceLabel(chrome)).toBe('Chrome on Windows 10');
    expect(deviceLabel(chrome, 'Work laptop')).toBe('Work laptop');
    expect(deviceLabel(null)).toBe('Unknown browser on Unknown OS');
  });
});
