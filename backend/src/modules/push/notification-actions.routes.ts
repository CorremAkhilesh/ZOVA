import {
  chatParamsSchema,
  notificationReplyBodySchema,
  sendMessageAckSchema,
} from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { currentUserId, requireSession } from '../../auth/session.ts';
import { sendMessage } from '../../chats/messages.service.ts';
import { assertSendLimit } from '../../realtime/handlers.ts';

/**
 * The notification's inline "Reply", sent by the service worker (no socket there). "Mark as read"
 * is the existing POST /v1/chats/:id/read. Same session cookie, same rules as the socket.
 */
export const notificationActionRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireSession);

  app.post(
    '/chats/:id/reply',
    {
      schema: {
        tags: ['chats'],
        summary: 'Reply from a notification (a text message; clientMsgId makes retries safe)',
        params: chatParamsSchema,
        body: notificationReplyBodySchema,
        response: { 200: sendMessageAckSchema },
      },
    },
    async (request) => {
      const userId = currentUserId(request);
      await assertSendLimit(app, userId);
      const { message, duplicate } = await sendMessage(app, {
        userId,
        chatId: request.params.id,
        clientMsgId: request.body.clientMsgId,
        text: request.body.text,
      });
      return { messageId: message.id, seq: message.seq, createdAt: message.createdAt, duplicate };
    },
  );
};
