import {
  createStatusBodySchema,
  okResponseSchema,
  statusFeedResponseSchema,
  statusMuteParamsSchema,
  statusParamsSchema,
  statusPrivacyResponseSchema,
  statusPrivacySchema,
  statusResponseSchema,
  statusViewersResponseSchema,
  viewStatusBodySchema,
} from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { currentUserId, requireSession } from '../../auth/session.ts';
import { setStatusPrivacy, statusPrivacyOf } from '../../status/audience.ts';
import { createStatus, deleteStatus } from '../../status/status.service.ts';
import { setStatusMute, statusFeed, statusViewers, viewStatus } from '../../status/status-feed.ts';

/** Posting is rate limited per person on top of the 30-a-day limit; reading is generous. */
const POST_LIMIT = { rateLimit: { max: 10, timeWindow: '1 minute' } };
const ACTION_LIMIT = { rateLimit: { max: 300, timeWindow: '1 minute' } };

/** Statuses: 24-hour updates, to the people my status privacy names. */
export const statusRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireSession);

  app.get(
    '/statuses',
    {
      config: ACTION_LIMIT,
      schema: {
        tags: ['status'],
        summary: 'My statuses and everyone else’s I may see',
        response: { 200: statusFeedResponseSchema },
      },
    },
    (request) => statusFeed(app, currentUserId(request)),
  );

  app.post(
    '/statuses',
    {
      config: POST_LIMIT,
      schema: {
        tags: ['status'],
        summary: 'Post a status (text, or a finished photo or video upload)',
        body: createStatusBodySchema,
        response: { 200: statusResponseSchema },
      },
    },
    async (request) => ({
      status: await createStatus(app, currentUserId(request), request.body),
    }),
  );

  app.delete(
    '/statuses/:id',
    {
      config: ACTION_LIMIT,
      schema: {
        tags: ['status'],
        summary: 'Delete my status, for everyone',
        params: statusParamsSchema,
        response: { 200: okResponseSchema },
      },
    },
    async (request) => {
      await deleteStatus(app, currentUserId(request), request.params.id);
      return { ok: true as const };
    },
  );

  app.post(
    '/statuses/:id/view',
    {
      config: ACTION_LIMIT,
      schema: {
        tags: ['status'],
        summary: 'Seen, with an optional quick reaction',
        params: statusParamsSchema,
        body: viewStatusBodySchema,
        response: { 200: okResponseSchema },
      },
    },
    async (request) => {
      await viewStatus(app, currentUserId(request), request.params.id, request.body.reaction);
      return { ok: true as const };
    },
  );

  app.get(
    '/statuses/:id/viewers',
    {
      config: ACTION_LIMIT,
      schema: {
        tags: ['status'],
        summary: 'Who has seen my status (people sharing read receipts)',
        params: statusParamsSchema,
        response: { 200: statusViewersResponseSchema },
      },
    },
    (request) => statusViewers(app, currentUserId(request), request.params.id),
  );

  for (const [method, muted] of [
    ['put', true],
    ['delete', false],
  ] as const) {
    app[method](
      '/statuses/mutes/:userId',
      {
        config: ACTION_LIMIT,
        schema: {
          tags: ['status'],
          summary: muted ? 'Mute someone’s statuses' : 'Unmute someone’s statuses',
          params: statusMuteParamsSchema,
          response: { 200: okResponseSchema },
        },
      },
      async (request) => {
        await setStatusMute(app, currentUserId(request), request.params.userId, muted);
        return { ok: true as const };
      },
    );
  }

  app.get(
    '/me/status-privacy',
    {
      schema: {
        tags: ['status'],
        summary: 'Who sees my statuses',
        response: { 200: statusPrivacyResponseSchema },
      },
    },
    async (request) => ({ privacy: await statusPrivacyOf(app, currentUserId(request)) }),
  );

  app.put(
    '/me/status-privacy',
    {
      config: ACTION_LIMIT,
      schema: {
        tags: ['status'],
        summary: 'Change who sees the statuses I post from now on',
        body: statusPrivacySchema,
        response: { 200: statusPrivacyResponseSchema },
      },
    },
    async (request) => ({
      privacy: await setStatusPrivacy(app, currentUserId(request), request.body),
    }),
  );
};
