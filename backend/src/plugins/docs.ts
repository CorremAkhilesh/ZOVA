import swagger from '@fastify/swagger';
import scalar from '@scalar/fastify-api-reference';
import { brand } from '@zuvo/config';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';
import { APP_VERSION } from '../lib/version.ts';

interface DocsOptions {
  apiUrl: string;
}

/** OpenAPI spec generated from the Zod route schemas, with the Scalar UI at /docs. Non-production only. */
async function docs(app: FastifyInstance, { apiUrl }: DocsOptions) {
  await app.register(swagger, {
    openapi: {
      info: { title: `${brand.name} API`, version: APP_VERSION },
      servers: [{ url: apiUrl }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(scalar, {
    routePrefix: '/docs',
    configuration: { title: `${brand.name} API` },
  });
}

export const docsPlugin = fp(docs, { name: 'docs', fastify: '5.x' });
