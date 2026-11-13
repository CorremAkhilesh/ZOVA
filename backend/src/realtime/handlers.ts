import { randomUUID } from 'node:crypto';
import {
  type AckResponse,
  deliveredUpdatePayloadSchema,
  presenceActivePayloadSchema,
  presenceSubscribePayloadSchema,
  readUpdatePayloadSchema,
  sendMessagePayloadSchema,
  typingPayloadSchema,
  voicePlayedPayloadSchema,
  windowStatePayloadSchema,
} from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { type AuthSessionRecord, trackActivity } from '../auth/session.ts';
import { sendMessage } from '../chats/messages.service.ts';
import { markPlayed } from '../chats/played.service.ts';
import { markDelivered, markRead } from '../chats/receipts.service.ts';
import { registerAuthModels } from '../db/auth-models.ts';
import { AppError } from '../lib/errors.ts';
import { toErrorResponse } from '../plugins/error-handler.ts';
import type { ZuvoSocket } from './server.ts';
import { closeSocket } from './session-guard.ts';
import { windowLimit } from './socket-limit.ts';
import { createTyping } from './typing.ts';

/** 20 messages per 5 seconds, per user, across all devices and instances. */
export const SEND_LIMIT = { max: 20, windowSeconds: 5 };
/** Scrolling the chat list re-subscribes; the client already waits between updates. */
const PRESENCE_SUBSCRIBE_LIMIT = { max: 20, windowMs: 10_000 };

/**
 * The push already closes revoked sockets; this is the second check every event gets, in case a
 * push was missed (a Redis blip between instances, or a session that just expired).
 */
async function assertSessionAlive(app: FastifyInstance, socket: ZuvoSocket) {
  const { session } = socket.data;
  const alive = await registerAuthModels(app.mongo).AuthSession.exists({
    token: session.token,
    expiresAt: { $gt: new Date() },
  });
  if (alive) return;
  throw new AppError('SESSION_EXPIRED', 'Your session has ended. Please sign in again.');
}

export async function assertSendLimit(app: FastifyInstance, userId: string) {
  const key = `zuvo:rate:send:${userId}`;
  const count = await app.counterStore.increment(key, SEND_LIMIT.windowSeconds);
  if (count > SEND_LIMIT.max) {
    throw new AppError('RATE_LIMITED', 'You are sending messages too fast.', {
      retryAfterSeconds: Math.max(1, await app.counterStore.ttl(key)),
    });
  }
}

/**
 * Why an event failed, for the logs. Never message text: our own errors say nothing about content,
 * and for anything else (a validation error can quote the value) only its name and code are kept.
 */
export function safeReason(error: unknown): string {
  if (error instanceof AppError) return error.message;
  if (!(error instanceof Error)) return 'unknown';
  const { code } = error as Error & { code?: unknown };
  return code === undefined ? error.name : `${error.name} ${String(code)}`;
}

/** Runs one event: validate, check the session, act, and always acknowledge. */
async function respond<Schema extends z.ZodType, Data>(
  app: FastifyInstance,
  socket: ZuvoSocket,
  event: string,
  schema: Schema,
  payload: unknown,
  ack: unknown,
  action: (input: z.output<Schema>) => Promise<Data>,
): Promise<void> {
  const reply = (typeof ack === 'function' ? ack : () => undefined) as (
    response: AckResponse<Data>,
  ) => void;
  try {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'That request is not valid.');
    }
    await assertSessionAlive(app, socket);
    reply({ ok: true, data: await action(parsed.data) });
  } catch (error) {
    const requestId = randomUUID();
    const { statusCode, body } = toErrorResponse(error, requestId);
    const failure = {
      event,
      code: body.code,
      reason: safeReason(error),
      requestId,
      userId: socket.data.userId,
    };
    if (statusCode >= 500) app.log.error(failure, 'socket event failed');
    else app.log.warn(failure, 'socket event refused');
    reply({ ok: false, error: body });
    // After the reply, so the client still hears why.
    if (body.code === 'SESSION_EXPIRED') closeSocket(socket, 'revoked');
  }
}

