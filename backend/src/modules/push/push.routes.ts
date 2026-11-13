import {
  objectIdSchema,
  pushRemovedResponseSchema,
  pushSettingsResponseSchema,
  pushStateResponseSchema,
  pushSubscribeResponseSchema,
  pushSubscriptionBodySchema,
  pushTestResponseSchema,
  pushUnsubscribeBodySchema,
  updatePushSettingsBodySchema,
} from '@zuvo/protocol';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { currentUserId, requireSession } from '../../auth/session.ts';
import { AppError } from '../../lib/errors.ts';
import { buildTestPayload } from '../../push/content.ts';
import { deliverToDevices, liveDevices } from '../../push/devices.ts';
import { pushSettingsFor, updatePushSettings } from '../../push/settings.service.ts';
import { toPushLanguage } from '../../push/strings.ts';
import {
  listPushDevices,
  removePushDevice,
  subscribe,
  unsubscribe,
} from '../../push/subscriptions.service.ts';

const tags = ['push'];
const deviceParamsSchema = z.object({ id: objectIdSchema });

const sessionOf = (request: FastifyRequest) => {
  if (!request.auth) throw new AppError('UNAUTHENTICATED', 'Please sign in.');
  return request.auth.session;
};

/** Settings → Notifications: this device's subscription, my devices, and my settings. */
export const pushRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireSession);

  app.get(
    '/me/push',
    { schema: { tags, response: { 200: pushStateResponseSchema } } },
    async (request) => {
      const userId = currentUserId(request);
      return {
        publicKey: app.push.publicKey,
        settings: await pushSettingsFor(app.mongo, userId),
        devices: await listPushDevices(app, userId, sessionOf(request).id),
      };
    },
  );

  app.put(
    '/me/push/subscription',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags,
        summary: "Turn push on for this device (the browser's PushSubscription)",
        body: pushSubscriptionBodySchema,
        response: { 200: pushSubscribeResponseSchema },
      },
    },
    async (request) => {
      if (!app.push.publicKey) {
        throw new AppError('SERVICE_UNAVAILABLE', 'Notifications are not set up on this server.');
      }
      const device = await subscribe(app, currentUserId(request), sessionOf(request), request.body);
      return { device };
    },
  );

  app.delete(
    '/me/push/subscription',
    {
      schema: {
        tags,
        summary: 'Turn push off for this browser',
        body: pushUnsubscribeBodySchema,
        response: { 200: pushRemovedResponseSchema },
      },
    },
    async (request) => ({
      removed: await unsubscribe(app, currentUserId(request), request.body.endpoint),
    }),
  );

  app.delete(
    '/me/push/devices/:id',
    {
      schema: {
        tags,
        summary: 'Stop pushes to one of my devices',
        params: deviceParamsSchema,
        response: { 200: pushRemovedResponseSchema },
      },
    },
    async (request) => ({
      removed: await removePushDevice(app, currentUserId(request), request.params.id),
    }),
  );

  app.put(
    '/me/push/settings',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags,
        summary: 'Change my notification settings (only what is sent)',
        body: updatePushSettingsBodySchema,
        response: { 200: pushSettingsResponseSchema },
      },
    },
    async (request) => ({
      settings: await updatePushSettings(app, currentUserId(request), request.body),
    }),
  );

  app.post(
    '/me/push/test',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        tags,
        summary: 'A test notification to this device',
        response: { 200: pushTestResponseSchema },
      },
    },
    async (request) => {
      const { sender } = app.push;
      if (!sender) return { sent: 0 };
      const userId = currentUserId(request);
      const devices = await liveDevices(app.push.context(), userId, {
        sessionId: sessionOf(request).id,
      });
      if (devices.length === 0) return { sent: 0 };
      const settings = await pushSettingsFor(app.mongo, userId);
      const language = toPushLanguage(
        (request.auth?.record as { language?: unknown } | undefined)?.language,
      );
      const payload = buildTestPayload(settings, language, new Date());
      const result = await deliverToDevices(
        { mongo: app.mongo, log: request.log, sender },
        devices,
        payload,
        {
          ttlSeconds: 60,
          urgency: 'high',
        },
      );
      request.log.info({ userId, devices: result.delivered }, 'push test sent');
      return { sent: result.delivered };
    },
  );
};
