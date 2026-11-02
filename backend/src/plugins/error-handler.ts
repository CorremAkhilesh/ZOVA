import type { ApiError } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { AppError, codeForStatus } from '../lib/errors.ts';

export interface ErrorResponse {
  statusCode: number;
  body: ApiError;
}

const GENERIC_MESSAGE = 'Something went wrong. Please try again.';

function statusOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const { statusCode } = error;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode <= 599) {
      return statusCode;
    }
  }
  return undefined;
}

/** Maps any thrown value to the shared ApiError shape. Never exposes stack traces or internals. */
export function toErrorResponse(error: unknown, requestId: string): ErrorResponse {
  if (error instanceof AppError) {
    const body: ApiError = { code: error.code, message: error.message, requestId };
    if (error.details) body.details = error.details;
    return { statusCode: error.statusCode, body };
  }

  if (typeof error !== 'object' || error === null) {
    return {
      statusCode: 500,
      body: { code: 'INTERNAL_ERROR', message: GENERIC_MESSAGE, requestId },
    };
  }

  if (hasZodFastifySchemaValidationErrors(error)) {
    const issues = error.validation.map((issue) => ({
      path: issue.instancePath,
      message: issue.message ?? 'Invalid value',
    }));
    return {
      statusCode: 400,
      body: {
        code: 'VALIDATION_FAILED',
        message: 'The request is invalid.',
        requestId,
        details: { issues },
      },
    };
  }

  if (isResponseSerializationError(error)) {
    return {
      statusCode: 500,
      body: { code: 'INTERNAL_ERROR', message: GENERIC_MESSAGE, requestId },
    };
  }

  const status = statusOf(error);
  if (status !== undefined && status < 500 && error instanceof Error) {
    // Fastify's own 4xx errors (bad JSON, unsupported media type, body too large) are safe to show.
    return {
      statusCode: status,
      body: { code: codeForStatus(status), message: error.message, requestId },
    };
  }

  const statusCode = status ?? 500;
  return {
    statusCode,
    body: {
      code: codeForStatus(statusCode),
      message: statusCode === 503 ? 'Service temporarily unavailable.' : GENERIC_MESSAGE,
      requestId,
    },
  };
}

async function errorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    const { statusCode, body } = toErrorResponse(error, request.id);
    if (statusCode >= 500) {
      request.log.error({ err: error }, 'request failed');
    } else {
      request.log.info({ code: body.code, statusCode }, body.message);
    }
    return reply.status(statusCode).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    const body: ApiError = {
      code: 'NOT_FOUND',
      message: `Route ${request.method} ${request.url.split('?')[0]} not found`,
      requestId: request.id,
    };
    return reply.status(404).send(body);
  });
}

export const errorHandlerPlugin = fp(errorHandler, { name: 'error-handler', fastify: '5.x' });
