import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import mongoose, { type Connection } from 'mongoose';
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
  /** Queries at or above this duration are logged (shape only, no values). */
  slowQueryMs?: number;
}

async function setupMongo(app: FastifyInstance, options: MongoPluginOptions) {
  const connection = mongoose.createConnection(options.uri, {
    dbName: options.dbName,
    autoIndex: options.autoIndex,
    autoCreate: options.autoIndex,
    maxPoolSize: 20,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
    socketTimeoutMS: 45_000,
    appName: 'zuvo-api',
    // Needed for slow query logging (command start/finish events).
    monitorCommands: true,
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
