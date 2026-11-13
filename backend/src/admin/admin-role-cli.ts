import { parseArgs } from 'node:util';
import { isValidEmail, normalizeEmail } from '@zuvo/protocol';
import type { Connection } from 'mongoose';
import { AppError } from '../lib/errors.ts';
import { CLI_ACTOR, changeRoleByEmail, type Role } from './role-change.ts';

export const USAGE =
  'Usage: pnpm --filter @zuvo/backend admin:role -- --email <email> --role <admin|user>';

/** Parses `--email` and `--role`; throws with the usage line when they are missing or wrong. */
export function parseRoleArgs(argv: string[]): { email: string; role: Role } {
  const { values } = parseArgs({
    args: argv.filter((arg) => arg !== '--'),
    options: { email: { type: 'string' }, role: { type: 'string' } },
    strict: true,
  });
  const email = normalizeEmail(values.email ?? '');
  if (!isValidEmail(email)) throw new Error(`A valid --email is required.\n${USAGE}`);
  if (values.role !== 'admin' && values.role !== 'user') {
    throw new Error(`--role must be "admin" or "user".\n${USAGE}`);
  }
  return { email, role: values.role };
}

interface RunOptions {
  argv: string[];
  database: string;
  confirm: (question: string) => Promise<boolean>;
  print: (line: string) => void;
}

/**
 * Emergency role change: confirm, then change through the same audited path as the app
 * (keeps at least one active admin). Returns the process exit code.
 */
export async function runAdminRole(connection: Connection, options: RunOptions): Promise<number> {
  const { email, role } = parseRoleArgs(options.argv);
  const question = `Set role of ${email} to "${role}" in database ${options.database}?`;
  if (!(await options.confirm(question))) {
    options.print('Cancelled. Nothing changed.');
    return 1;
  }
  try {
    const result = await changeRoleByEmail(connection, { email, role, actor: CLI_ACTOR });
    options.print(
      result.changed
        ? `Done: ${email} is now "${role}" (written to the audit log).`
        : `${email} is already "${role}". Nothing changed.`,
    );
    return 0;
  } catch (error) {
    if (error instanceof AppError) {
      options.print(`Refused: ${error.message}`);
      return 1;
    }
    throw error;
  }
}
