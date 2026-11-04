import { describe, expect, it, vi } from 'vitest';
import { modelRegistrations, registerModels } from './models.ts';
import { type IndexedModel, syncIndexes } from './sync-indexes.ts';

function fakeModel(overrides: Partial<IndexedModel> = {}): IndexedModel {
  return {
    modelName: 'Fake',
    collection: { collectionName: 'fakes' },
    schema: { indexes: () => [[{ email: 1 }, { unique: true }]] },
    diffIndexes: vi.fn(async () => ({ toCreate: [], toDrop: [] })),
    createCollection: vi.fn(async () => undefined),
    syncIndexes: vi.fn(async () => undefined),
    ...overrides,
  };
}

const quiet = { yes: true, confirm: async () => true, print: () => {} };

describe('syncIndexes (unit)', () => {
  it('treats a missing collection as "every schema index is new"', async () => {
    const model = fakeModel({
      diffIndexes: vi.fn(async () => {
        throw Object.assign(new Error('ns does not exist'), { code: 26 });
      }),
    });
    const result = await syncIndexes([model], quiet);
    expect(result.changes[0]?.toCreate).toEqual(['{"email":1} {"unique":true}']);
    expect(model.createCollection).toHaveBeenCalledOnce();
    expect(model.syncIndexes).toHaveBeenCalledOnce();
  });

  it('rethrows any other error', async () => {
    const model = fakeModel({
      diffIndexes: vi.fn(async () => {
        throw new Error('not authorized');
      }),
    });
    await expect(syncIndexes([model], quiet)).rejects.toThrow('not authorized');
  });

  it('prints index definitions without a key as JSON', async () => {
    const lines: string[] = [];
    const model = fakeModel({
      diffIndexes: vi.fn(async () => ({ toCreate: ['legacy_index'], toDrop: [] })),
    });
    await syncIndexes([model], { ...quiet, print: (line) => lines.push(line) });
    expect(lines).toContain('  + "legacy_index"');
  });
});

describe('model registry', () => {
  it('registers every model on the given connection', () => {
    const connection = {} as Parameters<typeof registerModels>[0];
    const register = vi.fn(() => fakeModel() as never);
    modelRegistrations.push(register);
    try {
      expect(registerModels(connection)).toHaveLength(1);
      expect(register).toHaveBeenCalledWith(connection);
    } finally {
      modelRegistrations.pop();
    }
  });
});
