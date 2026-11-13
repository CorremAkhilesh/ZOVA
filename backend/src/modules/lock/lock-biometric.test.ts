import { biometricOptionsResponseSchema, lockStatusResponseSchema } from '@zuvo/protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { lockClock } from '../../lock/lock-store.ts';

// No real authenticator here: the library's own checks are replaced, the rest is real.
const verifyRegistrationResponse = vi.fn();
const verifyAuthenticationResponse = vi.fn();
vi.mock('@simplewebauthn/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@simplewebauthn/server')>()),
  verifyRegistrationResponse: (...args: unknown[]) => verifyRegistrationResponse(...args),
  verifyAuthenticationResponse: (...args: unknown[]) => verifyAuthenticationResponse(...args),
}));

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
});
afterEach(() => {
  vi.restoreAllMocks();
  verifyRegistrationResponse.mockReset();
  verifyAuthenticationResponse.mockReset();
});
afterAll(async () => {
  await built.cleanup();
});

const post = (who: Person | null, path: string, payload?: object) =>
  call(who, 'POST', `/v1/me/lock/biometric/${path}`, payload);
const registered = (id: string) => ({
  verified: true,
  registrationInfo: {
    credential: { id, publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'] },
  },
});
const answer = (id: string) => ({ response: { id, rawId: id, type: 'public-key', response: {} } });

async function withPin() {
  const who = await person();
  expect((await call(who, 'PUT', '/v1/me/lock/pin', { pin: '1234' })).statusCode).toBe(200);
  return who;
}

async function register(who: Person, id: string) {
  const started = await post(who, 'register/options');
  expect(started.statusCode).toBe(200);
  verifyRegistrationResponse.mockResolvedValueOnce(registered(id));
  return post(who, 'register/verify', answer(id));
}

describe('adding a device', () => {
  it('needs a PIN set and entered in the last 5 minutes', async () => {
    const asha = await person();
    expect((await post(asha, 'register/options')).json().code).toBe('PIN_NOT_SET');
    await call(asha, 'PUT', '/v1/me/lock/pin', { pin: '1234' });
    vi.spyOn(lockClock, 'now').mockReturnValue(new Date(Date.now() + 6 * 60_000));
    const stale = await post(asha, 'register/options');
    expect(stale.statusCode).toBe(403);
    vi.restoreAllMocks();
    const options = await post(asha, 'register/options');
    const parsed = biometricOptionsResponseSchema.parse(options.json()).options;
    expect(parsed).toMatchObject({
      rp: { id: 'localhost' },
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
    });
  });

  it('stores a verified credential and counts it', async () => {
    const asha = await withPin();
    const done = await register(asha, 'cred-asha-1');
    expect(done.statusCode).toBe(200);
    expect(lockStatusResponseSchema.parse(done.json()).lock.biometricCount).toBe(1);
    const [call0] = verifyRegistrationResponse.mock.calls[0] as [Record<string, unknown>];
    expect(call0).toMatchObject({
      expectedRPID: 'localhost',
      expectedOrigin: ['http://localhost:5173'],
      requireUserVerification: true,
    });
    expect((await register(asha, 'cred-asha-1')).statusCode).toBe(409);
  });

  it('refuses an unverified answer, a replay and an answer without options', async () => {
    const asha = await withPin();
    expect((await post(asha, 'register/verify', answer('x'))).statusCode).toBe(400);
    await post(asha, 'register/options');
    verifyRegistrationResponse.mockResolvedValueOnce({ verified: false });
    expect((await post(asha, 'register/verify', answer('x'))).statusCode).toBe(403);
    // The challenge was used up by that answer.
    expect((await post(asha, 'register/verify', answer('x'))).statusCode).toBe(400);
    await post(asha, 'register/options');
    verifyRegistrationResponse.mockRejectedValueOnce(new Error('bad attestation'));
    expect((await post(asha, 'register/verify', answer('x'))).statusCode).toBe(403);
    expect((await post(asha, 'register/verify', { response: 'nope' })).statusCode).toBe(400);
  });
});

describe('unlocking with a device', () => {
  it('needs a device; success counts as a correct PIN and clears a lockout', async () => {
    const asha = await withPin();
    expect((await post(asha, 'unlock/options')).statusCode).toBe(409);
    await register(asha, 'cred-unlock-1');
    for (let i = 0; i < 5; i++) await call(asha, 'POST', '/v1/me/lock/verify', { pin: '0000' });
    const options = await post(asha, 'unlock/options');
    expect(options.json().options).toMatchObject({
      userVerification: 'required',
      allowCredentials: [{ id: 'cred-unlock-1' }],
    });
    verifyAuthenticationResponse.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 7 },
    });
    const unlocked = await post(asha, 'unlock/verify', answer('cred-unlock-1'));
    expect(unlocked.statusCode).toBe(200);
    expect(unlocked.json().lock).toMatchObject({ lockedUntil: null, attemptsLeft: 5 });
  });

  it("refuses a failed check and someone else's credential", async () => {
    const [asha, bharat] = [await withPin(), await withPin()];
    await register(asha, 'cred-a');
    await register(bharat, 'cred-b');
    await post(asha, 'unlock/options');
    expect((await post(asha, 'unlock/verify', answer('cred-b'))).statusCode).toBe(403);
    expect(verifyAuthenticationResponse).not.toHaveBeenCalled();
    await post(asha, 'unlock/options');
    verifyAuthenticationResponse.mockResolvedValueOnce({ verified: false, authenticationInfo: {} });
    expect((await post(asha, 'unlock/verify', answer('cred-a'))).statusCode).toBe(403);
    expect((await post(asha, 'unlock/verify', answer('cred-a'))).statusCode).toBe(400);
  });

  it('removing devices is mine alone', async () => {
    const [asha, bharat] = [await withPin(), await withPin()];
    await register(asha, 'cred-rm-a');
    await register(bharat, 'cred-rm-b');
    const removed = await call(asha, 'DELETE', '/v1/me/lock/biometric');
    expect(removed.json().lock.biometricCount).toBe(0);
    expect((await call(bharat, 'GET', '/v1/me/lock')).json().lock.biometricCount).toBe(1);
  });

  it('removing the PIN removes the devices too', async () => {
    const asha = await withPin();
    await register(asha, 'cred-pin-gone');
    const removed = await call(asha, 'DELETE', '/v1/me/lock/pin', { pin: '1234' });
    expect(removed.json().lock).toMatchObject({ pinSet: false, biometricCount: 0 });
    expect((await post(asha, 'unlock/options')).json().code).toBe('PIN_NOT_SET');
  });
});
