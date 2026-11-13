import type { LockStatus } from '@zuvo/protocol';
import { HttpResponse, http, server } from '@/test/msw';

/** Test-only: the lock API kept in memory, recording what the app sends. */
export interface LockServer {
  status: LockStatus;
  /** The PIN the server knows; null when none is set. */
  pin: string | null;
  requests: Array<{ method: string; path: string; body: unknown }>;
}

export const lockStatusFixture = (overrides: Partial<LockStatus> = {}): LockStatus => ({
  pinSet: false,
  appLock: { enabled: false, idleMinutes: 5 },
  lockedUntil: null,
  attemptsLeft: 5,
  biometricCount: 0,
  ...overrides,
});

const fail = (status: number, code: string, details?: Record<string, unknown>) =>
  HttpResponse.json(
    { code, message: code, requestId: 'r', ...(details ? { details } : {}) },
    { status },
  );

export function serveLock(pin: string | null, overrides: Partial<LockStatus> = {}): LockServer {
  const state: LockServer = {
    pin,
    status: lockStatusFixture({ pinSet: pin !== null, ...overrides }),
    requests: [],
  };
  const record = async (request: Request) => {
    const text = await request.text();
    const body = text ? (JSON.parse(text) as Record<string, string>) : null;
    state.requests.push({ method: request.method, path: new URL(request.url).pathname, body });
    return body ?? {};
  };
  const ok = () => HttpResponse.json({ lock: state.status });
  const check = (given: string | undefined) => {
    if (state.pin === null) return fail(409, 'PIN_NOT_SET');
    if (given === state.pin) {
      state.status = { ...state.status, attemptsLeft: 5 };
      return null;
    }
    const attemptsLeft = Math.max(0, state.status.attemptsLeft - 1);
    state.status = { ...state.status, attemptsLeft };
    if (attemptsLeft === 0) {
      const lockedUntil = new Date(Date.now() + 60_000).toISOString();
      state.status = { ...state.status, lockedUntil };
      return fail(429, 'PIN_LOCKED_OUT', { lockedUntil });
    }
    return fail(403, 'PIN_INVALID', { attemptsLeft });
  };
  const setPin = (next: string | null) => {
    state.pin = next;
    state.status = {
      ...state.status,
      pinSet: next !== null,
      ...(next === null ? { appLock: { ...state.status.appLock, enabled: false } } : {}),
    };
  };

  server.use(
    http.get('*/v1/me/lock', () => ok()),
    http.put('*/v1/me/lock/pin', async ({ request }) => {
      const body = await record(request);
      if (state.pin !== null) {
        const wrong = check(body.currentPin);
        if (wrong) return wrong;
      }
      setPin(body.pin ?? null);
      return ok();
    }),
    http.delete('*/v1/me/lock/pin', async ({ request }) => {
      const wrong = check((await record(request)).pin);
      if (wrong) return wrong;
      setPin(null);
      return ok();
    }),
    http.post('*/v1/me/lock/verify', async ({ request }) => {
      return check((await record(request)).pin) ?? ok();
    }),
    http.patch('*/v1/me/lock/settings', async ({ request }) => {
      const body = (await record(request)) as unknown as Pick<LockStatus, 'appLock'>;
      state.status = { ...state.status, appLock: body.appLock };
      return ok();
    }),
    http.put('*/v1/chats/:id/lock', async ({ request }) => {
      await record(request);
      return state.pin === null ? fail(409, 'PIN_NOT_SET') : HttpResponse.json({ ok: true });
    }),
    http.post('*/v1/me/lock/reset/request', async ({ request }) => {
      await record(request);
      return HttpResponse.json({ sent: true });
    }),
    http.post('*/v1/me/lock/reset/verify', async ({ request }) => {
      const body = await record(request);
      if (body.code !== '123456') return fail(400, 'OTP_INVALID', { attemptsRemaining: 4 });
      setPin(null);
      return ok();
    }),
  );
  return state;
}
