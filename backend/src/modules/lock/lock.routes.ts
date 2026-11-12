import {
  biometricOptionsResponseSchema,
  biometricVerifyBodySchema,
  chatLockBodySchema,
  chatParamsSchema,
  chatResponseSchema,
  lockSettingsBodySchema,
  lockStatusResponseSchema,
  resetPinBodySchema,
  resetPinRequestResponseSchema,
  setPinBodySchema,
  verifyPinBodySchema,
} from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { currentUserId, requireSession } from '../../auth/session.ts';
import {
  biometricRegisterOptions,
  biometricRegisterVerify,
  biometricUnlockOptions,
  biometricUnlockVerify,
  removeBiometrics,
} from '../../lock/biometric.service.ts';
import {
  removePin,
  setChatLock,
  setPin,
  updateLockSettings,
  verifyLockPin,
} from '../../lock/lock.service.ts';
import { lockStatus } from '../../lock/lock-store.ts';
import { confirmPinReset, requestPinReset } from '../../lock/reset.service.ts';

// Per network (an office shares one address); the real limit is per person (PIN_RATE_LIMIT).
const LIMIT = { rateLimit: { max: 120, timeWindow: '1 minute' } };
const tags = ['lock'];
const status = { 200: lockStatusResponseSchema };
const options = { 200: biometricOptionsResponseSchema };

/** Chat lock and app lock: my PIN (argon2id hash only), devices that unlock, and "Forgot PIN". */
export const lockRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireSession);
  const me = currentUserId;

  app.get('/me/lock', { schema: { tags, response: status } }, async (request) => ({
    lock: await lockStatus(app, me(request)),
  }));

  app.put(
    '/me/lock/pin',
    {
      config: LIMIT,
      schema: { tags, summary: 'Set or change my PIN', body: setPinBodySchema, response: status },
    },
    async (request) => ({ lock: await setPin(app, me(request), request.body) }),
  );

  app.delete(
    '/me/lock/pin',
    {
      config: LIMIT,
      schema: { tags, summary: 'Remove my PIN', body: verifyPinBodySchema, response: status },
    },
    async (request) => ({ lock: await removePin(app, me(request), request.body.pin) }),
  );

  app.post(
    '/me/lock/verify',
    { config: LIMIT, schema: { tags, body: verifyPinBodySchema, response: status } },
    async (request) => ({ lock: await verifyLockPin(app, me(request), request.body.pin) }),
  );

  app.patch(
    '/me/lock/settings',
    { schema: { tags, body: lockSettingsBodySchema, response: status } },
    async (request) => ({
      lock: await updateLockSettings(app, me(request), request.body.appLock),
    }),
  );

  app.put(
    '/chats/:id/lock',
    {
      config: LIMIT,
      schema: {
        tags,
        summary: 'Lock or unlock one of my chats (for me only)',
        params: chatParamsSchema,
        body: chatLockBodySchema,
        response: { 200: chatResponseSchema },
      },
    },
    async (request) => ({
      chat: await setChatLock(app, me(request), request.params.id, request.body.locked),
    }),
  );

  app.post(
    '/me/lock/reset/request',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags,
        summary: 'Forgot PIN: email a code to my account email',
        response: { 200: resetPinRequestResponseSchema },
      },
    },
    async (request) => requestPinReset(app, me(request)),
  );

  app.post(
    '/me/lock/reset/verify',
    { config: LIMIT, schema: { tags, body: resetPinBodySchema, response: status } },
    async (request) => ({ lock: await confirmPinReset(app, me(request), request.body.code) }),
  );

  app.post(
    '/me/lock/biometric/register/options',
    { config: LIMIT, schema: { tags, response: options } },
    async (request) => biometricRegisterOptions(app, me(request)),
  );

  app.post(
    '/me/lock/biometric/register/verify',
    { config: LIMIT, schema: { tags, body: biometricVerifyBodySchema, response: status } },
    async (request) => ({
      lock: await biometricRegisterVerify(app, me(request), request.body.response),
    }),
  );

  app.post(
    '/me/lock/biometric/unlock/options',
    { config: LIMIT, schema: { tags, response: options } },
    async (request) => biometricUnlockOptions(app, me(request)),
  );

  app.post(
    '/me/lock/biometric/unlock/verify',
    { config: LIMIT, schema: { tags, body: biometricVerifyBodySchema, response: status } },
    async (request) => ({
      lock: await biometricUnlockVerify(app, me(request), request.body.response),
    }),
  );

  app.delete('/me/lock/biometric', { schema: { tags, response: status } }, async (request) => ({
    lock: await removeBiometrics(app, me(request)),
  }));
};
