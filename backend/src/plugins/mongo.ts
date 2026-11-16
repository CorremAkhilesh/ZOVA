import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import mongoose, { type Connection } from 'mongoose';
import { mongoClientOptions } from '../db/mongo-options.ts';
import { attachSlowQueryLogger, SLOW_QUERY_MS } from '../db/slow-query.ts';

declare module 'fastify' {
  interface FastifyInstance {
    mongo: Connection;
  }
}

interface MongoPluginOptions {
  uri: string;
  dbName: string;
  /** Build indexes on startup. Off in production, where `db:sync-indexes` runs during deploy. */
  autoIndex: boolean;
  /** Wire compression: on for Atlas (production), off for local and in-memory databases. */
  compress: boolean;
  /** Queries at or above this duration are logged (shape only, no values). */
  slowQueryMs?: number;
}

async function setupMongo(app: FastifyInstance, options: MongoPluginOptions) {
  const connection = mongoose.createConnection(options.uri, {
    dbName: options.dbName,
    autoIndex: options.autoIndex,
    autoCreate: options.autoIndex,
    // Pool, timeouts, compression; `monitorCommands` for the slow query log.
    ...mongoClientOptions('api', { compress: options.compress }),
  });

  connection.on('connected', () => app.log.info({ db: options.dbName }, 'mongodb connected'));
  connection.on('disconnected', () => app.log.warn('mongodb disconnected'));
  connection.on('reconnected', () => app.log.info('mongodb reconnected'));
  connection.on('error', (error) => app.log.error({ err: error }, 'mongodb error'));

  await connection.asPromise();
  const detachSlowQueryLogger = attachSlowQueryLogger(
    connection.getClient(),
    app.log,
    options.slowQueryMs ?? SLOW_QUERY_MS,
  );
  app.decorate('mongo', connection);
  app.addHook('onClose', async () => {
    detachSlowQueryLogger();
    await connection.close();
  });
}

export const mongoPlugin = fp(setupMongo, { name: 'mongo', fastify: '5.x' });
