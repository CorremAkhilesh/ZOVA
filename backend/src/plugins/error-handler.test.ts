import { apiErrorSchema } from '@zuvo/protocol';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '../lib/errors.ts';
import { errorHandlerPlugin, toErrorResponse } from './error-handler.ts';

describe('toErrorResponse', () => {
  it('passes AppError code, message and details through', () => {
    const error = new AppError('CONFLICT', 'Username is taken', { field: 'username' });
    expect(toErrorResponse(error, 'req-1')).toEqual({
      statusCode: 409,
      body: {
        code: 'CONFLICT',
        message: 'Username is taken',
        requestId: 'req-1',
        details: { field: 'username' },
      },
    });
  });

  it('hides the message of unexpected errors', () => {
    const { statusCode, body } = toErrorResponse(new Error('db password is hunter2'), 'req-2');
    expect(statusCode).toBe(500);
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.message).not.toContain('hunter2');
  });

  it('keeps safe 4xx messages from Fastify errors', () => {
    const error = Object.assign(new Error('Unsupported Media Type'), { statusCode: 415 });
    expect(toErrorResponse(error, 'r').body).toMatchObject({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'Unsupported Media Type',
    });
  });

  it('maps a 413 to PAYLOAD_TOO_LARGE', () => {
    const error = Object.assign(new Error('Request body is too large'), { statusCode: 413 });
    expect(toErrorResponse(error, 'r')).toMatchObject({
      statusCode: 413,
      body: { code: 'PAYLOAD_TOO_LARGE' },
    });
  });

  it('treats non-Error throwables as internal errors', () => {
    expect(toErrorResponse('boom', 'r')).toMatchObject({
      statusCode: 500,
      body: { code: 'INTERNAL_ERROR' },
    });
  });
});

describe('error handler plugin', () => {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();

  beforeAll(async () => {
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(errorHandlerPlugin);
    app.post(
      '/echo',
      { schema: { body: z.object({ name: z.string().min(2) }) } },
      async (req) => req.body,
    );
    app.get('/crash', async () => {
      throw new Error('secret internals');
    });
    app.get('/forbidden', async () => {
      throw new AppError('FORBIDDEN', 'Not a member of this chat');
    });
    await app.ready();
  });
  afterAll(() => app.close());

  it('returns VALIDATION_FAILED with issues for an invalid body', async () => {
    const res = await app.inject({ method: 'POST', url: '/echo', payload: { name: 'x' } });
    expect(res.statusCode).toBe(400);
    const body = apiErrorSchema.parse(res.json());
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.details).toHaveProperty('issues');
  });

  it('returns a generic 500 without stack traces', async () => {
    const res = await app.inject({ method: 'GET', url: '/crash' });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('secret internals');
    expect(res.body).not.toContain('at ');
    expect(apiErrorSchema.parse(res.json()).code).toBe('INTERNAL_ERROR');
  });

  it('returns AppErrors with their status', async () => {
    const res = await app.inject({ method: 'GET', url: '/forbidden' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'FORBIDDEN', message: 'Not a member of this chat' });
  });

  it('returns NOT_FOUND for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope?x=1' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'NOT_FOUND', message: 'Route GET /nope not found' });
  });

  it('returns BAD_REQUEST for malformed JSON', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{bad json',
    });
    expect(res.statusCode).toBe(400);
    expect(apiErrorSchema.parse(res.json()).code).toBe('BAD_REQUEST');
  });
});
