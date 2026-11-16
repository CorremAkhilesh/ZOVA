import { randomBytes } from 'node:crypto';
import { describe, expect, inject, it } from 'vitest';
import { mongoClientOptions } from '../db/mongo-options.ts';
import { connectWorkerMongo } from './worker-mongo.ts';

describe('MongoDB client settings', () => {
  it('gives the API a bigger pool than the worker, both compressed and monitored', () => {
    const api = mongoClientOptions('api', { compress: true });
    const worker = mongoClientOptions('worker', { compress: true });
    expect(api.maxPoolSize).toBeGreaterThan(worker.maxPoolSize ?? 0);
    for (const options of [api, worker]) {
      expect(options.compressors).toEqual(['zlib']);
      // Slow query logging needs command events.
      expect(options.monitorCommands).toBe(true);
      // A wait limit failed app start while every model built its indexes (Step 20 load test).
      expect(options.waitQueueTimeoutMS).toBeUndefined();
    }
    expect(worker.appName).toBe('zuvo-worker');
  });

  it('compresses only when asked (production, Atlas)', () => {
    expect(mongoClientOptions('api', { compress: false }).compressors).toBeUndefined();
    expect(mongoClientOptions('worker', { compress: false }).compressors).toBeUndefined();
  });
});

describe('the worker database client', () => {
  it('is one shared connection that logs slow queries and closes cleanly', async () => {
    const warnings: string[] = [];
    const db = await connectWorkerMongo(
      {
        MONGODB_URI: inject('mongoUri'),
        MONGODB_DB: `zuvo_test_${randomBytes(6).toString('hex')}`,
        NODE_ENV: 'test',
      },
      { warn: (_object, message) => void warnings.push(message) },
    );
    try {
      expect(db.mongo.readyState).toBe(1);
      const client = db.mongo.getClient();
      expect(client.options.maxPoolSize).toBe(
        mongoClientOptions('worker', { compress: false }).maxPoolSize,
      );
      // Fires the listener the slow query logger attached (a 0 ms threshold is not used here, so
      // this only proves the client emits command events at all).
      let events = 0;
      client.on('commandStarted', () => events++);
      await db.mongo.db?.command({ ping: 1 });
      expect(events).toBeGreaterThan(0);
    } finally {
      await db.mongo.dropDatabase();
      await db.close();
    }
    expect(db.mongo.readyState).toBe(0);
    expect(warnings).toEqual([]);
  });
});
