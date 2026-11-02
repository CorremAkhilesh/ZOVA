/**
 * Sends a branded test email directly over SMTP (no queue, so Redis is not needed).
 * Usage: pnpm --filter @zuvo/backend mail:test -- --to someone@corremadvisory.com
 */
import { parseArgs } from 'node:util';
import { emailSchema } from '@zuvo/protocol';
import { loadEnv } from '../config/env.ts';
import { createMailer } from '../mail/mailer.ts';
import { testEmail } from '../mail/templates/test-email.ts';

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: { to: { type: 'string' } },
  });
  const to = emailSchema.safeParse(values.to ?? '');
  if (!to.success) {
    throw new Error('Pass a valid recipient: --to <email>');
  }

  const env = loadEnv();
  const mailer = createMailer(env);
  try {
    await mailer.verify();
    const { messageId } = await mailer.send(testEmail(to.data, env.NODE_ENV, new Date()));
    process.stdout.write(`Sent test email to ${to.data} (messageId ${messageId})\n`);
  } finally {
    mailer.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `mail:test failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
