import {
  callIdPayloadSchema,
  callSignalPayloadSchema,
  callStartPayloadSchema,
} from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import {
  acceptCall,
  beat,
  endCall,
  markRinging,
  relaySignal,
  startCall,
} from '../calls/calls.service.ts';
import { AppError } from '../lib/errors.ts';
import { respond } from './handlers.ts';
import type { ZuvoSocket } from './server.ts';
import { windowLimit } from './socket-limit.ts';

/** Offers, answers and ICE candidates: a burst at the start and on each network change. */
const SIGNAL_LIMIT = { max: 300, windowMs: 10_000 };
/** Ringing, accepting, declining, ending and heartbeats. */
const CONTROL_LIMIT = { max: 60, windowMs: 10_000 };

/** The call events of one socket. Every one is checked (who, which call, which device). */
export function registerCallHandlers(app: FastifyInstance, socket: ZuvoSocket): void {
  const { userId } = socket.data;
  const sessionId = socket.data.session.id;
  const signalAllowed = windowLimit(SIGNAL_LIMIT.max, SIGNAL_LIMIT.windowMs);
  const controlAllowed = windowLimit(CONTROL_LIMIT.max, CONTROL_LIMIT.windowMs);
  const limited = (allowed: () => boolean) => {
    if (!allowed()) throw new AppError('RATE_LIMITED', 'Too many call updates.');
  };

  socket.on('call:start', (payload, ack) => {
    void respond(app, socket, 'call:start', callStartPayloadSchema, payload, ack, (input) =>
      startCall(app, { userId, sessionId, chatId: input.chatId, kind: input.kind }),
    );
  });
  socket.on('call:ringing', (payload, ack) => {
    void respond(app, socket, 'call:ringing', callIdPayloadSchema, payload, ack, async (input) => {
      limited(controlAllowed);
      await markRinging(app, userId, input.callId);
      return {};
    });
  });
  socket.on('call:accept', (payload, ack) => {
    void respond(app, socket, 'call:accept', callIdPayloadSchema, payload, ack, (input) => {
      limited(controlAllowed);
      return acceptCall(app, userId, sessionId, input.callId);
    });
  });
  socket.on('call:decline', (payload, ack) => {
    void respond(app, socket, 'call:decline', callIdPayloadSchema, payload, ack, async (input) => {
      limited(controlAllowed);
      await endCall(app, userId, input.callId, 'decline');
      return {};
    });
  });
  socket.on('call:end', (payload, ack) => {
    void respond(app, socket, 'call:end', callIdPayloadSchema, payload, ack, async (input) => {
      limited(controlAllowed);
      await endCall(app, userId, input.callId, 'end');
      return {};
    });
  });
  socket.on('call:beat', (payload, ack) => {
    void respond(app, socket, 'call:beat', callIdPayloadSchema, payload, ack, async (input) => {
      limited(controlAllowed);
      await beat(app, userId, input.callId);
      return {};
    });
  });
  socket.on('call:signal', (payload, ack) => {
    void respond(
      app,
      socket,
      'call:signal',
      callSignalPayloadSchema,
      payload,
      ack,
      async (input) => {
        limited(signalAllowed);
        await relaySignal(app, { userId, sessionId }, input.callId, input.signal);
        return {};
      },
    );
  });
}
