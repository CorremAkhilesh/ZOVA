import { type Connection, Schema } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expectIndexedQuery } from '../../test/expect-indexed-query.ts';
import { connectTestDb } from '../../test/helpers.ts';
import { attachSlowQueryLogger } from './slow-query.ts';
import { syncIndexes } from './sync-indexes.ts';

let db: Awaited<ReturnType<typeof connectTestDb>>;

beforeEach(async () => {
  db = await connectTestDb({ monitorCommands: true });
});
afterEach(() => db.cleanup());

function sampleModel(connection: Connection, withEmailIndex = true) {
  const schema = new Schema(
    { email: String, name: String, createdAt: Date },
    { autoIndex: true, autoCreate: true },
  );
  // Serves: find user by email (login).
  if (withEmailIndex) schema.index({ email: 1 }, { unique: true });
  return connection.model('Sample', schema, 'samples');
}

describe('expectIndexedQuery', () => {
  it('passes for a query served by an index', async () => {
    const Sample = sampleModel(db.connection);
    await expectIndexedQuery(Sample.find({ email: 'a@corremadvisory.com' }));
  });

  it('fails for a query that needs a collection scan', async () => {
    const Sample = sampleModel(db.connection);
    await expect(expectIndexedQuery(Sample.find({ name: 'Asha' }))).rejects.toThrow(/COLLSCAN/);
  });
});

describe('slow query logging against a real server', () => {
  it('logs collection and shape without values', async () => {
    const Sample = sampleModel(db.connection);
    await Sample.init();
    const logged: Array<Record<string, unknown>> = [];
    const detach = attachSlowQueryLogger(
      db.connection.getClient(),
      { warn: (object) => logged.push(object as Record<string, unknown>) },
      0,
    );
    await Sample.find({ email: 'private@corremadvisory.com' }).exec();
    detach();

    const entry = logged.find((item) => item.command === 'find');
    expect(entry).toMatchObject({ collection: 'samples', shape: { filter: { email: '?string' } } });
    expect(JSON.stringify(logged)).not.toContain('private@');
  });
});

describe('syncIndexes', () => {
  const quiet = { print: () => {} };

  it('shows missing indexes and creates them when approved', async () => {
    const Sample = sampleModel(db.connection);
    const lines: string[] = [];
    const result = await syncIndexes([Sample], {
      yes: true,
      confirm: async () => false,
      print: (line) => lines.push(line),
    });
    expect(result.applied).toBe(true);
    expect(lines.join('\n')).toContain('+ {"email":1}');
    const names = (await Sample.collection.indexes()).map((index) => index.name);
    expect(names).toContain('email_1');
  });

  it('asks before applying and changes nothing when declined', async () => {
    const Sample = sampleModel(db.connection);
    let asked = '';
    const result = await syncIndexes([Sample], {
      ...quiet,
      yes: false,
      confirm: async (question) => {
        asked = question;
        return false;
      },
    });
    expect(asked).toMatch(/Apply/);
    expect(result).toMatchObject({ applied: false, changes: [{ toCreate: [expect.any(String)] }] });
    const exists = await db.connection.db?.listCollections({ name: 'samples' }).hasNext();
    expect(exists).toBe(false);
  });

  it('drops indexes that are no longer in the schema', async () => {
    await db.connection.collection('samples').createIndex({ name: 1 });
    const Sample = sampleModel(db.connection, false);
    const result = await syncIndexes([Sample], { ...quiet, yes: true, confirm: async () => true });
    expect(result.changes[0]?.toDrop).toEqual(['name_1']);
    const names = (await Sample.collection.indexes()).map((index) => index.name);
    expect(names).toEqual(['_id_']);
  });

  it('reports when everything is in sync', async () => {
    const Sample = sampleModel(db.connection);
    await Sample.init();
    const lines: string[] = [];
    const result = await syncIndexes([Sample], {
      yes: true,
      confirm: async () => true,
      print: (line) => lines.push(line),
    });
    expect(result).toEqual({ changes: [], applied: false });
    expect(lines).toEqual(['All indexes are in sync (1 models).']);
  });
});
