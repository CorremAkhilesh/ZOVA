export interface IndexChange {
  model: string;
  collection: string;
  toCreate: string[];
  toDrop: string[];
}

export interface SyncResult {
  changes: IndexChange[];
  applied: boolean;
}

export interface SyncOptions {
  /** Apply without asking. */
  yes: boolean;
  /** Asked when there are changes and `yes` is false. */
  confirm: (question: string) => Promise<boolean>;
  print: (line: string) => void;
}

/** The parts of a Mongoose model that index syncing needs. */
export interface IndexedModel {
  modelName: string;
  collection: { collectionName: string };
  schema: { indexes(): Array<[object, object]> };
  diffIndexes(): Promise<{ toCreate: unknown[]; toDrop: unknown[] }>;
  createCollection(): Promise<unknown>;
  syncIndexes(): Promise<unknown>;
}

function describeIndex(definition: unknown): string {
  if (typeof definition === 'object' && definition !== null && 'key' in definition) {
    const { key, ...options } = definition as { key: unknown };
    const extras = Object.keys(options).length > 0 ? ` ${JSON.stringify(options)}` : '';
    return `${JSON.stringify(key)}${extras}`;
  }
  return JSON.stringify(definition);
}

function isMissingCollection(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 26;
}

async function diffModel(model: IndexedModel): Promise<IndexChange> {
  const base = { model: model.modelName, collection: model.collection.collectionName };
  try {
    const diff = await model.diffIndexes();
    return { ...base, toCreate: diff.toCreate.map(describeIndex), toDrop: diff.toDrop.map(String) };
  } catch (error) {
    if (!isMissingCollection(error)) throw error;
    // Collection not created yet: every schema index is new.
    const toCreate = model.schema
      .indexes()
      .map(([key, options]) => describeIndex({ key, ...options }));
    return { ...base, toCreate, toDrop: [] };
  }
}

/** Shows what would change for each model, asks, then creates missing and drops stale indexes. */
export async function syncIndexes(
  models: IndexedModel[],
  options: SyncOptions,
): Promise<SyncResult> {
  const changes: IndexChange[] = [];
  for (const model of models) {
    const change = await diffModel(model);
    if (change.toCreate.length + change.toDrop.length > 0) changes.push(change);
  }

  if (changes.length === 0) {
    options.print(`All indexes are in sync (${models.length} models).`);
    return { changes, applied: false };
  }
  for (const change of changes) {
    options.print(`${change.model} (${change.collection})`);
    for (const index of change.toCreate) options.print(`  + ${index}`);
    for (const index of change.toDrop) options.print(`  - ${index}`);
  }

  const approved = options.yes || (await options.confirm('Apply these index changes?'));
  if (!approved) {
    options.print('No changes applied.');
    return { changes, applied: false };
  }
  for (const change of changes) {
    const model = models.find((candidate) => candidate.modelName === change.model);
    await model?.createCollection();
    await model?.syncIndexes();
  }
  options.print('Index changes applied.');
  return { changes, applied: true };
}
