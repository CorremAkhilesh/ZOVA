import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import mongoose, { type Connection } from 'mongoose';

declare module 'fastify' {
  interface FastifyInstance {
    mongo: Connection;
  }
}

interface MongoPluginOptions {
  uri: string;
  dbName: string;
  /** Build indexes on startup. Off in production, where indexes are synced during deploy. */
  autoIndex: boolean;
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
  });

  connection.on('connected', () => app.log.info({ db: options.dbName }, 'mongodb connected'));
  connection.on('disconnected', () => app.log.warn('mongodb disconnected'));
  connection.on('reconnected', () => app.log.info('mongodb reconnected'));
  connection.on('error', (error) => app.log.error({ err: error }, 'mongodb error'));

  await connection.asPromise();
  app.decorate('mongo', connection);
  app.addHook('onClose', async () => {
    await connection.close();
  });
}

export const mongoPlugin = fp(setupMongo, { name: 'mongo', fastify: '5.x' });
