import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Redis } from 'ioredis';
import { checkEvictionPolicy, createRedis } from '../lib/redis.ts';

declare module 'fastify' {
  interface FastifyInstance {
    /** Null when REDIS_URL is not configured (development only). */
    redis: Redis | null;
  }
}

interface RedisPluginOptions {
  url: string | undefined;
  /** Injected client (tests). `null` forces "no Redis". Not closed by the plugin. */
  client?: Redis | null;
}

async function setupRedis(app: FastifyInstance, options: RedisPluginOptions) {
  if (options.client !== undefined) {
    app.decorate('redis', options.client);
    return;
  }
  if (!options.url) {
    app.log.warn('REDIS_URL is not set: using in-memory rate limiting, no background jobs');
    app.decorate('redis', null);
    return;
  }

  const redis = createRedis(options.url);
  redis.on('ready', () => app.log.info('redis connected'));
  redis.once('ready', () => void checkEvictionPolicy(redis, app.log));
  redis.on('error', (error) => app.log.error({ err: error }, 'redis error'));
  redis.on('reconnecting', () => app.log.warn('redis reconnecting'));
  app.decorate('redis', redis);
  app.addHook('onClose', async () => {
    await redis.quit();
  });
}

export const redisPlugin = fp(setupRedis, { name: 'redis', fastify: '5.x' });
