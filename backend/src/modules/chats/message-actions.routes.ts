import {
  chatParamsSchema,
  chatPrefsBodySchema,
  chatResponseSchema,
  deleteMessageQuerySchema,
  editMessageBodySchema,
  forwardBodySchema,
  forwardResponseSchema,
  messageParamsSchema,
  okResponseSchema,
  reactionBodySchema,
  starsQuerySchema,
  starsResponseSchema,
} from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { currentUserId, requireSession } from '../../auth/session.ts';
import { clearChat, listStars, setChatPrefs } from '../../chats/chat-prefs.service.ts';
import { forwardMessages } from '../../chats/forward.service.ts';
import {
  deleteForEveryone,
  editMessage,
  setReaction,
} from '../../chats/message-actions.service.ts';
import { deleteForMe, setStar } from '../../chats/message-personal.service.ts';

const ok = { 200: okResponseSchema };
const done = { ok: true as const };

/** Things done to a message or a chat. Every one checks who is asking, and what they can see. */
export const messageActionsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireSession);

  app.patch(
    '/chats/:id/messages/:messageId',
    {
      schema: {
        tags: ['messages'],
        summary: 'Edit my text or caption, within 15 minutes',
        params: messageParamsSchema,
        body: editMessageBodySchema,
        response: ok,
      },
    },
    async (request) => {
      const { id, messageId } = request.params;
      await editMessage(app, currentUserId(request), id, messageId, request.body.text);
      return done;
    },
  );

  app.delete(
    '/chats/:id/messages/:messageId',
    {
      schema: {
        tags: ['messages'],
        summary: 'Delete for me, or for everyone',
        params: messageParamsSchema,
        querystring: deleteMessageQuerySchema,
        response: ok,
      },
    },
    async (request) => {
      const { id, messageId } = request.params;
      const act = request.query.scope === 'me' ? deleteForMe : deleteForEveryone;
      await act(app, currentUserId(request), id, messageId);
      return done;
    },
  );

  app.put(
    '/chats/:id/messages/:messageId/reaction',
    {
      schema: {
        tags: ['messages'],
        params: messageParamsSchema,
        body: reactionBodySchema,
        response: ok,
      },
    },
    async (request) => {
      const { id, messageId } = request.params;
      await setReaction(app, currentUserId(request), id, messageId, request.body.emoji);
      return done;
    },
  );
  app.delete(
    '/chats/:id/messages/:messageId/reaction',
    { schema: { tags: ['messages'], params: messageParamsSchema, response: ok } },
    async (request) => {
      const { id, messageId } = request.params;
      await setReaction(app, currentUserId(request), id, messageId, null);
      return done;
    },
  );

  app.put(
    '/chats/:id/messages/:messageId/star',
    { schema: { tags: ['messages'], params: messageParamsSchema, response: ok } },
    async (request) => {
      const { id, messageId } = request.params;
      await setStar(app, currentUserId(request), id, messageId, true);
      return done;
    },
  );
  app.delete(
    '/chats/:id/messages/:messageId/star',
    { schema: { tags: ['messages'], params: messageParamsSchema, response: ok } },
    async (request) => {
      const { id, messageId } = request.params;
      await setStar(app, currentUserId(request), id, messageId, false);
      return done;
    },
  );

  app.get(
    '/stars',
    {
      schema: {
        tags: ['messages'],
        querystring: starsQuerySchema,
        response: { 200: starsResponseSchema },
      },
    },
    async (request) => listStars(app, currentUserId(request), request.query),
  );

  app.post(
    '/forward',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['messages'],
        body: forwardBodySchema,
        response: { 200: forwardResponseSchema },
      },
    },
    async (request) => ({ sent: await forwardMessages(app, currentUserId(request), request.body) }),
  );

  app.patch(
    '/chats/:id/prefs',
    {
      schema: {
        tags: ['chats'],
        summary: 'Pin, mute, archive or mark unread, for me',
        params: chatParamsSchema,
        body: chatPrefsBodySchema,
        response: { 200: chatResponseSchema },
      },
    },
    async (request) => ({
      chat: await setChatPrefs(app, currentUserId(request), request.params.id, request.body),
    }),
  );

  app.post(
    '/chats/:id/clear',
    { schema: { tags: ['chats'], params: chatParamsSchema, response: ok } },
    async (request) => {
      await clearChat(app, currentUserId(request), request.params.id, { removeChat: false });
      return done;
    },
  );
  app.delete(
    '/chats/:id',
    {
      schema: {
        tags: ['chats'],
        summary: 'Delete a direct chat, for me',
        params: chatParamsSchema,
        response: ok,
      },
    },
    async (request) => {
      await clearChat(app, currentUserId(request), request.params.id, { removeChat: true });
      return done;
    },
  );
};
