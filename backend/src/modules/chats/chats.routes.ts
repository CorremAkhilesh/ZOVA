import {
  chatListQuerySchema,
  chatListResponseSchema,
  chatParamsSchema,
  chatResponseSchema,
  createDirectChatBodySchema,
  markChatReadResponseSchema,
  markReadBodySchema,
  messageHistoryQuerySchema,
  messageHistoryResponseSchema,
  syncQuerySchema,
  syncResponseSchema,
} from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { currentUserId, requireSession } from '../../auth/session.ts';
import {
  getChat,
  getOrCreateDirectChat,
  getOrCreateSelfChat,
  listChats,
} from '../../chats/chats.service.ts';
import { getHistory } from '../../chats/history.service.ts';
import { markRead } from '../../chats/receipts.service.ts';
import { syncSince } from '../../chats/sync.service.ts';
import { unreadChatCount } from '../../push/gather.ts';

/** Chats, history, read state and sync. Sending happens over the socket (`message:send`). */
export const chatsRoutes: FastifyPluginAsyncZod = async (app) => {
  // onRequest: authentication is decided before any body is parsed or validated (401 before 400).
  app.addHook('onRequest', requireSession);

  app.post(
    '/chats/direct',
    {
      schema: {
        tags: ['chats'],
        summary: 'Get or create the 1:1 chat with a user',
        body: createDirectChatBodySchema,
        response: { 200: chatResponseSchema },
      },
    },
    async (request) => ({
      chat: await getOrCreateDirectChat(app, currentUserId(request), request.body.userId),
    }),
  );

  app.get(
    '/chats/self',
    {
      schema: {
        tags: ['chats'],
        summary: 'Saved Messages (created on first call)',
        response: { 200: chatResponseSchema },
      },
    },
    async (request) => ({ chat: await getOrCreateSelfChat(app, currentUserId(request)) }),
  );

  app.get(
    '/chats',
    {
      schema: {
        tags: ['chats'],
        summary: 'My chats, most recent first',
        querystring: chatListQuerySchema,
        response: { 200: chatListResponseSchema },
      },
    },
    async (request) =>
      listChats(app, currentUserId(request), request.query.limit, request.query.cursor),
  );

  app.get(
    '/chats/:id',
    {
      schema: {
        tags: ['chats'],
        params: chatParamsSchema,
        response: { 200: chatResponseSchema },
      },
    },
    async (request) => ({ chat: await getChat(app, request.params.id, currentUserId(request)) }),
  );

  app.get(
    '/chats/:id/messages',
    {
      schema: {
        tags: ['chats'],
        summary: 'Message history (members only)',
        params: chatParamsSchema,
        querystring: messageHistoryQuerySchema,
        response: { 200: messageHistoryResponseSchema },
      },
    },
    async (request) => getHistory(app, currentUserId(request), request.params.id, request.query),
  );

  app.post(
    '/chats/:id/read',
    {
      schema: {
        tags: ['chats'],
        summary: 'Move my read position forward (it never moves back)',
        params: chatParamsSchema,
        body: markReadBodySchema,
        response: { 200: markChatReadResponseSchema },
      },
    },
    async (request) => {
      const userId = currentUserId(request);
      const read = await markRead(app, userId, request.params.id, request.body.seq);
      // Also the notification's "Mark as read": the service worker sets the app badge from this.
      return { ...read, badge: await unreadChatCount(app.mongo, userId) };
    },
  );

  app.get(
    '/sync',
    {
      schema: {
        tags: ['chats'],
        summary: 'Everything that changed for me since a cursor (docs/protocol.md)',
        querystring: syncQuerySchema,
        response: { 200: syncResponseSchema },
      },
    },
    async (request) =>
      syncSince(app, currentUserId(request), request.query.since, request.query.limit),
  );
};
