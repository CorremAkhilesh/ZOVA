import { appConfigResponseSchema } from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireSession } from '../../auth/session.ts';
import { limitsOf, mediaMaxBytes } from '../../media/limits.ts';

/** What the app needs to know from the server's settings, so the two can never disagree. */
export const configRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/config',
    {
      onRequest: requireSession,
      schema: {
        tags: ['config'],
        summary: 'Settings the app follows, such as the file size limit',
        response: { 200: appConfigResponseSchema },
      },
    },
    async () => {
      const settings = app.settings.current();
      return {
        media: {
          maxFileBytes: mediaMaxBytes(limitsOf(app)),
          voiceMaxSeconds: app.env.VOICE_MAX_SECONDS,
          userQuotaBytes: settings.mediaUserQuotaMb * 1024 * 1024,
        },
        features: {
          status: settings.status,
          linkPreviews: settings.linkPreviews,
          groupMaxMembers: settings.groupMaxMembers,
        },
      };
    },
  );
};
