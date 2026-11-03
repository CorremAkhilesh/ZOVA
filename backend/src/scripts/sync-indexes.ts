/**
 * Syncs MongoDB indexes for every registered model against MONGODB_DB.
 *   pnpm --filter @zuvo/backend db:sync-indexes          (shows the diff, then asks)
 *   pnpm --filter @zuvo/backend db:sync-indexes -- --yes (deploy: applies without asking)
 */
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import mongoose from 'mongoose';
import { loadEnv } from '../config/env.ts';
import { registerModels } from '../db/models.ts';
import { syncIndexes } from '../db/sync-indexes.ts';

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: { yes: { type: 'boolean', default: false } },
  });
  const env = loadEnv();
  const connection = mongoose.createConnection(env.MONGODB_URI, {
    dbName: env.MONGODB_DB,
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 15_000,
  });
  try {
    await connection.asPromise();
    process.stdout.write(`Database: ${env.MONGODB_DB}\n`);
    await syncIndexes(registerModels(connection), {
      yes: values.yes,
      confirm,
      print: (line) => process.stdout.write(`${line}\n`),
    });
  } finally {
    await connection.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `db:sync-indexes failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
