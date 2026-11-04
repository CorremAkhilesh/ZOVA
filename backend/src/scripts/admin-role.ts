/**
 * Emergency admin role change (e.g. when no admin can sign in). Runs against MONGODB_DB from env:
 *   pnpm --filter @zuvo/backend admin:role -- --email <email> --role <admin|user>
 * Asks for confirmation, keeps at least one active admin, writes an audit log entry.
 */
import { createInterface } from 'node:readline/promises';
import mongoose from 'mongoose';
import { runAdminRole } from '../admin/admin-role-cli.ts';
import { loadEnv } from '../config/env.ts';

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

async function main() {
  const env = loadEnv();
  const connection = mongoose.createConnection(env.MONGODB_URI, {
    dbName: env.MONGODB_DB,
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 15_000,
  });
  try {
    await connection.asPromise();
    process.exitCode = await runAdminRole(connection, {
      argv: process.argv.slice(2),
      database: env.MONGODB_DB,
      confirm,
      print: (line) => process.stdout.write(`${line}\n`),
    });
  } finally {
    await connection.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `admin:role failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
