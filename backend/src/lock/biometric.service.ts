import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { brand } from '@zuvo/config';
import type { FastifyInstance } from 'fastify';
import type { LockChallenge, LockCredentialDoc } from '../db/lock-models.ts';
import { AppError } from '../lib/errors.ts';
import { requireUser } from '../users/users.service.ts';
import { recordCorrect } from './attempts.ts';
import {
  announceLock,
  assertPinRate,
  ensureLock,
  loadLock,
  lockClock,
  lockModels,
  userOid,
} from './lock-store.ts';
import {
  BIOMETRIC_MAX,
  CHALLENGE_TTL_MS,
  RECENT_PIN_MS,
  webAuthnConfig,
} from './webauthn-config.ts';

type WebAuthnJson = Record<string, unknown>;

const notVerified = () =>
  new AppError('FORBIDDEN', 'This device could not be verified. Use your PIN instead.');

async function myCredentials(app: FastifyInstance, userId: string) {
  return (await lockModels(app)
    .LockCredential.find({ userId: userOid(userId) })
    .sort({ createdAt: 1 })
    .lean()) as LockCredentialDoc[];
}

const descriptorOf = (credential: LockCredentialDoc) => ({
  id: credential.credentialId,
  transports: credential.transports as AuthenticatorTransport[],
});

async function saveChallenge(
  app: FastifyInstance,
  userId: string,
  purpose: LockChallenge['purpose'],
  value: string,
) {
  await ensureLock(app, userId);
  const challenge: LockChallenge = {
    value,
    purpose,
    expiresAt: new Date(lockClock.now().getTime() + CHALLENGE_TTL_MS),
  };
  await lockModels(app).Lock.updateOne({ _id: userOid(userId) }, { $set: { challenge } });
}

/** Takes the pending challenge (once): a replayed or late answer finds none. */
async function takeChallenge(
  app: FastifyInstance,
  userId: string,
  purpose: LockChallenge['purpose'],
) {
  const before = await lockModels(app)
    .Lock.findOneAndUpdate(
      {
        _id: userOid(userId),
        'challenge.purpose': purpose,
        'challenge.expiresAt': { $gt: lockClock.now() },
      },
      { $set: { challenge: null } },
      { returnDocument: 'before' },
    )
    .lean();
  if (!before?.challenge) throw new AppError('BAD_REQUEST', 'This took too long. Try again.');
  return before.challenge.value;
}

/** A device may be added only with a PIN set and entered in the last 5 minutes. */
async function assertRecentPin(app: FastifyInstance, userId: string) {
  const doc = await loadLock(app, userId);
  if (!doc?.pinHash) throw new AppError('PIN_NOT_SET', 'Set a PIN first.');
  const verifiedAt = doc.lastVerifiedAt ? new Date(doc.lastVerifiedAt).getTime() : 0;
  if (lockClock.now().getTime() - verifiedAt > RECENT_PIN_MS) {
    throw new AppError('FORBIDDEN', 'Enter your PIN first.');
  }
}

export async function biometricRegisterOptions(app: FastifyInstance, userId: string) {
  await assertRecentPin(app, userId);
  const credentials = await myCredentials(app, userId);
  if (credentials.length >= BIOMETRIC_MAX) {
    throw new AppError('CONFLICT', `At most ${BIOMETRIC_MAX} devices can unlock.`);
  }
  const user = await requireUser(app, userId);
  const { rpID } = webAuthnConfig(app.env);
  const options = await generateRegistrationOptions({
    rpName: brand.name,
    rpID,
    userName: user.email,
    userDisplayName: user.displayName ?? user.email,
    userID: new TextEncoder().encode(userId),
    attestationType: 'none',
    excludeCredentials: credentials.map(descriptorOf),
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'required',
      residentKey: 'discouraged',
    },
  });
  await saveChallenge(app, userId, 'register', options.challenge);
  return { options: options as unknown as WebAuthnJson };
}

export async function biometricRegisterVerify(
  app: FastifyInstance,
  userId: string,
  response: WebAuthnJson,
) {
  const expectedChallenge = await takeChallenge(app, userId, 'register');
  await assertRecentPin(app, userId);
  const { rpID, expectedOrigin } = webAuthnConfig(app.env);
  const verification = await verifyRegistrationResponse({
    response: response as unknown as RegistrationResponseJSON,
    expectedChallenge,
    expectedOrigin,
    expectedRPID: rpID,
    requireUserVerification: true,
  }).catch(() => null);
  if (!verification?.verified) throw notVerified();
  const { credential } = verification.registrationInfo;
  try {
    await lockModels(app).LockCredential.create({
      userId: userOid(userId),
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: credential.transports ?? [],
    });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
      throw new AppError('CONFLICT', 'This device can already unlock.');
    }
    throw error;
  }
  return announceLock(app, userId);
}

export async function biometricUnlockOptions(app: FastifyInstance, userId: string) {
  if (!(await loadLock(app, userId))?.pinHash)
    throw new AppError('PIN_NOT_SET', 'Set a PIN first.');
  const credentials = await myCredentials(app, userId);
  if (credentials.length === 0) {
    throw new AppError('CONFLICT', 'No device can unlock yet. Use your PIN.');
  }
  const options = await generateAuthenticationOptions({
    rpID: webAuthnConfig(app.env).rpID,
    allowCredentials: credentials.map(descriptorOf),
    userVerification: 'required',
  });
  await saveChallenge(app, userId, 'unlock', options.challenge);
  return { options: options as unknown as WebAuthnJson };
}

/** A verified fingerprint counts as a correct PIN: the count and any lockout are cleared. */
export async function biometricUnlockVerify(
  app: FastifyInstance,
  userId: string,
  response: WebAuthnJson,
) {
  await assertPinRate(app, userId);
  const expectedChallenge = await takeChallenge(app, userId, 'unlock');
  const credentialId = typeof response.id === 'string' ? response.id : '';
  const { LockCredential } = lockModels(app);
  const stored = (await LockCredential.findOne({
    credentialId,
    userId: userOid(userId),
  }).lean()) as LockCredentialDoc | null;
  if (!stored) throw notVerified();
  const { rpID, expectedOrigin } = webAuthnConfig(app.env);
  const verification = await verifyAuthenticationResponse({
    response: response as unknown as AuthenticationResponseJSON,
    expectedChallenge,
    expectedOrigin,
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: {
      id: stored.credentialId,
      publicKey: new Uint8Array(Buffer.from(stored.publicKey, 'base64url')),
      counter: stored.counter,
      transports: stored.transports as AuthenticatorTransport[],
    },
  }).catch(() => null);
  if (!verification?.verified) throw notVerified();
  await LockCredential.updateOne(
    { _id: stored._id },
    { $set: { counter: verification.authenticationInfo.newCounter } },
  );
  await recordCorrect(app, userId, true);
  return announceLock(app, userId);
}

export async function removeBiometrics(app: FastifyInstance, userId: string) {
  await lockModels(app).LockCredential.deleteMany({ userId: userOid(userId) });
  return announceLock(app, userId);
}
