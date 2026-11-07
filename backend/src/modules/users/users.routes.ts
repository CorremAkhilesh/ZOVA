import {
  normalizeUsername,
  publicProfileResponseSchema,
  usernameAvailabilityQuerySchema,
  usernameAvailabilityResponseSchema,
  userParamsSchema,
  userSearchQuerySchema,
  userSearchResponseSchema,
} from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { currentUserId, requireSession } from '../../auth/session.ts';
import { AppError } from '../../lib/errors.ts';
import { blockersAmong } from '../../moderation/blocks.service.ts';
import { privacyOf, toPublicProfile } from '../../users/user-record.ts';
import { requireUser, searchUsers, usernameAvailability } from '../../users/users.service.ts';

/** Other people: search, public profiles, username availability and profile photos. */
export const usersRoutes: FastifyPluginAsyncZod = async (app) => {
  // onRequest: authentication is decided before any body is parsed or validated (401 before 400).
  app.addHook('onRequest', requireSession);

  app.get(
    '/users/search',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['users'],
        summary: 'Find active colleagues by name or username prefix, or exact email',
        querystring: userSearchQuerySchema,
        response: { 200: userSearchResponseSchema },
      },
    },
    async (request) =>
      searchUsers(app, {
        viewerId: currentUserId(request),
        q: request.query.q,
        cursor: request.query.cursor,
        limit: request.query.limit,
      }),
  );

  app.get(
    '/users/username-availability',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['users'],
        querystring: usernameAvailabilityQuerySchema,
        response: { 200: usernameAvailabilityResponseSchema },
      },
    },
    async (request) =>
      usernameAvailability(app, normalizeUsername(request.query.username), currentUserId(request)),
  );

  app.get(
    '/users/:id',
    {
      schema: {
        tags: ['users'],
        params: userParamsSchema,
        response: { 200: publicProfileResponseSchema },
      },
    },
    async (request) => {
      const viewer = currentUserId(request);
      const user = await requireUser(app, request.params.id);
      const blockers = await blockersAmong(app, viewer, [user._id]);
      return {
        user: toPublicProfile(user, viewer, { blockedViewer: blockers.size > 0 }),
      };
    },
  );

  app.get(
    '/users/:id/avatar',
    {
      schema: {
        tags: ['users'],
        summary: 'Profile photo (signed-in users only; private cache)',
        params: userParamsSchema,
        querystring: z.object({
          size: z.enum(['small', 'large']).default('small'),
          v: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(app, request.params.id);
      const viewer = currentUserId(request);
      const other = user._id.toString() !== viewer;
      const hidden =
        other &&
        (privacyOf(user).profilePhoto === 'nobody' ||
          (await blockersAmong(app, viewer, [user._id])).size > 0);
      if (!user.avatar || hidden || user.status === 'deactivated') {
        throw new AppError('NOT_FOUND', 'No photo.');
      }
      const { size } = request.query;
      const etag = `"${user.avatar.version}-${size}"`;
      reply
        .header('etag', etag)
        .header('cache-control', 'private, max-age=86400')
        .header('vary', 'Cookie');
      if (request.headers['if-none-match'] === etag) return reply.status(304).send();
      const stream = await app.storage.read(
        size === 'large' ? user.avatar.large : user.avatar.small,
      );
      return reply.type('image/webp').send(stream);
    },
  );
};