export function registerHandlers(app: FastifyInstance, socket: ZuvoSocket): void {
  const { userId } = socket.data;
  const session: AuthSessionRecord = socket.data.session;
  const touch = () =>
    void trackActivity(app, session).catch((error: unknown) =>
      app.log.warn({ err: error }, 'could not record session activity'),
    );

  socket.on('message:send', (payload, ack) => {
    void respond(
      app,
      socket,
      'message:send',
      sendMessagePayloadSchema,
      payload,
      ack,
      async (input) => {
        await assertSendLimit(app, userId);
        touch();
        const { message, duplicate } = await sendMessage(app, {
          userId,
          chatId: input.chatId,
          clientMsgId: input.clientMsgId,
          text: input.text ?? input.caption,
          mediaId: input.mediaIds?.[0],
          albumId: input.albumId,
          replyTo: input.replyTo,
          linkPreviewId: input.linkPreviewId,
          mentions: input.mentions,
          mentionsEveryone: input.mentionsEveryone,
          poll: input.poll,
          viewOnce: input.viewOnce,
        });
        return { messageId: message.id, seq: message.seq, createdAt: message.createdAt, duplicate };
      },
    );
  });

  socket.on('read:update', (payload, ack) => {
    void respond(app, socket, 'read:update', readUpdatePayloadSchema, payload, ack, (input) => {
      touch();
      return markRead(app, userId, input.chatId, input.seq);
    });
  });

  socket.on('delivered:update', (payload, ack) => {
    void respond(
      app,
      socket,
      'delivered:update',
      deliveredUpdatePayloadSchema,
      payload,
      ack,
      (input) => markDelivered(app, userId, input.chatId, input.seq),
    );
  });

  socket.on('voice:played', (payload, ack) => {
    void respond(app, socket, 'voice:played', voicePlayedPayloadSchema, payload, ack, (input) =>
      markPlayed(app, userId, input.chatId, input.messageId),
    );
  });

  const typing = createTyping(app, socket);
  socket.on('typing:start', (payload, ack) => {
    void respond(app, socket, 'typing:start', typingPayloadSchema, payload, ack, async (input) => {
      await typing.start(input.chatId);
      return {};
    });
  });
  socket.on('typing:stop', (payload, ack) => {
    void respond(app, socket, 'typing:stop', typingPayloadSchema, payload, ack, async (input) => {
      typing.stop(input.chatId);
      return {};
    });
  });
  socket.on('disconnect', () => typing.stopAll());

  const subscribeAllowed = windowLimit(
    PRESENCE_SUBSCRIBE_LIMIT.max,
    PRESENCE_SUBSCRIBE_LIMIT.windowMs,
  );
  socket.on('presence:subscribe', (payload, ack) => {
    void respond(
      app,
      socket,
      'presence:subscribe',
      presenceSubscribePayloadSchema,
      payload,
      ack,
      async (input) => {
        if (!subscribeAllowed()) throw new AppError('RATE_LIMITED', 'Too many presence updates.');
        return { users: await app.realtime.presence.subscribe(socket, input.userIds) };
      },
    );
  });
  // Web Push skips a device while one of its tabs is visible and focused.
  socket.on('window:state', (payload, ack) => {
    void respond(
      app,
      socket,
      'window:state',
      windowStatePayloadSchema,
      payload,
      ack,
      async (input) => {
        await app.push.windowState(socket.id, session.id, input.visible && input.focused);
        return {};
      },
    );
  });

  socket.on('presence:active', (payload, ack) => {
    void respond(
      app,
      socket,
      'presence:active',
      presenceActivePayloadSchema,
      payload,
      ack,
      async (input) => {
        await app.realtime.presence.setActive(socket, input.active);
        return {};
      },
    );
  });
}
