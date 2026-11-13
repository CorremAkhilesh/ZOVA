/**
 * Sends a branded test email.
 *   Direct over SMTP:   pnpm --filter @zuvo/backend mail:test -- --to someone@corremadvisory.com
 *   Through the queue:  pnpm --filter @zuvo/backend mail:test -- --to someone@corremadvisory.com --queue
 * With --queue the email is enqueued in BullMQ and the script waits until the worker
 * (`dev:worker`) has sent it.
 */
import { parseArgs } from 'node:util';
import { emailSchema } from '@zuvo/protocol';
import { QueueEvents } from 'bullmq';
import { type Env, loadEnv } from '../config/env.ts';
import { createEmailQueue, EMAIL_QUEUE } from '../jobs/email-queue.ts';
import { createBullConnection } from '../lib/redis.ts';
import { createMailer, type MailMessage } from '../mail/mailer.ts';
import { testEmail } from '../mail/templates/test-email.ts';

const QUEUE_WAIT_MS = 60_000;

async function sendDirect(env: Env, message: MailMessage): Promise<string> {
  const mailer = createMailer(env);
  try {
    await mailer.verify();
    const { messageId } = await mailer.send(message);
    return `sent directly over SMTP (messageId ${messageId})`;
  } finally {
    mailer.close();
  }
}

async function sendViaQueue(env: Env, message: MailMessage): Promise<string> {
  if (!env.REDIS_URL) throw new Error('--queue needs REDIS_URL');
  const queueConnection = createBullConnection(env.REDIS_URL, 'zuvo-mail-test');
  const eventsConnection = createBullConnection(env.REDIS_URL, 'zuvo-mail-test-events');
  const queue = createEmailQueue(queueConnection);
  const events = new QueueEvents(EMAIL_QUEUE, { connection: eventsConnection });
  try {
    await events.waitUntilReady();
    const job = await queue.add('test-email', message);
    process.stdout.write(`Enqueued job ${job.id}; waiting for the worker...\n`);
    await job.waitUntilFinished(events, QUEUE_WAIT_MS);
    return `sent through the "${EMAIL_QUEUE}" queue by the worker (job ${job.id})`;
  } finally {
    await events.close();
    await queue.close();
    await Promise.all([queueConnection.quit(), eventsConnection.quit()]);
  }
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: { to: { type: 'string' }, queue: { type: 'boolean', default: false } },
  });
  const to = emailSchema.safeParse(values.to ?? '');
  if (!to.success) {
    throw new Error('Pass a valid recipient: --to <email>');
  }

  const env = loadEnv();
  const message = testEmail(to.data, env.NODE_ENV, new Date());
  const result = values.queue ? await sendViaQueue(env, message) : await sendDirect(env, message);
  process.stdout.write(`Test email to ${to.data} ${result}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `mail:test failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
