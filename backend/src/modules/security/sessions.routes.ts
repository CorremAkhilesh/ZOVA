import {
  type DeviceSession,
  deviceSessionsResponseSchema,
  notMeBodySchema,
  notMeResponseSchema,
  revokedSessionsResponseSchema,
  sessionParamsSchema,
} from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { Types } from 'mongoose';
import { currentUserId, requireSession } from '../../auth/session.ts';
import { registerAuthModels } from '../../db/auth-models.ts';
import { AppError } from '../../lib/errors.ts';
import { describeDevice, maskIp } from '../../security/devices.ts';
import { consumeRevokeToken } from '../../security/security-tokens.ts';

interface SessionDoc {
  _id: Types.ObjectId;
  token: string;
  userId: Types.ObjectId | string;
  userAgent?: string | null;
  ipAddress?: string | null;
  createdAt: Date;
  expiresAt: Date;
  lastActiveAt?: Date | null;
}

/** Settings → Devices, plus the public "This wasn't me" endpoint. */
export const sessionsRoutes: FastifyPluginAsyncZod = async (app) => {
  const sessionsModel = () => registerAuthModels(app.mongo).AuthSession;
  const context = () => app.auth.$context;

  /** Only the caller's own, unexpired sessions — newest first (index: userId + expiresAt). */
  async function mySessions(userId: string): Promise<SessionDoc[]> {
    const ids: Array<Types.ObjectId | string> = [userId];
    if (Types.ObjectId.isValid(userId)) ids.push(new Types.ObjectId(userId));
    return (await sessionsModel()
      .find({ userId: { $in: ids }, expiresAt: { $gt: new Date() } })
      .sort({ expiresAt: -1 })
      .lean()) as unknown as SessionDoc[];
  }

  const toDevice = (doc: SessionDoc, currentId: string): DeviceSession => ({
    id: doc._id.toString(),
    current: doc._id.toString() === currentId,
    ...describeDevice(doc.userAgent),
    ipAddress: maskIp(doc.ipAddress),
    createdAt: doc.createdAt.toISOString(),
    lastActiveAt: (doc.lastActiveAt ?? doc.createdAt).toISOString(),
    expiresAt: doc.expiresAt.toISOString(),
  });

  app.get(
    '/me/sessions',
    {
      onRequest: requireSession,
      schema: { tags: ['security'], response: { 200: deviceSessionsResponseSchema } },
    },
    async (request) => {
      const currentId = request.auth?.session.id ?? '';
      return {
        sessions: (await mySessions(currentUserId(request))).map((doc) => toDevice(doc, currentId)),
      };
    },
  );

  app.delete(
    '/me/sessions/:id',
    {
      onRequest: requireSession,
      schema: {
        tags: ['security'],
        params: sessionParamsSchema,
        response: { 200: revokedSessionsResponseSchema },
      },
    },
    async (request) => {
      const target = (await mySessions(currentUserId(request))).find(
        (doc) => doc._id.toString() === request.params.id,
      );
      // Someone else's session looks exactly like a missing one.
      if (!target) throw new AppError('NOT_FOUND', 'Session not found.');
      await (await context()).internalAdapter.deleteSession(target.token);
      return { revoked: 1 };
    },
  );

  app.post(
    '/me/sessions/revoke-others',
    {
      onRequest: requireSession,
      schema: { tags: ['security'], response: { 200: revokedSessionsResponseSchema } },
    },
    async (request) => {
      const currentId = request.auth?.session.id ?? '';
      const others = (await mySessions(currentUserId(request))).filter(
        (doc) => doc._id.toString() !== currentId,
      );
      if (others.length > 0)
        await (await context()).internalAdapter.deleteSessions(others.map((doc) => doc.token));
      return { revoked: others.length };
    },
  );

  app.post(
    '/auth/not-me',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['security'],
        summary: '"This wasn\'t me": a single-use link token revokes every session of the account',
        body: notMeBodySchema,
        response: { 200: notMeResponseSchema },
      },
    },
    async (request, reply) => {
      reply.header('referrer-policy', 'no-referrer');
      const userId = await consumeRevokeToken(app, request.body.token);
      const revokedSessions = (await mySessions(userId)).length;
      await (await context()).internalAdapter.deleteUserSessions(userId);
      request.log.warn(
        { userId, revokedSessions },
        'all sessions revoked via "This wasn\'t me" link',
      );
      return { status: 'revoked' as const, revokedSessions };
    },
  );
};
