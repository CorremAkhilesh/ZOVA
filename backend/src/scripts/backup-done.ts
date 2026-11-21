/**
 * The nightly backup finished well: records when, for Admin → Dashboard ("Last backup"). Called by
 * deploy/scripts/backup.sh inside the api container:
 *   node dist/scripts/backup-done.js --files 1234
 */
import { parseArgs } from 'node:util';
import mongoose from 'mongoose';
import { loadEnv } from '../config/env.ts';
import { recordBackup } from '../db/system-status.ts';

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: { files: { type: 'string', default: '0' } },
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
    const files = Math.max(0, Number.parseInt(values.files ?? '0', 10) || 0);
    await recordBackup(connection, new Date(), files);
    process.stdout.write(`backup recorded (${files} files)\n`);
  } finally {
    await connection.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `backup-done failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
