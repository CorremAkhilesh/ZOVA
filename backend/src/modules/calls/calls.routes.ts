import {
  activeCallResponseSchema,
  callAccessResponseSchema,
  callLogQuerySchema,
  callLogResponseSchema,
  iceResponseSchema,
} from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { currentUserId, requireSession } from '../../auth/session.ts';
import { callsAllowedFor } from '../../calls/access.ts';
import { listCalls } from '../../calls/call-log.ts';
import { activeCall } from '../../calls/calls.service.ts';
import { iceServersFor } from '../../calls/ice.ts';
import { AppError } from '../../lib/errors.ts';

const READ_LIMIT = { rateLimit: { max: 120, timeWindow: '1 minute' } };
/** TURN credentials: a few per call (both people, a retry); never a stream of them. */
const ICE_LIMIT = { rateLimit: { max: 30, timeWindow: '1 minute' } };

/** Calls: who may call, the ICE servers for a call, my ringing call and my call history. */
export const callsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireSession);

  app.get(
    '/calls/access',
    {
      config: READ_LIMIT,
      schema: {
        tags: ['calls'],
        summary: 'Whether I may make calls',
        response: { 200: callAccessResponseSchema },
      },
    },
    async (request) => ({ enabled: await callsAllowedFor(app, currentUserId(request)) }),
  );

  app.get(
    '/calls/ice',
    {
      config: ICE_LIMIT,
      schema: {
        tags: ['calls'],
        summary: 'STUN and TURN servers for a call (TURN credentials expire)',
        response: { 200: iceResponseSchema },
      },
    },
    async (request, reply) => {
      const userId = currentUserId(request);
      if (!(await callsAllowedFor(app, userId))) {
        throw new AppError('CALLS_UNAVAILABLE', 'Calls are not available for your account yet.');
      }
      void reply.header('cache-control', 'no-store');
      return iceServersFor(app.env, userId);
    },
  );

  app.get(
    '/calls/active',
    {
      config: READ_LIMIT,
      schema: {
        tags: ['calls'],
        summary: 'The call ringing for me, or the one I am in',
        response: { 200: activeCallResponseSchema },
      },
    },
    async (request) => ({ call: await activeCall(app, currentUserId(request)) }),
  );

  app.get(
    '/calls',
    {
      config: READ_LIMIT,
      schema: {
        tags: ['calls'],
        summary: 'My call history, newest first',
        querystring: callLogQuerySchema,
        response: { 200: callLogResponseSchema },
      },
    },
    (request) => listCalls(app, currentUserId(request), request.query),
  );
};
